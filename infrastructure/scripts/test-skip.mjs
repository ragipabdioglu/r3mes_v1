#!/usr/bin/env node
/**
 * Açıkça atlanan test paketleri — CI çıktısında "no-op" yerine tutarlı uyarı.
 * Kullanım: node infrastructure/scripts/test-skip.mjs @r3mes/package-name
 */
const pkg = process.argv[2] ?? "unknown";
console.warn(
  `[R3MES] TESTS_DISABLED package=${pkg} — gerçek test yok veya henüz bağlanmadı (bkz. infrastructure/README.md).`,
);
process.exit(0);
