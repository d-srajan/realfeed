"""
Export trained EfficientNet model to ONNX format + INT8 quantization.

Usage:
    python export_onnx.py
    python export_onnx.py --quantize --output ../../extension/models/image-classifier.onnx

Outputs:
    image-classifier.onnx             — Full precision ONNX model
    image-classifier-quantized.onnx   — INT8 quantized (for browser deployment)
"""

import argparse
import shutil
from pathlib import Path

import torch
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

from train_image_model import create_model


CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
DEFAULT_OUTPUT = Path(__file__).parent / "exported"
IMAGE_SIZE = 224


def export_onnx(args):
    checkpoint_path = CHECKPOINT_DIR / "best_model.pth"
    if not checkpoint_path.exists():
        raise FileNotFoundError(
            f"No trained model at {checkpoint_path}. Run train_image_model.py first."
        )

    output_dir = Path(args.output).parent if args.output else DEFAULT_OUTPUT
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load model
    print(f"Loading model from {checkpoint_path}...")
    device = torch.device("cpu")
    checkpoint = torch.load(str(checkpoint_path), map_location=device)

    model = create_model()
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    # Dummy input
    dummy_input = torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE)

    # Export to ONNX
    onnx_path = output_dir / "image-classifier.onnx"
    print(f"Exporting to ONNX: {onnx_path}")

    torch.onnx.export(
        model,
        dummy_input,
        str(onnx_path),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["pixel_values"],
        output_names=["logits"],
        dynamic_axes={
            "pixel_values": {0: "batch_size"},
            "logits": {0: "batch_size"},
        },
    )

    # Validate
    onnx_model = onnx.load(str(onnx_path))
    onnx.checker.check_model(onnx_model)

    model_size = onnx_path.stat().st_size / (1024 * 1024)
    print(f"  ONNX model: {model_size:.1f} MB")

    if args.quantize:
        print("\nQuantizing to INT8...")
        quantized_path = output_dir / "image-classifier-quantized.onnx"

        quantize_dynamic(
            model_input=str(onnx_path),
            model_output=str(quantized_path),
            weight_type=QuantType.QUInt8,
            optimize_model=True,
        )

        q_size = quantized_path.stat().st_size / (1024 * 1024)
        print(f"  Quantized model: {q_size:.1f} MB")
        print(f"  Size reduction: {(1 - q_size / model_size) * 100:.0f}%")

        if args.output:
            final_path = Path(args.output)
            final_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(quantized_path), str(final_path))
            print(f"\n  Final model copied to: {final_path}")
    else:
        if args.output:
            final_path = Path(args.output)
            final_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(onnx_path), str(final_path))
            print(f"\n  Final model copied to: {final_path}")

    # Save preprocessing config for browser
    import json
    config = {
        "input_size": IMAGE_SIZE,
        "input_name": "pixel_values",
        "output_name": "logits",
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
        "id2label": {"0": "real", "1": "ai"},
    }
    with open(output_dir / "image_config.json", "w") as f:
        json.dump(config, f, indent=2)

    print("\nExport complete!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export EfficientNet to ONNX")
    parser.add_argument("--output", "-o", help="Output path for final ONNX model")
    parser.add_argument("--quantize", "-q", action="store_true",
                        help="Apply INT8 quantization (recommended for browser)")
    args = parser.parse_args()
    export_onnx(args)
