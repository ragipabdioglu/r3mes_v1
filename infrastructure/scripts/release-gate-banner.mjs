#!/usr/bin/env node
/**
 * Önceki adımlar (validate, smoke) başarılı bittiğinde tek bakışta GO özeti basar.
 * Test çalıştırmaz — yalnızca çıktı; kök package.json'daki release:check zincirinin sonunda çağrılır.
 */
const full = process.argv.includes("--full");

console.log("");
console.log("═══════════════════════════════════════════════════════════════════");
if (full) {
  console.log("  RELEASE GATE: GO   (validate + tam smoke: TS + Move)");
} else {
  console.log("  RELEASE GATE: GO   (validate + smoke:ts)");
}
console.log("═══════════════════════════════════════════════════════════════════");
console.log("");
console.log("  Manifest drift: yok");
if (full) {
  console.log("  Tanımlı smoke (build + test + sözleşmeler): yeşil");
} else {
  console.log("  Tanımlı TS smoke (build + test): yeşil");
  console.log("  Move/sözleşme değiştiyse ayrıca yeşil olmalı: pnpm release:check:full");
}
console.log("");
console.log("  Rehber: infrastructure/RELEASE_CHECKLIST.md");
console.log("");
