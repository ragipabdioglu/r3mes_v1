import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, "..", "..");
const inputFile = resolve(repoRoot, argValue("--input", "artifacts/evals/production-rag/feedback-gate.json"));
const outFile = resolve(repoRoot, argValue("--out", "artifacts/evals/real-data-certification/latest.json"));
const markdownFile = resolve(repoRoot, argValue("--markdown", "artifacts/evals/real-data-certification/latest.md"));
const manifestDir = resolve(repoRoot, argValue("--manifest-dir", "infrastructure/evals/real-data-certification/datasets"));

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function readSummary(artifact) {
  return artifact?.summary && typeof artifact.summary === "object" ? artifact.summary : artifact;
}

function readTotals(artifact) {
  const summary = readSummary(artifact);
  const totals = summary?.totals && typeof summary.totals === "object" ? summary.totals : summary;
  return {
    status: summary?.status ?? (Number(totals?.failed ?? 0) > 0 ? "fail" : "pass"),
    total: Number(totals?.total ?? totals?.expectedCases ?? 0),
    passed: Number(totals?.passed ?? 0),
    failed: Number(totals?.failed ?? 0),
    passRate: Number(totals?.passRate ?? 0),
  };
}

async function readJsonIfExists(path) {
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function readDatasetManifests() {
  if (!(await exists(manifestDir))) return [];
  const files = (await readdir(manifestDir)).filter((file) => file.endsWith(".json")).sort();
  const manifests = [];
  for (const file of files) {
    const path = resolve(manifestDir, file);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifests.push({ ...manifest, manifestFile: path });
  }
  return manifests;
}

function suiteArtifactPath(suite) {
  return resolve(repoRoot, suite.artifactPath ?? `artifacts/evals/${suite.id}/latest.json`);
}

function suiteReleaseSeverity(summary, artifactExists) {
  if (!artifactExists) return "blocker";
  if (summary?.evalGuardrails?.status === "fail") return "blocker";
  if (Number(summary?.failed ?? 0) > 0) return "blocker";
  if (Number(summary?.runtimeControlTower?.qualityFallbackRatio ?? 0) > 0) return "blocker";
  if (Number(summary?.rerankerQuality?.fallbackRatio ?? summary?.rerankerFallbackRatio ?? 0) > 0) return "blocker";
  if (summary?.evalGuardrails?.status === "warn") return "warning";
  return "pass";
}

function buildSuiteRollup(dataset, suite, artifact, artifactPath) {
  const summary = artifact ? readSummary(artifact) : null;
  const totals = artifact ? readTotals(artifact) : { status: "missing", total: 0, passed: 0, failed: 0, passRate: 0 };
  const severity = suiteReleaseSeverity(summary, Boolean(artifact));
  const blockers = asArray(summary?.failureTaxonomy?.blockers).map((blocker) => ({
    ...blocker,
    suite: suite.id,
    datasetId: dataset.id,
  }));
  const providerStrictFailures = asArray(summary?.providerStrictFailures).map((failure) => ({
    ...failure,
    suite: suite.id,
    datasetId: dataset.id,
    classes: ["runtime_fallback"],
    subtypes: ["provider_fallback"],
    failures: [failure.failure ?? "provider_strict_failure"],
  }));
  return {
    datasetId: dataset.id,
    datasetName: dataset.displayName,
    datasetType: dataset.datasetType,
    privacyClass: dataset.privacyClass,
    suiteId: suite.id,
    suitePath: suite.path,
    artifactPath,
    artifactExists: Boolean(artifact),
    status: totals.status,
    total: totals.total,
    passed: totals.passed,
    failed: totals.failed,
    passRate: totals.passRate,
    releaseSeverity: severity,
    modes: asArray(suite.modes),
    runtimeLineageCoverage: summary?.runtimeControlTower?.coverageRatio ?? null,
    qualityFallbackRatio: summary?.runtimeControlTower?.qualityFallbackRatio ?? null,
    rerankerFallbackRatio: summary?.rerankerQuality?.fallbackRatio ?? summary?.rerankerFallbackRatio ?? null,
    qwenCallRatio: summary?.qwenCallRatio ?? summary?.runtimeControlTower?.qwenCallRatio ?? null,
    answerPathDistribution: summary?.answerPathDistribution ?? summary?.runtimeControlTower?.answerPathDistribution ?? {},
    failureClasses: summary?.failureTaxonomy?.classes ?? {},
    failureSubtypes: summary?.failureTaxonomy?.subtypes ?? {},
    phaseDiagnosisClasses: summary?.failureTaxonomy?.phaseDiagnosis?.classes ?? {},
    blockerCount: blockers.length,
    providerStrictFailureCount: providerStrictFailures.length,
    blockers,
    providerStrictFailures,
  };
}

async function buildDatasetSuiteRollups(manifests) {
  const rollups = [];
  for (const dataset of manifests.filter((manifest) => manifest.status === "active")) {
    for (const suite of asArray(dataset.evalSuites).filter((item) => item.status === "active")) {
      const artifactPath = suiteArtifactPath(suite);
      const artifact = await readJsonIfExists(artifactPath);
      rollups.push(buildSuiteRollup(dataset, suite, artifact, artifactPath));
    }
  }
  return rollups;
}

function classifyOwnerPhase(blocker) {
  const failures = asArray(blocker.failures).join(" ").toLowerCase();
  const classes = asArray(blocker.classes);
  const subtypes = asArray(blocker.subtypes);
  const suite = String(blocker.suite ?? "");
  const id = String(blocker.id ?? "");
  const bucket = String(blocker.bucket ?? "");

  if (classes.includes("runtime_fallback") || subtypes.includes("provider_fallback") || failures.includes("fallback")) {
    return {
      ownerPhase: "Phase 3 - Storage / Embedding / Index Backbone",
      layerFamily: "provider-runtime",
      nextAction: "Verify strict provider/vector readiness and remove fallback from eval/pilot/production paths.",
    };
  }

  if (classes.includes("query_understanding") || subtypes.includes("query_understanding") || failures.includes("intent:unknown")) {
    return {
      ownerPhase: "Phase 5 - Query / Source Intelligence",
      layerFamily: "query-source-intelligence",
      nextAction: "Improve query contract/source scoring diagnostics for this query shape before changing answer behavior.",
    };
  }

  if (classes.includes("retrieval_quality") || subtypes.includes("wrong_source") || subtypes.includes("wrong_chunk")) {
    return {
      ownerPhase: "Phase 4 - Retrieval Quality",
      layerFamily: "retrieval",
      nextAction: "Inspect source/chunk candidate trace, reranker lineage, and V2 payload readiness before touching composer.",
    };
  }

  if (classes.includes("safety") || subtypes.includes("safety") || blocker.phaseDiagnosis?.classes?.includes("safety_policy_or_presentation_failure")) {
    return {
      ownerPhase: "Phase 7 - Full Answer Intelligence",
      layerFamily: "safety-presentation",
      nextAction: "Separate evidence-supported answer from deterministic safety/presentation rewrite; do not relax safety blindly.",
    };
  }

  if (subtypes.includes("context_coverage_failure") || failures.includes("missing_concepts")) {
    const kapOrTable = /kap|table|cash|share|withholding|dividend/i.test(`${suite} ${id} ${bucket}`);
    return {
      ownerPhase: kapOrTable ? "Phase 6 - Full Evidence Intelligence" : "Phase 6 - Full Evidence Intelligence",
      layerFamily: kapOrTable ? "structured-evidence-table" : "context-evidence-coverage",
      nextAction: "Check evidence-only result, selected facts, required concept coverage, and whether V2 reingestion/profile refresh is needed.",
    };
  }

  return {
    ownerPhase: "Phase 10 - Real Data Certification",
    layerFamily: "certification-triage",
    nextAction: "Keep as certification backlog until a concrete owning layer is identified.",
  };
}

function releaseSeverity(blocker) {
  const classes = asArray(blocker.classes);
  const subtypes = asArray(blocker.subtypes);
  if (classes.includes("runtime_fallback") || subtypes.includes("provider_fallback")) return "blocker";
  if (classes.includes("safety") || subtypes.includes("safety")) return "blocker";
  if (classes.includes("retrieval_quality") || subtypes.includes("wrong_source") || subtypes.includes("wrong_chunk")) return "blocker";
  if (subtypes.includes("context_coverage_failure")) return "blocker";
  return "warning";
}

function buildCertificationItems(blockers) {
  return blockers.map((blocker) => {
    const ownership = classifyOwnerPhase(blocker);
    return {
      suite: blocker.suite ?? "unknown",
      id: blocker.id ?? "unknown",
      bucket: blocker.bucket ?? "unknown",
      releaseSeverity: releaseSeverity(blocker),
      ownerPhase: ownership.ownerPhase,
      layerFamily: ownership.layerFamily,
      classes: asArray(blocker.classes),
      subtypes: asArray(blocker.subtypes),
      phaseDiagnosis: blocker.phaseDiagnosis ?? null,
      failures: asArray(blocker.failures),
      nextAction: ownership.nextAction,
    };
  });
}

function productionTotals(production) {
  const suites = asArray(production.suites);
  const total = Number(production.total ?? production.expectedCases ?? suites.reduce((sum, suite) => sum + Number(suite.total ?? suite.expectedCases ?? 0), 0));
  const passed = Number(production.passed ?? suites.reduce((sum, suite) => sum + Number(suite.passed ?? 0), 0));
  const failed = Number(production.failed ?? suites.reduce((sum, suite) => sum + Number(suite.failed ?? 0), 0));
  return { total, passed, failed };
}

function decideReleaseGate(items, production, suiteRollups = []) {
  if (production.status !== "ok" && production.status !== "pass") return "fail";
  if (suiteRollups.some((suite) => suite.releaseSeverity === "blocker")) return "fail";
  if (items.some((item) => item.releaseSeverity === "blocker")) return "fail";
  if (suiteRollups.some((suite) => suite.releaseSeverity === "warning")) return "conditional_pass";
  if (items.some((item) => item.releaseSeverity === "warning")) return "conditional_pass";
  return "pass";
}

function toMarkdown(report) {
  const lines = [
    "# Real Data Certification Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Input: ${report.inputFile}`,
    "",
    "## Release Gate",
    "",
    `- Decision: ${report.releaseGateDecision}`,
    `- Production status: ${report.production.status}`,
    `- Total cases: ${report.production.total}`,
    `- Passed: ${report.production.passed}`,
    `- Failed: ${report.production.failed}`,
    `- Runtime lineage coverage: ${report.production.runtimeLineageCoverage}`,
    `- Quality fallback ratio: ${report.production.qualityFallbackRatio}`,
    "",
    "## Dataset Suite Summary",
    "",
  ];
  for (const suite of report.datasetSuites) {
    lines.push(`### ${suite.datasetId} / ${suite.suiteId}`);
    lines.push(`- Severity: ${suite.releaseSeverity}`);
    lines.push(`- Status: ${suite.status}`);
    lines.push(`- Total: ${suite.total}`);
    lines.push(`- Passed: ${suite.passed}`);
    lines.push(`- Failed: ${suite.failed}`);
    lines.push(`- Runtime lineage coverage: ${suite.runtimeLineageCoverage}`);
    lines.push(`- Quality fallback ratio: ${suite.qualityFallbackRatio}`);
    lines.push(`- Reranker fallback ratio: ${suite.rerankerFallbackRatio}`);
    lines.push(`- Artifact: ${suite.artifactPath}`);
    lines.push("");
  }
  lines.push(
    "## Owner Phase Summary",
    "",
  );
  for (const [phase, count] of Object.entries(report.ownerPhaseCounts)) {
    lines.push(`- ${phase}: ${count}`);
  }
  lines.push("", "## Layer Family Summary", "");
  for (const [family, count] of Object.entries(report.layerFamilyCounts)) {
    lines.push(`- ${family}: ${count}`);
  }
  lines.push("", "## Certification Backlog", "");
  for (const item of report.items) {
    lines.push(`### ${item.suite} / ${item.id}`);
    lines.push(`- Severity: ${item.releaseSeverity}`);
    lines.push(`- Owner phase: ${item.ownerPhase}`);
    lines.push(`- Layer family: ${item.layerFamily}`);
    lines.push(`- Classes: ${item.classes.join(", ") || "none"}`);
    lines.push(`- Subtypes: ${item.subtypes.join(", ") || "none"}`);
    lines.push(`- Failures: ${item.failures.join(" | ") || "none"}`);
    lines.push(`- Next action: ${item.nextAction}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const production = JSON.parse(await readFile(inputFile, "utf8"));
  const manifests = await readDatasetManifests();
  const datasetSuites = await buildDatasetSuiteRollups(manifests);
  const blockers = asArray(production.failureTaxonomy?.blockers);
  const suiteBlockers = datasetSuites.flatMap((suite) => [
    ...asArray(suite.blockers),
    ...asArray(suite.providerStrictFailures),
  ]);
  const items = buildCertificationItems([...blockers, ...suiteBlockers]);
  const totals = productionTotals(production);
  const report = {
    schemaVersion: "RealDataCertificationReport.v2",
    generatedAt: new Date().toISOString(),
    inputFile,
    manifestDir,
    production: {
      status: production.status ?? "unknown",
      total: totals.total,
      passed: totals.passed,
      failed: totals.failed,
      failedSuites: asArray(production.failedSuites),
      guardrailFailedSuites: asArray(production.guardrailFailedSuites),
      runtimeLineageCoverage: production.runtimeControlTower?.coverageRatio ?? null,
      qualityFallbackCases: production.runtimeControlTower?.qualityFallbackCases ?? null,
      qualityFallbackRatio: production.runtimeControlTower?.qualityFallbackRatio ?? null,
      providerStrictFailureCount: production.providerStrictFailureCount ?? 0,
      failureClasses: production.failureTaxonomy?.classes ?? {},
      failureSubtypes: production.failureTaxonomy?.subtypes ?? {},
    },
    datasets: manifests.map((manifest) => ({
      id: manifest.id,
      displayName: manifest.displayName,
      status: manifest.status,
      datasetType: manifest.datasetType,
      privacyClass: manifest.privacyClass,
      evalSuites: asArray(manifest.evalSuites).map((suite) => ({
        id: suite.id,
        status: suite.status,
        modes: asArray(suite.modes),
        path: suite.path,
      })),
    })),
    datasetSuites: datasetSuites.map(({ blockers: _blockers, providerStrictFailures: _providerStrictFailures, ...suite }) => suite),
    datasetSuiteCounts: {
      active: datasetSuites.length,
      blocker: datasetSuites.filter((suite) => suite.releaseSeverity === "blocker").length,
      warning: datasetSuites.filter((suite) => suite.releaseSeverity === "warning").length,
      pass: datasetSuites.filter((suite) => suite.releaseSeverity === "pass").length,
      missingArtifact: datasetSuites.filter((suite) => !suite.artifactExists).length,
    },
    releaseGateDecision: decideReleaseGate(items, production, datasetSuites),
    certificationBacklogCount: items.length,
    blockerCount: items.filter((item) => item.releaseSeverity === "blocker").length,
    warningCount: items.filter((item) => item.releaseSeverity === "warning").length,
    ownerPhaseCounts: countBy(items.map((item) => item.ownerPhase)),
    layerFamilyCounts: countBy(items.map((item) => item.layerFamily)),
    failedSuiteCounts: countBy(items.map((item) => item.suite)),
    items,
    nextRecommendedPhase: items.length > 0 ? "Phase 10 triage, then route each blocker to its owner phase before Phase 11 cleanup." : "Phase 11 - Legacy Cleanup / Production Hardening",
    note: "This report classifies existing eval output only. It does not change runtime behavior.",
  };

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(dirname(markdownFile), { recursive: true });
  await writeFile(markdownFile, toMarkdown(report), "utf8");
  console.log(JSON.stringify({
    outFile,
    markdownFile,
    releaseGateDecision: report.releaseGateDecision,
    certificationBacklogCount: report.certificationBacklogCount,
    blockerCount: report.blockerCount,
    ownerPhaseCounts: report.ownerPhaseCounts,
    layerFamilyCounts: report.layerFamilyCounts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
