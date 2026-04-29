#!/usr/bin/env bash
# CI / Linux: Sui CLI’yi tek seferlik indirip PATH’e ekler (sui move build | test).
set -euo pipefail

TAG="${SUI_RELEASE_TAG:-mainnet-v1.61.2}"
URL="https://github.com/MystenLabs/sui/releases/download/${TAG}/sui-${TAG}-ubuntu-x86_64.tgz"
WORKDIR="${RUNNER_TEMP:-/tmp}/r3mes-sui-install-$$"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "[r3mes] Sui indiriliyor: ${URL}"
curl -fsSL "$URL" -o sui.tgz
tar -xzf sui.tgz

SUI_BIN=""
if [[ -f "./sui" ]]; then
  SUI_BIN="$(pwd)/sui"
else
  SUI_BIN="$(find "$WORKDIR" -maxdepth 4 -name sui -type f 2>/dev/null | head -1 || true)"
fi

if [[ -n "${SUI_BIN}" ]] && [[ ! -x "${SUI_BIN}" ]]; then
  chmod +x "${SUI_BIN}" || true
fi

if [[ -z "${SUI_BIN}" ]] || [[ ! -f "${SUI_BIN}" ]]; then
  echo "[r3mes] Hata: arşivde sui ikili dosyası bulunamadı." >&2
  find "$WORKDIR" -type f 2>/dev/null | head -20 >&2 || true
  exit 1
fi

BIN_DIR="$(dirname "${SUI_BIN}")"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${BIN_DIR}" >>"${GITHUB_PATH}"
fi
export PATH="${BIN_DIR}:${PATH}"

echo "[r3mes] sui: ${SUI_BIN}"
sui --version
