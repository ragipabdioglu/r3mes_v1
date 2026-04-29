#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import pandas as pd


DEFAULT_SOURCE = Path("train-00000-of-00001.parquet")
DEFAULT_OUTPUT_DIR = Path("infrastructure/knowledge-datasets/gyn-onco-cards-v2")
TARGET_SPECIALITY = "kadin-hastaliklari-ve-dogum-jinekolojik-onkoloji"

TOPIC_DEFINITIONS = [
    {
        "slug": "smear-servikal-tarama",
        "topic": "smear sonucu ve servikal tarama",
        "keywords": ("smear", "ascus", "ascus", "lsil", "hsil", "rahim ağzı", "rahim agzi"),
        "summary": "Servikal tarama veya smear sonucuna ek jinekolojik yakınma eşlik ediyor.",
        "takeaway": "Smear sonucu tek başına her kasık ağrısı veya kanama nedenini açıklamaz; sonuç temiz olsa da yakınma sürüyorsa ayrı jinekolojik değerlendirme gerekir.",
        "guidance": "Smear sonucunu doktor kontrolünde izleyin. Yakınma sürüyor veya artıyorsa kadın hastalıkları muayenesi planlayın.",
        "red_flags": "Şiddetli ağrı, kötü kokulu akıntı, temas sonrası kanama veya beklenmeyen yoğun kanama varsa daha hızlı değerlendirme gerekir.",
        "do_not_infer": "Tek başına smear sonucundan kanser, ileri tetkik zorunluluğu veya CA-125 gerekliliği çıkarma.",
    },
    {
        "slug": "hpv-servikal-takip",
        "topic": "hpv ve servikal takip",
        "keywords": ("hpv", "siğil", "sigil", "kolposkop", "kolposkopi"),
        "summary": "HPV veya servikal takip süreciyle ilgili endişe ve izlem sorusu var.",
        "takeaway": "HPV pozitifliği tek başına ciddi hastalık anlamına gelmez; sonuçlar düzenli takip ve doktor değerlendirmesi ile yorumlanır.",
        "guidance": "Planlanan smear, HPV veya kolposkopi kontrolünü aksatmayın. Yeni yakınma varsa jinekoloji kontrolü planlayın.",
        "red_flags": "Yoğun kanama, artan ağrı, kötü kokulu akıntı veya belirgin halsizlik gelişirse daha hızlı değerlendirme gerekir.",
        "do_not_infer": "Soruda açık dayanak yoksa kanser tanısı, acil cerrahi veya ileri tümör belirteci gerekliliği çıkarma.",
    },
    {
        "slug": "kasik-agrisi",
        "topic": "kasık ağrısı",
        "keywords": ("kasık", "kasik", "pelvik ağrı", "pelvik agri", "karın ağr", "karin agr"),
        "summary": "Tekrarlayan veya yeni başlayan alt karın-kasık ağrısı soruluyor.",
        "takeaway": "Kasık ağrısının tek bir nedeni yoktur; yakınmanın süresi, şiddeti ve eşlik eden belirtiler değerlendirilmeden kesin neden söylenemez.",
        "guidance": "Ağrı tekrarlıyor, uzuyor veya günlük yaşamı etkiliyorsa kadın hastalıkları muayenesi uygundur.",
        "red_flags": "Şiddetli ağrı, ateş, bulantı-kusma, bayılma, gebelik şüphesi veya anormal kanama varsa acil değerlendirme gerekir.",
        "do_not_infer": "Tek başına kasık ağrısından kanser, CA-125 gerekliliği veya ameliyat zorunluluğu çıkarma.",
    },
    {
        "slug": "anormal-kanama",
        "topic": "anormal kanama",
        "keywords": ("kanama", "lekelen", "leke", "pıhtı", "pihti", "adet dışı", "adet disi"),
        "summary": "Beklenmeyen, uzayan veya tekrar eden kanama/lekelenme yakınması anlatılıyor.",
        "takeaway": "Beklenmeyen kanama jinekolojik değerlendirme gerektirebilir; yalnızca önceki temiz sonuçlara bakarak neden kesinleştirilemez.",
        "guidance": "Kanama tekrarlıyor, uzuyor veya miktarı artıyorsa kadın hastalıkları muayenesi planlayın.",
        "red_flags": "Yoğun kanama, bayılma, nefes darlığı, şiddetli ağrı veya gebelik şüphesi varsa acil değerlendirme gerekir.",
        "do_not_infer": "Kanamadan tek başına kanser, tümör belirteci gerekliliği veya patoloji sonucu varmış gibi çıkarım yapma.",
    },
    {
        "slug": "yumurtalik-kisti-adneks",
        "topic": "yumurtalık kisti ve adneksal yakınma",
        "keywords": ("kist", "kitle", "yumurtalık", "yumurtalik", "adneks"),
        "summary": "Yumurtalık kisti veya adneksal yakınmayla ilişkili soru var.",
        "takeaway": "Kist veya kitle ifadesi tek başına ameliyat gerektirir anlamına gelmez; boyut, görünüm ve yakınmalar birlikte değerlendirilir.",
        "guidance": "Takip önerildiyse kontrol ultrasonunu aksatmayın. Ağrı veya yeni belirti varsa muayene planlayın.",
        "red_flags": "Ani şiddetli ağrı, kusma, ateş veya karında belirgin şişlik olursa acil değerlendirme gerekir.",
        "do_not_infer": "Soruda açık dayanak yoksa kanser, acil ameliyat veya CA-125 zorunluluğu çıkarma.",
    },
    {
        "slug": "adet-duzensizligi",
        "topic": "adet düzensizliği ve hormonal yakınma",
        "keywords": ("adet", "regl", "gecik", "erken", "siklus", "lekelen"),
        "summary": "Adet düzeni, gecikme veya beklenmeyen hormonal yakınma soruluyor.",
        "takeaway": "Adet düzensizliği birçok nedenle görülebilir; tek bir laboratuvar veya yakınma ile kesin neden söylemek doğru değildir.",
        "guidance": "Düzensizlik devam ediyorsa, sık tekrarlıyorsa veya başka belirtiler eşlik ediyorsa jinekoloji değerlendirmesi uygundur.",
        "red_flags": "Yoğun kanama, bayılma, şiddetli ağrı veya gebelik şüphesi varsa daha hızlı değerlendirme gerekir.",
        "do_not_infer": "Tek bir siklus değişikliğinden ciddi hastalık, infertilite veya ileri tümör araştırması çıkarma.",
    },
    {
        "slug": "gebelik-iliskili-yakinma",
        "topic": "gebelik olasılığı veya gebelikle ilişkili jinekolojik yakınma",
        "keywords": ("geb", "hamile", "ilişki", "iliski", "beta hcg", "bhcg", "döllen", "dollen"),
        "summary": "Gebelik olasılığı veya gebelikle ilişkili jinekolojik yakınma soruluyor.",
        "takeaway": "Gebelik olasılığı tarih, test ve belirtiler birlikte değerlendirilerek yorumlanır; tek yakınmayla kesin sonuç söylenemez.",
        "guidance": "Gecikme sürüyorsa uygun zamanda gebelik testi ve gerekiyorsa kadın hastalıkları değerlendirmesi planlayın.",
        "red_flags": "Şiddetli ağrı, bayılma, omuz ağrısı, yoğun kanama veya pozitif testle birlikte kötüleşme olursa acil değerlendirme gerekir.",
        "do_not_infer": "Soruda açık test veya muayene bilgisi yoksa dış gebelik, düşük veya ileri onkolojik sorun çıkarma.",
    },
]

