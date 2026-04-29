from __future__ import annotations

from fastapi import APIRouter, Request

from r3mes_ai_engine.proxy_service import proxy_chat_completions
from r3mes_ai_engine.schemas_openai import ChatCompletionRequest

router = APIRouter(tags=["chat"])


def _request_id_header(request: Request) -> str | None:
    return request.headers.get("x-request-id") or request.headers.get("X-Request-ID")


@router.post("/v1/chat/completions")
async def chat_completions(payload: ChatCompletionRequest, request: Request):
    settings = request.app.state.r3mes_settings
    state = request.app.state.r3mes_state
    return await proxy_chat_completions(
        settings,
        state,
        payload,
        request_id=_request_id_header(request),
    )
