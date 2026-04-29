#!/usr/bin/env node
/**
 * Gerçek export GGUF → POST /v1/adapters (multipart).
 *
 * Önkoşul: API ayakta; sunucuda geliştirme için genelde:
 *   R3MES_SKIP_WALLET_AUTH=1
 *   R3MES_DEV_WALLET=0x...   (geçerli Sui adresi)
 *
 * Kullanım:
 *   node scripts/upload-export-gguf.mjs <path/to/tr-v1.gguf>
 *
 * İsteğe bağlı:
 *   R3MES_E2E_BASE_URL=http://127.0.0.1:3000
 */

import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const base = (process.env.R3MES_E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: node scripts/upload-export-gguf.mjs <path/to/adapter.gguf>");
  process.exit(1);
}

const filePath = resolve(fileArg);
const st = statSync(filePath);
if (!st.isFile()) {
  console.error(`Not a file: ${filePath}`);
  process.exit(1);
}

const displayName = process.env.R3MES_UPLOAD_DISPLAY_NAME?.trim() || basename(filePath, ".gguf");

async function main() {
  const buf = readFileSync(filePath);
  const fd = new FormData();
  fd.set("displayName", displayName);
  fd.set("weights", new Blob([buf], { type: "application/octet-stream" }), basename(filePath));

  const res = await fetch(`${base}/v1/adapters`, { method: "POST", body: fd });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text.slice(0, 2000)}`);
    process.exit(2);
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    console.error("Response is not JSON:", text.slice(0, 500));
    process.exit(3);
  }
  console.log(JSON.stringify(j, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
