"""HTTP üzerinden bayt indirme (PyTorch / safetensors yok)."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import httpx


def gateway_url(gateway_base: str, cid: str) -> str:
    return f"{gateway_base.rstrip('/')}/ipfs/{cid.strip()}"


def download_with_retries(
    url: str,
    out_path: Path,
    *,
    chunk_size: int,
    max_rounds: int,
    connect_timeout: float,
    read_timeout: float,
) -> tuple[int, str]:
    last_err: Exception | None = None
    for round_idx in range(max_rounds):
        h = hashlib.sha256()
        total = 0
        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with httpx.Client(
                timeout=httpx.Timeout(connect_timeout, read=read_timeout),
                follow_redirects=True,
            ) as client:
                with client.stream("GET", url) as resp:
                    resp.raise_for_status()
                    with out_path.open("wb") as f:
                        for chunk in resp.iter_bytes(chunk_size):
                            if not chunk:
                                continue
                            f.write(chunk)
                            h.update(chunk)
                            total += len(chunk)
            return total, h.hexdigest()
        except (httpx.HTTPError, OSError) as e:
            last_err = e
            try:
                if out_path.exists():
                    out_path.unlink()
            except OSError:
                pass
            if round_idx < max_rounds - 1:
                time.sleep(min(60.0, 2.0**round_idx))
            continue
    assert last_err is not None
    raise last_err


def verify_sha256(path: Path, expected: str) -> None:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    got = h.hexdigest()
    if got.lower() != expected.lower():
        msg = f"SHA256 uyuşmazlığı.\nBeklenen: {expected}\nAlınan:   {got}"
        raise ValueError(msg)


def download_url_to_file(
    url: str,
    out_path: Path,
    *,
    chunk_size: int = 1024 * 1024,
) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=httpx.Timeout(120.0, read=3600.0), follow_redirects=True) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            n = 0
            with out_path.open("wb") as f:
                for chunk in resp.iter_bytes(chunk_size):
                    f.write(chunk)
                    n += len(chunk)
    return n
