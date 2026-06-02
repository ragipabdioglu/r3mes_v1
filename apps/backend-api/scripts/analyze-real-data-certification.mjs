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

  const hasActualProviderFallback =
    classes.includes("runtime_fallback") ||
    subtypes.includes("provider_fallback") ||
    failures.includes("provider_strict_failure") ||
    failures.includes("runtime_fallback:") ||
    failures.includes("reranker_fallback:true") ||
    failures.includes("qdrant_fallback:true");

  if (hasActualProviderFallback) {
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

const WORK_PACKAGE_DEFINITIONS = {
  "provider-runtime": {
    id: "wp-provider-runtime-strict",
    title: "Provider/runtime strictness closure",
    priority: 1,
    ownerPhase: "Phase 3 - Storage / Embedding / Index Backbone",
    acceptanceGates: [
      "qualityFallbackRatio must be 0 in strict real-data suites",
      "rerankerFallbackRatio must be 0 in strict real-data suites",
      "providerStrictFailures must be 0",
      "eval:real-data-certification must show no provider-runtime blockers",
    ],
    scope: "Remove or fix strict-profile provider fallback across B.Y, G.P, UI reality, and stress suites before judging answer quality.",
  },
  "context-evidence-coverage": {
    id: "wp-evidence-coverage",
    title: "Evidence/context coverage closure",
    priority: 2,
    ownerPhase: "Phase 6 - Full Evidence Intelligence",
    acceptanceGates: [
      "evidenceOnly failed cases must be triaged to retrieval, artifact, or evidence compiler",
      "context_coverage_failure count must decrease in real-data suites",
      "required context terms should appear before answer generation for supported queries",
      "no-source cases must expose not-supported evidence without hallucination",
    ],
    scope: "Fix cases where the source exists but enough usable context/facts do not reach the answer layer.",
  },
  "structured-evidence-table": {
    id: "wp-structured-table-evidence",
    title: "Structured table/numeric evidence closure",
    priority: 3,
    ownerPhase: "Phase 6 - Full Evidence Intelligence",
    acceptanceGates: [
      "KAP numeric/table blockers must expose structured facts or explicit missing-field diagnostics",
      "table/numeric required fields must be covered before composer runs",
      "kap-pilot suite should not fail table row or share group grounding cases",
    ],
    scope: "Improve table and numeric evidence readiness for KAP-style disclosures without hardcoding company-specific values.",
  },
  retrieval: {
    id: "wp-retrieval-quality",
    title: "Retrieval wrong source/chunk closure",
    priority: 4,
    ownerPhase: "Phase 4 - Retrieval Quality",
    acceptanceGates: [
      "wrong_source and wrong_chunk blockers must have candidate/rerank/alignment diagnosis",
      "same-domain wrong-topic cases should not reach composer",
      "retrieval-quality suite should pass strict guardrails",
    ],
    scope: "Address wrong source and wrong chunk failures after provider fallback is stable.",
  },
  "safety-presentation": {
    id: "wp-answer-safety-presentation",
    title: "Answer safety/presentation closure",
    priority: 5,
    ownerPhase: "Phase 7 - Full Answer Intelligence",
    acceptanceGates: [
      "template pollution and unnecessary warning cases must disappear from B.Y/G.P smoke",
      "safety rewrites must not hide sufficient evidence",
      "answer-quality and UI reality should remain public/debug clean",
    ],
    scope: "Fix cases where evidence is sufficient but deterministic safety/presentation/composer output is poor.",
  },
  "certification-triage": {
    id: "wp-certification-triage",
    title: "Certification triage leftovers",
    priority: 6,
    ownerPhase: "Phase 10 - Real Data Certification",
    acceptanceGates: [
      "Every remaining backlog item must have a concrete owner phase",
      "No unknown/certification-only blocker should remain before Phase 11",
    ],
    scope: "Resolve unclassified items and keep the release report actionable.",
  },
};

function buildWorkPackages(items, datasetSuites) {
  const grouped = new Map();
  for (const item of items) {
    const key = item.layerFamily || "certification-triage";
    const definition = WORK_PACKAGE_DEFINITIONS[key] ?? WORK_PACKAGE_DEFINITIONS["certification-triage"];
    if (!grouped.has(definition.id)) {
      grouped.set(definition.id, {
        ...definition,
        layerFamilies: new Set([key]),
        affectedSuites: new Set(),
        affectedDatasets: new Set(),
        blockerCount: 0,
        warningCount: 0,
        itemCount: 0,
        sampleItems: [],
      });
    }
    const packageItem = grouped.get(definition.id);
    packageItem.layerFamilies.add(key);
    packageItem.affectedSuites.add(item.suite);
    if (item.datasetId) packageItem.affectedDatasets.add(item.datasetId);
    packageItem.itemCount += 1;
    if (item.releaseSeverity === "blocker") packageItem.blockerCount += 1;
    if (item.releaseSeverity === "warning") packageItem.warningCount += 1;
    if (packageItem.sampleItems.length < 8) {
      packageItem.sampleItems.push({
        suite: item.suite,
        id: item.id,
        bucket: item.bucket,
        severity: item.releaseSeverity,
      });
    }
  }

  for (const suite of datasetSuites) {
    if (suite.releaseSeverity !== "blocker" && suite.releaseSeverity !== "warning") continue;
    const key = Number(suite.rerankerFallbackRatio ?? 0) > 0 || Number(suite.qualityFallbackRatio ?? 0) > 0
      ? "provider-runtime"
      : "certification-triage";
    const definition = WORK_PACKAGE_DEFINITIONS[key];
    if (!grouped.has(definition.id)) {
      grouped.set(definition.id, {
        ...definition,
        layerFamilies: new Set([key]),
        affectedSuites: new Set(),
        affectedDatasets: new Set(),
        blockerCount: 0,
        warningCount: 0,
        itemCount: 0,
        sampleItems: [],
      });
    }
    const packageItem = grouped.get(definition.id);
    packageItem.affectedSuites.add(suite.suiteId);
    packageItem.affectedDatasets.add(suite.datasetId);
  }

  return [...grouped.values()]
    .map((packageItem) => ({
      ...packageItem,
      layerFamilies: [...packageItem.layerFamilies].sort(),
      affectedSuites: [...packageItem.affectedSuites].filter(Boolean).sort(),
      affectedDatasets: [...packageItem.affectedDatasets].filter(Boolean).sort(),
    }))
    .sort((a, b) => a.priority - b.priority);
}

function buildCertificationItems(blockers) {
  return blockers.map((blocker) => {
    const ownership = classifyOwnerPhase(blocker);
    return {
      datasetId: blocker.datasetId ?? null,
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
  lines.push("", "## Closure Work Packages", "");
  for (const workPackage of report.workPackages) {
    lines.push(`### ${workPackage.id}`);
    lines.push(`- Priority: ${workPackage.priority}`);
    lines.push(`- Title: ${workPackage.title}`);
    lines.push(`- Owner phase: ${workPackage.ownerPhase}`);
    lines.push(`- Items: ${workPackage.itemCount}`);
    lines.push(`- Blockers: ${workPackage.blockerCount}`);
    lines.push(`- Warnings: ${workPackage.warningCount}`);
    lines.push(`- Affected suites: ${workPackage.affectedSuites.join(", ") || "none"}`);
    lines.push(`- Scope: ${workPackage.scope}`);
    lines.push("- Acceptance gates:");
    for (const gate of workPackage.acceptanceGates) {
      lines.push(`  - ${gate}`);
    }
    lines.push("");
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
  const workPackages = buildWorkPackages(items, datasetSuites);
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
    workPackageCounts: {
      total: workPackages.length,
      blockerPackages: workPackages.filter((workPackage) => workPackage.blockerCount > 0).length,
      warningOnlyPackages: workPackages.filter((workPackage) => workPackage.blockerCount === 0 && workPackage.warningCount > 0).length,
    },
    workPackages,
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
