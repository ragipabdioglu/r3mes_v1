"""Chat completions route testleri.

Bu modül **birim** testleridir: `R3MES_SKIP_LLAMA=true` ile llama subprocess yoktur;
gerçek IPFS indirme, llama-server veya tam proxy zinciri çalışmaz.

`test_chat_proxy_route_mocked` yalnızca `proxy_chat_completions` fonksiyonunu
monkeypatch eder — böylece HTTP katmanı ve şema doğrulaması doğrulanır, çıkarım yoktur.
Entegrasyon / E2E testleri (gerçek llama + gateway) ayrı ortamda çalıştırılmalıdır.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("R3MES_SKIP_LLAMA", "true")
    from r3mes_ai_engine.app import build_app

    with TestClient(build_app()) as c:
        yield c


def test_health(client) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_runtime_health_exposes_provider_configuration(client) -> None:
    r = client.get("/health/runtime")
    assert r.status_code == 200
    body = r.json()

    assert body["status"] == "ok"
    assert body["inference"]["backend"] == "llama_cpp"
    assert body["embedding"]["configured_model"] == "BAAI/bge-m3"
    assert body["embedding"]["loaded"] is False
    assert body["reranker"]["configured_model"] == "BAAI/bge-reranker-base"
    assert body["reranker"]["loaded"] is False


def test_chat_proxy_route_mocked(client, monkeypatch: pytest.MonkeyPatch) -> None:
    """proxy tamamen mock: doğrulama + route; LoRA/IPFS/llama yok."""

    async def fake_proxy(_settings, _state, _body, **_kwargs):
        from starlette.responses import Response

        return Response(
            content=b'{"id":"x","object":"chat.completion","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
            media_type="application/json",
        )

    monkeypatch.setattr("r3mes_ai_engine.routes.chat.proxy_chat_completions", fake_proxy)

    r = client.post(
        "/v1/chat/completions",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "adapter_cid": "bafyadapter",
            "stream": False,
        },
    )
    assert r.status_code == 200


def test_missing_adapter_cid_is_allowed(client, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_proxy(_settings, _state, body, **_kwargs):
        from starlette.responses import JSONResponse

        return JSONResponse(
            {
                "adapter_cid": body.adapter_cid,
                "system_context": body.system_context,
                "retrieved_context": body.retrieved_context,
            }
        )

    monkeypatch.setattr("r3mes_ai_engine.routes.chat.proxy_chat_completions", fake_proxy)
    r = client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "x"}]})
    assert r.status_code == 200
    assert r.json() == {
        "adapter_cid": None,
        "system_context": None,
        "retrieved_context": None,
    }


def test_whitespace_only_adapter_cid_normalizes_to_none(client, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_proxy(_settings, _state, body, **_kwargs):
        from starlette.responses import JSONResponse

        return JSONResponse({"adapter_cid": body.adapter_cid})

    monkeypatch.setattr("r3mes_ai_engine.routes.chat.proxy_chat_completions", fake_proxy)
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "x"}], "adapter_cid": "   "},
    )
    assert r.status_code == 200
    assert r.json() == {"adapter_cid": None}


def test_context_fields_are_accepted(client, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_proxy(_settings, _state, body, **_kwargs):
        from starlette.responses import JSONResponse

        return JSONResponse(
            {
                "system_context": body.system_context,
                "retrieved_context": body.retrieved_context,
                "adapter_cid": body.adapter_cid,
            }
        )

    monkeypatch.setattr("r3mes_ai_engine.routes.chat.proxy_chat_completions", fake_proxy)
    r = client.post(
        "/v1/chat/completions",
        json={
            "messages": [{"role": "user", "content": "x"}],
            "system_context": "you are concise",
            "retrieved_context": "doc: adapter is optional",
        },
    )
    assert r.status_code == 200
    assert r.json() == {
        "system_context": "you are concise",
        "retrieved_context": "doc: adapter is optional",
        "adapter_cid": None,
    }
