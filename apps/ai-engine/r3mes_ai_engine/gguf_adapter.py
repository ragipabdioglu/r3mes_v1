"""LoRA GGUF indirme — yalnızca dosya sistemi (tensör hesabı yok)."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import NamedTuple

from r3mes_ai_engine.http_download import download_with_retries, gateway_url
from r3mes_ai_engine.settings import Settings

logger = logging.getLogger(__name__)


class AdapterArtifact(NamedTuple):
    """`adapter_cid` için çözümlenen yerel GGUF yolu ve önbellek bilgisi."""

    path: Path
    cache_hit: bool
    resolve_ms: float


def _safe_name(cid: str) -> str:
    return cid.strip().replace("/", "_").replace("\\", "_")


async def ensure_adapter_gguf(settings: Settings, adapter_cid: str) -> AdapterArtifact:
    settings.adapter_cache_dir.mkdir(parents=True, exist_ok=True)
    path = settings.adapter_cache_dir / f"{_safe_name(adapter_cid)}.gguf"
    if path.is_file():
        logger.info(
            "r3mes_adapter cache_hit adapter_cid=%s path=%s",
            adapter_cid,
            path,
        )
        return AdapterArtifact(path.resolve(), True, 0.0)

    url = gateway_url(settings.ipfs_gateway, adapter_cid)
    logger.info("r3mes_adapter cache_miss adapter_cid=%s url=%s", adapter_cid, url)

    t0 = time.monotonic()

    def _dl() -> Path:
        download_with_retries(
            url,
            path,
            chunk_size=settings.chunk_size,
            max_rounds=settings.download_max_rounds,
            connect_timeout=settings.connect_timeout,
            read_timeout=settings.read_timeout,
        )
        return path.resolve()

    resolved = await asyncio.to_thread(_dl)
    resolve_ms = (time.monotonic() - t0) * 1000.0
    logger.info(
        "r3mes_adapter downloaded adapter_cid=%s resolve_ms=%.1f max_rounds=%s",
        adapter_cid,
        resolve_ms,
        settings.download_max_rounds,
    )
    return AdapterArtifact(resolved, False, resolve_ms)
