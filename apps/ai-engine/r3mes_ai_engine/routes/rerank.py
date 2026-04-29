from __future__ import annotations

from fastapi import APIRouter, Request

from r3mes_ai_engine.hf_reranker import rerank_documents
from r3mes_ai_engine.schemas_rerank import RerankRequest

router = APIRouter(tags=["rerank"])


@router.post("/v1/rerank")
async def rerank(payload: RerankRequest, request: Request):
    settings = request.app.state.r3mes_settings
    state = request.app.state.r3mes_state
    return await rerank_documents(settings, state, payload.query, payload.documents)
