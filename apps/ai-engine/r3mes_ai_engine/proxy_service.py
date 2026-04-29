"""llama-server (C++) üzerinden OpenAI uyumlu proxy — FastAPI içinde tensör hesabı yok."""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse

from r3mes_ai_engine.gguf_adapter import AdapterArtifact, ensure_adapter_gguf
from r3mes_ai_engine.hf_inference import hf_chat_completions
from r3mes_ai_engine.inference_errors import classify_httpx_cause, inference_error_detail
from r3mes_ai_engine.llama_bootstrap import llama_public_base
from r3mes_ai_engine.schemas_openai import ChatCompletionRequest
from r3mes_ai_engine.settings import Settings
from r3mes_ai_engine.state import AppState

logger = logging.getLogger(__name__)

_lora_lock = asyncio.Lock()


def _adapter_cid_or_placeholder(adapter_cid: str | None) -> str:
    return adapter_cid or "-"


def _log_inference_line(
    *,
    request_id: str | None,
    adapter_cid: str | None,
    stream: bool,
    artifact: AdapterArtifact | None,
    lock_wait_ms: float,
    swap_ms: float | None,
) -> None:
    rid = request_id or "-"
    cache = artifact.cache_hit if artifact else None
    logger.info(
        "r3mes_inference request_id=%s adapter_cid=%s stream=%s cache_hit=%s "
        "lock_wait_ms=%.1f resolve_ms=%.1f swap_ms=%s",
        rid,
        _adapter_cid_or_placeholder(adapter_cid),
        stream,
        cache,
        lock_wait_ms,
        artifact.resolve_ms if artifact else 0.0,
        f"{swap_ms:.1f}" if swap_ms is not None else "-",
    )


async def _post_lora_adapter(settings: Settings, adapter_path: str, adapter_cid: str) -> float:
    """llama-server: LoRA dosyası --lora ile önceden yüklenir; POST yalnızca id+scale (path yok sayılır)."""
    base = llama_public_base(settings).rstrip("/")
    url_get = f"{base}/lora-adapters"
    url_post = f"{base}/lora-adapters"
    timeout = httpx.Timeout(120.0)
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            gr = await client.get(url_get)
            gr.raise_for_status()
            adapters: Any = gr.json()
            if not isinstance(adapters, list) or not adapters:
                raise HTTPException(
                    status_code=502,
                    detail=inference_error_detail(
                        "lora_hot_swap",
                        "llama-server üzerinde yüklü LoRA yok (GET /lora-adapters boş). "
                        "Süreci --lora <yol.gguf> ile başlatın; proxy indirilen GGUF'u bu dosyanın üzerine kopyalar.",
                        adapter_cid,
                        extra={"upstream_url": url_get},
                    ),
                )
            slot_id = settings.lora_adapter_slot_id
            slot = next((a for a in adapters if int(a.get("id", -1)) == slot_id), None)
            if slot is None:
                raise HTTPException(
                    status_code=502,
                    detail=inference_error_detail(
                        "lora_hot_swap",
                        f"GET /lora-adapters içinde id={slot_id} yok.",
                        adapter_cid,
                        extra={"adapters": adapters},
                    ),
                )
            if settings.lora_copy_target_override is not None:
                target = Path(settings.lora_copy_target_override)
            else:
                raw_p = slot.get("path")
                if not raw_p:
                    raise HTTPException(
                        status_code=502,
                        detail=inference_error_detail(
                            "lora_hot_swap",
                            "LoRA slot kaydında path yok.",
                            adapter_cid,
                        ),
                    )
                target = Path(str(raw_p))
            target.parent.mkdir(parents=True, exist_ok=True)
            source = Path(adapter_path)
            if source.resolve() != target.resolve():
                await asyncio.to_thread(shutil.copy2, source, target)

            body: list[dict[str, Any]] = []
            for a in adapters:
                sid = int(a["id"])
                sc = float(settings.lora_scale) if sid == slot_id else float(a.get("scale", 0.0))
                body.append({"id": sid, "scale": sc})

            r = await client.post(url_post, json=body)
            r.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning(
            "r3mes_lora_hot_swap http_status=%s body=%s",
            e.response.status_code,
            e.response.text[:500],
        )
        raise HTTPException(
            status_code=502,
            detail=inference_error_detail(
                "lora_hot_swap",
                "llama-server LoRA kaydı reddetti; lora-adapters yanıtı başarısız.",
                adapter_cid,
                extra={
                    "upstream_status": e.response.status_code,
                    "upstream_url": str(e.request.url),
                },
                cause=classify_httpx_cause(e),
            ),
        ) from e
    except httpx.RequestError as e:
        logger.exception("r3mes_lora_hot_swap transport adapter_cid=%s", adapter_cid)
        raise HTTPException(
            status_code=503,
            detail=inference_error_detail(
                "lora_hot_swap",
                f"llama-server erişilemedi ({base}): {e!s}",
                adapter_cid,
                cause=classify_httpx_cause(e),
            ),
        ) from e
    return (time.monotonic() - t0) * 1000.0


