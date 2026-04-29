#!/usr/bin/env python3
"""Build the merged dataset for `tr-clean-v1`.

Input:
  - core:    infrastructure/lora-trials/candidates/2026-04-19_tr-clean-v1/train/tr-conversations-clean-v1-core.jsonl
  - support: infrastructure/lora-trials/candidates/2026-04-19_tr-clean-v1/train/tr-conversations-clean-v1-support.jsonl
  - hidden benchmark: packages/qa-sandbox/worker/r3mes_qa_worker/data/hidden_dataset.json

Output:
  - train:   infrastructure/lora-trials/candidates/2026-04-19_tr-clean-v1/train/tr-clean-v1-merged-train.jsonl
  - dev:     infrastructure/lora-trials/candidates/2026-04-19_tr-clean-v1/train/tr-clean-v1-merged-dev.jsonl
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path("infrastructure/lora-trials/candidates/2026-04-19_tr-clean-v1/train")
CORE = ROOT / "tr-conversations-clean-v1-core.jsonl"
SUPPORT = ROOT / "tr-conversations-clean-v1-support.jsonl"
HIDDEN = Path("packages/qa-sandbox/worker/r3mes_qa_worker/data/hidden_dataset.json")
OUT_TRAIN = ROOT / "tr-clean-v1-merged-train.jsonl"
OUT_DEV = ROOT / "tr-clean-v1-merged-dev.jsonl"


def load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_dev_from_hidden(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict] = []
    for item in raw:
        rows.append(
            {
                "messages": [
                    {"role": "user", "content": item["prompt"]},
                    {"role": "assistant", "content": item["reference"]},
                ]
            }
        )
    return rows


def main() -> int:
    missing = [str(p) for p in (CORE, SUPPORT, HIDDEN) if not p.exists()]
    if missing:
        raise SystemExit(f"Missing input files: {', '.join(missing)}")

    core = load_jsonl(CORE)
    support = load_jsonl(SUPPORT)
    dev = build_dev_from_hidden(HIDDEN)

    train = core + support
    dump_jsonl(OUT_TRAIN, train)
    dump_jsonl(OUT_DEV, dev)

    print(f"train={len(train)} dev={len(dev)}")
    print(f"train_path={OUT_TRAIN}")
    print(f"dev_path={OUT_DEV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
