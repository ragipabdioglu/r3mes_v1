#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd


DEFAULT_SOURCE = Path("train-00000-of-00001.parquet")
DEFAULT_OUTPUT_DIR = Path("infrastructure/knowledge-datasets/gyn-onco-rag-v2")
TARGET_SPECIALITY = "kadin-hastaliklari-ve-dogum-jinekolojik-onkoloji"


def normalize(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


def clean_row(question: str, answer: str) -> tuple[str, str]:
    question = normalize(question)
    answer = normalize(answer)
    answer = re.sub(r"\*{2,}", "", answer)
    answer = re.sub(r"tel\s*[: ]?\s*[\d* -]+", "", answer, flags=re.I)
    answer = re.sub(r"randevu.*$", "", answer, flags=re.I)
    return question.strip(), answer.strip(" .") + "."


def is_good_row(question: str, answer: str) -> bool:
    low = answer.lower()
    if len(question) < 30 or len(answer) < 80 or len(answer) > 900:
        return False
    if "***" in answer or "randevu" in low or "tel" in low:
        return False
    if answer.upper() == answer and len(answer) > 24:
        return False
    if any(bad in low for bad in ["katiyen", "mutlak", "kesin gebelik yok", "değil. smear yaptırsın"]):
        return False
    if answer.count(".") < 1:
        return False
    return True


def render_record(idx: int, question: str, answer: str) -> str:
    return (
        "# Jinekolojik Onkoloji Bilgi Kaydı\n\n"
        f"Kayıt No: {idx}\n"
        "Uzmanlık: Kadın Hastalıkları ve Doğum - Jinekolojik Onkoloji\n\n"
        f"Soru:\n{question}\n\n"
        f"Yanıt:\n{answer}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--limit", type=int, default=120)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Missing parquet source: {args.source}")

    df = pd.read_parquet(
        args.source,
        columns=["doctor_speciality", "question_content", "question_answer"],
    )
    df = df.dropna()
    df["doctor_speciality"] = df["doctor_speciality"].map(normalize)
    df["question_content"] = df["question_content"].map(normalize)
    df["question_answer"] = df["question_answer"].map(normalize)
    df = df[df["doctor_speciality"] == TARGET_SPECIALITY]

    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in df.itertuples(index=False):
        question, answer = clean_row(row.question_content, row.question_answer)
        if not is_good_row(question, answer):
            continue
        key = f"{question}||{answer}"
        if key in seen:
            continue
        seen.add(key)
        rows.append({"question": question, "answer": answer})
        if len(rows) >= args.limit:
            break

    args.output_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for idx, row in enumerate(rows, start=1):
        file_name = f"gyn-onco-record-{idx:03d}.md"
        target = args.output_dir / file_name
        target.write_text(render_record(idx, row["question"], row["answer"]), encoding="utf-8")
        files.append({"file": file_name, "question": row["question"][:120]})

    (args.output_dir / "manifest.json").write_text(
        json.dumps(
            {
                "source": str(args.source),
                "rows": len(rows),
                "speciality": TARGET_SPECIALITY,
                "files": files,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "rows": len(rows),
                "outputDir": str(args.output_dir),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