TOPIC_CAPS = {
    "smear-servikal-tarama": 40,
    "hpv-servikal-takip": 25,
    "kasik-agri": 35,
    "anormal-kanama": 30,
    "yumurtalik-kisti-adneks": 25,
    "adet-duzensizligi": 25,
    "gebelik-iliskili-yakinma": 20,
    "genel-jinekolojik-degerlendirme": 15,
}

NEGATIVE_MARKERS = (
    "randevu",
    "telefon",
    "tel ",
    "tel:",
    "***",
    "whatsapp",
    "mail at",
    "mail:",
)

LOW_SIGNAL_ANSWER_MARKERS = (
    "evet.",
    "hayır.",
    "hayir.",
    "değil.",
    "degil.",
    "görmem gerekir",
    "gormem gerekir",
)


@dataclass(frozen=True)
class TopicProfile:
    slug: str
    topic: str
    keywords: tuple[str, ...]
    summary: str
    takeaway: str
    guidance: str
    red_flags: str
    do_not_infer: str


PROFILES = [TopicProfile(**item) for item in TOPIC_DEFINITIONS]


def normalize(text: str) -> str:
    text = str(text or "")
    text = text.replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fold(text: str) -> str:
    text = normalize(text).lower()
    replacements = str.maketrans(
        {
            "ç": "c",
            "ğ": "g",
            "ı": "i",
            "İ": "i",
            "ö": "o",
            "ş": "s",
            "ü": "u",
        }
    )
    return text.translate(replacements)


