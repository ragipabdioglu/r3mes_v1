import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function decideReleaseGate(items, production) {
  if (production.status !== "ok" && production.status !== "pass") return "fail";
  if (items.some((item) => item.releaseSeverity === "blocker")) return "fail";
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
    "## Owner Phase Summary",
    "",
  ];
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
  const blockers = asArray(production.failureTaxonomy?.blockers);
  const items = buildCertificationItems(blockers);
  const totals = productionTotals(production);
  const report = {
    schemaVersion: "RealDataCertificationReport.v1",
    generatedAt: new Date().toISOString(),
    inputFile,
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
    releaseGateDecision: decideReleaseGate(items, production),
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
