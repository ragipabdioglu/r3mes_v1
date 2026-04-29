#!/usr/bin/env bash
# R3MES — değerlendirme öncesi zorunlu izolasyon kontrolleri.
# Bu betik, konteyner --network none ve --read-only ile çalıştırıldığında başarılı olur.
set -euo pipefail

readonly MARKER="/tmp/.r3mes_sandbox_rw_ok"

fail() {
  echo "[qa-sandbox] GÜVENLİK: $*" >&2
  exit 17
}

# --- Ağ: internet / dış çıkış olmamalı (--network none) ---
if command -v ip >/dev/null 2>&1; then
  if ip route 2>/dev/null | grep -qE '^default\s|via\s'; then
    fail "Varsayılan rota veya gateway tespit edildi; ağ izolasyonu (--network none) eksik olabilir."
  fi
fi

# --- Salt okunur kök: / altında dosya oluşturma denemesi (tmpfs /tmp ayrı) ---
if touch /.r3mes_ro_probe 2>/dev/null; then
  rm -f /.r3mes_ro_probe 2>/dev/null || true
  fail "Kök dosya sistemi yazılabilir görünüyor; docker run için --read-only kullanın."
fi

# /tmp yazılabilir olmalı (--tmpfs /tmp); yoksa birçok araç çalışmaz
if ! touch "${MARKER}" 2>/dev/null; then
  fail "/tmp yazılabilir değil; docker run için --tmpfs /tmp ekleyin."
fi
rm -f "${MARKER}"

# --- İsteğe bağlı: girdi dizini doğrulaması (R3MES_INPUT_DIR ayarlıysa) ---
if [[ -n "${R3MES_INPUT_DIR:-}" && -d "${R3MES_INPUT_DIR}" ]]; then
  if [[ "${R3MES_SKIP_INPUT_VALIDATION:-0}" != "1" ]]; then
    /opt/r3mes-sandbox/validate-input-artifacts.sh "${R3MES_INPUT_DIR}" || fail "Girdi dosya doğrulaması başarısız."
  fi
fi

exec "$@"
