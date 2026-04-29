#!/bin/sh
# Pin: qvac-fabric-llm.cpp b7349 — llama-server; modeller volume ile bağlanır.
set -eu
: "${LLAMA_BASE:?set LLAMA_BASE to base GGUF path}"
: "${LLAMA_SLOT:?set LLAMA_SLOT to slot0 LoRA GGUF path}"
PORT="${LLAMA_PORT:-8080}"
HOST="${LLAMA_HOST:-0.0.0.0}"
cd /opt/qvac
exec ./llama-server -m "$LLAMA_BASE" --lora "$LLAMA_SLOT" --lora-init-without-apply --host "$HOST" --port "$PORT"