async def _post_lora_scale(settings: Settings, scale: float, adapter_label: str) -> float:
    """Set the configured llama.cpp LoRA slot scale without copying/changing the slot file."""
    base = llama_public_base(settings).rstrip("/")
    url = f"{base}/lora-adapters"
    timeout = httpx.Timeout(30.0)
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            gr = await client.get(url)
            gr.raise_for_status()
            adapters: Any = gr.json()
            if not isinstance(adapters, list) or not adapters:
                return 0.0
            slot_id = settings.lora_adapter_slot_id
            body = [
                {
                    "id": int(a["id"]),
                    "scale": float(scale) if int(a.get("id", -1)) == slot_id else float(a.get("scale", 0.0)),
                }
                for a in adapters
            ]
            r = await client.post(url, json=body)
            r.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("r3mes_lora_scale_reset_failed adapter=%s error=%s", adapter_label, e)
        return 0.0
    return (time.monotonic() - t0) * 1000.0


def _local_adapter_path(path_value: str | None, adapter_label: str) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value)
    if not path.is_file():
        raise HTTPException(
            status_code=400,
            detail=inference_error_detail(
                "adapter_path",
                "Yerel LoRA GGUF adapter_path bulunamadı.",
                adapter_label,
                extra={"adapter_path": path_value},
            ),
        )
    if path.suffix.lower() != ".gguf":
        raise HTTPException(
            status_code=400,
            detail=inference_error_detail(
                "adapter_path",
                "llama_cpp runtime yerel adapter_path için .gguf LoRA bekler.",
                adapter_label,
                extra={"adapter_path": path_value},
            ),
        )
    return path


def _prepend_context_messages(body: ChatCompletionRequest) -> list[dict[str, Any]]:
    messages = [message.model_dump(mode="json", exclude_none=True) for message in body.messages]
    prefixed: list[dict[str, Any]] = []
    if body.system_context:
        prefixed.append({"role": "system", "content": body.system_context})
    if body.retrieved_context:
        prefixed.append({"role": "system", "content": body.retrieved_context})
    prefixed.extend(messages)
    return prefixed


def _upstream_payload(body: ChatCompletionRequest) -> dict:
    payload = body.model_dump(
        mode="json",
        exclude={"adapter_cid", "system_context", "retrieved_context"},
        exclude_none=True,
    )
    payload["messages"] = _prepend_context_messages(body)
    return payload


def _success_headers(
    artifact: AdapterArtifact,
    lock_wait_ms: float,
    swap_ms: float,
    settings: Settings,
) -> dict[str, str]:
    return {
        "X-R3MES-Adapter-Cache": "hit" if artifact.cache_hit else "miss",
        "X-R3MES-Lock-Wait-Ms": f"{lock_wait_ms:.2f}",
        "X-R3MES-Adapter-Resolve-Ms": f"{artifact.resolve_ms:.2f}",
        "X-R3MES-Lora-Swap-Ms": f"{swap_ms:.2f}",
        "X-R3MES-Lora-Slot": str(settings.lora_adapter_slot_id),
    }


