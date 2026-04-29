#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import prepare_gyn_onco_cards_v2 as v2


DEFAULT_SOURCE = Path("train-00000-of-00001.parquet")
DEFAULT_OUTPUT_DIR = Path("infrastructure/knowledge-datasets/gyn-onco-cards-v3")


def mentions_vaccine(question: str, answer: str) -> bool:
    raw = f"{question} {answer}".lower()
    folded = v2.fold(f"{question} {answer}")
    return "aşı" in raw or re.search(r"\basi\b", folded) is not None


def clinical_facts(question: str, answer: str, card: dict[str, str | list[str]]) -> list[str]:
    qf = v2.fold(question)
    af = v2.fold(answer)
    topic_slug = str(card["topic_slug"])
    haystack = f"{qf} {af}"
    facts = [
        str(card["clinical_takeaway"]),
        str(card["safe_guidance"]),
    ]

    if topic_slug == "smear-servikal-tarama":
        if "temiz" in qf or "normal" in qf:
            facts.append("Temiz veya normal smear sonucu servikal tarama açısından rahatlatıcıdır.")
        facts.append("Smear sonucu kasık ağrısı, akıntı veya kanamanın tüm nedenlerini tek başına açıklamaz.")
    if topic_slug == "hpv-servikal-takip":
        facts.append("HPV sonucu smear, HPV tipi, kolposkopi gereksinimi ve kontrol planıyla birlikte değerlendirilir.")
        facts.append("HPV aşısı uygunluğu yaş, önceki aşı durumu, HPV sonucu ve kişisel risklere göre doktorla değerlendirilir.")
    if topic_slug == "kasik-agrisi":
        facts.append("Kasık ağrısında süre, şiddet, ateş, kanama, kusma ve gebelik olasılığı ayrıca sorgulanmalıdır.")
    if topic_slug == "anormal-kanama":
        facts.append("Beklenmeyen kanamada miktar, süre, adet ilişkisi ve önceki testler birlikte değerlendirilir.")
        facts.append("Menopoz sonrası kanama veya lekelenme beklenerek geçiştirilmemeli, kadın hastalıkları değerlendirmesiyle netleştirilmelidir.")
        facts.append("Menopozdan sonra bir kez kanama olsa bile normal deyip beklemek yerine değerlendirme planlanmalıdır.")
    if topic_slug == "yumurtalik-kisti-adneks":
        facts.append("Kist/kitle yönetimi boyut, ultrason görünümü, ağrı ve takip değişimine göre planlanır.")
    if topic_slug == "gebelik-iliskili-yakinma":
        facts.append("Negatif gebelik testi olasılığı azaltır; adet gecikmesi sürerse test tekrarı veya muayene gerekebilir.")
    if mentions_vaccine(question, answer) and ("hpv" in haystack or topic_slug == "hpv-servikal-takip"):
        facts.append("HPV pozitifliği varsa bile aşı konusu doktorla ayrıca konuşulabilir; aşı tedavi yerine koruyucu strateji olarak değerlendirilir.")
    if "muayene" in af or "kontrol" in af:
        facts.append("Kesin neden için yazışma yerine muayene ve uygun takip planı gerekir.")

    return list(dict.fromkeys(item.strip() for item in facts if item.strip()))


def applicable_when(question: str, card: dict[str, str | list[str]]) -> list[str]:
    tags = set(card["tags"] if isinstance(card["tags"], list) else [])
    items = [str(card["patient_summary"])]
    if "smear" in tags:
        items.append("Soru smear/servikal tarama sonucunu yakınma ile birlikte yorumlamayı istiyorsa.")
    if "hpv" in tags:
        items.append("Soru HPV sonucu, servikal takip veya aşı/kolposkopi kaygısı içeriyorsa.")
        items.append("Soru HPV pozitifliği sonrası aşı uygunluğunu soruyorsa.")
    if "kasik-agri" in tags or "agri" in tags:
        items.append("Soru kasık veya alt karın ağrısında güvenli sonraki adımı soruyorsa.")
    if "kanama" in tags:
        items.append("Soru beklenmeyen kanama veya lekelenme ile ilgiliyse.")
        items.append("Soru menopoz sonrası kanama veya lekelenme içeriyorsa.")
        items.append("Soru menopozdan sonra kanama oldu ve beklemeli miyim diye soruyorsa.")
    if "gebelik" in tags:
        items.append("Soru gebelik olasılığı, negatif test, adet gecikmesi veya gebelikle ilişkili yakınma içeriyorsa.")
    if "kist" in tags:
        items.append("Soru yumurtalık kisti/kitle ifadesinin takip veya müdahale gerektirip gerektirmediğini soruyorsa.")
    return list(dict.fromkeys(items))


def not_applicable_when(card: dict[str, str | list[str]]) -> list[str]:
    topic_slug = str(card["topic_slug"])
    common = [
        "Soru acil tanı veya kesin tedavi kararı istiyorsa bu kart tek başına yeterli değildir.",
        "Soruda kaynak dayanağı olmayan kanser, ameliyat veya tümör belirteci çıkarımı yapılmamalıdır.",
    ]
    if topic_slug == "smear-servikal-tarama":
        common.append("Soru smear dışı bir laboratuvar veya görüntüleme sonucunu esas alıyorsa.")
    if topic_slug == "hpv-servikal-takip":
        common.append("Soru HPV içermiyor ve yalnız genel ağrı/kanama yönetimi soruyorsa.")
    if topic_slug == "gebelik-iliskili-yakinma":
        common.append("Soru gebelik olasılığı veya adet gecikmesi içermiyorsa gebelik yorumu öne çıkarılmamalıdır.")
    if topic_slug == "yumurtalik-kisti-adneks":
        common.append("Soru kist/kitle veya ultrason bulgusu içermiyorsa ameliyat/takip yorumu yapılmamalıdır.")
    return common


