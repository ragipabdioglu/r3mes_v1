"""inference_errors modülü — saf birim; HTTP/mock yok."""

from __future__ import annotations

from r3mes_ai_engine.inference_errors import classify_httpx_cause, inference_error_detail


def test_inference_error_detail_shape() -> None:
    d = inference_error_detail(
        "adapter_download",
        "gateway yok",
        "bafycid",
        cause="timeout",
        extra={"upstream_status": 504},
    )
    assert d["stage"] == "adapter_download"
    assert d["category"] == "artifact_fetch"
    assert d["retryable"] is True
    assert d["cause"] == "timeout"
    assert d["adapter_cid"] == "bafycid"
    assert d["upstream_status"] == 504


def test_unknown_stage_defaults() -> None:
    d = inference_error_detail("custom_future_stage", "msg", "cid")
    assert d["category"] == "unknown"
    assert d["retryable"] is False


def test_classify_httpx_timeout() -> None:
    import httpx

    exc = httpx.ReadTimeout("t")
    assert classify_httpx_cause(exc) == "timeout"
