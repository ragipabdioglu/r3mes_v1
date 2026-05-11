from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from r3mes_ai_engine.hf_embeddings import embedding_runtime_status
from r3mes_ai_engine.hf_reranker import reranker_runtime_status
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

    @app.get("/health/runtime")
    def runtime_health() -> dict[str, object]:
        settings = app.state.r3mes_settings
        state = app.state.r3mes_state
        return {
            "status": "ok",
            "inference": {
                "backend": settings.inference_backend,
                "default_model": settings.default_model_name,
                "llama": {
                    "configured": settings.inference_backend == "llama_cpp",
                    "loaded": state.llama_process is not None and state.llama_process.poll() is None,
                    "core_source": state.frozen_core_source,
                    "ctx_size": settings.llama_ctx_size,
                    "n_gpu_layers": settings.llama_n_gpu_layers,
                },
                "hf": {
                    "model": settings.hf_model_name_or_path,
                    "local_path": str(settings.hf_model_local_path) if settings.hf_model_local_path else None,
                    "local_files_only": settings.hf_local_files_only,
                    "loaded": state.hf_runtime is not None,
                },
            },
            "embedding": embedding_runtime_status(settings, state),
            "reranker": reranker_runtime_status(settings, state),
        }

    app.include_router(chat_router)
    app.include_router(embeddings_router)
    app.include_router(rerank_router)
    return app


app = build_app()