def answer_strategy(card: dict[str, str | list[str]]) -> list[str]:
    return [
        "Önce mevcut sonucun neyi rahatlattığını kısa söyle.",
        "Sonra bu sonucun hangi yakınmayı tek başına açıklamadığını belirt.",
        "Kesin tanı koymadan güvenli takip veya muayene adımını öner.",
        "Kırmızı bayrakları kısa ve net yaz.",
        "Cevabı sakin, kısa ve kaynak dışına çıkmadan bitir.",
    ]


def build_v3_card(question: str, answer: str) -> dict[str, object]:
    base = v2.build_card(question, answer)
    tags = list(base["tags"]) if isinstance(base["tags"], list) else []
    haystack = v2.fold(f"{question} {answer}")
    if mentions_vaccine(question, answer) and "hpv" in haystack:
        tags.append("asi")
    base["tags"] = sorted(set(tags))
    return {
        **base,
        "usable_facts": clinical_facts(question, answer, base),
        "applicable_when": applicable_when(question, base),
        "not_applicable_when": not_applicable_when(base),
        "answer_strategy": answer_strategy(base),
    }


def render_list(label: str, values: list[str]) -> str:
    if not values:
        return f"{label}:\n- Belirtilmemiş.\n"
    return f"{label}:\n" + "\n".join(f"- {value}" for value in values) + "\n"


def render_card(card: dict[str, object]) -> str:
    tags = ", ".join(card["tags"]) if isinstance(card["tags"], list) else str(card["tags"])
    return (
        "# Clinical Atom Card\n\n"
        f"Topic: {card['topic']}\n"
        f"Tags: {tags}\n\n"
        f"Patient Summary: {card['patient_summary']}\n\n"
        + render_list("Usable Clinical Facts", list(card["usable_facts"]))
        + "\n"
        f"Clinical Takeaway: {card['clinical_takeaway']}\n\n"
        f"Safe Guidance: {card['safe_guidance']}\n\n"
        + render_list("Applicable When", list(card["applicable_when"]))
        + "\n"
        + render_list("Not Applicable When", list(card["not_applicable_when"]))
        + "\n"
        + render_list("Answer Strategy", list(card["answer_strategy"]))
        + "\n"
        f"Red Flags: {card['red_flags']}\n\n"
        f"Do Not Infer: {card['do_not_infer']}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--limit", type=int, default=180)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Missing parquet source: {args.source}")

    df = pd.read_parquet(
        args.source,
        columns=["doctor_speciality", "question_content", "question_answer"],
    ).dropna()
    df["doctor_speciality"] = df["doctor_speciality"].map(v2.normalize)
    df["question_content"] = df["question_content"].map(v2.normalize)
    df["question_answer"] = df["question_answer"].map(v2.normalize)
    df = df[df["doctor_speciality"] == v2.TARGET_SPECIALITY]

    cards: list[dict[str, object]] = []
    seen_questions: set[str] = set()
    topic_counts: Counter[str] = Counter()
    files_manifest: list[dict[str, object]] = []
    drop_reasons: defaultdict[str, int] = defaultdict(int)

    for row in df.itertuples(index=False):
        question, answer = v2.clean_row(row.question_content, row.question_answer)
        if not v2.is_good_row(question, answer):
            drop_reasons["quality_filter"] += 1
            continue
        qkey = v2.fold(question)
        if qkey in seen_questions:
            drop_reasons["duplicate_question"] += 1
            continue
        card = build_v3_card(question, answer)
        topic_slug = str(card["topic_slug"])
        topic_cap = v2.TOPIC_CAPS.get(topic_slug, 15)
        if topic_counts[topic_slug] >= topic_cap:
            drop_reasons[f"topic_cap:{topic_slug}"] += 1
            continue
        seen_questions.add(qkey)
        topic_counts[topic_slug] += 1
        cards.append(card)
        if len(cards) >= args.limit:
            break

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for old_file in args.output_dir.glob("clinical-atom-card-*.md"):
        old_file.unlink()

    for idx, card in enumerate(cards, start=1):
        file_name = f"clinical-atom-card-{idx:03d}.md"
        target = args.output_dir / file_name
        target.write_text(render_card(card), encoding="utf-8")
        files_manifest.append(
            {
                "file": file_name,
                "topic": card["topic"],
                "topicSlug": card["topic_slug"],
                "tags": card["tags"],
            }
        )

    manifest = {
        "source": str(args.source),
        "rows": len(cards),
        "speciality": v2.TARGET_SPECIALITY,
        "format": "clinical-atom-card-v3",
        "topicCounts": dict(topic_counts),
        "dropReasons": dict(sorted(drop_reasons.items())),
        "heuristics": {
            "base": "prepare_gyn_onco_cards_v2.py quality filter and topic caps",
            "v3Additions": [
                "usable clinical facts separated from source narrative",
                "applicable and not-applicable boundaries",
                "explicit answer strategy for small-model grounded generation",
                "raw patient source question excluded to reduce prompt pollution",
            ],
        },
        "files": files_manifest,
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"rows": len(cards), "outputDir": str(args.output_dir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
