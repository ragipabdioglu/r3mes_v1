from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "infrastructure" / "lora-trials" / "candidates" / "2026-04-23_doctor-role-qwen3b-v2" / "train"
TRAIN_SOURCE = SOURCE_DIR / "doctor-role-qwen3b-v2-train.jsonl"
DEV_SOURCE = SOURCE_DIR / "doctor-role-qwen3b-v2-dev.jsonl"
OUTPUT_DIR = ROOT / "infrastructure" / "training-hf" / "data" / "doctor-role-qwen3b-v2"
TRAIN_OUTPUT = OUTPUT_DIR / "train.jsonl"
DEV_OUTPUT = OUTPUT_DIR / "dev.jsonl"


def load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for index, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path} satir {index} JSON degil: {exc}") from exc
            rows.append(validate_row(payload, path, index))
    if not rows:
        raise ValueError(f"{path} bos")
    return rows


def validate_row(payload: dict, path: Path, index: int) -> dict:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError(f"{path} satir {index} icin messages listesi yok")

    normalized_messages = []
    roles = []
    for message_index, message in enumerate(messages, start=1):
        if not isinstance(message, dict):
            raise ValueError(f"{path} satir {index} mesaj {message_index} dict degil")
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant"}:
            raise ValueError(f"{path} satir {index} mesaj {message_index} gecersiz role: {role}")
        if not isinstance(content, str) or not content.strip():
            raise ValueError(f"{path} satir {index} mesaj {message_index} bos content")
        normalized_messages.append({"role": role, "content": content.strip()})
        roles.append(role)

    if roles[-1] != "assistant":
        raise ValueError(f"{path} satir {index} assistant ile bitmiyor")
    if "user" not in roles:
        raise ValueError(f"{path} satir {index} user mesaji icermiyor")

    return {"messages": normalized_messages}


def qwen_prompt_from_messages(messages: Iterable[dict]) -> str:
    parts = []
    for message in messages:
        parts.append(f"<|im_start|>{message['role']}\n{message['content']}<|im_end|>")
    return "\n".join(parts) + "\n"


def to_hf_record(row: dict) -> dict:
    return {
        "messages": row["messages"],
        "text": qwen_prompt_from_messages(row["messages"]),
    }


def write_jsonl(path: Path, rows: Iterable[dict]) -> int:
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1
    return count


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    train_rows = [to_hf_record(row) for row in load_jsonl(TRAIN_SOURCE)]
    dev_rows = [to_hf_record(row) for row in load_jsonl(DEV_SOURCE)]

    train_count = write_jsonl(TRAIN_OUTPUT, train_rows)
    dev_count = write_jsonl(DEV_OUTPUT, dev_rows)

    summary = {
        "source_train": str(TRAIN_SOURCE.relative_to(ROOT)),
        "source_dev": str(DEV_SOURCE.relative_to(ROOT)),
        "output_train": str(TRAIN_OUTPUT.relative_to(ROOT)),
        "output_dev": str(DEV_OUTPUT.relative_to(ROOT)),
        "train_count": train_count,
        "dev_count": dev_count,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
