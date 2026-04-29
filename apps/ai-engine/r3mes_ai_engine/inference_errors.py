"""Çıkarım hataları — operasyonel sınıflandırma (AI engine içi; identity çözümlemesi yok)."""

from __future__ import annotations

from typing import Any

import httpx

# stage -> (category, retryable) — backend / istemci retry kararı için ipucu
_STAGE_META: dict[str, tuple[str, bool]] = {
    "llama_process": ("local_runtime", True),
    "adapter_download": ("artifact_fetch", True),
    "lora_hot_swap": ("llama_inference", True),
    "upstream_completion": ("llama_inference", True),
}


def classify_httpx_cause(exc: BaseException) -> str:
    """Gateway / llama HTTP katmanı için kısa kök neden etiketi."""
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.HTTPStatusError):
        return "http_status"
    if isinstance(exc, httpx.RequestError):
        return "transport"
    if isinstance(exc, OSError):
        return "os_error"
    return "unknown"


def inference_error_detail(
    stage: str,
    message: str,
    adapter_cid: str,
    *,
    extra: dict[str, Any] | None = None,
    cause: str | None = None,
) -> dict[str, Any]:
    category, retryable = _STAGE_META.get(stage, ("unknown", False))
    out: dict[str, Any] = {
        "stage": stage,
        "category": category,
        "retryable": retryable,
        "message": message,
        "adapter_cid": adapter_cid,
    }
    if cause is not None:
        out["cause"] = cause
    if extra:
        out.update(extra)
    return out
