"""
Stream ve non-stream aynı hata koşulunda FastAPI `detail` sözlüğünü (triage) paylaşır.

Ürün koşullarında teşhis: hangi modda olursa olsun stage / category / cause ile ayrıştırma tutarlı kalır.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import HTTPException
from starlette.responses import StreamingResponse

import r3mes_ai_engine.proxy_service as proxy_module
from r3mes_ai_engine.gguf_adapter import AdapterArtifact
from r3mes_ai_engine.proxy_service import proxy_chat_completions
from r3mes_ai_engine.schemas_openai import ChatCompletionRequest
from r3mes_ai_engine.settings import Settings
from r3mes_ai_engine.state import AppState


def _fresh_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(proxy_module, "_lora_lock", asyncio.Lock())


def _patch_client_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    RealAsyncClient = httpx.AsyncClient

    def _factory(*_a: object, **kw: object) -> httpx.AsyncClient:
        kw.pop("timeout", None)
        t = httpx.MockTransport(
            lambda r: httpx.Response(200, json={"ok": True})
            if "chat/completions" in str(r.url)
            else httpx.Response(404)
        )
        return RealAsyncClient(transport=t, timeout=None)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.httpx.AsyncClient", _factory)


def _detail_keys(d: object) -> set[str]:
    assert isinstance(d, dict)
    return set(d.keys())


async def _drain_or_raise(resp: object) -> None:
    """Stream yanıtında hata, gövde üretilirken oluşur; tüketim gerekir."""
    if isinstance(resp, StreamingResponse):
        async for _ in resp.body_iterator:
            pass


@pytest.mark.asyncio
async def test_adapter_download_error_detail_parity_stream_vs_nonstream(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fresh_lock(monkeypatch)

    async def boom(_s: Settings, _c: str) -> AdapterArtifact:
        raise httpx.TimeoutException("t", request=MagicMock())

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", boom)
    _patch_client_ok(monkeypatch)

    settings = Settings(skip_llama=True, adapter_cache_dir=tmp_path / "c")
    state = AppState()
    cid = "bafyparity"

    async def run(stream: bool) -> dict:
        body = ChatCompletionRequest(
            messages=[{"role": "user", "content": "x"}],
            adapter_cid=cid,
            stream=stream,
        )
        with pytest.raises(HTTPException) as ei:
            resp = await proxy_chat_completions(settings, state, body)
            await _drain_or_raise(resp)
        d = ei.value.detail
        assert isinstance(d, dict)
        return d

    d0 = await run(False)
    d1 = await run(True)
    assert _detail_keys(d0) == _detail_keys(d1)
    assert d0["stage"] == d1["stage"] == "adapter_download"
    assert d0["category"] == d1["category"] == "artifact_fetch"
    assert d0["cause"] == d1["cause"] == "timeout"


@pytest.mark.asyncio
async def test_upstream_error_detail_parity_stream_vs_nonstream(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fresh_lock(monkeypatch)

    async def ok_ensure(_s: Settings, _c: str) -> AdapterArtifact:
        p = tmp_path / "f.gguf"
        p.write_bytes(b"x")
        return AdapterArtifact(p.resolve(), True, 0.0)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.ensure_adapter_gguf", ok_ensure)

    RealAsyncClient = httpx.AsyncClient

    slot = tmp_path / "parity_lora.gguf"
    slot.write_bytes(b"p")

    def _transport() -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            u = str(request.url)
            if "lora-adapters" in u:
                if request.method == "GET":
                    return httpx.Response(
                        200,
                        json=[{"id": 0, "path": str(slot), "scale": 0.0}],
                    )
                return httpx.Response(204)
            if "chat/completions" in u:
                return httpx.Response(502, text="upstream")
            return httpx.Response(404)

        return httpx.MockTransport(handler)

    def _factory(*_a: object, **kw: object) -> httpx.AsyncClient:
        kw.pop("timeout", None)
        return RealAsyncClient(transport=_transport(), timeout=None)

    monkeypatch.setattr("r3mes_ai_engine.proxy_service.httpx.AsyncClient", _factory)

    settings = Settings(skip_llama=True, adapter_cache_dir=tmp_path / "c")
    state = AppState()
    cid = "bafyparity2"

    async def run(stream: bool) -> dict:
        body = ChatCompletionRequest(
            messages=[{"role": "user", "content": "x"}],
            adapter_cid=cid,
            stream=stream,
        )
        with pytest.raises(HTTPException) as ei:
            resp = await proxy_chat_completions(settings, state, body)
            await _drain_or_raise(resp)
        return ei.value.detail  # type: ignore[return-value]

    d0 = await run(False)
    d1 = await run(True)
    assert isinstance(d0, dict) and isinstance(d1, dict)
    assert _detail_keys(d0) == _detail_keys(d1)
    assert d0["stage"] == d1["stage"] == "upstream_completion"
    assert d0["upstream_status"] == d1["upstream_status"] == 502