async def proxy_chat_completions(
    settings: Settings,
    state: AppState,
    body: ChatCompletionRequest,
    *,
    request_id: str | None = None,
) -> Response | StreamingResponse:
    runtime = body.runtime or settings.inference_backend
    if runtime == "transformers_peft":
        return await hf_chat_completions(settings, state, body, request_id=request_id)

    adapter_cid = body.adapter_cid
    adapter_label = body.adapter_path or _adapter_cid_or_placeholder(adapter_cid)
    local_adapter_path = _local_adapter_path(body.adapter_path, adapter_label)

    if not settings.skip_llama and state.llama_process is None:
        raise HTTPException(
            status_code=503,
            detail=inference_error_detail(
                "llama_process",
                "llama-server süreci ayakta değil; çıkarım kullanılamıyor.",
                adapter_label,
            ),
        )

    upstream = f"{llama_public_base(settings).rstrip('/')}/v1/chat/completions"
    payload = _upstream_payload(body)
    timeout = httpx.Timeout(settings.connect_timeout, read=settings.read_timeout)

    if body.stream:

        async def streamer() -> AsyncIterator[bytes]:
            artifact: AdapterArtifact | None = None
            lock_wait_ms = 0.0
            swap_ms: float | None = None
            if adapter_cid or local_adapter_path is not None:
                wait_t0 = time.monotonic()
                async with _lora_lock:
                    lock_wait_ms = (time.monotonic() - wait_t0) * 1000.0
                    if local_adapter_path is not None:
                        swap_ms = await _post_lora_adapter(settings, str(local_adapter_path), adapter_label)
                    elif adapter_cid:
                        try:
                            artifact = await ensure_adapter_gguf(settings, adapter_cid)
                        except (httpx.HTTPError, OSError) as e:
                            logger.exception("r3mes_adapter_download_failed adapter_cid=%s", adapter_cid)
                            raise HTTPException(
                                status_code=502,
                                detail=inference_error_detail(
                                    "adapter_download",
                                    f"IPFS gateway üzerinden adaptör indirilemedi: {e!s}",
                                    adapter_label,
                                    cause=classify_httpx_cause(e),
                                ),
                            ) from e

                        swap_ms = await _post_lora_adapter(settings, str(artifact.path), adapter_cid)
            elif settings.lora_slot_path is not None:
                wait_t0 = time.monotonic()
                async with _lora_lock:
                    lock_wait_ms = (time.monotonic() - wait_t0) * 1000.0
                    swap_ms = await _post_lora_scale(settings, 0.0, adapter_label)

            _log_inference_line(
                request_id=request_id,
                adapter_cid=adapter_cid,
                stream=True,
                artifact=artifact,
                lock_wait_ms=lock_wait_ms,
                swap_ms=swap_ms,
            )

            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    async with client.stream("POST", upstream, json=payload) as resp:
                        resp.raise_for_status()
                        async for chunk in resp.aiter_bytes():
                            yield chunk
            except httpx.HTTPStatusError as e:
                logger.warning("r3mes_upstream_stream http_status=%s", e.response.status_code)
                raise HTTPException(
                    status_code=502,
                    detail=inference_error_detail(
                        "upstream_completion",
                        "llama-server tamamlama akışı başarısız.",
                        adapter_label,
                        extra={"upstream_status": e.response.status_code},
                        cause=classify_httpx_cause(e),
                    ),
                ) from e
            except httpx.RequestError as e:
                logger.exception("r3mes_upstream_stream_transport adapter_cid=%s", adapter_label)
                raise HTTPException(
                    status_code=503,
                    detail=inference_error_detail(
                        "upstream_completion",
                        f"llama-server erişilemedi: {e!s}",
                        adapter_label,
                        cause=classify_httpx_cause(e),
                    ),
                ) from e

        return StreamingResponse(
            streamer(),
            media_type="text/event-stream",
            headers={
                "X-R3MES-Inference-Stage": "stream",
                "X-R3MES-Diagnostics": "see_server_logs",
            },
        )

    artifact: AdapterArtifact | None = None
    lock_wait_ms = 0.0
    swap_ms: float = 0.0
    if adapter_cid or local_adapter_path is not None:
        wait_t0 = time.monotonic()
        async with _lora_lock:
            lock_wait_ms = (time.monotonic() - wait_t0) * 1000.0
            if local_adapter_path is not None:
                swap_ms = await _post_lora_adapter(settings, str(local_adapter_path), adapter_label)
            elif adapter_cid:
                try:
                    artifact = await ensure_adapter_gguf(settings, adapter_cid)
                except (httpx.HTTPError, OSError) as e:
                    logger.exception("r3mes_adapter_download_failed adapter_cid=%s", adapter_cid)
                    raise HTTPException(
                        status_code=502,
                        detail=inference_error_detail(
                            "adapter_download",
                            f"IPFS gateway üzerinden adaptör indirilemedi: {e!s}",
                            adapter_label,
                            cause=classify_httpx_cause(e),
                        ),
                    ) from e

                swap_ms = await _post_lora_adapter(settings, str(artifact.path), adapter_cid)
    elif settings.lora_slot_path is not None:
        wait_t0 = time.monotonic()
        async with _lora_lock:
            lock_wait_ms = (time.monotonic() - wait_t0) * 1000.0
            swap_ms = await _post_lora_scale(settings, 0.0, adapter_label)

    _log_inference_line(
        request_id=request_id,
        adapter_cid=adapter_label if local_adapter_path is not None else adapter_cid,
        stream=False,
        artifact=artifact,
        lock_wait_ms=lock_wait_ms,
        swap_ms=swap_ms if adapter_cid else None,
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(upstream, json=payload)
            r.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning("r3mes_upstream_chat http_status=%s", e.response.status_code)
        raise HTTPException(
            status_code=502,
            detail=inference_error_detail(
                "upstream_completion",
                "llama-server tamamlama isteği başarısız.",
                adapter_label,
                extra={"upstream_status": e.response.status_code},
                cause=classify_httpx_cause(e),
            ),
        ) from e
    except httpx.RequestError as e:
        logger.exception("r3mes_upstream_chat_transport adapter_cid=%s", adapter_label)
        raise HTTPException(
            status_code=503,
            detail=inference_error_detail(
                "upstream_completion",
                f"llama-server erişilemedi: {e!s}",
                adapter_label,
                cause=classify_httpx_cause(e),
            ),
        ) from e

    ct = r.headers.get("content-type", "application/json")
    if artifact is not None:
        hdr = _success_headers(artifact, lock_wait_ms, swap_ms, settings)
    elif local_adapter_path is not None:
        hdr = {
            "X-R3MES-Adapter-Cache": "local",
            "X-R3MES-Lock-Wait-Ms": f"{lock_wait_ms:.2f}",
            "X-R3MES-Adapter-Resolve-Ms": "0.00",
            "X-R3MES-Lora-Swap-Ms": f"{swap_ms:.2f}",
            "X-R3MES-Lora-Slot": str(settings.lora_adapter_slot_id),
        }
    else:
        hdr = {
            "X-R3MES-Adapter-Cache": "none",
            "X-R3MES-Lock-Wait-Ms": f"{lock_wait_ms:.2f}",
            "X-R3MES-Adapter-Resolve-Ms": "0.00",
            "X-R3MES-Lora-Swap-Ms": "0.00",
            "X-R3MES-Lora-Slot": str(settings.lora_adapter_slot_id),
        }
    return Response(content=r.content, status_code=r.status_code, media_type=ct, headers=hdr)
