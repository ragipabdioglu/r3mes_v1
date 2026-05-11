from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("R3MES_SKIP_LLAMA", "true")
    from r3mes_ai_engine.app import build_app

    with TestClient(build_app()) as c:
        yield c


def test_rerank_route_mocked(client, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_rerank(_settings, _state, query, documents):
        from r3mes_ai_engine.schemas_rerank import RerankResponse

        assert query == "smear"
        assert documents == ["doc-a", "doc-b"]
        return RerankResponse(scores=[0.9, 0.1])

    monkeypatch.setattr("r3mes_ai_engine.routes.rerank.rerank_documents", fake_rerank)

    r = client.post(
        "/v1/rerank",
        json={"query": "smear", "documents": ["doc-a", "doc-b"]},
    )

    assert r.status_code == 200
    assert r.json() == {
        "scores": [0.9, 0.1],
        "provider": "cross_encoder",
        "fallback_used": False,
        "fallback_reason": None,
    }
