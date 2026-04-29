"""
Operasyonel davranış — proxy zinciri mock transport ile.

Gerçek llama / IPFS / altyapı yok; başarı kriteri: hata ve başarı yüzeyi
(stage / category / cause / başlıklar) tutarlı ve teşhis edilebilir kalır.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import HTTPException

import r3mes_ai_engine.proxy_service as proxy_module
from r3mes_ai_engine.gguf_adapter import AdapterArtifact
from r3mes_ai_engine.proxy_service import proxy_chat_completions
from r3mes_ai_engine.schemas_openai import ChatCompletionRequest
from r3mes_ai_engine.settings import Settings
from r3mes_ai_engine.state import AppState


def _settings_skip_llama(tmp_path: Path) -> Settings:
    return Settings(
        skip_llama=True,
        adapter_cache_dir=tmp_path / "adapter_cache",
    )


def _chat_body(*, stream: bool = False) -> ChatCompletionRequest:
    return ChatCompletionRequest(
        messages=[{"role": "user", "content": "ping"}],
        adapter_cid="bafyoperational",
        stream=stream,
    )


def _base_only_body(*, stream: bool = False) -> ChatCompletionRequest:
    return ChatCompletionRequest(
        messages=[{"role": "user", "content": "ping"}],
        system_context="stay concise",
        retrieved_context="source: adapter optional",
        stream=stream,
    )


def _transport_ok(tmp_path: Path, *, lora_slot_id: int = 0) -> httpx.MockTransport:
    """GET /lora-adapters → yüklü slot; POST → scale güncelle; chat → tamam."""

    slot_file = tmp_path / f"server_lora_{lora_slot_id}.gguf"
    slot_file.parent.mkdir(parents=True, exist_ok=True)
    slot_file.write_bytes(b"placeholder")

    def handler(request: httpx.Request) -> httpx.Response:
        u = str(request.url)
        if "lora-adapters" in u:
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json=[{"id": lora_slot_id, "path": str(slot_file), "scale": 0.0}],
                    headers={"content-type": "application/json"},
                )
            if request.method == "POST":
                return httpx.Response(204)
        if "chat/completions" in u:
            return httpx.Response(
                200,
                json={"id": "1", "object": "chat.completion", "choices": []},
                headers={"content-type": "application/json"},
            )
        return httpx.Response(404, text="unexpected url")

    return httpx.MockTransport(handler)


def _fresh_lora_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Modül düzeyindeki Lock eski event loop'a bağlı kalmasın diye her testte yenile."""
    monkeypatch.setattr(proxy_module, "_lora_lock", asyncio.Lock())


def _patch_async_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    """proxy_service içindeki AsyncClient çağrıları MockTransport kullanır (_post_lora_adapter dahil)."""

    RealAsyncClient = httpx.AsyncClient

    def _factory(*_a: object, **kw: object) -> httpx.AsyncClient:
        kw.pop("timeout", None)
        return RealAsyncClient(transport=transport, timeout=None)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.httpx.AsyncClient", _factory)


