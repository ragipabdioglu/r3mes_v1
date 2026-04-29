"""Donmuş GGUF indirme ve llama-server (C++) başlatma."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from pathlib import Path

import httpx

from r3mes_ai_engine.http_download import download_url_to_file, download_with_retries, gateway_url, verify_sha256
from r3mes_ai_engine.settings import Settings
from r3mes_ai_engine.state import AppState

logger = logging.getLogger(__name__)


def _llama_base(settings: Settings) -> str:
    return f"http://{settings.llama_internal_host}:{settings.llama_internal_port}"


async def ensure_frozen_gguf(settings: Settings) -> tuple[Path, str]:
    if settings.frozen_gguf_local_path and settings.frozen_gguf_local_path.is_file():
        p = settings.frozen_gguf_local_path.resolve()
        return p, f"local:{p}"

    dest = settings.frozen_cache_dir / settings.frozen_gguf_filename
    settings.frozen_cache_dir.mkdir(parents=True, exist_ok=True)

    if settings.frozen_core_cid:
        url = gateway_url(settings.ipfs_gateway, settings.frozen_core_cid)

        def _dl() -> Path:
            _b, sha = download_with_retries(
                url,
                dest,
                chunk_size=settings.chunk_size,
                max_rounds=settings.download_max_rounds,
                connect_timeout=settings.connect_timeout,
                read_timeout=settings.read_timeout,
            )
            if settings.frozen_core_sha256:
                verify_sha256(dest, settings.frozen_core_sha256)
            logger.info("Donmuş GGUF IPFS’ten indirildi sha256=%s", sha)
            return dest

        path = await asyncio.to_thread(_dl)
        return path, f"ipfs:{settings.frozen_core_cid}"

    if settings.frozen_core_hf_url:
        url = str(settings.frozen_core_hf_url)

        def _hf() -> Path:
            n = download_url_to_file(url, dest)
            logger.info("Donmuş GGUF HF URL’den indirildi (%s byte).", n)
            if settings.frozen_core_sha256:
                verify_sha256(dest, settings.frozen_core_sha256)
            return dest

        path = await asyncio.to_thread(_hf)
        return path, f"hf:{url}"

    raise RuntimeError(
        "Donmuş model yok: R3MES_FROZEN_CORE_CID, R3MES_FROZEN_CORE_HF_URL veya "
        "R3MES_FROZEN_GGUF_LOCAL_PATH tanımlayın."
    )


def start_llama_server(settings: Settings, gguf_path: Path, state: AppState) -> None:
    cmd = [
        settings.llama_server_bin,
        "-m",
        str(gguf_path),
        "--port",
        str(settings.llama_internal_port),
        "-c",
        str(settings.llama_ctx_size),
    ]
    if settings.llama_n_gpu_layers > 0:
        cmd.extend(["-ngl", str(settings.llama_n_gpu_layers)])
    if settings.lora_init_without_apply:
        cmd.append("--lora-init-without-apply")
    if settings.lora_slot_path is not None:
        settings.lora_slot_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--lora", str(settings.lora_slot_path)])

    logger.info("llama-server başlatılıyor: %s", " ".join(cmd))
    log_dir = Path(os.environ.get("R3MES_LLAMA_LOG_DIR", ".")).resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout = (log_dir / "llama-server.out.log").open("ab")
    stderr = (log_dir / "llama-server.err.log").open("ab")
    state.llama_process = subprocess.Popen(
        cmd,
        stdout=stdout,
        stderr=stderr,
    )


def stop_llama_server(state: AppState) -> None:
    proc = state.llama_process
    if proc is None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=15)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    state.llama_process = None


async def bootstrap_llama(settings: Settings, state: AppState) -> None:
    if settings.skip_llama:
        if settings.frozen_gguf_local_path:
            state.frozen_gguf_path = settings.frozen_gguf_local_path.resolve()
            state.frozen_core_source = f"local:{state.frozen_gguf_path}"
        logger.warning("skip_llama etkin; llama-server başlatılmadı.")
        return

    path, src = await ensure_frozen_gguf(settings)
    state.frozen_gguf_path = path
    state.frozen_core_source = src
    start_llama_server(settings, path, state)
    base = _llama_base(settings).rstrip("/")
    time_limit = 120.0
    started = asyncio.get_running_loop().time()
    last_error: str | None = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, read=5.0)) as client:
        while (asyncio.get_running_loop().time() - started) < time_limit:
            proc = state.llama_process
            if proc is not None and proc.poll() is not None:
                raise RuntimeError(f"llama-server erken kapandı (exit={proc.returncode})")
            try:
                resp = await client.get(f"{base}/health")
                if resp.is_success:
                    logger.info("llama-server hazır: %s", base)
                    return
                last_error = f"health status={resp.status_code}"
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
            await asyncio.sleep(1.0)
    raise RuntimeError(f"llama-server timeout içinde hazır olmadı: {last_error or 'unknown'}")


def llama_public_base(settings: Settings) -> str:
    return _llama_base(settings)
