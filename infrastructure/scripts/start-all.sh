#!/usr/bin/env bash
# R3MES — uçtan uca yerel başlatıcı (Faz 8.5).
# Docker yoksa veya daemon kapalıysa compose adımları uyarı ile atlanır; geri kalan mantık çalışmaya devam eder.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

POSTGRES_COMPOSE="$ROOT/infrastructure/docker/docker-compose.postgres.yml"
STORAGE_COMPOSE="$ROOT/infrastructure/docker/docker-compose.storage.yml"
PID_FILE="$ROOT/.r3mes-ai-engine.pid"
LOG_FILE="$ROOT/.r3mes-ai-engine.log"

copy_env_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -f "$src" ]] && [[ ! -f "$dest" ]]; then
    cp "$src" "$dest"
    echo "[r3mes] .env oluşturuldu: $dest  (örnek: cp ile aynı)"
  fi
}

echo "[r3mes] Ortam dosyaları (.env.example -> .env / .env.local) kontrol ediliyor..."
copy_env_if_missing "$ROOT/apps/backend-api/.env.example" "$ROOT/apps/backend-api/.env"
copy_env_if_missing "$ROOT/apps/dApp/.env.example" "$ROOT/apps/dApp/.env"
# Next.js yerel geliştirme: .env.local önceliklidir (Windows/Git Bash dahil).
copy_env_if_missing "$ROOT/apps/dApp/.env.example" "$ROOT/apps/dApp/.env.local"
copy_env_if_missing "$ROOT/packages/sui-indexer/.env.example" "$ROOT/packages/sui-indexer/.env"
# ai-engine: örnekte R3MES_SKIP_LLAMA=1 — aksi halde ilk açılışta büyük GGUF indirmesi uzun sürer.
copy_env_if_missing "$ROOT/apps/ai-engine/.env.example" "$ROOT/apps/ai-engine/.env"

docker_up() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[r3mes] Uyarı: docker bulunamadı; compose atlandı."
    return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "[r3mes] Uyarı: Docker daemon erişilemiyor; compose atlandı."
    return 0
  fi
  if docker compose -f "$POSTGRES_COMPOSE" up -d; then
    :
  else
    echo "[r3mes] Uyarı: postgres compose başarısız (bağlantı veya imaj?)."
  fi
  if docker compose -f "$STORAGE_COMPOSE" up -d; then
    echo "[r3mes] Docker: postgres + storage (IPFS gateway host portu 9080) ayakta."
  else
    echo "[r3mes] Uyarı: storage compose başarısız."
  fi
}

run_db_migrate() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[r3mes] Uyarı: pnpm yok; db:migrate atlandı."
    return 0
  fi
  echo "[r3mes] Veritabanı migrate (pnpm db:migrate)..."
  sleep 4
  (cd "$ROOT" && pnpm db:migrate) || {
    echo "[r3mes] Uyarı: db:migrate başarısız (PostgreSQL ayakta mı, apps/backend-api/.env DATABASE_URL doğru mu?)."
    return 0
  }
}

cleanup_ai_engine() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "[r3mes] ai-engine süreci sonlandırıldı (pid $pid)."
    fi
    rm -f "$PID_FILE"
  fi
}

trap cleanup_ai_engine EXIT INT TERM
# Windows/Git Bash: script sonlanınca (Ctrl+C ile turbo durunca da EXIT tetiklenir) cleanup_ai_engine
# ai-engine arka planını öldürür. Ayrıca pnpm→cmd zinciri Ctrl+C ile "Terminate batch job" görebilir.
# 8000'i turbo'dan bağımsız tutmak için: infrastructure/scripts/run-ai-engine-dev.ps1 (ayrı pencere).

# ai-engine log dosyası 50MB üzerindeyse döndür (disk dolmasını yavaşlatır).
rotate_ai_engine_log_if_large() {
  local f="$1"
  local max_bytes=$((50 * 1024 * 1024))
  if [[ ! -f "$f" ]]; then
    return 0
  fi
  local sz
  sz=$(wc -c <"$f" 2>/dev/null | tr -d ' \n' || echo 0)
  if [[ "${sz:-0}" -gt "$max_bytes" ]]; then
    mv "$f" "${f}.old"
    echo "[r3mes] ai-engine log döndürüldü (>50MB): ${f}.old"
  fi
}

start_ai_engine_bg() {
  if [[ -f "$PID_FILE" ]]; then
    local old
    old="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
      echo "[r3mes] ai-engine zaten çalışıyor (pid $old); yeniden başlatılmadı."
      return 0
    fi
  fi
  rotate_ai_engine_log_if_large "$LOG_FILE"
  : >"$LOG_FILE"
  (
    cd "$ROOT/apps/ai-engine"
    exec pnpm dev
  ) >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "[r3mes] ai-engine arka planda: http://127.0.0.1:8000 (uvicorn, log: $LOG_FILE, pid: $(cat "$PID_FILE"))."
  sleep 2
}

main() {
  docker_up
  run_db_migrate
  start_ai_engine_bg

  echo "[r3mes] Turbo: Fastify :3000 + Next.js dApp :3001 (ai-engine :8000 arka planda)."
  echo "[r3mes] Durdurmak: Ctrl+C; gerekirse: kill \$(cat .r3mes-ai-engine.pid)"
  cd "$ROOT"
  pnpm exec turbo run dev --filter=@r3mes/backend-api --filter=@r3mes/dapp --parallel
}

main "$@"