@pytest.mark.asyncio
async def test_lora_lock_serializes_critical_section(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Yüksek eşzamanlılıkta ensure_adapter_gguf içi eşzamanlılık en fazla 1 olmalı."""
    _fresh_lora_lock(monkeypatch)
    depth = 0
    max_depth = 0

    async def tracked_ensure(_settings: Settings, _cid: str) -> AdapterArtifact:
        nonlocal depth, max_depth
        depth += 1
        max_depth = max(max_depth, depth)
        await asyncio.sleep(0.06)
        depth -= 1
        p = tmp_path / "fake.gguf"
        p.write_bytes(b"x")
        return AdapterArtifact(p.resolve(), True, 0.0)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", tracked_ensure)
    _patch_async_client(monkeypatch, _transport_ok(tmp_path))

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _chat_body()

    async def one() -> None:
        await proxy_chat_completions(settings, state, body)

    await asyncio.gather(one(), one())
    assert max_depth == 1


@pytest.mark.asyncio
async def test_second_request_nonzero_lock_wait_headers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """İkinci istek birincinin kritik bölümünde bekler; Lock-Wait-Ms > 0 olabilir."""
    _fresh_lora_lock(monkeypatch)
    gate = asyncio.Event()

    async def slow_ensure(_settings: Settings, _cid: str) -> AdapterArtifact:
        await gate.wait()
        await asyncio.sleep(0.05)
        p = tmp_path / "a.gguf"
        p.write_bytes(b"x")
        return AdapterArtifact(p.resolve(), True, 0.0)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", slow_ensure)
    _patch_async_client(monkeypatch, _transport_ok(tmp_path))

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _chat_body()

    async def first() -> object:
        return await proxy_chat_completions(settings, state, body)

    t1 = asyncio.create_task(first())
    await asyncio.sleep(0.01)
    t2 = asyncio.create_task(first())
    gate.set()
    r1, r2 = await asyncio.gather(t1, t2)

    from starlette.responses import Response

    assert isinstance(r1, Response) and isinstance(r2, Response)
    w1 = float(r1.headers["X-R3MES-Lock-Wait-Ms"])
    w2 = float(r2.headers["X-R3MES-Lock-Wait-Ms"])
    assert min(w1, w2) < 1.0
    assert max(w1, w2) >= 20.0


@pytest.mark.asyncio
async def test_adapter_download_error_triage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fresh_lora_lock(monkeypatch)
    async def boom(_settings: Settings, _cid: str) -> AdapterArtifact:
        raise httpx.ConnectError("gateway down", request=MagicMock())

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", boom)

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _chat_body()

    with pytest.raises(HTTPException) as ei:
        await proxy_chat_completions(settings, state, body)

    d = ei.value.detail
    assert d["stage"] == "adapter_download"
    assert d["category"] == "artifact_fetch"
    assert d["cause"] == "transport"
    assert d["retryable"] is True
    assert d["adapter_cid"] == "bafyoperational"


@pytest.mark.asyncio
async def test_lora_hot_swap_http_error_triage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fresh_lora_lock(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if "lora-adapters" in str(request.url):
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json=[{"id": 0, "path": str(tmp_path / "s.gguf"), "scale": 0.0}],
                )
            return httpx.Response(400, text="bad lora")
        return httpx.Response(500, text="should not reach")

    async def fake_ensure(_s: Settings, _c: str) -> AdapterArtifact:
        return AdapterArtifact((tmp_path / "z.gguf").resolve(), True, 0.0)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", fake_ensure)
    (tmp_path / "z.gguf").write_bytes(b"x")
    (tmp_path / "s.gguf").write_bytes(b"p")
    _patch_async_client(monkeypatch, httpx.MockTransport(handler))

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _chat_body()

    with pytest.raises(HTTPException) as ei:
        await proxy_chat_completions(settings, state, body)

    d = ei.value.detail
    assert d["stage"] == "lora_hot_swap"
    assert d["category"] == "llama_inference"
    assert d["cause"] == "http_status"
    assert d["upstream_status"] == 400


@pytest.mark.asyncio
async def test_upstream_completion_error_triage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fresh_lora_lock(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if "lora-adapters" in str(request.url):
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json=[{"id": 0, "path": str(tmp_path / "s2.gguf"), "scale": 0.0}],
                )
            return httpx.Response(204)
        if "chat/completions" in str(request.url):
            return httpx.Response(503, text="busy")
        return httpx.Response(404)

    async def fake_ensure(_s: Settings, _c: str) -> AdapterArtifact:
        return AdapterArtifact((tmp_path / "z.gguf").resolve(), True, 0.0)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", fake_ensure)
    (tmp_path / "z.gguf").write_bytes(b"x")
    (tmp_path / "s2.gguf").write_bytes(b"p")
    _patch_async_client(monkeypatch, httpx.MockTransport(handler))

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _chat_body()

    with pytest.raises(HTTPException) as ei:
        await proxy_chat_completions(settings, state, body)

    d = ei.value.detail
    assert d["stage"] == "upstream_completion"
    assert d["category"] == "llama_inference"
    assert d["cause"] == "http_status"
    assert d["upstream_status"] == 503


@pytest.mark.asyncio
async def test_non_stream_success_headers_consistent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fresh_lora_lock(monkeypatch)

    async def fake_ensure(_s: Settings, _c: str) -> AdapterArtifact:
        return AdapterArtifact((tmp_path / "z.gguf").resolve(), False, 12.5)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", fake_ensure)
    (tmp_path / "z.gguf").write_bytes(b"x")
    _patch_async_client(monkeypatch, _transport_ok(tmp_path, lora_slot_id=2))

    settings = _settings_skip_llama(tmp_path)
    settings = settings.model_copy(update={"lora_adapter_slot_id": 2})
    state = AppState()
    body = _chat_body()

    resp = await proxy_chat_completions(settings, state, body, request_id="req-smoke-1")
    from starlette.responses import Response

    assert isinstance(resp, Response)
    assert resp.headers["X-R3MES-Adapter-Cache"] == "miss"
    assert resp.headers["X-R3MES-Lora-Slot"] == "2"
    assert "X-R3MES-Lock-Wait-Ms" in resp.headers
    assert "X-R3MES-Adapter-Resolve-Ms" in resp.headers
    assert float(resp.headers["X-R3MES-Adapter-Resolve-Ms"]) == pytest.approx(12.5)


@pytest.mark.asyncio
async def test_stream_response_has_stable_diagnostic_headers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fresh_lora_lock(monkeypatch)

    async def fake_ensure(_s: Settings, _c: str) -> AdapterArtifact:
        return AdapterArtifact((tmp_path / "z.gguf").resolve(), True, 0.0)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", fake_ensure)
    (tmp_path / "z.gguf").write_bytes(b"x")
    (tmp_path / "stream_slot.gguf").write_bytes(b"p")

    def handler(request: httpx.Request) -> httpx.Response:
        if "lora-adapters" in str(request.url):
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json=[{"id": 0, "path": str(tmp_path / "stream_slot.gguf"), "scale": 0.0}],
                )
            return httpx.Response(204)
        if "chat/completions" in str(request.url):
            return httpx.Response(200, text="data: {}\n\n")
        return httpx.Response(404)

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _chat_body(stream=True)

    resp = await proxy_chat_completions(settings, state, body)
    assert resp.headers.get("X-R3MES-Inference-Stage") == "stream"
    assert resp.headers.get("X-R3MES-Diagnostics") == "see_server_logs"
    assert "X-R3MES-Adapter-Cache" not in resp.headers


@pytest.mark.asyncio
async def test_base_only_request_skips_lora_and_preserves_context(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fresh_lora_lock(monkeypatch)
    ensure_called = False
    post_lora_called = False
    captured_json: dict | None = None

    async def fake_ensure(_s: Settings, _c: str) -> AdapterArtifact:
        nonlocal ensure_called
        ensure_called = True
        raise AssertionError("ensure_adapter_gguf should not be called for base-only chat")

    async def fake_post_lora(_settings: Settings, _path: str, _cid: str) -> float:
        nonlocal post_lora_called
        post_lora_called = True
        raise AssertionError("_post_lora_adapter should not be called for base-only chat")

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", fake_ensure)
    monkeypatch.setattr("r3mes_ai_engine.proxy_service._post_lora_adapter", fake_post_lora)

    RealAsyncClient = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_json
        if "chat/completions" in str(request.url):
            captured_json = __import__("json").loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={"id": "1", "object": "chat.completion", "choices": []},
                headers={"content-type": "application/json"},
            )
        return httpx.Response(404, text="unexpected url")

    def _factory(*_a: object, **kw: object) -> httpx.AsyncClient:
        kw.pop("timeout", None)
        return RealAsyncClient(transport=httpx.MockTransport(handler), timeout=None)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.httpx.AsyncClient", _factory)

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _base_only_body()

    resp = await proxy_chat_completions(settings, state, body)
    from starlette.responses import Response

    assert isinstance(resp, Response)
    assert ensure_called is False
    assert post_lora_called is False
    assert resp.headers["X-R3MES-Adapter-Cache"] == "none"
    assert captured_json is not None
    assert captured_json["messages"][0] == {"role": "system", "content": "stay concise"}
    assert captured_json["messages"][1] == {"role": "system", "content": "source: adapter optional"}
    assert captured_json["messages"][2] == {"role": "user", "content": "ping"}


def test_base_only_request_skips_lora_and_preserves_context_sync(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fresh_lora_lock(monkeypatch)
    ensure_called = False
    post_lora_called = False
    captured_json: dict | None = None

    async def fake_ensure(_s: Settings, _c: str) -> AdapterArtifact:
        nonlocal ensure_called
        ensure_called = True
        raise AssertionError("ensure_adapter_gguf should not be called for base-only chat")

    async def fake_post_lora(_settings: Settings, _path: str, _cid: str) -> float:
        nonlocal post_lora_called
        post_lora_called = True
        raise AssertionError("_post_lora_adapter should not be called for base-only chat")

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", fake_ensure)
    monkeypatch.setattr("r3mes_ai_engine.proxy_service._post_lora_adapter", fake_post_lora)

    RealAsyncClient = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_json
        if "chat/completions" in str(request.url):
            captured_json = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={"id": "1", "object": "chat.completion", "choices": []},
                headers={"content-type": "application/json"},
            )
        return httpx.Response(404, text="unexpected url")

    def _factory(*_a: object, **kw: object) -> httpx.AsyncClient:
        kw.pop("timeout", None)
        return RealAsyncClient(transport=httpx.MockTransport(handler), timeout=None)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.httpx.AsyncClient", _factory)

    settings = _settings_skip_llama(tmp_path)
    state = AppState()
    body = _base_only_body()

    from starlette.responses import Response

    resp = asyncio.run(proxy_chat_completions(settings, state, body))
    assert isinstance(resp, Response)
    assert ensure_called is False
    assert post_lora_called is False
    assert resp.headers["X-R3MES-Adapter-Cache"] == "none"
    assert captured_json is not None
    assert captured_json["messages"][0] == {"role": "system", "content": "stay concise"}
    assert captured_json["messages"][1] == {"role": "system", "content": "source: adapter optional"}
    assert captured_json["messages"][2] == {"role": "user", "content": "ping"}
