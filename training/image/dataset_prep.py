"""
Dataset preparation for AI image detection model.

Sources:
  - Real images: COCO (subset), Unsplash random samples
  - AI images: Public Stable Diffusion datasets, DALL-E generations

Key: images are augmented with JPEG compression + resizing to simulate
social media processing (LinkedIn recompresses all uploads).

Outputs: train/, val/, test/ directories with class subdirectories
"""

import os
import random
from pathlib import Path

from datasets import load_dataset
from PIL import Image
from tqdm import tqdm


OUTPUT_DIR = Path(__file__).parent / "data"
SEED = 42
TARGET_SIZE = (224, 224)  # EfficientNet-Lite input size
MAX_SAMPLES_PER_CLASS = 25000


def apply_social_media_augmentation(img):
    """
    Simulate social media image processing pipeline:
    1. Resize (LinkedIn resizes to various dimensions)
    2. JPEG compress (quality 70-85, typical for social platforms)
    3. Resize again to target
    """
    import io

    # Random resize to simulate upload processing
    scale = random.uniform(0.5, 1.5)
    new_size = (int(img.width * scale), int(img.height * scale))
    new_size = (max(new_size[0], 64), max(new_size[1], 64))
    img = img.resize(new_size, Image.LANCZOS)

    # JPEG compression (simulates platform recompression)
    quality = random.randint(70, 85)
    buffer = io.BytesIO()
    img = img.convert("RGB")
    img.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    img = Image.open(buffer)

    # Final resize to target
    img = img.resize(TARGET_SIZE, Image.LANCZOS)

    return img


def load_real_images():
    """Load real photographs from public datasets."""
    print("Loading real images...")
    images = []

    try:
        # COCO subset — diverse real photographs
        ds = load_dataset("detection-datasets/coco", split="train", streaming=True)
        count = 0
        for row in ds:
            if count >= MAX_SAMPLES_PER_CLASS:
                break
            img = row.get("image")
            if img and img.width >= 64 and img.height >= 64:
                images.append(("real", img))
                count += 1
                if count % 1000 == 0:
                    print(f"  Real images: {count}")
    except Exception as e:
        print(f"  Warning: Could not load COCO: {e}")

    print(f"  Total real images: {len(images)}")
    return images


def load_ai_images():
    """Load AI-generated images from public datasets."""
    print("Loading AI-generated images...")
    images = []

    try:
        # Stable Diffusion generated images
        ds = load_dataset(
            "poloclub/diffusiondb", "2m_first_1k",
            split="train", trust_remote_code=True
        )
        count = 0
        for row in ds:
            if count >= MAX_SAMPLES_PER_CLASS:
                break
            img = row.get("image")
            if img and img.width >= 64 and img.height >= 64:
                images.append(("ai", img))
                count += 1
                if count % 1000 == 0:
                    print(f"  AI images: {count}")
    except Exception as e:
        print(f"  Warning: Could not load DiffusionDB: {e}")

    print(f"  Total AI images: {len(images)}")
    return images


def save_dataset(images, split_name):
    """Save images to split directories."""
    split_dir = OUTPUT_DIR / split_name
    (split_dir / "real").mkdir(parents=True, exist_ok=True)
    (split_dir / "ai").mkdir(parents=True, exist_ok=True)

    for i, (label, img) in enumerate(tqdm(images, desc=f"Saving {split_name}")):
        # Apply social media augmentation to ~70% of images
        if random.random() < 0.7:
            img = apply_social_media_augmentation(img)
        else:
            img = img.convert("RGB").resize(TARGET_SIZE, Image.LANCZOS)

        path = split_dir / label / f"{i:06d}.jpg"
        img.save(str(path), "JPEG", quality=90)


def prepare_dataset():
    """Full pipeline: load, balance, split, augment, save."""
    random.seed(SEED)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    real_images = load_real_images()
    ai_images = load_ai_images()

    # Balance
    min_count = min(len(real_images), len(ai_images))
    real_images = random.sample(real_images, min_count) if len(real_images) > min_count else real_images
    ai_images = random.sample(ai_images, min_count) if len(ai_images) > min_count else ai_images

    all_images = real_images + ai_images
    random.shuffle(all_images)

    print(f"\nBalanced dataset: {len(all_images)} images ({min_count} per class)")

    # Split: 80/10/10
    n = len(all_images)
    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    train_imgs = all_images[:train_end]
    val_imgs = all_images[train_end:val_end]
    test_imgs = all_images[val_end:]

    print(f"  Train: {len(train_imgs)}")
    print(f"  Val:   {len(val_imgs)}")
    print(f"  Test:  {len(test_imgs)}")

    save_dataset(train_imgs, "train")
    save_dataset(val_imgs, "val")
    save_dataset(test_imgs, "test")

    print("\nDataset preparation complete!")


if __name__ == "__main__":
    prepare_dataset()