def sentence_case(text: str) -> str:
    text = normalize(text)
    if not text:
        return ""
    return text[0].upper() + text[1:]


def clean_row(question: str, answer: str) -> tuple[str, str]:
    question = normalize(question)
    answer = normalize(answer)
    answer = re.sub(r"\*{2,}", "", answer)
    answer = re.sub(r"randevu.*$", "", answer, flags=re.I)
    answer = re.sub(r"tel\s*[: ]?\s*[\d* -]+", "", answer, flags=re.I)
    answer = re.sub(r"mail\s*[: ]?\s*\S+", "", answer, flags=re.I)
    answer = normalize(answer)
    return question, answer


def is_good_row(question: str, answer: str) -> bool:
    qf = fold(question)
    af = fold(answer)
    if len(question) < 35 or len(question) > 850:
        return False
    if len(answer) < 20 or len(answer) > 900:
        return False
    if any(marker in af for marker in NEGATIVE_MARKERS):
        return False
    if af in LOW_SIGNAL_ANSWER_MARKERS:
        return False
    if af.isupper() and len(answer) < 120:
        return False
    if "katiyen yoktur" in af or "endise etmeyin" in af:
        return False
    if qf.count("?") > 4:
        return False
    return True


def find_profile(question: str, answer: str) -> TopicProfile:
    haystack = f"{fold(question)} {fold(answer)}"
    best = None
    best_score = -1
    for profile in PROFILES:
        score = 0
        for keyword in profile.keywords:
            score += 3 if keyword in haystack else 0
        if profile.slug == "smear-servikal-tarama" and "temiz" in haystack:
            score += 1
        if profile.slug == "kasik-agri" and ("agri" in haystack or "sanci" in haystack):
            score += 2
        if score > best_score:
            best = profile
            best_score = score
    if best is None or best_score <= 0:
        return TopicProfile(
            slug="genel-jinekolojik-degerlendirme",
            topic="genel jinekolojik değerlendirme",
            keywords=(),
            summary="Jinekolojik belirti nedeniyle genel değerlendirme ihtiyacı anlatılıyor.",
            takeaway="Yakınmanın nedeni muayene ve gerekirse temel testlerle netleştirilir; yalnız yazışma ile kesin yorum yapmak uygun değildir.",
            guidance="Yakınma sürüyorsa veya tekrarlıyorsa kadın hastalıkları muayenesi planlayın.",
            red_flags="Şiddetli ağrı, yoğun kanama, ateş, bayılma veya hızlı kötüleşme olursa acil değerlendirme gerekir.",
            do_not_infer="Soruda açık dayanak yoksa ileri test, kanser veya acil işlem gerekliliği çıkarma.",
        )
    return best


def infer_tags(question: str, answer: str, profile: TopicProfile) -> list[str]:
    haystack = fold(f"{question} {answer}")
    tags: list[str] = []
    if "smear" in haystack or "ascus" in haystack or "lsil" in haystack or "hsil" in haystack:
        tags.append("smear")
    if "hpv" in haystack:
        tags.append("hpv")
    if "kasik" in haystack or "kasık" in question.lower():
        tags.append("kasik-agri")
    if "kanama" in haystack or "lekelen" in haystack:
        tags.append("kanama")
    if "kist" in haystack or "kitle" in haystack:
        tags.append("kist")
    if "adet" in haystack or "regl" in haystack:
        tags.append("adet")
    if "hamile" in haystack or "gebe" in haystack or "bhcg" in haystack or "beta hcg" in haystack:
        tags.append("gebelik")
    if "akınt" in haystack or "akinti" in haystack:
        tags.append("akinti")
    if "ağrı" in question.lower() or "agri" in haystack:
        tags.append("agri")
    tags.append(profile.slug)
    return sorted(set(tags))


def infer_age(question: str) -> str | None:
    match = re.search(r"\b(\d{2})\s*ya[sş]", fold(question))
    if not match:
        return None
    age = int(match.group(1))
    if 12 <= age <= 89:
        return str(age)
    return None


