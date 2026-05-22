import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeFailureTaxonomy } from "./eval-scorers/failure-taxonomy.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const backendRoot = resolve(repoRoot, "apps/backend-api");
const runner = resolve(backendRoot, "scripts/run-grounded-response-eval.mjs");

const SUITES = [
  ["rag-quality-gates", "infrastructure/evals/rag-quality-gates/golden.jsonl"],
  ["retrieval-quality", "infrastructure/evals/retrieval-quality/golden.jsonl"],
  ["kap-pilot", "infrastructure/evals/kap-pilot/golden.jsonl"],
  ["real-world-stress", "infrastructure/evals/real-world-stress/golden.jsonl"],
  ["grounded-response", "infrastructure/evals/grounded-response/golden.jsonl"],
  ["answer-quality", "infrastructure/evals/answer-quality/golden.jsonl"],
  ["evidence-only", "infrastructure/evals/evidence-only/golden.jsonl"],
  ["ui-reality", "infrastructure/evals/ui-reality/golden.jsonl"],
  ["context-pruning", "infrastructure/evals/context-pruning/golden.jsonl"],
  ["conversational-intent", "infrastructure/evals/conversational-intent/golden.jsonl"],
  ["adaptive-rag", "infrastructure/evals/adaptive-rag/golden.jsonl"],
  ["realistic-rag", "infrastructure/evals/realistic-rag/golden.jsonl"],
  ["multi-domain-basic", "infrastructure/evals/multi-domain-basic/golden.jsonl"],
  ["collection-suggestion", "infrastructure/evals/collection-suggestion/golden.jsonl"],
  ["domain-regression", "infrastructure/evals/domain-regression/golden.jsonl"],
  ["legal-basic", "infrastructure/evals/legal-basic/golden.jsonl"],
  ["legal-divorce-basic", "infrastructure/evals/legal-divorce-basic/golden.jsonl"],
  ["education-basic", "infrastructure/evals/education-basic/golden.jsonl"],
];

function argValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function countJsonlLines(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .length;
}

function suiteOutPath(id) {
  return resolve(repoRoot, `artifacts/evals/${id}/latest.json`);
}

function runSuite([id, file]) {
  const absoluteFile = resolve(repoRoot, file);
  const absoluteOut = suiteOutPath(id);
  mkdirSync(dirname(absoluteOut), { recursive: true });

  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [runner, "--file", absoluteFile, "--out", absoluteOut],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        R3MES_RUNTIME_PROFILE: process.env.R3MES_RUNTIME_PROFILE ?? "eval",
        R3MES_EVAL_GUARDRAILS_STRICT: "1",
        R3MES_EVAL_MIN_RUNTIME_LINEAGE_COVERAGE: "1",
        R3MES_EVAL_MAX_QUALITY_FALLBACK_RATIO: "0",
      },
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  const durationMs = Date.now() - startedAt;
  let report = null;
  try {
    report = JSON.parse(readFileSync(absoluteOut, "utf8"));
  } catch {
    report = null;
  }

  if (result.status !== 0 && !report) {
    return {
      id,
      file,
      out: absoluteOut,
      expectedCases: countJsonlLines(absoluteFile),
      status: "error",
      exitCode: result.status,
      durationMs,
      total: 0,
      passed: 0,
      failed: 0,
      guardrailStatus: "error",
      violations: [{ id: "suite_process_failed", detail: `exit ${result.status}` }],
    };
  }

  const summary = report.summary ?? {};
  return {
    id,
    file,
    out: absoluteOut,
    expectedCases: countJsonlLines(absoluteFile),
    status: result.status === 0 ? "ok" : "failed",
    exitCode: result.status,
    durationMs,
    total: Number(summary.total ?? 0),
    passed: Number(summary.passed ?? 0),
    failed: Number(summary.failed ?? 0),
    passRate: Number(summary.passRate ?? 0),
    guardrailStatus: summary.evalGuardrails?.status ?? "unknown",
    guardrailStrict: summary.evalGuardrails?.strict ?? false,
    violations: summary.evalGuardrails?.violations ?? [],
    runtimeControlTower: summary.runtimeControlTower ?? null,
    providerStrictFailures: summary.providerStrictFailures ?? [],
    failureTaxonomy: summary.failureTaxonomy ?? null,
    answerPathDistribution: summary.answerPathDistribution ?? {},
    qwenCallRatio: Number(summary.qwenCallRatio ?? 0),
    validatorCallRatio: Number(summary.validatorCallRatio ?? 0),
    embeddingFallbackRatio: Number(summary.embeddingFallbackRatio ?? 0),
    rerankerFallbackRatio: Number(summary.rerankerFallbackRatio ?? 0),
    buckets: summary.buckets ?? {},
    routeDecisionModes: summary.routeDecisionModes ?? {},
  };
}

const selected = new Set(argValues("--suite"));
const suites = selected.size > 0 ? SUITES.filter(([id]) => selected.has(id)) : SUITES;
const outFile = resolve(repoRoot, argValue("--out", "artifacts/evals/production-rag/latest.json"));
const failOnWarn = hasFlag("--fail-on-warn");
const dryRun = hasFlag("--dry-run");
const skipQualityProviderGate = hasFlag("--skip-quality-provider-gate");

