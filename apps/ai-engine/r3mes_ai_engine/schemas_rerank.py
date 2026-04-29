from __future__ import annotations

from pydantic import BaseModel, Field


class RerankRequest(BaseModel):
    query: str = Field(min_length=1)
    documents: list[str] = Field(default_factory=list)


class RerankResponse(BaseModel):
    scores: list[float]