def infer_patient_summary(question: str, profile: TopicProfile) -> str:
    qf = fold(question)
    parts: list[str] = []
    age = infer_age(question)
    if age:
        parts.append(f"{age} yaş civarında bir kullanıcı")
    else:
        parts.append("Kullanıcı")

    if profile.slug == "smear-servikal-tarama":
        if "temiz" in qf or "normal" in qf:
            parts.append("temiz/normal smear sonucu sonrasında devam eden yakınmayı soruyor")
        else:
            parts.append("smear sonucu veya servikal tarama bulgusunu nasıl yorumlaması gerektiğini soruyor")
    elif profile.slug == "hpv-servikal-takip":
        parts.append("HPV veya servikal takip sonucunu ve izlem adımlarını soruyor")
    elif profile.slug == "kasik-agri":
        if "smear" in qf:
            parts.append("smear sonucuna rağmen tekrar eden kasık ağrısını soruyor")
        else:
            parts.append("tekrarlayan kasık-alt karın ağrısının ne anlama gelebileceğini soruyor")
    elif profile.slug == "anormal-kanama":
        parts.append("beklenmeyen kanama veya lekelenmenin nasıl değerlendirilmesi gerektiğini soruyor")
    elif profile.slug == "yumurtalik-kisti-adneks":
        parts.append("yumurtalık kisti/kitle ifadesinin takip veya müdahale gerektirip gerektirmediğini soruyor")
    elif profile.slug == "adet-duzensizligi":
        parts.append("adet düzensizliği veya gecikmenin nasıl değerlendirilmesi gerektiğini soruyor")
    elif profile.slug == "gebelik-iliskili-yakinma":
        parts.append("gebelik olasılığı veya gebelikle ilişkili yakınmayı nasıl yorumlaması gerektiğini soruyor")
    else:
        parts.append("jinekolojik yakınmasının nasıl değerlendirilmesi gerektiğini soruyor")

    if "ates" in qf or "ateş" in question.lower():
        parts.append("ateş eşlik ettiğini belirtiyor")
    if "kusma" in qf or "bulanti" in qf or "bulantı" in question.lower():
        parts.append("bulantı-kusma yakınmasından söz ediyor")
    if "akınt" in qf or "akinti" in qf:
        parts.append("akıntı tarif ediyor")
    if "kanama" in qf or "lekelen" in qf:
        parts.append("kanama/lekelenme eşlik edebiliyor")

    summary = ", ".join(parts).strip()
    return sentence_case(summary.rstrip(".")) + "."


def infer_clinical_takeaway(question: str, answer: str, profile: TopicProfile) -> str:
    qf = fold(question)
    af = fold(answer)
    clauses: list[str] = [profile.takeaway]

    if "temiz" in qf and profile.slug in {"smear-servikal-tarama", "kasik-agri"}:
        clauses.append("Temiz sonuç iyi bir bulgu olsa da yeni veya süren yakınmayı tek başına dışlamaz.")
    if "ca125" in af or "ca 125" in af:
        clauses.append("Yanıttaki tümör belirteci vurgusu bu soru için temel bilgi olarak alınmamalıdır.")
    if "muayene" in af or "gormem gerekir" in af or "görmem gerekir" in af:
        clauses.append("Kesin neden yerine muayene ile netleştirme yaklaşımı daha uygundur.")
    if profile.slug == "anormal-kanama" and ("patoloji" in qf or "biyopsi" in qf):
        clauses.append("Önceki temiz patoloji sonucu olsa bile yeni kanama yeniden değerlendirilmelidir.")
    if profile.slug == "yumurtalik-kisti-adneks" and ("takip" in af or "kontrol" in af):
        clauses.append("Kist yönetimi çoğu zaman takip bulguları ile birlikte planlanır.")

    return " ".join(dict.fromkeys(clauses))


def infer_safe_guidance(question: str, answer: str, profile: TopicProfile) -> str:
    qf = fold(question)
    clauses: list[str] = [profile.guidance]
    if profile.slug == "smear-servikal-tarama" and ("temiz" in qf or "normal" in qf):
        clauses.append("Kasık ağrısı veya yeni kanama sürüyorsa bunu smear sonucundan ayrı bir yakınma gibi ele almak gerekir.")
    if profile.slug == "kasik-agri":
        clauses.append("Ağrı günlerce sürüyor, sık tekrarlıyor veya şiddetleniyorsa kontrol randevusu geciktirilmemelidir.")
    if profile.slug == "anormal-kanama":
        clauses.append("Kanama miktarı ve süresi kaydedilirse muayenede değerlendirme kolaylaşır.")
    if profile.slug == "gebelik-iliskili-yakinma":
        clauses.append("Uygun zamanda gebelik testi ve gerekirse jinekoloji değerlendirmesi planlanabilir.")
    return " ".join(dict.fromkeys(clauses))


