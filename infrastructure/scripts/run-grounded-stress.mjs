import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs() {
  return {
    baseUrl: argValue("--base-url", process.env.R3MES_BACKEND_URL || "http://127.0.0.1:3000"),
    file: resolve(root, argValue("--file", "infrastructure/evals/domain-regression/golden.jsonl")),
    out: resolve(root, argValue("--out", "artifacts/evals/stress/latest.json")),
    concurrency: parsePositiveInt(argValue("--concurrency", process.env.R3MES_STRESS_CONCURRENCY || "2"), 2),
    repeat: parsePositiveInt(argValue("--repeat", process.env.R3MES_STRESS_REPEAT || "2"), 2),
    wallet: argValue("--wallet", process.env.R3MES_DEV_WALLET || "0xdevlocal"),
  };
}

async function loadCases(file, repeat) {
  const raw = await readFile(file, "utf8");
  const baseCases = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const cases = [];
  for (let round = 0; round < repeat; round += 1) {
    for (const testCase of baseCases) {
      cases.push({ ...testCase, runId: `${testCase.id}#${round + 1}` });
    }
  }
  return cases;
}

function percentile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

async function runCase(opts, testCase) {
  const started = Date.now();
  try {
    const response = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-r3mes-debug": "1",
        "x-wallet-address": opts.wallet,
        "x-message": JSON.stringify({
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900,
          address: opts.wallet,
        }),
        "x-signature": "dev-stress-skip-wallet-auth",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: testCase.query }],
        collectionIds: testCase.collectionIds,
        includePublic: testCase.includePublic === true,
        stream: false,
      }),
    });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const sources = Array.isArray(json?.sources) ? json.sources : [];
    const safetyPass = json?.safety_gate?.pass ?? null;
    const shadowRuntime = json?.retrieval_debug?.sourceSelection?.shadowRuntime ?? null;
    const mustHaveSources = testCase.mustHaveSources === true;
    const ok = response.ok && (!mustHaveSources || sources.length > 0) && safetyPass !== false;
    return {
      id: testCase.id,
      runId: testCase.runId,
      ok,
      status: response.status,
      latencyMs,
      sourceCount: sources.length,
      safetyPass,
      confidence: json?.retrieval_debug?.groundingConfidence ?? null,
      domain: json?.retrieval_debug?.domain ?? null,
      shadowActiveAdjustmentCount: Number(shadowRuntime?.activeAdjustmentCount ?? 0),
      shadowPromotedCandidateCount: Number(shadowRuntime?.promotedCandidateCount ?? 0),
      shadowWouldChangeTopCandidate: shadowRuntime?.wouldChangeTopCandidate === true,
      error: ok ? null : text.slice(0, 240),
    };
  } catch (error) {
    return {
      id: testCase.id,
      runId: testCase.runId,
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      sourceCount: 0,
      safetyPass: null,
      confidence: null,
      domain: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runPool(opts, cases) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const index = next;
      next += 1;
      const result = await runCase(opts, cases[index]);
      results.push(result);
      console.log(`${result.ok ? "PASS" : "FAIL"} ${result.runId} status=${result.status} latency=${result.latencyMs}ms sources=${result.sourceCount}`);
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  return results;
}

async function main() {
  const opts = parseArgs();
  const cases = await loadCases(opts.file, opts.repeat);
  const started = Date.now();
  const results = await runPool(opts, cases);
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const passed = results.filter((result) => result.ok).length;
  const summary = {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : Number((passed / results.length).toFixed(3)),
    concurrency: opts.concurrency,
    repeat: opts.repeat,
    durationMs: Date.now() - started,
    latency: {
      min: latencies[0] ?? null,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? null,
    },
    shadowRuntime: {
      activeAdjustmentCases: results.filter((result) => result.shadowActiveAdjustmentCount > 0).length,
      promotedCandidateCases: results.filter((result) => result.shadowPromotedCandidateCount > 0).length,
      topChangeCases: results.filter((result) => result.shadowWouldChangeTopCandidate === true).length,
    },
  };
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
  console.log(`wrote ${opts.out}`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
