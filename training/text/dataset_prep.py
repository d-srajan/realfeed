"""
Dataset preparation for text AI detection model.

Combines multiple public datasets of human vs AI-generated text:
  - HC3 (Human ChatGPT Comparison Corpus)
  - OpenGPTText
  - Custom LinkedIn-style samples

Outputs: train.jsonl, val.jsonl, test.jsonl
"""

import json
import os
import random
from pathlib import Path

from datasets import load_dataset
from sklearn.model_selection import train_test_split


OUTPUT_DIR = Path(__file__).parent / "data"
SEED = 42
MAX_SAMPLES_PER_SOURCE = 50000  # cap per source to balance dataset
MAX_TEXT_LENGTH = 1024  # characters — LinkedIn posts are typically short


def load_hc3():
    """Load HC3 dataset — human answers vs ChatGPT answers."""
    print("Loading HC3 dataset...")
    samples = []

    try:
        ds = load_dataset("Hello-SimpleAI/HC3", "all", trust_remote_code=True)
        for split in ds:
            for row in ds[split]:
                # Human answers
                for answer in row.get("human_answers", []):
                    text = answer.strip()
                    if 20 < len(text) <= MAX_TEXT_LENGTH:
                        samples.append({"text": text, "label": 0, "source": "hc3_human"})

                # ChatGPT answers
                for answer in row.get("chatgpt_answers", []):
                    text = answer.strip()
                    if 20 < len(text) <= MAX_TEXT_LENGTH:
                        samples.append({"text": text, "label": 1, "source": "hc3_ai"})
    except Exception as e:
        print(f"  Warning: Could not load HC3: {e}")

    print(f"  HC3: {len(samples)} samples")
    return samples[:MAX_SAMPLES_PER_SOURCE]


def load_open_gpt_text():
    """Load OpenGPTText dataset — rephrased content by GPT."""
    print("Loading OpenGPTText dataset...")
    samples = []

    try:
        ds = load_dataset("aadityaubhat/GPT-wiki-intro", trust_remote_code=True)
        for row in ds["train"]:
            # Original human text
            human_text = row.get("wiki_intro", "").strip()
            if 20 < len(human_text) <= MAX_TEXT_LENGTH:
                samples.append({"text": human_text, "label": 0, "source": "gpt_wiki_human"})

            # GPT-generated text
            gpt_text = row.get("generated_intro", "").strip()
            if 20 < len(gpt_text) <= MAX_TEXT_LENGTH:
                samples.append({"text": gpt_text, "label": 1, "source": "gpt_wiki_ai"})
    except Exception as e:
        print(f"  Warning: Could not load OpenGPTText: {e}")

    print(f"  OpenGPTText: {len(samples)} samples")
    return samples[:MAX_SAMPLES_PER_SOURCE]


def generate_linkedin_samples():
    """
    Generate synthetic LinkedIn-style training samples.
    These are templates that mimic typical AI-generated LinkedIn posts.
    In production, you'd want to scrape real LinkedIn posts (with consent).
    """
    print("Generating LinkedIn-style samples...")
    samples = []

    # AI-style LinkedIn post templates
    ai_templates = [
        "I'm thrilled to announce that {action}. This has been an incredible journey, "
        "and I couldn't have done it without my amazing team. Here are 3 key lessons I learned:\n\n"
        "1. {lesson1}\n2. {lesson2}\n3. {lesson3}\n\n"
        "What are your thoughts? Let me know in the comments! 👇\n\n"
        "#leadership #growth #innovation",

        "Stop scrolling. This might change your perspective.\n\n"
        "I recently realized that {insight}. In today's fast-paced world, "
        "it's important to note that {observation}.\n\n"
        "Here's the thing — {conclusion}.\n\n"
        "Agree? ♻️ Repost if this resonated with you.\n\n"
        "#mindset #career #success",

        "Unpopular opinion: {opinion}.\n\n"
        "I know this might be controversial, but hear me out.\n\n"
        "{argument1}\n\n{argument2}\n\n"
        "The bottom line is this: {conclusion}.\n\n"
        "What do you think? Drop your thoughts below. 👇",
    ]

    fill_values = [
        {
            "action": "we've closed our Series B funding round",
            "lesson1": "Resilience is not optional — it's essential",
            "lesson2": "Your network is your net worth",
            "lesson3": "Always bet on people, not just ideas",
            "insight": "most successful leaders share one trait",
            "observation": "we often overlook the fundamentals",
            "opinion": "hustle culture is destroying innovation",
            "argument1": "When we prioritize output over outcomes, we lose sight of what matters.",
            "argument2": "The best companies I've seen foster deep work, not busy work.",
            "conclusion": "sustainable growth beats rapid burnout every time",
        },
        {
            "action": "I've been promoted to VP of Engineering",
            "lesson1": "Technical skills get you hired; soft skills get you promoted",
            "lesson2": "Mentorship is a two-way street",
            "lesson3": "Embrace discomfort — that's where growth happens",
            "insight": "networking isn't about collecting connections",
            "observation": "authentic relationships drive real results",
            "opinion": "remote work is the future and there's no going back",
            "argument1": "Productivity data consistently shows remote workers deliver more.",
            "argument2": "The talent pool becomes global when location doesn't matter.",
            "conclusion": "companies that resist this shift will lose their best people",
        },
    ]

    for template in ai_templates:
        for fills in fill_values:
            text = template.format(**fills)
            samples.append({"text": text, "label": 1, "source": "linkedin_synthetic_ai"})

    print(f"  LinkedIn synthetic: {len(samples)} samples")
    return samples


def prepare_dataset():
    """Combine all sources, balance, split, and save."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_samples = []
    all_samples.extend(load_hc3())
    all_samples.extend(load_open_gpt_text())
    all_samples.extend(generate_linkedin_samples())

    random.seed(SEED)
    random.shuffle(all_samples)

    # Balance classes
    human = [s for s in all_samples if s["label"] == 0]
    ai = [s for s in all_samples if s["label"] == 1]
    min_count = min(len(human), len(ai))
    balanced = human[:min_count] + ai[:min_count]
    random.shuffle(balanced)

    print(f"\nBalanced dataset: {len(balanced)} samples ({min_count} per class)")

    # Split: 80% train, 10% val, 10% test
    train, temp = train_test_split(balanced, test_size=0.2, random_state=SEED,
                                    stratify=[s["label"] for s in balanced])
    val, test = train_test_split(temp, test_size=0.5, random_state=SEED,
                                  stratify=[s["label"] for s in temp])

    # Save as JSONL
    for name, data in [("train", train), ("val", val), ("test", test)]:
        path = OUTPUT_DIR / f"{name}.jsonl"
        with open(path, "w") as f:
            for sample in data:
                f.write(json.dumps(sample) + "\n")
        print(f"  {name}: {len(data)} samples → {path}")

    # Save label mapping
    with open(OUTPUT_DIR / "label_map.json", "w") as f:
        json.dump({"0": "human", "1": "ai"}, f, indent=2)

    print("\nDataset preparation complete!")


if __name__ == "__main__":
    prepare_dataset()
