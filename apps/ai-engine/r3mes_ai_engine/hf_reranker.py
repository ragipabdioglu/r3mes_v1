from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException

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
        runtime = await _load_reranker(settings, state)

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
        raise HTTPException(
            status_code=500,
            detail={"code": "RERANK_FAILED", "message": str(exc)},
        ) from exc

    return RerankResponse(scores=scores)
