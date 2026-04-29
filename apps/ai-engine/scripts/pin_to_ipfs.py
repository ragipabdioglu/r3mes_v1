"""
Yerel dosyayı Kubo (IPFS) API ile ekler ve kalıcı pin'ler; CID yazdırır.

Varsayılan API: http://127.0.0.1:5001 — IPFS_API_URL ile değiştirilebilir.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="IPFS'e dosya ekle ve pin'le (Kubo)")
    p.add_argument("file", type=Path, help="Yüklenecek dosya")
    p.add_argument(
        "--api",
        default=os.environ.get("IPFS_API_URL", "http://127.0.0.1:5001"),
        help="Kubo API tabanı (varsayılan: IPFS_API_URL veya 127.0.0.1:5001)",
    )
    p.add_argument(
        "--cli",
        action="store_true",
        help="HTTP yerine ipfs CLI (ipfs add --pin) kullan",
    )
    p.add_argument(
        "--write-cid",
        type=Path,
        default=None,
        help="CID'yi bu dosyaya da yaz (ör. artifacts/last_cid.txt)",
    )
    return p.parse_args()


def pin_via_http(api_base: str, file_path: Path) -> str:
    url = urljoin(api_base.rstrip("/") + "/", "api/v0/add")
    params = {"pin": "true", "progress": "false", "wrap-with-directory": "false"}
    with file_path.open("rb") as f:
        r = requests.post(url, params=params, files={"file": (file_path.name, f)}, timeout=3600)
    r.raise_for_status()
    line = r.text.strip().splitlines()[-1]
    data = json.loads(line)
    cid = data.get("Hash")
    if not cid:
        raise RuntimeError(f"Beklenmeyen API yanıtı: {r.text[:500]}")
    return cid


def pin_via_cli(file_path: Path) -> str:
    proc = subprocess.run(
        ["ipfs", "add", "--pin", str(file_path)],
        capture_output=True,
        text=True,
        timeout=3600,
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        proc.check_returncode()
    # Örnek çıktı: added Qm... name
    for line in proc.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == "added":
            return parts[1]
    raise RuntimeError(f"ipfs çıktısı ayrıştırılamadı: {proc.stdout!r}")


def main() -> None:
    args = parse_args()
    path = args.file.resolve()
    if not path.is_file():
        raise SystemExit(f"Dosya yok: {path}")

    try:
        if args.cli:
            cid = pin_via_cli(path)
        else:
            cid = pin_via_http(args.api, path)
    except requests.exceptions.ConnectionError as e:
        raise SystemExit(
            f"Kubo API'ye bağlanılamadı ({args.api}). "
            "Altyapı ajanının IPFS (Kubo) servisini başlatın veya IPFS_API_URL kullanın.\n"
            f"Detay: {e}"
        ) from e

    print(cid)
    if args.write_cid:
        args.write_cid.parent.mkdir(parents=True, exist_ok=True)
        args.write_cid.write_text(cid + "\n", encoding="utf-8")
        print(f"CID yazıldı: {args.write_cid}", file=sys.stderr)


if __name__ == "__main__":
    main()
