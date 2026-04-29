#!/usr/bin/env bash
# R3MES — Testnet publish akışı (referans / simülasyon).
# Gerçek anahtar ve gaz maliyeti doğrulanmadan çalıştırmayın.
set -euo pipefail

echo "== 1) Testnet ortamı =="
echo "sui client switch --env testnet"
echo "sui client active-address"
echo ""
echo "== 2) (İsteğe bağlı) SUI faucet — limit veya ağ politikası nedeniyle başarısız olabilir =="
echo "sui client faucet"
echo ""
echo "== 3) Derle ve yayınla (gas budget örnek) =="
echo "cd \"\$(dirname \"\$0\")/..\""
echo "sui move build"
echo "sui client publish --gas-budget 100000000"
echo ""
echo "Çıktıdan PACKAGE_ID ve paylaşımlı nesne ID'lerini kopyalayın; .env dosyalarına işleyin."
echo "Mock / şablon değerler: packages/shared-types/src/r3mesTestnetMock.ts"
