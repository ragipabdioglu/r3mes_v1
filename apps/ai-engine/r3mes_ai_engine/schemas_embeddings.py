from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class EmbeddingsRequest(BaseModel):
    input: list[str] = Field(min_length=1, max_length=64)


class EmbeddingItem(BaseModel):
    index: int
    embedding: list[float]


class EmbeddingsResponse(BaseModel):
    object: Literal["list"] = "list"
    provider: Literal["bge-m3", "external"]
    model: str
    dimension: int
    normalized: bool
    pooling: Literal["mean_pooling"]
    device: Literal["cpu", "cuda"]
    fallback_used: Literal[False] = False
    data: list[EmbeddingItem]
