import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const args = new Set(process.argv.slice(2));

const skipTypecheck = args.has("--skip-typecheck");
const skipProviders = args.has("--skip-providers");
const skipBackfill = args.has("--skip-backfill");
const skipReindex = args.has("--skip-reindex");
const skipParseQuality = args.has("--skip-parse-quality");
const skipEval = args.has("--skip-eval");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pnpmBin() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    console.log(`\n[r3mes-knowledge-quality] ${step.name}`);
    const child = spawn(step.command, step.args, {
      cwd: step.cwd ?? backendRoot,
      env: {
        ...process.env,
        ...(step.env ?? {}),
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      const durationMs = Date.now() - started;
      if (code === 0) {
        resolve({ name: step.name, durationMs });
        return;
      }
      reject(new Error(`${step.name} failed with exit code ${code ?? "unknown"} after ${durationMs}ms`));
    });
  });
}

const steps = [];

if (!skipTypecheck) {
  steps.push({
    name: "typecheck",
    command: pnpmBin(),
    args: ["exec", "tsc", "-p", "tsconfig.json", "--pretty", "false"],
  });
}

if (!skipProviders) {
  steps.push({
    name: "quality providers",
    command: pnpmBin(),
    args: ["run", "smoke:quality-providers"],
  });
}

if (!skipBackfill) {
  steps.push({
    name: "metadata backfill",
    command: pnpmBin(),
    args: ["run", "knowledge:metadata:backfill"],
  });
}

if (!skipReindex) {
  const reindexArgs = ["run", "qdrant:reindex", "--", "--verify-count"];
  if (args.has("--reset-checkpoint")) reindexArgs.push("--reset-checkpoint");
  const maxBatches = argValue("--max-batches");
  if (maxBatches) reindexArgs.push("--max-batches", maxBatches);
  steps.push({
    name: "qdrant reindex",
    command: pnpmBin(),
    args: reindexArgs,
  });
}

if (!skipParseQuality) {
  steps.push({
    name: "parse quality eval",
    command: pnpmBin(),
    args: ["run", "eval:parse-quality"],
  });
}

if (!skipEval) {
  steps.push({
    name: "generated collection smoke",
    command: pnpmBin(),
    args: ["run", "eval:collection-smoke"],
  });
}

const completed = [];
try {
  for (const step of steps) {
    completed.push(await runStep(step));
  }
  console.log(JSON.stringify({
    ok: true,
    completed,
    skipped: {
      typecheck: skipTypecheck,
      providers: skipProviders,
      backfill: skipBackfill,
      reindex: skipReindex,
      parseQuality: skipParseQuality,
      eval: skipEval,
    },
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(JSON.stringify({
    ok: false,
    completed,
  }, null, 2));
  process.exitCode = 1;
}