if (suites.length === 0) {
  console.error(`No matching suites. Available: ${SUITES.map(([id]) => id).join(", ")}`);
  process.exit(2);
}

if (dryRun) {
  const planned = suites.map(([id, file]) => ({
    id,
    file,
    expectedCases: countJsonlLines(resolve(repoRoot, file)),
  }));
  console.log(JSON.stringify({
    totalSuites: planned.length,
    totalExpectedCases: planned.reduce((sum, item) => sum + item.expectedCases, 0),
    suites: planned,
  }, null, 2));
  process.exit(0);
}

function runQualityProviderGate() {
  if (skipQualityProviderGate) {
    console.log("[production-rag] quality provider gate skipped");
    return {
      skipped: true,
      status: "skipped",
    };
  }
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    ["scripts/smoke-quality-providers.mjs"],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        R3MES_REQUIRE_REAL_EMBEDDINGS: "1",
        R3MES_REQUIRE_REAL_RERANKER: "1",
        R3MES_QDRANT_REINDEX_REQUIRE_REAL_EMBEDDINGS: "1",
      },
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    throw new Error(`quality provider gate failed with exit ${result.status ?? "unknown"}`);
  }
  return {
    skipped: false,
    status: "pass",
    durationMs,
  };
}

let qualityProviderGate;
try {
  qualityProviderGate = runQualityProviderGate();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const startedAt = new Date().toISOString();
const results = suites.map(runSuite);
const total = results.reduce((sum, suite) => sum + suite.total, 0);
const passed = results.reduce((sum, suite) => sum + suite.passed, 0);
const failed = results.reduce((sum, suite) => sum + suite.failed, 0);
const expectedCases = results.reduce((sum, suite) => sum + suite.expectedCases, 0);
const guardrailViolations = results.flatMap((suite) =>
  suite.violations.map((violation) => ({ suite: suite.id, ...violation })),
);
const providerStrictFailures = results.flatMap((suite) =>
  (Array.isArray(suite.providerStrictFailures) ? suite.providerStrictFailures : []).map((failure) => ({
    suite: suite.id,
    ...failure,
  })),
);
const failureTaxonomy = mergeFailureTaxonomy(results);
const runtimeObservedCases = results.reduce((sum, suite) => sum + Number(suite.runtimeControlTower?.observedCases ?? 0), 0);
const runtimeSyntheticCases = results.reduce((sum, suite) => sum + Number(suite.runtimeControlTower?.syntheticCases ?? 0), 0);
const runtimeQualityFallbackCases = results.reduce(
  (sum, suite) => sum + Number(suite.runtimeControlTower?.qualityFallbackCases ?? 0),
  0,
);
const runtimeMissingCases = results.flatMap((suite) =>
  (Array.isArray(suite.runtimeControlTower?.missingCases) ? suite.runtimeControlTower.missingCases : []).map((item) => ({
    suite: suite.id,
    ...item,
  })),
);
const warnSuites = results.filter((suite) => suite.guardrailStatus === "warn").map((suite) => suite.id);
const failedSuites = results.filter((suite) => suite.status !== "ok" || suite.failed > 0).map((suite) => suite.id);
const guardrailFailedSuites = results
  .filter((suite) => suite.guardrailStatus === "fail" || suite.guardrailStatus === "error")
  .map((suite) => suite.id);
const status =
  failedSuites.length > 0 || guardrailFailedSuites.length > 0 || (failOnWarn && warnSuites.length > 0)
    ? "fail"
    : warnSuites.length > 0
      ? "warn"
      : "pass";

const aggregate = {
  startedAt,
  finishedAt: new Date().toISOString(),
  status,
  failOnWarn,
  qualityProviderGate,
  totals: {
    suites: results.length,
    expectedCases,
    total,
    passed,
    failed,
    passRate: total > 0 ? passed / total : 0,
  },
  failedSuites,
  guardrailFailedSuites,
  warnSuites,
  guardrailViolations,
  providerStrictFailures,
  failureTaxonomy,
  runtimeControlTower: {
    observedCases: runtimeObservedCases,
    syntheticCases: runtimeSyntheticCases,
    coverageRatio: total === 0 ? 0 : Number((runtimeObservedCases / total).toFixed(3)),
    missingCases: runtimeMissingCases,
    qualityFallbackCases: runtimeQualityFallbackCases,
    qualityFallbackRatio: total === 0 ? 0 : Number((runtimeQualityFallbackCases / total).toFixed(3)),
  },
  suites: results,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(aggregate, null, 2)}\n`);

console.log(JSON.stringify({
  status: aggregate.status,
  suites: aggregate.totals.suites,
  expectedCases: aggregate.totals.expectedCases,
  total: aggregate.totals.total,
  passed: aggregate.totals.passed,
  failed: aggregate.totals.failed,
  warnSuites,
  failedSuites,
  guardrailFailedSuites,
  runtimeControlTower: aggregate.runtimeControlTower,
  providerStrictFailureCount: aggregate.providerStrictFailures.length,
  failureTaxonomy: aggregate.failureTaxonomy,
  out: outFile,
}, null, 2));

if (status === "fail") process.exit(1);
