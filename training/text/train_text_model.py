"""
Fine-tune DistilBERT for AI text detection (binary classification).

Usage:
    python train_text_model.py
    python train_text_model.py --epochs 5 --batch_size 32 --lr 2e-5

Outputs:
    ./checkpoints/best_model/    — PyTorch model + tokenizer
    ./results/                    — Training metrics
"""

import argparse
import json
import os
from pathlib import Path

import evaluate
import numpy as np
import torch
from datasets import Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    Trainer,
    TrainingArguments,
    EarlyStoppingCallback,
)


DATA_DIR = Path(__file__).parent / "data"
CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
RESULTS_DIR = Path(__file__).parent / "results"
MODEL_NAME = "distilbert-base-uncased"
MAX_LENGTH = 256  # tokens — LinkedIn posts are short


def load_data(split):
    """Load JSONL data file into HuggingFace Dataset."""
    path = DATA_DIR / f"{split}.jsonl"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Run dataset_prep.py first."
        )

    samples = []
    with open(path) as f:
        for line in f:
            samples.append(json.loads(line))

    return Dataset.from_list(samples)


def tokenize_fn(examples, tokenizer):
    return tokenizer(
        examples["text"],
        truncation=True,
        max_length=MAX_LENGTH,
        padding=False,  # DataCollator handles padding
    )


def compute_metrics(eval_pred):
    """Compute accuracy, precision, recall, F1."""
    accuracy_metric = evaluate.load("accuracy")
    precision_metric = evaluate.load("precision")
    recall_metric = evaluate.load("recall")
    f1_metric = evaluate.load("f1")

    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)

    return {
        "accuracy": accuracy_metric.compute(predictions=predictions, references=labels)["accuracy"],
        "precision": precision_metric.compute(predictions=predictions, references=labels)["precision"],
        "recall": recall_metric.compute(predictions=predictions, references=labels)["recall"],
        "f1": f1_metric.compute(predictions=predictions, references=labels)["f1"],
    }


def train(args):
    print(f"Loading model: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=2,
        id2label={0: "human", 1: "ai"},
        label2id={"human": 0, "ai": 1},
    )

    print("Loading datasets...")
    train_ds = load_data("train")
    val_ds = load_data("val")

    print(f"  Train: {len(train_ds)} samples")
    print(f"  Val:   {len(val_ds)} samples")

    # Tokenize
    train_ds = train_ds.map(
        lambda x: tokenize_fn(x, tokenizer), batched=True,
        remove_columns=["text", "source"],
    )
    val_ds = val_ds.map(
        lambda x: tokenize_fn(x, tokenizer), batched=True,
        remove_columns=["text", "source"],
    )

    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)

    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(CHECKPOINT_DIR),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size * 2,
        learning_rate=args.lr,
        weight_decay=0.01,
        warmup_ratio=0.1,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        greater_is_better=True,
        logging_dir=str(RESULTS_DIR / "logs"),
        logging_steps=100,
        save_total_limit=3,
        fp16=torch.cuda.is_available(),
        report_to="none",
        seed=42,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        tokenizer=tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=3)],
    )

    print("\nStarting training...")
    train_result = trainer.train()

    # Save best model
    best_model_dir = CHECKPOINT_DIR / "best_model"
    trainer.save_model(str(best_model_dir))
    tokenizer.save_pretrained(str(best_model_dir))

    # Save training metrics
    metrics = train_result.metrics
    trainer.log_metrics("train", metrics)
    trainer.save_metrics("train", metrics)

    # Evaluate on validation set
    print("\nEvaluating...")
    eval_metrics = trainer.evaluate()
    trainer.log_metrics("eval", eval_metrics)
    trainer.save_metrics("eval", eval_metrics)

    # Save metrics to JSON
    with open(RESULTS_DIR / "metrics.json", "w") as f:
        json.dump({
            "train": metrics,
            "eval": eval_metrics,
            "model": MODEL_NAME,
            "max_length": MAX_LENGTH,
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "lr": args.lr,
        }, f, indent=2)

    print(f"\nTraining complete!")
    print(f"  Best model saved to: {best_model_dir}")
    print(f"  Val F1: {eval_metrics.get('eval_f1', 'N/A'):.4f}")
    print(f"  Val Accuracy: {eval_metrics.get('eval_accuracy', 'N/A'):.4f}")


def test(args):
    """Run evaluation on test set."""
    best_model_dir = CHECKPOINT_DIR / "best_model"
    if not best_model_dir.exists():
        raise FileNotFoundError("No trained model found. Run training first.")

    print(f"Loading model from {best_model_dir}")
    tokenizer = AutoTokenizer.from_pretrained(str(best_model_dir))
    model = AutoModelForSequenceClassification.from_pretrained(str(best_model_dir))

    test_ds = load_data("test")
    print(f"  Test: {len(test_ds)} samples")

    test_ds = test_ds.map(
        lambda x: tokenize_fn(x, tokenizer), batched=True,
        remove_columns=["text", "source"],
    )

    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)

    trainer = Trainer(
        model=model,
        tokenizer=tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
    )

    print("\nRunning test evaluation...")
    test_metrics = trainer.evaluate(test_ds)
    print(f"\nTest Results:")
    print(f"  Accuracy:  {test_metrics.get('eval_accuracy', 'N/A'):.4f}")
    print(f"  Precision: {test_metrics.get('eval_precision', 'N/A'):.4f}")
    print(f"  Recall:    {test_metrics.get('eval_recall', 'N/A'):.4f}")
    print(f"  F1:        {test_metrics.get('eval_f1', 'N/A'):.4f}")

    with open(RESULTS_DIR / "test_metrics.json", "w") as f:
        json.dump(test_metrics, f, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train DistilBERT for AI text detection")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--test", action="store_true", help="Run test evaluation only")

    args = parser.parse_args()

    if args.test:
        test(args)
    else:
        train(args)
