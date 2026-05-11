from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from r3mes_ai_engine.schemas_rerank import RerankResponse
from r3mes_ai_engine.settings import Settings
from r3mes_ai_engine.state import AppState

logger = logging.getLogger(__name__)


@dataclass
class RerankerRuntime:
    model_name_or_path: str
    tokenizer: Any
    model: Any
    device: str


_reranker_lock = asyncio.Lock()


def _lazy_imports() -> tuple[Any, Any, Any]:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    return torch, AutoModelForSequenceClassification, AutoTokenizer


def _resolve_model_name(settings: Settings) -> str:
    if settings.reranker_local_path and settings.reranker_local_path.exists():
        return str(settings.reranker_local_path.resolve())
    return settings.reranker_model_name_or_path


def _normalize_text(value: str) -> str:
    replacements = str.maketrans({
        "ç": "c",
        "ğ": "g",
        "ı": "i",
        "ö": "o",
        "ş": "s",
        "ü": "u",
        "Ç": "c",
        "Ğ": "g",
        "İ": "i",
        "I": "i",
        "Ö": "o",
        "Ş": "s",
        "Ü": "u",
    })
    return value.translate(replacements).lower()


def _tokens(value: str) -> set[str]:
    stopwords = {
        "ama",
        "bir",
        "icin",
        "ile",
        "kisa",
        "mi",
        "ne",
        "nasil",
        "once",
        "sonra",
        "ve",
        "veya",
    }
    return {
        token
        for token in re.split(r"[^a-z0-9]+", _normalize_text(value))
        if len(token) >= 3 and token not in stopwords
    }


def _fallback_scores(query: str, documents: list[str]) -> list[float]:
    query_tokens = _tokens(query)
    if not query_tokens:
        return [0.0 for _document in documents]
    scores: list[float] = []
    normalized_query = _normalize_text(query)
    query_phrases = [
        phrase.strip()
        for phrase in re.split(r"[?.!,;:\n]+", normalized_query)
        if len(phrase.strip()) >= 10
    ]
    for document in documents:
        document_text = _normalize_text(document)
        document_tokens = _tokens(document)
        overlap = len(query_tokens & document_tokens)
        union = max(1, len(query_tokens | document_tokens))
        phrase_bonus = 0.25 if any(phrase in document_text for phrase in query_phrases) else 0.0
        title_bonus = 0.15 if "title:" in document_text and overlap > 0 else 0.0
        scores.append((overlap / union) + phrase_bonus + title_bonus)
    return scores


def _fallback_response(query: str, documents: list[str], reason: str) -> RerankResponse:
    logger.warning("reranker lightweight fallback kullanıldı: %s", reason)
    return RerankResponse(
        scores=_fallback_scores(query, documents),
        provider="lightweight_fallback",
        fallback_used=True,
        fallback_reason=reason[:500],
    )


async def _load_reranker(settings: Settings, state: AppState) -> RerankerRuntime:
    if state.reranker_runtime is not None:
        return state.reranker_runtime

    torch, AutoModelForSequenceClassification, AutoTokenizer = _lazy_imports()
    model_name_or_path = _resolve_model_name(settings)

    def _load() -> RerankerRuntime:
        tokenizer = AutoTokenizer.from_pretrained(
            model_name_or_path,
            local_files_only=settings.reranker_local_files_only,
        )
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name_or_path,
            local_files_only=settings.reranker_local_files_only,
            low_cpu_mem_usage=False,
            device_map=None,
        )
        device = "cpu"
        if settings.reranker_device == "cuda" and torch.cuda.is_available():
            model = model.to("cuda")
            device = "cuda"
        model.eval()
        return RerankerRuntime(
            model_name_or_path=model_name_or_path,
            tokenizer=tokenizer,
            model=model,
            device=device,
        )

    runtime = await asyncio.to_thread(_load)
    state.reranker_runtime = runtime
    logger.info("reranker_runtime hazır model=%s device=%s", runtime.model_name_or_path, runtime.device)
    return runtime


async def rerank_documents(
    settings: Settings,
    state: AppState,
    query: str,
    documents: list[str],
) -> RerankResponse:
    if not documents:
        return RerankResponse(scores=[])

    async with _reranker_lock:
        try:
            runtime = await _load_reranker(settings, state)
        except Exception as exc:
            return _fallback_response(query, documents, str(exc))

    def _score() -> list[float]:
        torch, _AutoModelForSequenceClassification, _AutoTokenizer = _lazy_imports()
        merged_inputs = [f"Query: {query}\nDocument: {document}" for document in documents]
        batch = runtime.tokenizer(
            merged_inputs,
            padding=True,
            truncation=True,
            max_length=settings.reranker_max_length,
            return_tensors="pt",
        )
        if runtime.device == "cuda":
            batch = {key: value.to("cuda") for key, value in batch.items()}
        with torch.no_grad():
            logits = runtime.model(**batch).logits.view(-1).detach().cpu().tolist()
        return [float(item) for item in logits]

    try:
        scores = await asyncio.to_thread(_score)
    except Exception as exc:
        state.reranker_runtime = None
        return _fallback_response(query, documents, str(exc))

    return RerankResponse(scores=scores, provider="cross_encoder", fallback_used=False)


def reranker_runtime_status(settings: Settings, state: AppState) -> dict[str, Any]:
    runtime = state.reranker_runtime
    resolved_model = _resolve_model_name(settings)
    return {
        "configured_model": settings.reranker_model_name_or_path,
        "resolved_model": runtime.model_name_or_path if runtime else resolved_model,
        "local_path": str(settings.reranker_local_path) if settings.reranker_local_path else None,
        "local_files_only": settings.reranker_local_files_only,
        "configured_device": settings.reranker_device,
        "loaded": runtime is not None,
        "device": runtime.device if runtime else None,
        "max_length": settings.reranker_max_length,
    }
