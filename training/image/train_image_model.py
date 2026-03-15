"""
Fine-tune EfficientNet-Lite0 for AI image detection (binary classification).

Usage:
    python train_image_model.py
    python train_image_model.py --epochs 10 --batch_size 64 --lr 1e-4

Outputs:
    ./checkpoints/best_model.pth  — PyTorch model weights
    ./results/                     — Training metrics
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms, models
from tqdm import tqdm
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score


DATA_DIR = Path(__file__).parent / "data"
CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
RESULTS_DIR = Path(__file__).parent / "results"
IMAGE_SIZE = 224


def get_transforms(is_train=True):
    """Image transforms — training has augmentation, val/test don't."""
    if is_train:
        return transforms.Compose([
            transforms.RandomResizedCrop(IMAGE_SIZE, scale=(0.8, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
    else:
        return transforms.Compose([
            transforms.Resize(IMAGE_SIZE + 32),
            transforms.CenterCrop(IMAGE_SIZE),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])


def create_model():
    """
    Create EfficientNet-B0 (Lite variant via reduced complexity).
    Using torchvision's efficientnet_b0 as base — closest to Lite0.
    Replace classifier head for binary classification.
    """
    model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)

    # Freeze early layers, fine-tune later layers
    for param in list(model.parameters())[:-20]:
        param.requires_grad = False

    # Replace classifier
    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(p=0.3),
        nn.Linear(in_features, 2),
    )

    return model


def train_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss = 0
    all_preds, all_labels = [], []

    for images, labels in tqdm(loader, desc="Training", leave=False):
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad()
        outputs = model(images)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item()
        preds = outputs.argmax(dim=1).cpu().numpy()
        all_preds.extend(preds)
        all_labels.extend(labels.cpu().numpy())

    return {
        "loss": total_loss / len(loader),
        "accuracy": accuracy_score(all_labels, all_preds),
    }


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    all_preds, all_labels = [], []

    for images, labels in tqdm(loader, desc="Evaluating", leave=False):
        images, labels = images.to(device), labels.to(device)

        outputs = model(images)
        loss = criterion(outputs, labels)

        total_loss += loss.item()
        preds = outputs.argmax(dim=1).cpu().numpy()
        all_preds.extend(preds)
        all_labels.extend(labels.cpu().numpy())

    return {
        "loss": total_loss / len(loader),
        "accuracy": accuracy_score(all_labels, all_preds),
        "precision": precision_score(all_labels, all_preds, zero_division=0),
        "recall": recall_score(all_labels, all_preds, zero_division=0),
        "f1": f1_score(all_labels, all_preds, zero_division=0),
    }


def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else
                          "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Using device: {device}")

    # Data loaders
    for split in ["train", "val"]:
        if not (DATA_DIR / split).exists():
            raise FileNotFoundError(
                f"{DATA_DIR / split} not found. Run dataset_prep.py first."
            )

    train_ds = datasets.ImageFolder(str(DATA_DIR / "train"), transform=get_transforms(True))
    val_ds = datasets.ImageFolder(str(DATA_DIR / "val"), transform=get_transforms(False))

    print(f"Classes: {train_ds.classes}")
    print(f"Train: {len(train_ds)} images")
    print(f"Val:   {len(val_ds)} images")

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                               num_workers=4, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size * 2, shuffle=False,
                             num_workers=4, pin_memory=True)

    # Model
    model = create_model().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=args.lr,
        weight_decay=0.01,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    best_f1 = 0
    patience_counter = 0
    history = []

    print(f"\nTraining for {args.epochs} epochs...")
    for epoch in range(1, args.epochs + 1):
        print(f"\n--- Epoch {epoch}/{args.epochs} ---")

        train_metrics = train_epoch(model, train_loader, criterion, optimizer, device)
        val_metrics = evaluate(model, val_loader, criterion, device)
        scheduler.step()

        print(f"  Train Loss: {train_metrics['loss']:.4f}, Acc: {train_metrics['accuracy']:.4f}")
        print(f"  Val   Loss: {val_metrics['loss']:.4f}, Acc: {val_metrics['accuracy']:.4f}, "
              f"F1: {val_metrics['f1']:.4f}")

        history.append({"epoch": epoch, "train": train_metrics, "val": val_metrics})

        # Save best model
        if val_metrics["f1"] > best_f1:
            best_f1 = val_metrics["f1"]
            patience_counter = 0
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_metrics": val_metrics,
                "classes": train_ds.classes,
            }, str(CHECKPOINT_DIR / "best_model.pth"))
            print(f"  Saved best model (F1: {best_f1:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= 5:
                print(f"  Early stopping at epoch {epoch}")
                break

    # Save training history
    with open(RESULTS_DIR / "history.json", "w") as f:
        json.dump(history, f, indent=2, default=str)

    print(f"\nTraining complete! Best val F1: {best_f1:.4f}")


def test(args):
    """Evaluate on test set."""
    device = torch.device("cuda" if torch.cuda.is_available() else
                          "mps" if torch.backends.mps.is_available() else "cpu")

    checkpoint_path = CHECKPOINT_DIR / "best_model.pth"
    if not checkpoint_path.exists():
        raise FileNotFoundError("No trained model found. Run training first.")

    checkpoint = torch.load(str(checkpoint_path), map_location=device)
    model = create_model().to(device)
    model.load_state_dict(checkpoint["model_state_dict"])

    test_ds = datasets.ImageFolder(str(DATA_DIR / "test"), transform=get_transforms(False))
    test_loader = DataLoader(test_ds, batch_size=args.batch_size * 2, shuffle=False,
                              num_workers=4, pin_memory=True)

    print(f"Test: {len(test_ds)} images")

    criterion = nn.CrossEntropyLoss()
    metrics = evaluate(model, test_loader, criterion, device)

    print(f"\nTest Results:")
    print(f"  Accuracy:  {metrics['accuracy']:.4f}")
    print(f"  Precision: {metrics['precision']:.4f}")
    print(f"  Recall:    {metrics['recall']:.4f}")
    print(f"  F1:        {metrics['f1']:.4f}")

    with open(RESULTS_DIR / "test_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train EfficientNet for AI image detection")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--test", action="store_true", help="Run test evaluation only")

    args = parser.parse_args()

    if args.test:
        test(args)
    else:
        train(args)
