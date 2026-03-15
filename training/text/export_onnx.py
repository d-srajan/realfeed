"""
Export trained DistilBERT model to ONNX format + INT8 quantization.

Usage:
    python export_onnx.py
    python export_onnx.py --quantize --output ../../extension/models/text-classifier.onnx

Outputs:
    text-classifier.onnx          — Full precision ONNX model
    text-classifier-quantized.onnx — INT8 quantized (for browser deployment)
    tokenizer/                     — Tokenizer files for browser use
"""

import argparse
import json
import shutil
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from optimum.onnxruntime import ORTModelForSequenceClassification
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from optimum.onnxruntime import ORTQuantizer


CHECKPOINT_DIR = Path(__file__).parent / "checkpoints" / "best_model"
DEFAULT_OUTPUT = Path(__file__).parent / "exported"


def export_onnx(args):
    if not CHECKPOINT_DIR.exists():
        raise FileNotFoundError(
            f"No trained model at {CHECKPOINT_DIR}. Run train_text_model.py first."
        )

    output_dir = Path(args.output).parent if args.output else DEFAULT_OUTPUT
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading model from {CHECKPOINT_DIR}...")
    tokenizer = AutoTokenizer.from_pretrained(str(CHECKPOINT_DIR))

    # Export to ONNX using Optimum
    print("Exporting to ONNX...")
    ort_model = ORTModelForSequenceClassification.from_pretrained(
        str(CHECKPOINT_DIR),
        export=True,
    )

    # Save ONNX model
    onnx_path = output_dir / "onnx"
    ort_model.save_pretrained(str(onnx_path))
    tokenizer.save_pretrained(str(onnx_path))

    model_file = onnx_path / "model.onnx"
    model_size = model_file.stat().st_size / (1024 * 1024)
    print(f"  ONNX model saved: {model_file} ({model_size:.1f} MB)")

    if args.quantize:
        print("\nQuantizing to INT8...")
        quantizer = ORTQuantizer.from_pretrained(str(onnx_path))

        qconfig = AutoQuantizationConfig.avx512_vnni(
            is_static=False,  # dynamic quantization — no calibration data needed
            per_channel=True,
        )

        quantized_path = output_dir / "onnx-quantized"
        quantizer.quantize(
            save_dir=str(quantized_path),
            quantization_config=qconfig,
        )

        quantized_file = quantized_path / "model_quantized.onnx"
        if quantized_file.exists():
            q_size = quantized_file.stat().st_size / (1024 * 1024)
            print(f"  Quantized model: {quantized_file} ({q_size:.1f} MB)")
            print(f"  Size reduction: {(1 - q_size / model_size) * 100:.0f}%")

            # Copy tokenizer to quantized dir too
            tokenizer.save_pretrained(str(quantized_path))

        # Copy to final output path if specified
        if args.output:
            final_path = Path(args.output)
            final_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(quantized_file), str(final_path))
            print(f"\n  Final model copied to: {final_path}")
    else:
        if args.output:
            final_path = Path(args.output)
            final_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(model_file), str(final_path))
            print(f"\n  Final model copied to: {final_path}")

    # Export tokenizer config for browser usage
    export_tokenizer_for_browser(tokenizer, output_dir / "tokenizer")

    print("\nExport complete!")


def export_tokenizer_for_browser(tokenizer, output_dir):
    """
    Export tokenizer files needed for in-browser tokenization.
    The browser will use HuggingFace tokenizers WASM build.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    tokenizer.save_pretrained(str(output_dir))

    # Also save a simplified config for the browser
    config = {
        "model_type": "distilbert",
        "max_length": 256,
        "id2label": {"0": "human", "1": "ai"},
        "label2id": {"human": 0, "ai": 1},
    }
    with open(output_dir / "browser_config.json", "w") as f:
        json.dump(config, f, indent=2)

    print(f"  Tokenizer exported to: {output_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export DistilBERT to ONNX")
    parser.add_argument(
        "--output", "-o",
        help="Output path for the final ONNX model file",
    )
    parser.add_argument(
        "--quantize", "-q",
        action="store_true",
        help="Apply INT8 quantization (recommended for browser)",
    )

    args = parser.parse_args()
    export_onnx(args)
