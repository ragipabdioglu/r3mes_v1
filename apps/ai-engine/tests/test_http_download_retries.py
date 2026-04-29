"""IPFS/HTTP indirme yeniden deneme — saf birim; gerçek ağ yok."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest

from r3mes_ai_engine.http_download import download_with_retries


def test_download_with_retries_exhausts_max_rounds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("r3mes_ai_engine.http_download.time.sleep", lambda *_a, **_k: None)
    attempts = {"n": 0}

    class BoomStream:
        def __enter__(self) -> BoomStream:
            attempts["n"] += 1
            raise httpx.ConnectError("fail", request=MagicMock())

        def __exit__(self, *_a: object) -> None:
            pass

    class BoomClient:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> BoomClient:
            return self

        def __exit__(self, *_a: object) -> None:
            pass

        def stream(self, *_a: object, **_k: object) -> BoomStream:
            return BoomStream()

    monkeypatch.setattr("r3mes_ai_engine.http_download.httpx.Client", BoomClient)

    out = tmp_path / "out.gguf"
    with pytest.raises(httpx.ConnectError):
        download_with_retries(
            "http://127.0.0.1:9080/ipfs/QmX",
            out,
            chunk_size=64,
            max_rounds=4,
            connect_timeout=1.0,
            read_timeout=1.0,
        )
    assert attempts["n"] == 4


def test_download_with_retries_succeeds_after_transient_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("r3mes_ai_engine.http_download.time.sleep", lambda *_a, **_k: None)
    attempts = {"n": 0}

    class FlakyStream:
        def __enter__(self) -> FlakyStream:
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise httpx.ConnectError("transient", request=MagicMock())
            return self

        def __exit__(self, *_a: object) -> None:
            pass

        def raise_for_status(self) -> None:
            return None

        def iter_bytes(self, chunk_size: int) -> object:
            yield b"ok"

    class FlakyClient:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> FlakyClient:
            return self

        def __exit__(self, *_a: object) -> None:
            pass

        def stream(self, *_a: object, **_k: object) -> FlakyStream:
            return FlakyStream()

    monkeypatch.setattr("r3mes_ai_engine.http_download.httpx.Client", FlakyClient)

    out = tmp_path / "out.gguf"
    total, sha = download_with_retries(
        "http://127.0.0.1:9080/ipfs/QmY",
        out,
        chunk_size=64,
        max_rounds=5,
        connect_timeout=1.0,
        read_timeout=1.0,
    )
    assert total == 2
    assert out.read_bytes() == b"ok"
    assert len(sha) == 64
