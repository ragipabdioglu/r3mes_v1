#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd


DEFAULT_SOURCE = Path("train-00000-of-00001.parquet")
DEFAULT_OUTPUT_DIR = Path("infrastructure/knowledge-datasets/gyn-onco-cards-v1")
TARGET_SPECIALITY = "kadin-hastaliklari-ve-dogum-jinekolojik-onkoloji"

TOPIC_RULES = [
    ("smear", "smear sonucu ve servikal tarama"),
    ("hpv", "hpv ve smear takibi"),
    ("kasık ağr", "kasık ağrısı"),
    ("kasik agr", "kasık ağrısı"),
    ("kanama", "anormal kanama"),
    ("kist", "yumurtalık kisti"),
    ("adet", "adet düzensizliği"),
    ("gebe", "gebelik ve jinekolojik yakınma"),
]

RED_FLAG_MARKERS = (
    "şiddetli ağrı",
    "siddetli agri",
    "ates",
    "ateş",
    "bayıl",
    "bayil",
    "kusma",
    "anormal kanama",
    "çok kanama",
)

DO_NOT_INFER_MARKERS = (
    "ca125",
    "ca 125",
    "bhcg",
    "beta hcg",
    "kanser",
    "biyopsi",
    "patoloji",
)


def normalize(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


def first_sentence(text: str) -> str:
    match = re.match(r"(.+?[.!?])(?:\s|$)", text.strip())
    return (match.group(1) if match else text).strip()


def clean_row(question: str, answer: str) -> tuple[str, str]:
    question = normalize(question)
    answer = normalize(answer)
    answer = re.sub(r"\*{2,}", "", answer)
    answer = re.sub(r"tel\s*[: ]?\s*[\d* -]+", "", answer, flags=re.I)
    answer = re.sub(r"randevu.*$", "", answer, flags=re.I)
    return question.strip(), answer.strip(" .") + "."


def is_good_row(question: str, answer: str) -> bool:
    low = answer.lower()
    if len(question) < 25 or len(answer) < 70 or len(answer) > 900:
        return False
    if "***" in answer or "randevu" in low or "tel" in low:
        return False
    return True


def infer_topic(question: str, answer: str) -> str:
    haystack = f"{question} {answer}".lower()
    for marker, topic in TOPIC_RULES:
        if marker in haystack:
            return topic
    return "jinekolojik değerlendirme"


def infer_tags(question: str, answer: str) -> list[str]:
    haystack = f"{question} {answer}".lower()
    tags = []
    for marker, topic in TOPIC_RULES:
        if marker in haystack:
            tags.append(marker)
    return sorted(set(tags))


def infer_red_flags(question: str, answer: str) -> str:
    haystack = f"{question} {answer}".lower()
    explicit = any(marker in haystack for marker in RED_FLAG_MARKERS)
    if explicit:
        return "Şiddetli ağrı, ateş, bayılma, kusma veya anormal kanama varsa daha hızlı değerlendirme gerekir."
    return "Şiddetli ağrı, ateş, bayılma, kusma veya anormal kanama gelişirse daha hızlı değerlendirme gerekir."


def infer_do_not_infer(question: str, answer: str) -> str:
    haystack = f"{question} {answer}".lower()
    blocked = [marker for marker in DO_NOT_INFER_MARKERS if marker in haystack]
    if not blocked:
        return "Soruda açık dayanak yoksa ileri tetkik, kanser veya özel test gerekliliği çıkarma."
    return "Soruda açık dayanak yoksa " + ", ".join(sorted(set(blocked))) + " gibi ileri çıkarımlar yapma."


def build_card(question: str, answer: str) -> dict[str, str | list[str]]:
    topic = infer_topic(question, answer)
    patient_summary = first_sentence(question)
    clinical_takeaway = first_sentence(answer)
    safe_guidance = "Yakınma sürüyor, artıyor veya tekrar ediyorsa kadın hastalıkları değerlendirmesi uygundur."
    return {
        "topic": topic,
        "tags": infer_tags(question, answer),
        "patient_summary": patient_summary,
        "clinical_takeaway": clinical_takeaway,
        "safe_guidance": safe_guidance,
        "red_flags": infer_red_flags(question, answer),
        "do_not_infer": infer_do_not_infer(question, answer),
    }


def render_card(idx: int, card: dict[str, str | list[str]]) -> str:
    tags = ", ".join(card["tags"]) if isinstance(card["tags"], list) else str(card["tags"])
    return (
        "# Clinical Card\n\n"
        f"Topic: {card['topic']}\n"
        f"Tags: {tags}\n\n"
        f"Patient Summary: {card['patient_summary']}\n\n"
        f"Clinical Takeaway: {card['clinical_takeaway']}\n\n"
        f"Safe Guidance: {card['safe_guidance']}\n\n"
        f"Red Flags: {card['red_flags']}\n\n"
        f"Do Not Infer: {card['do_not_infer']}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--limit", type=int, default=160)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Missing parquet source: {args.source}")

    df = pd.read_parquet(
        args.source,
        columns=["doctor_speciality", "question_content", "question_answer"],
    ).dropna()
    df["doctor_speciality"] = df["doctor_speciality"].map(normalize)
    df["question_content"] = df["question_content"].map(normalize)
    df["question_answer"] = df["question_answer"].map(normalize)
    df = df[df["doctor_speciality"] == TARGET_SPECIALITY]

    cards: list[dict[str, str | list[str]]] = []
    seen: set[str] = set()
    for row in df.itertuples(index=False):
        question, answer = clean_row(row.question_content, row.question_answer)
        if not is_good_row(question, answer):
            continue
        key = f"{question}||{answer}"
        if key in seen:
            continue
        seen.add(key)
        cards.append(build_card(question, answer))
        if len(cards) >= args.limit:
            break

    args.output_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for idx, card in enumerate(cards, start=1):
        file_name = f"clinical-card-{idx:03d}.md"
        target = args.output_dir / file_name
        target.write_text(render_card(idx, card), encoding="utf-8")
        files.append({"file": file_name, "topic": card["topic"], "tags": card["tags"]})

    (args.output_dir / "manifest.json").write_text(
        json.dumps(
            {
                "source": str(args.source),
                "rows": len(cards),
                "speciality": TARGET_SPECIALITY,
                "files": files,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"rows": len(cards), "outputDir": str(args.output_dir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

