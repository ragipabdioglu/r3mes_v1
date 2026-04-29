#!/usr/bin/env python3
"""Clean the raw doctor-role dataset into a Qwen-3B behavior LoRA dataset."""

from __future__ import annotations

import json
import random
from pathlib import Path


SOURCE = Path("doctor_role_dataset.jsonl")
ROOT = Path("infrastructure/lora-trials/candidates/2026-04-23_doctor-role-qwen3b-v1/train")
TRAIN_OUT = ROOT / "doctor-role-qwen3b-v1-train.jsonl"
DEV_OUT = ROOT / "doctor-role-qwen3b-v1-dev.jsonl"

SYSTEM_PROMPT = (
    "Sen sakin, profesyonel ve güvenli bir doktorsun. Türkçe, net ve ölçülü cevap ver. "
    "Kesin tanı koyuyormuş gibi konuşma; gerekirse muayene, tetkik veya uzman değerlendirmesi öner."
)


def normalize(text: str) -> str:
    return " ".join((text or "").strip().split())


def keep_example(instruction: str, response: str) -> bool:
    if len(instruction) < 25 or len(instruction) > 1400:
        return False
    if len(response) < 40 or len(response) > 600:
        return False
    if response.count("!") > 1:
        return False
    if response.lower() in {
        "hayır.",
        "hayır olmaz.",
        "geçmiş olsun.",
        "gebelik yok.",
    }:
        return False
    return True


def load_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            instruction = normalize(str(raw.get("instruction", "")))
            response = normalize(str(raw.get("response", "")))
            if not keep_example(instruction, response):
                continue
            key = (instruction, response)
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": instruction},
                        {"role": "assistant", "content": response},
                    ]
                }
            )
    return rows


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> int:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source dataset: {SOURCE}")

    ROOT.mkdir(parents=True, exist_ok=True)
    rows = load_rows(SOURCE)
    if len(rows) < 300:
        raise SystemExit(f"Dataset too small after cleanup: {len(rows)} rows")

    random.seed(42)
    random.shuffle(rows)

    dev_size = min(120, max(80, int(len(rows) * 0.1)))
    dev = rows[:dev_size]
    train = rows[dev_size:]

    dump_jsonl(TRAIN_OUT, train)
    dump_jsonl(DEV_OUT, dev)

    print(
        json.dumps(
            {
                "total": len(rows),
                "train": len(train),
                "dev": len(dev),
                "trainPath": str(TRAIN_OUT),
                "devPath": str(DEV_OUT),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
