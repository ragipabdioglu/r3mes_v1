from __future__ import annotations

from pydantic import BaseModel, Field


class EmbeddingsRequest(BaseModel):
    input: list[str] = Field(min_length=1, max_length=64)


class EmbeddingItem(BaseModel):
    index: int
    embedding: list[float]


class EmbeddingsResponse(BaseModel):
    model: str
    data: list[EmbeddingItem]
