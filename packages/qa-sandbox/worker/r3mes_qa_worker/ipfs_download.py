from __future__ import annotations

import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


def gateway_object_url(gateway_base: str, cid: str) -> str:
    return f"{gateway_base.rstrip('/')}/ipfs/{cid.strip()}"


def download_ipfs_artifact(
    gateway_base: str,
    cid: str,
    dest: Path,
    *,
    connect_timeout_sec: float = 30.0,
    read_timeout_sec: float = 600.0,
) -> int:
    """Tek artefact indirir (LoRA GGUF); boyut döner.

    Bağlantı ve okuma süreleri ayrı; uzun süren gateway yanıtlarında takılı kalmayı önler.
    """
    url = gateway_object_url(gateway_base, cid)
    dest.parent.mkdir(parents=True, exist_ok=True)
    timeout = httpx.Timeout(
        connect=connect_timeout_sec,
        read=read_timeout_sec,
        write=min(120.0, read_timeout_sec),
        pool=connect_timeout_sec,
    )
    logger.info("ipfs_download_start cid=%s url=%s dest=%s", cid, url, dest)
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)
    except Exception as e:
        logger.error(
            "ipfs_download_failed cid=%s url=%s connect_timeout=%.1fs read_timeout=%.1fs err=%s",
            cid,
            url,
            connect_timeout_sec,
            read_timeout_sec,
            e,
            exc_info=True,
        )
        raise
    nbytes = dest.stat().st_size
    logger.info("ipfs_download_ok cid=%s bytes=%s", cid, nbytes)
    return nbytes
