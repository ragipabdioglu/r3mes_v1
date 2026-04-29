#!/usr/bin/env node
/**
 * Ürün seviyesinde MVP kanıt özeti — test çalıştırmaz.
 * validate + smoke zincirinin sonunda (banner öncesi) çalışır; yerel ve release öncesi aynı metin.
 *
 * --full: tam smoke (TS + Move) sonrası kullanılır.
 */
const full = process.argv.includes("--full");

// Kök package.json smoke:build / smoke:test ile senkron tutun (filter listeleri).
const SMOKE_BUILD = [
  "@r3mes/shared-types",
  "@r3mes/qa-sandbox",
  "@r3mes/sui-indexer",
  "@r3mes/backend-api",
  "@r3mes/dapp",
  "@r3mes/ai-engine",
];
const SMOKE_TEST = [
  "@r3mes/backend-api",
  "@r3mes/sui-indexer",
  "@r3mes/qa-sandbox",
  "@r3mes/qa-worker",
  "@r3mes/ai-engine",
  "@r3mes/dapp",
  "@r3mes/shared-types",
];

console.log("");
console.log("┌──────────────────────────────────────────────────────────────────────");
console.log("│ MVP kanıt özeti (teknik → ürün sinyali)");
console.log("└──────────────────────────────────────────────────────────────────────");
console.log("");
console.log("  Bu özet, az önce başarıyla tamamlanan adımların yorumudur (yeniden test etmez).");
console.log("");
console.log("  Kapı bağlantısı:");
console.log("    • Teknik doğrulama: manifest (validate) + tanımlı smoke.");
console.log("    • Uçtan uca tarayıcı MVP (E2E) şu an release kapısına bağlı değil — bilinçli.");
if (full) {
  console.log("    • Bu koşu: TS smoke + Move (sui-contracts) dahil.");
} else {
  console.log("    • Bu koşu: TS smoke (Move hariç). Sözleşme sürümü için: pnpm release:check:full");
}
console.log("");
console.log("  Smoke:ts kapsamı (build):");
console.log(`    ${SMOKE_BUILD.join(", ")}`);
console.log("  Smoke:ts kapsamı (test):");
console.log(`    ${SMOKE_TEST.join(", ")}`);
if (full) {
  console.log("  + Move: @r3mes/sui-contracts (build + sui move test)");
}
console.log("");
console.log("  Tek giriş noktası: pnpm mvp  (= release:check)  |  tam: pnpm release:check:full");
console.log("  Önkoşullar: infrastructure/PREREQUISITES.md");
console.log("");
