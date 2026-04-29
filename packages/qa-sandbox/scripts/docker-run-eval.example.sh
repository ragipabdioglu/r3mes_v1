#!/usr/bin/env bash
# Örnek: değerlendirmeyi tam izolasyonla çalıştırma (host üzerinde çalıştırın; konteyner içinde değil).
# İnternet yok: --network none
# Kök FS salt okunur: --read-only
# Geçici yazma: --tmpfs /tmp
# İsteğe bağlı: --security-opt no-new-privileges:true --cap-drop ALL
set -euo pipefail

IMAGE="${R3MES_SANDBOX_IMAGE:-r3mes-qa-sandbox:latest}"
HOST_INPUT="${R3MES_HOST_INPUT:-$(cd "$(dirname "$0")/.." && pwd)/example-input}"
CONTAINER_INPUT="/workspace/input_readonly"

mkdir -p "${HOST_INPUT}"

docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "${HOST_INPUT}:${CONTAINER_INPUT}:ro" \
  -e R3MES_INPUT_DIR="${CONTAINER_INPUT}" \
  -e R3MES_SKIP_INPUT_VALIDATION=0 \
  -u 10001:10001 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  "${IMAGE}" \
  python -c "print('Buraya AI ajanının eval komutu gelecek')"
