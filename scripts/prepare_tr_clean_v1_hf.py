#!/usr/bin/env python3
"""Prepare `tr-clean-v1` from a Turkish HF instruction dataset.

Usage:
  python scripts/prepare_tr_clean_v1_hf.py

Default source:
  `tascib/turkish-instruction`

Output:
  `infrastructure/lora-trials/candidates/2026-04-19_tr-clean-v1/train/`
    - `tr-clean-v1-train.jsonl`
    - `tr-clean-v1-dev.jsonl`
"""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_DATASET_ID = "tascib/turkish-instruction"
DEFAULT_DATASET_SPLIT = "train"
DEFAULT_TARGET_TOTAL = 360
DEFAULT_TRAIN_COUNT = 300
DEFAULT_DEV_COUNT = 60
DEFAULT_SEED = 42

TURKISH_SPECIFIC_CHARS = "çğıöşüÇĞİÖŞÜ"
COMMON_TR_WORDS = {
    "ve",
    "bir",
    "bu",
    "şu",
    "için",
    "ile",
    "gibi",
    "de",
    "da",
    "mı",
    "mi",
    "ne",
    "nasıl",
    "nedir",
    "neden",
    "kısa",
    "açıkla",
    "cevap",
    "model",
    "soru",
    "yanıt",
    "olarak",
    "ama",
    "çünkü",
    "ancak",
    "daha",
    "çok",
    "az",
}
ROLEPLAY_MARKERS = (
    "roleplay",
    "rol yap",
    "senaryo",
    "hikaye",
    "öykü",
    "şiir",
    "poem",
    "lyrics",
    "creative writing",
    "masal",
    "jailbreak",
)
ENGLISH_MARKERS = (
    "the",
    "and",
    "you",
    "your",
    "please",
    "explain",
    "answer",
    "assistant",
    "user",
    "write",
    "story",
    "poem",
    "sentence",
    "translate",
)

WORD_RE = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşü]+", re.UNICODE)


@dataclass(frozen=True)
class Candidate:
    source: str
    user: str
    assistant: str
    score: float


def normalize_space(text: str) -> str:
    return " ".join(text.split()).strip()


def word_tokens(text: str) -> list[str]:
    return WORD_RE.findall(text)


def english_token_ratio(text: str) -> float:
    tokens = word_tokens(text)
    if not tokens:
        return 0.0
    english = sum(1 for tok in tokens if tok.isascii() and len(tok) >= 3)
    return english / len(tokens)


def turkish_signal(text: str) -> float:
    tokens = word_tokens(text)
    if not tokens:
        return 0.0
    hits = 0
    for tok in tokens:
        low = tok.lower()
        if any(ch in tok for ch in TURKISH_SPECIFIC_CHARS) or low in COMMON_TR_WORDS:
            hits += 1
    return hits / len(tokens)


def has_roleplay_or_noise(text: str) -> bool:
    low = text.lower()
    return any(marker in low for marker in ROLEPLAY_MARKERS)


def has_english_bloat(text: str) -> bool:
    low = text.lower()
    if any(marker in low for marker in ENGLISH_MARKERS):
        return True
    return english_token_ratio(text) > 0.35


def is_good_length(user: str, assistant: str) -> bool:
    return 12 <= len(user) <= 600 and 20 <= len(assistant) <= 1200


def quality_score(user: str, assistant: str, source: str) -> float:
    combined = f"{user} {assistant}"
    score = 0.0
    score += min(1.0, turkish_signal(combined) * 2.0) * 0.45
    score += 0.25 if any(ch in combined for ch in TURKISH_SPECIFIC_CHARS) else 0.0
    score += min(1.0, len(assistant) / 500.0) * 0.15
    score += min(1.0, len(user) / 250.0) * 0.10
    score += 0.05 if source and source != "unknown" else 0.0
    if has_english_bloat(combined):
        score -= 0.35
    if has_roleplay_or_noise(combined):
        score -= 0.40
    return score


def extract_texts(example: dict[str, Any]) -> tuple[str, str, str] | None:
    source = str(example.get("source") or example.get("dataset") or "unknown").strip() or "unknown"

    if "messages" in example and isinstance(example["messages"], list):
        user_parts: list[str] = []
        assistant_parts: list[str] = []
        for msg in example["messages"]:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role") or "").strip().lower()
            content = normalize_space(str(msg.get("content") or ""))
            if not content:
                continue
            if role == "user":
                user_parts.append(content)
            elif role == "assistant":
                assistant_parts.append(content)
        if user_parts and assistant_parts:
            return source, "\n\n".join(user_parts), "\n\n".join(assistant_parts)
        return None

    instruction = normalize_space(
        str(
            example.get("instruction")
            or example.get("prompt")
            or example.get("question")
            or example.get("input")
            or ""
        )
    )
    context = normalize_space(str(example.get("input") or example.get("context") or ""))
    output = normalize_space(
        str(
            example.get("output")
            or example.get("answer")
            or example.get("response")
            or example.get("completion")
            or ""
        )
    )
    if not instruction or not output:
        return None
    user = instruction if not context else f"{instruction}\n\nBağlam:\n{context}"
    return source, user, output


