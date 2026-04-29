"""
IPFS / HTTP üzerinden büyük dosya indirme benchmark aracı (tensör yükleme yok).

qvac / llama.cpp GGUF akışı için bayt düzeyinde ölçüm amaçlıdır.
"""

from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

from r3mes_ai_engine.http_download import (
    download_with_retries,
    gateway_url,
    verify_sha256,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="IPFS gateway üzerinden dosya indir ve SHA256 doğrula")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--cid", help="IPFS CID")
    p.add_argument(
        "--gateway",
        default=os.environ.get("R3MES_IPFS_GATEWAY", "http://127.0.0.1:9080"),
        help="IPFS gateway tabanı",
    )
    src.add_argument("--local-file", type=Path, help="Yerel dosya (indirme atlanır)")
    p.add_argument("--expected-sha256", default=os.environ.get("R3MES_EXPECTED_SHA256"))
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--chunk-size", type=int, default=1024 * 1024)
    p.add_argument("--max-rounds", type=int, default=8)
    p.add_argument("--connect-timeout", type=float, default=30.0)
    p.add_argument("--read-timeout", type=float, default=600.0)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    artifacts = Path(__file__).resolve().parent / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)

    if args.local_file:
        path = args.local_file.resolve()
        if not path.is_file():
            raise SystemExit(f"Dosya yok: {path}")
        print("Mod: yerel dosya")
    else:
        url = gateway_url(args.gateway, args.cid or "")
        safe = (args.cid or "").strip().replace("/", "_").replace("\\", "_")
        out = args.out or (artifacts / "download" / f"{safe}.bin")
        print(f"GET {url}")
        t0 = time.perf_counter()
        dl_bytes, dl_hash = download_with_retries(
            url,
            out,
            chunk_size=args.chunk_size,
            max_rounds=args.max_rounds,
            connect_timeout=args.connect_timeout,
            read_timeout=args.read_timeout,
        )
        print(f"İndirilen: {dl_bytes} byte in {time.perf_counter() - t0:.3f}s")
        print(f"SHA256: {dl_hash}")
        path = out
        if args.expected_sha256:
            verify_sha256(path, args.expected_sha256)
            print("SHA256 doğrulandı.")

    if args.expected_sha256 and args.local_file:
        verify_sha256(path, args.expected_sha256)
        print("SHA256 doğrulandı.")

    print(f"Boyut: {path.stat().st_size} byte")


if __name__ == "__main__":
    main()
