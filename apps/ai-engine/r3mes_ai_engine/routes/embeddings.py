from __future__ import annotations

from fastapi import APIRouter, Request

from r3mes_ai_engine.hf_embeddings import embed_documents
from r3mes_ai_engine.schemas_embeddings import EmbeddingsRequest

router = APIRouter(tags=["embeddings"])


@router.post("/v1/embeddings")
async def embeddings(payload: EmbeddingsRequest, request: Request):
    settings = request.app.state.r3mes_settings
    state = request.app.state.r3mes_state
    return await embed_documents(settings, state, payload.input)
