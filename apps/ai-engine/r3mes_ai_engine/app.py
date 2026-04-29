from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from r3mes_ai_engine.llama_bootstrap import bootstrap_llama, stop_llama_server
from r3mes_ai_engine.routes.chat import router as chat_router
from r3mes_ai_engine.routes.embeddings import router as embeddings_router
from r3mes_ai_engine.routes.rerank import router as rerank_router
from r3mes_ai_engine.settings import get_settings
from r3mes_ai_engine.state import AppState

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    state = AppState()
    if settings.inference_backend == "llama_cpp":
        await bootstrap_llama(settings, state)
    app.state.r3mes_settings = settings
    app.state.r3mes_state = state
    logger.info(
        "R3MES ai-engine hazır (backend=%s, çekirdek=%s).",
        settings.inference_backend,
        state.frozen_core_source,
    )
    yield
    if settings.inference_backend == "llama_cpp":
        stop_llama_server(state)
        logger.info("llama-server süreci sonlandırıldı.")


def build_app() -> FastAPI:
    app = FastAPI(title="R3MES Inference Proxy", version="0.3.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(chat_router)
    app.include_router(embeddings_router)
    app.include_router(rerank_router)
    return app


app = build_app()
