import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderReadinessReport } from "../dist/lib/providerReadiness.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const defaultOut = resolve(root, "artifacts/evals/provider-readiness/latest.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function modeValue() {
  const raw = argValue("--mode", process.env.R3MES_PROVIDER_READINESS_MODE || process.env.R3MES_DEEP_READY_MODE || "warm");
  return raw === "summary" ? "summary" : "warm";
}

async function main() {
  const out = resolve(root, argValue("--out", process.env.R3MES_PROVIDER_READINESS_OUT || defaultOut));
  const report = await buildProviderReadinessReport({ mode: modeValue() });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
