from __future__ import annotations

from typing import Any, Literal

from r3mes_ai_engine.settings import Settings

RuntimeProfileName = Literal["local-dev", "eval", "pilot-rag", "production", "peft-lab"]
RuntimeStrictness = Literal["dev_fallback_allowed", "quality_fallback_blocked"]

_STRICT_PROFILES: set[str] = {"eval", "pilot-rag", "production"}


def runtime_strictness(profile_name: str) -> RuntimeStrictness:
    if profile_name in _STRICT_PROFILES:
        return "quality_fallback_blocked"
    return "dev_fallback_allowed"


def is_strict_runtime_profile(settings: Settings) -> bool:
    return runtime_strictness(settings.runtime_profile) == "quality_fallback_blocked"


def runtime_profile_summary(settings: Settings) -> dict[str, Any]:
    """Return the ai-engine mirror of the product runtime profile.

    This is intentionally a summary: backend owns retrieval/Qdrant policy, while
    ai-engine reports the runtime facts it can enforce locally.
    """

    embedding_provider = (
        "bge-m3" if "bge-m3" in settings.embedding_model_name_or_path.lower() else "ai-engine"
    )
    strictness = runtime_strictness(settings.runtime_profile)
    return {
        "version": 1,
        "name": settings.runtime_profile,
        "strictness": strictness,
        "chat": {
            "runtime": settings.inference_backend,
            "model_family": "qwen2_5_3b"
            if "qwen2.5-3b" in settings.default_model_name.lower()
            or "qwen2.5-3b" in settings.hf_model_name_or_path.lower()
            else "unknown",
            "model_id": settings.default_model_name
            if settings.inference_backend == "llama_cpp"
            else settings.hf_model_name_or_path,
            "synthesis_only": True,
            "allow_deterministic_composer_bypass": settings.runtime_profile == "local-dev",
        },
        "embedding": {
            "requested_provider": embedding_provider,
            "required_real_provider": strictness == "quality_fallback_blocked",
            "expected_model_includes": ["bge-m3"],
            "expected_dimension": 1024,
        },
        "reranker": {
            "requested_mode": "model",
            "required_real_provider": strictness == "quality_fallback_blocked",
            "expected_provider": "cross_encoder",
        },
        "stream": {
            "product_mode": "sse_stream",
            "diagnostics": "first_event_and_headers",
        },
        "lora": {
            "role": "behavior_persona_only",
            "optional": True,
            "max_lock_wait_ms": settings.lora_max_lock_wait_ms,
            "budget_policy": "fail_request"
            if strictness == "quality_fallback_blocked"
            else "warn_continue",
        },
    }
