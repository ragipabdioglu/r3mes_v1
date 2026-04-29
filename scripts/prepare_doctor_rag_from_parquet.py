#!/usr/bin/env python3
"""Convert the doctor QA parquet dataset into RAG-ready markdown bundles."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path

import pandas as pd


DEFAULT_SOURCE = Path("train-00000-of-00001.parquet")
DEFAULT_OUTPUT_DIR = Path("infrastructure/knowledge-datasets/doctor-rag")
DEFAULT_ROWS_PER_FILE = 250


def normalize(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


def slugify(text: str) -> str:
    low = normalize(text).lower()
    low = low.replace("ğ", "g").replace("ü", "u").replace("ş", "s")
    low = low.replace("ı", "i").replace("ö", "o").replace("ç", "c")
    low = re.sub(r"[^a-z0-9]+", "-", low)
    return low.strip("-") or "unknown"


def render_record(idx: int, title: str, speciality: str, question: str, answer: str) -> str:
    return (
        f"## Kayıt {idx}\n"
        f"Doktor unvanı: {title}\n"
        f"Uzmanlık: {speciality}\n\n"
        f"Soru:\n{question}\n\n"
        f"Yanıt:\n{answer}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--rows-per-file", type=int, default=DEFAULT_ROWS_PER_FILE)
    parser.add_argument(
        "--speciality-contains",
        action="append",
        default=[],
        help="Only keep rows whose doctor_speciality contains this substring. Can be passed multiple times.",
    )
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Missing parquet source: {args.source}")

    df = pd.read_parquet(
        args.source,
        columns=["doctor_title", "doctor_speciality", "question_content", "question_answer"],
    )
    df = df.dropna()
    df["doctor_title"] = df["doctor_title"].map(normalize)
    df["doctor_speciality"] = df["doctor_speciality"].map(normalize)
    df["question_content"] = df["question_content"].map(normalize)
    df["question_answer"] = df["question_answer"].map(normalize)
    df = df[
        (df["doctor_speciality"] != "")
        & (df["question_content"] != "")
        & (df["question_answer"] != "")
    ].drop_duplicates()

    if args.speciality_contains:
        needles = [normalize(item).lower() for item in args.speciality_contains if normalize(item)]
        if needles:
            mask = df["doctor_speciality"].str.lower().map(
                lambda value: any(needle in value for needle in needles)
            )
            df = df[mask]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "source": str(args.source),
        "rows": int(len(df)),
        "rowsPerFile": args.rows_per_file,
        "files": [],
        "specialities": Counter(df["doctor_speciality"]).most_common(),
    }

    for speciality, group in df.groupby("doctor_speciality", sort=True):
        slug = slugify(speciality)
        group = group.reset_index(drop=True)
        total_parts = math.ceil(len(group) / args.rows_per_file)
        for part_idx in range(total_parts):
            start = part_idx * args.rows_per_file
            end = start + args.rows_per_file
            part = group.iloc[start:end]
            lines = [
                f"# Doktor bilgi paketi: {speciality}",
                "",
                f"Bu dosya R3MES RAG knowledge yüklemesi için üretildi. Uzmanlık: {speciality}.",
                "",
            ]
            for local_idx, row in enumerate(part.itertuples(index=False), start=1):
                lines.append(
                    render_record(
                        idx=start + local_idx,
                        title=row.doctor_title,
                        speciality=row.doctor_speciality,
                        question=row.question_content,
                        answer=row.question_answer,
                    )
                )
                lines.append("")

            file_name = f"{slug}-part-{part_idx + 1:03d}.md"
            target = args.output_dir / file_name
            target.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
            manifest["files"].append(
                {
                    "file": file_name,
                    "speciality": speciality,
                    "rows": int(len(part)),
                }
            )

    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "rows": int(len(df)),
                "outputDir": str(args.output_dir),
                "fileCount": len(manifest["files"]),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
