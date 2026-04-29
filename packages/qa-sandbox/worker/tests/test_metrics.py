from __future__ import annotations

from r3mes_qa_worker.metrics import (
    aggregate_quality_0_100,
    fails_quality_hard_gate,
    score_single,
)


def test_identical_strings_high_score() -> None:
    ref = "Aynı metin tam olarak."
    hyp = ref
    s = score_single(ref, hyp)
    assert s.rouge_l_f1 >= 0.99
    assert s.bleu_0_1 >= 0.99
    agg = aggregate_quality_0_100([s])
    assert agg >= 99.0


def test_unrelated_strings_low_score() -> None:
    ref = "Blokzincir konsensüsü hakkında uzun bir açıklama."
    hyp = "Alakasız kısa cevap."
    s = score_single(ref, hyp)
    agg = aggregate_quality_0_100([s])
    assert agg < 75.0


def test_template_token_leak_fails_hard_gate() -> None:
    hyp = "Hello <|im_start|> assistant <|im_end|>"
    assert fails_quality_hard_gate(hyp) is True
    s = score_single("referans", hyp)
    assert s.rouge_l_f1 == 0.0
    assert s.bleu_0_1 == 0.0


def test_blank_like_response_fails_hard_gate() -> None:
    hyp = " ...  \n\t "
    assert fails_quality_hard_gate(hyp) is True
    s = score_single("referans", hyp)
    assert s.rouge_l_f1 == 0.0
    assert s.bleu_0_1 == 0.0
