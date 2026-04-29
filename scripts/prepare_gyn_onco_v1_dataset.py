#!/usr/bin/env python3
"""Prepare the user-provided gynecologic oncology JSONL dataset for llama-finetune-lora.

Input rows are expected in the form:
  {"instruction": "...", "response": "..."}

Output rows follow the existing repo convention:
  {"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
"""

from __future__ import annotations

import json
import random
from pathlib import Path


SOURCE = Path("jinekolojik_onkoloji_lora.jsonl")
ROOT = Path("infrastructure/lora-trials/candidates/2026-04-22_gyn-onco-v1/train")
TRAIN_OUT = ROOT / "gyn-onco-v1-train.jsonl"
DEV_OUT = ROOT / "gyn-onco-v1-dev.jsonl"


def normalize(text: str) -> str:
    return " ".join((text or "").strip().split())


def load_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            instruction = normalize(str(raw.get("instruction", "")))
            response = normalize(str(raw.get("response", "")))
            if not instruction or not response:
                continue
            key = (instruction, response)
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "messages": [
                        {"role": "user", "content": instruction},
                        {"role": "assistant", "content": response},
                    ]
                }
            )
    return rows


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> int:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source dataset: {SOURCE}")

    ROOT.mkdir(parents=True, exist_ok=True)
    rows = load_rows(SOURCE)
    if len(rows) < 100:
        raise SystemExit(f"Dataset too small after cleanup: {len(rows)} rows")

    random.seed(42)
    random.shuffle(rows)

    dev_size = min(400, max(200, int(len(rows) * 0.05)))
    dev = rows[:dev_size]
    train = rows[dev_size:]

    dump_jsonl(TRAIN_OUT, train)
    dump_jsonl(DEV_OUT, dev)

    print(f"train={len(train)} dev={len(dev)} total={len(rows)}")
    print(f"train_path={TRAIN_OUT}")
    print(f"dev_path={DEV_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