def filter_candidate(source: str, user: str, assistant: str) -> bool:
    combined = f"{user} {assistant}"
    if not is_good_length(user, assistant):
        return False
    if turkish_signal(combined) <= 0.10 and not any(ch in combined for ch in TURKISH_SPECIFIC_CHARS):
        return False
    if has_roleplay_or_noise(combined):
        return False
    if has_english_bloat(combined):
        return False
    if re.search(r"```|<\|im_start\|>|<\|im_end\|>", combined, flags=re.IGNORECASE):
        return False
    if len(set(word_tokens(assistant))) < 4 and len(assistant) > 120:
        return False
    return True


def load_hf_dataset(dataset_id: str, split: str):
    try:
        from datasets import load_dataset
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SystemExit(
            "Missing dependency: `datasets`. Install it in the Python environment first."
        ) from exc
    ds = load_dataset(dataset_id, split=split)
    return ds


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare Turkish clean-v1 support dataset from HF.")
    parser.add_argument("--dataset-id", default=DEFAULT_DATASET_ID)
    parser.add_argument("--split", default=DEFAULT_DATASET_SPLIT)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--target-total", type=int, default=DEFAULT_TARGET_TOTAL)
    parser.add_argument("--train-count", type=int, default=DEFAULT_TRAIN_COUNT)
    parser.add_argument("--dev-count", type=int, default=DEFAULT_DEV_COUNT)
    parser.add_argument(
        "--out-dir",
        default="infrastructure/lora-trials/candidates/2026-04-19_tr-clean-v1/train",
    )
    args = parser.parse_args()

    if args.train_count + args.dev_count != args.target_total:
        raise SystemExit("train-count + dev-count must equal target-total")

    raw = load_hf_dataset(args.dataset_id, args.split)
    if len(raw) == 0:
        raise SystemExit(f"Dataset is empty: {args.dataset_id}:{args.split}")

    rng = random.Random(args.seed)
    source_buckets: dict[str, list[Candidate]] = defaultdict(list)

    seen_pairs: set[str] = set()
    kept = 0
    for example in raw:
        extracted = extract_texts(example)
        if not extracted:
            continue
        source, user, assistant = extracted
        user = normalize_space(user)
        assistant = normalize_space(assistant)
        if not filter_candidate(source, user, assistant):
            continue
        pair_key = normalize_space(f"{user}\n{assistant}").lower()
        if pair_key in seen_pairs:
            continue
        seen_pairs.add(pair_key)
        source_buckets[source].append(
            Candidate(
                source=source,
                user=user,
                assistant=assistant,
                score=quality_score(user, assistant, source),
            )
        )
        kept += 1

    if kept < args.target_total:
        raise SystemExit(
            f"Filtered pool too small: {kept} < {args.target_total}. "
            "Loosen filters or use a larger HF source."
        )

    for bucket in source_buckets.values():
        bucket.sort(key=lambda item: (-item.score, len(item.assistant), len(item.user)))
        rng.shuffle(bucket)

    sources = list(source_buckets.keys())
    rng.shuffle(sources)
    if len(sources) == 1:
        per_source_cap = args.target_total
    else:
        per_source_cap = max(1, args.target_total // 2)

    counts: Counter[str] = Counter()
    selected: list[Candidate] = []
    while len(selected) < args.target_total:
        progressed = False
        for source in sources:
            if len(selected) >= args.target_total:
                break
            if counts[source] >= per_source_cap:
                continue
            bucket = source_buckets.get(source)
            if not bucket:
                continue
            candidate = bucket.pop(0)
            selected.append(candidate)
            counts[source] += 1
            progressed = True
        if not progressed:
            break

    if len(selected) < args.target_total:
        raise SystemExit(
            f"Could only select {len(selected)} examples; expected {args.target_total}. "
            "Need a bigger or less restrictive source."
        )

    rng.shuffle(selected)
    train = selected[: args.train_count]
    dev = selected[args.train_count : args.target_total]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    train_path = out_dir / "tr-clean-v1-train.jsonl"
    dev_path = out_dir / "tr-clean-v1-dev.jsonl"

    write_jsonl(
        train_path,
        [{"messages": [{"role": "user", "content": c.user}, {"role": "assistant", "content": c.assistant}]} for c in train],
    )
    write_jsonl(
        dev_path,
        [{"messages": [{"role": "user", "content": c.user}, {"role": "assistant", "content": c.assistant}]} for c in dev],
    )

    print(f"dataset_id={args.dataset_id}")
    print(f"split={args.split}")
    print(f"raw_examples={len(raw)}")
    print(f"filtered_examples={kept}")
    print(f"selected_total={len(selected)}")
    print(f"train={len(train)} dev={len(dev)}")
    print(f"train_path={train_path}")
    print(f"dev_path={dev_path}")
    print(f"seed={args.seed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
