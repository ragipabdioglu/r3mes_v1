import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const suites = [
  "legal-basic",
  "legal-divorce-basic",
  "education-basic",
  "domain-regression",
  "multi-domain-basic",
  "grounded-response",
];

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function assertBackendHealthy() {
  const baseUrl = process.env.R3MES_BACKEND_URL || "http://127.0.0.1:3000";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
  if (!response.ok) {
    throw new Error(`Backend health failed: ${response.status}`);
  }
}

async function main() {
  await assertBackendHealthy();
  const failures = [];
  for (const suite of suites) {
    const file = `infrastructure/evals/${suite}/golden.jsonl`;
    const out = `artifacts/evals/${suite}/latest.json`;
    await mkdir(resolve(root, `artifacts/evals/${suite}`), { recursive: true });
    console.log(`\n=== grounded eval: ${suite} ===`);
    try {
      await run("pnpm", [
        "--filter",
        "@r3mes/backend-api",
        "eval:grounded-response",
        "--",
        "--file",
        file,
        "--out",
        out,
        "--retries",
        "1",
      ]);
    } catch (error) {
      failures.push({ suite, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failures.length > 0) {
    console.error("\n=== grounded eval failures ===");
    for (const failure of failures) {
      console.error(`${failure.suite}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