def infer_red_flags(question: str, answer: str, profile: TopicProfile) -> str:
    qf = fold(f"{question} {answer}")
    extras: list[str] = []
    if "bayil" in qf or "bayıl" in question.lower():
        extras.append("bayılma")
    if "ates" in qf or "ateş" in question.lower():
        extras.append("ateş")
    if "kusma" in qf or "bulanti" in qf:
        extras.append("bulantı-kusma")
    if "kanama" in qf or "lekelen" in qf:
        extras.append("artan kanama")
    if "gebe" in qf or "hamile" in qf:
        extras.append("gebelik şüphesi")
    if not extras:
        return profile.red_flags
    joined = ", ".join(dict.fromkeys(extras))
    return f"{profile.red_flags} Özellikle {joined} varsa beklemeden değerlendirme gerekir."


def infer_do_not_infer(question: str, answer: str, profile: TopicProfile) -> str:
    qf = fold(f"{question} {answer}")
    clauses = [profile.do_not_infer]
    if "ca125" in qf or "ca 125" in qf:
        clauses.append("CA-125 ifadesini yalnız açık ve ilgili klinik bağlam varsa dikkate al.")
    if "patoloji" in qf or "biyopsi" in qf:
        clauses.append("Yeni patoloji sonucu yoksa eski sonuçtan yeni tanı çıkarma.")
    return " ".join(dict.fromkeys(clauses))


def build_card(question: str, answer: str) -> dict[str, str | list[str]]:
    profile = find_profile(question, answer)
    return {
        "topic": profile.topic,
        "topic_slug": profile.slug,
        "tags": infer_tags(question, answer, profile),
        "patient_summary": infer_patient_summary(question, profile),
        "clinical_takeaway": infer_clinical_takeaway(question, answer, profile),
        "safe_guidance": infer_safe_guidance(question, answer, profile),
        "red_flags": infer_red_flags(question, answer, profile),
        "do_not_infer": infer_do_not_infer(question, answer, profile),
    }


def render_card(card: dict[str, str | list[str]]) -> str:
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
    seen_questions: set[str] = set()
    topic_counts: Counter[str] = Counter()
    files_manifest: list[dict[str, object]] = []
    drop_reasons: defaultdict[str, int] = defaultdict(int)

    for row in df.itertuples(index=False):
        question, answer = clean_row(row.question_content, row.question_answer)
        if not is_good_row(question, answer):
            drop_reasons["quality_filter"] += 1
            continue
        qkey = fold(question)
        if qkey in seen_questions:
            drop_reasons["duplicate_question"] += 1
            continue
        card = build_card(question, answer)
        topic_slug = str(card["topic_slug"])
        topic_cap = TOPIC_CAPS.get(topic_slug, 15)
        if topic_counts[topic_slug] >= topic_cap:
            drop_reasons[f"topic_cap:{topic_slug}"] += 1
            continue
        seen_questions.add(qkey)
        topic_counts[topic_slug] += 1
        cards.append(card)
        if len(cards) >= args.limit:
            break

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for idx, card in enumerate(cards, start=1):
        file_name = f"clinical-card-{idx:03d}.md"
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

    heuristics = {
        "qualityFilter": {
            "minQuestionLength": 35,
            "maxQuestionLength": 850,
            "minAnswerLength": 20,
            "maxAnswerLength": 900,
            "drops": [
                "contact-info",
                "randevu yönlendirmesi",
                "çok kısa veya bağlamsız yanıt",
                "tamamı büyük harf kısa yanıt",
                "aynı soru tekrarı",
            ],
        },
        "cardConstruction": [
            "topic weighted keyword match",
            "patient summary question templates",
            "clinical takeaway topic template plus limited answer cues",
            "safe guidance topic template",
            "red flags symptom augmentation",
            "do-not-infer topic-specific guardrails",
        ],
        "topicCaps": TOPIC_CAPS,
    }

    manifest = {
        "source": str(args.source),
        "rows": len(cards),
        "speciality": TARGET_SPECIALITY,
        "topicCounts": dict(topic_counts),
        "dropReasons": dict(sorted(drop_reasons.items())),
        "heuristics": heuristics,
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
