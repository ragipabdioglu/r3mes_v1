from __future__ import annotations

from dataclasses import dataclass
import re

from rouge_score import rouge_scorer
from sacrebleu import sentence_bleu


@dataclass(frozen=True)
class SampleScores:
    rouge_l_f1: float
    bleu_0_1: float


_FORBIDDEN_TEMPLATE_MARKERS = (
    "<|im_start|>",
    "<|im_end|>",
    "</|im_start|>",
    "</|im_end|>",
)


def _normalize(text: str) -> str:
    return " ".join(text.split()).strip()


def has_forbidden_template_markers(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _FORBIDDEN_TEMPLATE_MARKERS)


def is_effectively_empty(text: str) -> bool:
    normalized = _normalize(text)
    if not normalized:
        return True
    return re.sub(r"[\W_]+", "", normalized, flags=re.UNICODE) == ""


def fails_quality_hard_gate(hypothesis: str) -> bool:
    return is_effectively_empty(hypothesis) or has_forbidden_template_markers(hypothesis)


def rouge_l_f1(reference: str, hypothesis: str) -> float:
    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
    return float(scorer.score(reference, hypothesis)["rougeL"].fmeasure)


def bleu_0_1(reference: str, hypothesis: str) -> float:
    """BLEU'yu 0-1 aralığına indirger (sacrebleu varsayılanı 0-100)."""
    bleu = sentence_bleu(hypothesis, [reference])
    return float(bleu.score) / 100.0


def score_single(reference: str, hypothesis: str) -> SampleScores:
    if fails_quality_hard_gate(hypothesis):
        return SampleScores(rouge_l_f1=0.0, bleu_0_1=0.0)
    return SampleScores(
        rouge_l_f1=rouge_l_f1(reference, hypothesis),
        bleu_0_1=bleu_0_1(reference, hypothesis),
    )


def aggregate_quality_0_100(samples: list[SampleScores]) -> float:
    """Örnekler üzerinde basit ortalama — 0-100 skor."""
    if not samples:
        return 0.0
    acc = 0.0
    for s in samples:
        combined_0_1 = 0.5 * s.rouge_l_f1 + 0.5 * s.bleu_0_1
        acc += combined_0_1 * 100.0
    return acc / len(samples)
