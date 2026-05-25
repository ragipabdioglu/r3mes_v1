from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from r3mes_ai_engine.schemas_embeddings import EmbeddingItem, EmbeddingsResponse


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("R3MES_SKIP_LLAMA", "true")
    from r3mes_ai_engine.app import build_app

    with TestClient(build_app()) as test_client:
        yield test_client


def test_embeddings_route_exposes_provider_lineage(client, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_embed_documents(_settings, _state, _input):
        return EmbeddingsResponse(
            provider="bge-m3",
            model="BAAI/bge-m3",
            dimension=2,
            normalized=True,
            pooling="mean_pooling",
            device="cpu",
            data=[EmbeddingItem(index=0, embedding=[0.1, 0.2])],
        )

    monkeypatch.setattr("r3mes_ai_engine.routes.embeddings.embed_documents", fake_embed_documents)

    response = client.post("/v1/embeddings", json={"input": ["ornek bilgi"]})

    assert response.status_code == 200
    assert response.json() == {
        "object": "list",
        "provider": "bge-m3",
        "model": "BAAI/bge-m3",
        "dimension": 2,
        "normalized": True,
        "pooling": "mean_pooling",
        "device": "cpu",
        "fallback_used": False,
        "data": [{"index": 0, "embedding": [0.1, 0.2]}],
    }
