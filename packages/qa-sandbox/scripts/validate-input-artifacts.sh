#!/usr/bin/env bash
# Katı dosya tipi / safetensors yapı doğrulaması — kötü niyetli pickle/tf checkpoint sızmasını azaltır.
# Tam MIME güveni için: uzantı + magic + (LoRA için) safetensors başlık şeması birlikte kullanılır.
set -euo pipefail

DIR="${1:?Dizin gerekli}"

ALLOWED_EXT_REGEX='\.(safetensors|json|txt)$'
REJECT_EXT_REGEX='\.(pkl|pickle|pt|pth|ckpt|h5|pb|zip|tar|gz|7z|bin)$'

reject() { echo "[validate-input-artifacts] RED: $*" >&2; exit 19; }

[[ -d "$DIR" ]] || reject "Dizin yok: $DIR"

while IFS= read -r -d '' f; do
  base="$(basename "$f")"
  lc="$(echo "$base" | tr '[:upper:]' '[:lower:]')"

  if echo "$lc" | grep -qE "$REJECT_EXT_REGEX"; then
    reject "Yasak uzantı: $f"
  fi

  if ! echo "$lc" | grep -qE "$ALLOWED_EXT_REGEX"; then
    reject "İzin verilmeyen dosya adı uzantısı: $f (yalnızca safetensors/json/txt)"
  fi

  # file(1) — libmagic; tek başına yeterli değil, ek katman
  mime="$(file -b --mime-type "$f" 2>/dev/null || echo unknown)"
  case "$mime" in
    application/octet-stream|application/json|text/plain) ;;
    *) reject "Beklenmeyen MIME ($mime): $f" ;;
  esac

  case "$lc" in
    *.safetensors)
      python3 - "$f" <<'PY'
import struct, json, sys
path = sys.argv[1]
with open(path, "rb") as fp:
    raw = fp.read(8)
    if len(raw) != 8:
        sys.exit(2)
    hlen = struct.unpack("<Q", raw)[0]
    if hlen == 0 or hlen > 268_435_456:  # 256 MiB üstü başlık şüpheli
        sys.exit(3)
    header_bytes = fp.read(hlen)
    if len(header_bytes) != hlen:
        sys.exit(4)
    header = json.loads(header_bytes.decode("utf-8"))
    if not isinstance(header, dict) or len(header) == 0:
        sys.exit(5)
PY
      ;;
    *.json)
      python3 -m json.tool "$f" >/dev/null
      ;;
    *.txt)
      # UTF-8 okunabilirlik (küçük dosyalar)
      if [[ "$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null)" -gt 1048576 ]]; then
        reject "txt çok büyük: $f"
      fi
      ;;
  esac
done < <(find "$DIR" -type f -print0)

echo "[validate-input-artifacts] OK: $DIR"
