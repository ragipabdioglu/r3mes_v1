#!/usr/bin/env bash
# Kök sarmalayıcı — asıl betik: infrastructure/scripts/start-all.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/infrastructure/scripts/start-all.sh" "$@"
