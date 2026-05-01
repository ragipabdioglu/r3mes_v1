from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from r3mes_ai_engine.schemas_embeddings import EmbeddingItem, EmbeddingsResponse
from r3mes_ai_engine.settings import Settings
from r3mes_ai_engine.state import AppState

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingRuntime:
    model_name_or_path: str
    tokenizer: Any
    model: Any
    device: str


_embedding_lock = asyncio.Lock()


def _lazy_imports() -> tuple[Any, Any, Any]:
    import torch
    from transformers import AutoModel, AutoTokenizer

    return torch, AutoModel, AutoTokenizer


def _resolve_model_name(settings: Settings) -> str:
    if settings.embedding_local_path and settings.embedding_local_path.exists():
        return str(settings.embedding_local_path.resolve())
    return settings.embedding_model_name_or_path


def _l2_normalize(values: list[float]) -> list[float]:
    norm = sum(value * value for value in values) ** 0.5
    if norm == 0:
        return values
    return [float(value / norm) for value in values]


async def _load_embedding(settings: Settings, state: AppState) -> EmbeddingRuntime:
    if state.embedding_runtime is not None:
        return state.embedding_runtime

    torch, AutoModel, AutoTokenizer = _lazy_imports()
    model_name_or_path = _resolve_model_name(settings)

    def _load() -> EmbeddingRuntime:
        tokenizer = AutoTokenizer.from_pretrained(
            model_name_or_path,
            local_files_only=settings.embedding_local_files_only,
        )
        model = AutoModel.from_pretrained(
            model_name_or_path,
            local_files_only=settings.embedding_local_files_only,
        )
        device = "cpu"
        if settings.embedding_device == "cuda" and torch.cuda.is_available():
            try:
                model = model.to("cuda")
                device = "cuda"
            except Exception as exc:
                logger.warning(
                    "embedding CUDA yüklenemedi, CPU fallback kullanılacak model=%s reason=%s",
                    model_name_or_path,
                    exc,
                )
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                model = model.to("cpu")
        model.eval()
        return EmbeddingRuntime(
            model_name_or_path=model_name_or_path,
            tokenizer=tokenizer,
            model=model,
            device=device,
        )

    runtime = await asyncio.to_thread(_load)
    state.embedding_runtime = runtime
    logger.info("embedding_runtime hazır model=%s device=%s", runtime.model_name_or_path, runtime.device)
    return runtime


async def embed_documents(
    settings: Settings,
    state: AppState,
    inputs: list[str],
) -> EmbeddingsResponse:
    async with _embedding_lock:
        runtime = await _load_embedding(settings, state)

    def _embed() -> list[list[float]]:
        torch, _AutoModel, _AutoTokenizer = _lazy_imports()
        batch = runtime.tokenizer(
            inputs,
            padding=True,
            truncation=True,
            max_length=settings.embedding_max_length,
            return_tensors="pt",
        )
        if runtime.device == "cuda":
            batch = {key: value.to("cuda") for key, value in batch.items()}
        with torch.no_grad():
            outputs = runtime.model(**batch)
            hidden = outputs.last_hidden_state
            mask = batch["attention_mask"].unsqueeze(-1).expand(hidden.size()).float()
            summed = (hidden * mask).sum(dim=1)
            counts = mask.sum(dim=1).clamp(min=1e-9)
            pooled = summed / counts
            vectors = pooled.detach().cpu().tolist()
        return [_l2_normalize([float(value) for value in vector]) for vector in vectors]

    try:
        vectors = await asyncio.to_thread(_embed)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"code": "EMBEDDING_FAILED", "message": str(exc)},
        ) from exc

    return EmbeddingsResponse(
        model=runtime.model_name_or_path,
        data=[EmbeddingItem(index=index, embedding=vector) for index, vector in enumerate(vectors)],
    )
