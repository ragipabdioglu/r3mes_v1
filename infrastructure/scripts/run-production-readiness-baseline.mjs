import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultEvalRoot = resolve(root, "infrastructure/evals");
const defaultArtifactsRoot = resolve(root, "artifacts/evals");
const defaultOut = resolve(root, "artifacts/evals/readiness-baseline/latest.json");

const REQUIRED_BUCKETS = [
  "wrong_source",
  "no_source",
  "private_leak",
  "dirty_ocr",
  "typo_normalization",
  "same_domain_wrong_topic",
  "multi_domain",
  "contradiction",
  "latency",
  "shadow_runtime",
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseArgs() {
  return {
    evalRoot: resolve(root, argValue("--eval-root", defaultEvalRoot)),
    artifactsRoot: resolve(root, argValue("--artifacts-root", defaultArtifactsRoot)),
    out: resolve(root, argValue("--out", process.env.R3MES_READINESS_BASELINE_OUT || defaultOut)),
    includeArtifacts: !hasFlag("--no-artifacts"),
  };
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function includesAny(haystack, needles) {
  const text = normalize(haystack);
  return needles.some((needle) => text.includes(normalize(needle)));
}

function classifyCase(testCase, suite) {
  const id = normalize(testCase.id);
  const bucket = normalize(testCase.bucket);
  const query = normalize(testCase.query);
  const suiteName = normalize(suite);
  const expectedRails = asArray(testCase.expectedSafetyRailIds);
  const forbiddenRails = asArray(testCase.forbiddenSafetyRailIds);
  const expectedShadowFields = [
    testCase.expectedShadowRuntimeAffected,
    testCase.expectedShadowWouldChangeTopCandidate,
    testCase.minShadowPromotedCandidates,
    testCase.expectedShadowImpactCollectionIds,
  ];
  const labels = new Set();
  const reasons = {};

  function mark(label, reason, condition) {
    if (!condition) return;
    labels.add(label);
    reasons[label] = reasons[label] ?? [];
    reasons[label].push(reason);
  }

  mark(
    "wrong_source",
    "query/source mismatch or rejected source expectation",
    includesAny(`${id} ${bucket}`, ["wrong", "mismatch", "adversarial", "source_suggestion"]) ||
      expectedRails.includes("QUERY_SOURCE_MISMATCH") ||
      expectedRails.includes("SUGGEST_MODE_NO_GROUNDED_SOURCES") ||
      Array.isArray(testCase.expectedRejectedCollectionIds),
  );
  mark(
    "same_domain_wrong_topic",
    "same-domain mismatch or alignment fast-fail expectation",
    testCase.expectedAlignmentFastFailed === true ||
      expectedRails.includes("QUERY_SOURCE_MISMATCH") ||
      includesAny(`${id} ${bucket}`, ["same_domain_wrong_topic", "wrong_topic", "wrong-topic"]),
  );
  mark(
    "no_source",
    "no-source, suggest, or zero-source fallback expectation",
    testCase.mustHaveSources === false ||
      Number(testCase.maxSources ?? Number.NaN) === 0 ||
      includesAny(testCase.expectedFallbackMode, ["no_source", "source_suggestion"]) ||
      expectedRails.includes("NO_USABLE_FACTS") ||
      expectedRails.includes("MISSING_SOURCES") ||
      expectedRails.includes("SUGGEST_MODE_NO_GROUNDED_SOURCES"),
  );
  mark(
    "private_leak",
    "private scope or visibility protection expectation",
    includesAny(`${id} ${bucket} ${suiteName}`, ["private", "leak", "visibility"]) ||
      expectedRails.includes("PRIVATE_SOURCE_SCOPE_MISMATCH") ||
      forbiddenRails.includes("PRIVATE_SOURCE_SCOPE_MISMATCH"),
  );
  mark(
    "dirty_ocr",
    "dirty/noisy document expectation",
    includesAny(`${id} ${bucket} ${query}`, ["dirty", "ocr", "noisy", "kirli", "bozuk"]),
  );
  mark(
    "typo_normalization",
    "typo, ascii Turkish, or informal wording expectation",
    includesAny(`${id} ${bucket} ${query}`, ["typo", "ascii", "agriyo", "kasigim", "maliyim", "bozuk türkçe", "bozuk turkce"]),
  );
  mark(
    "multi_domain",
    "multi-domain suite, bucket, or collection expectation",
    includesAny(`${id} ${bucket} ${suiteName}`, ["multi-domain", "multi_domain", "domain-regression"]) ||
      asArray(testCase.expectedDomain).length > 1,
  );
  mark(
    "contradiction",
    "contradictory evidence expectation",
    includesAny(`${id} ${bucket} ${query}`, ["contradiction", "contradictory", "çeliş", "celis"]),
  );
  mark(
    "latency",
    "latency budget expectation",
    Number.isFinite(Number(testCase.maxLatencyMs)),
  );
  mark(
    "shadow_runtime",
    "shadow runtime expectation",
    expectedShadowFields.some((value) => value !== undefined),
  );

  return {
    labels: [...labels].sort(),
    reasons,
  };
}

async function readJsonl(file) {
  const raw = await readFile(file, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1} invalid jsonl: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function listSuites(evalRoot) {
  const entries = await readdir(evalRoot, { withFileTypes: true });
  const suites = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const goldenPath = join(evalRoot, entry.name, "golden.jsonl");
    try {
      await stat(goldenPath);
      suites.push({ name: entry.name, file: goldenPath });
    } catch {
      // Skip directories without a golden set.
    }
  }
  return suites.sort((a, b) => a.name.localeCompare(b.name));
}

async function readArtifactSummary(artifactsRoot, suite) {
  const file = join(artifactsRoot, suite, "latest.json");
  try {
    const [raw, stats] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const parsed = JSON.parse(raw);
    return {
      path: file,
      updatedAt: stats.mtime.toISOString(),
      summary: parsed.summary ?? null,
    };
  } catch {
    return null;
  }
}

async function readOptionalEvalArtifact(artifactsRoot, name) {
  const file = join(artifactsRoot, name, "latest.json");
  try {
    const [raw, stats] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const parsed = JSON.parse(raw);
    return {
      name,
      path: file,
      updatedAt: stats.mtime.toISOString(),
      summary: parsed.summary ?? null,
    };
  } catch {
    return {
      name,
      path: file,
      updatedAt: null,
      summary: null,
    };
  }
}

function createEmptyCoverage() {
  return REQUIRED_BUCKETS.reduce((acc, bucket) => {
    acc[bucket] = {
      caseCount: 0,
      suites: {},
      examples: [],
    };
    return acc;
  }, {});
}

function scoreReadiness({ totalCases, coverage, artifacts }) {
  const coveredBuckets = REQUIRED_BUCKETS.filter((bucket) => coverage[bucket]?.caseCount > 0);
  const missingBuckets = REQUIRED_BUCKETS.filter((bucket) => coverage[bucket]?.caseCount === 0);
  const suitesWithArtifacts = artifacts.filter((artifact) => artifact.summary).length;
  const failedArtifactSuites = artifacts.filter((artifact) => Number(artifact.summary?.failed ?? 0) > 0);
  const passRates = artifacts
    .map((artifact) => Number(artifact.summary?.passRate ?? Number.NaN))
    .filter((value) => Number.isFinite(value));
  const averagePassRate =
    passRates.length === 0
      ? null
      : Number((passRates.reduce((sum, value) => sum + value, 0) / passRates.length).toFixed(3));
  const coverageScore = Number((coveredBuckets.length / REQUIRED_BUCKETS.length).toFixed(3));
  const artifactScore =
    artifacts.length === 0 ? 0 : Number((suitesWithArtifacts / artifacts.length).toFixed(3));
  const status =
    missingBuckets.length === 0 && failedArtifactSuites.length === 0 && totalCases >= 100
      ? "ready_for_controlled_adaptive_work"
      : "baseline_has_gaps";
  const blockers = [
    ...(totalCases < 100 ? [`eval_case_target:${totalCases}<100`] : []),
    ...missingBuckets.map((bucket) => `missing_bucket:${bucket}`),
    ...failedArtifactSuites.map((artifact) => `failing_latest_artifact:${artifact.suite}`),
  ];

  return {
    status,
    blockers,
    totalCases,
    requiredCaseTarget: 100,
    coverageScore,
    artifactScore,
    averagePassRate,
    coveredBuckets,
    missingBuckets,
    failedArtifactSuites: failedArtifactSuites.map((artifact) => ({
      suite: artifact.suite,
      failed: artifact.summary.failed,
      passRate: artifact.summary.passRate,
    })),
  };
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    target[key] = (target[key] ?? 0) + Number(value ?? 0);
  }
  return target;
}

function mergeWeightedAverage(target, key, average, weight) {
  const numericAverage = Number(average ?? 0);
  const numericWeight = Number(weight ?? 0);
  if (!Number.isFinite(numericAverage) || !Number.isFinite(numericWeight) || numericWeight <= 0) return;
  const current = target[key] ?? { weightedSum: 0, weight: 0 };
  current.weightedSum += numericAverage * numericWeight;
  current.weight += numericWeight;
  target[key] = current;
}

function finalizeWeightedAverages(weighted) {
  return Object.fromEntries(
    Object.entries(weighted)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        value.weight <= 0 ? 0 : Number((value.weightedSum / value.weight).toFixed(3)),
      ]),
  );
}

function summarizeRouterQualityArtifacts(artifacts) {
  const routerArtifacts = artifacts.filter((artifact) => artifact.summary?.routerQuality);
  const aggregate = {
    observedSuites: routerArtifacts.length,
    routeDecisionModes: {},
    routeDecisionConfidences: {},
    routePrimaryDomains: {},
    selectionModes: {},
    metadataCandidateCoverage: {
      totalCases: 0,
      casesWithCandidates: 0,
      ratio: 0,
      averageCandidateCount: 0,
      averageTopScore: 0,
      averageTopMatchedTerms: 0,
      sourceQualities: {},
      scoringModes: {},
      topSourceQualities: {},
      topScoringModes: {},
      topSignalAverages: {},
      topContributionAverages: {},
    },
    expectations: {
      routeDecision: { total: 0, matched: 0, mismatches: [] },
      usedCollections: { total: 0, matched: 0, mismatches: [] },
      suggestedCollections: { total: 0, matched: 0, mismatches: [] },
      topMetadataCandidateQuality: { total: 0, matched: 0, mismatches: [] },
      forbiddenTopMetadataCandidateQuality: { total: 0, matched: 0, mismatches: [] },
      topMetadataCandidateScoringMode: { total: 0, matched: 0, mismatches: [] },
    },
  };

  let weightedCandidateCount = 0;
  let weightedTopScore = 0;
  let weightedTopMatchedTerms = 0;
  let topCandidateWeight = 0;
  const weightedSignals = {};
  const weightedContributions = {};
  for (const artifact of routerArtifacts) {
    const routerQuality = artifact.summary.routerQuality;
    const suiteTotal = Number(artifact.summary.total ?? 0);
    mergeCounts(aggregate.routeDecisionModes, routerQuality.routeDecisionModes);
    mergeCounts(aggregate.routeDecisionConfidences, routerQuality.routeDecisionConfidences);
    mergeCounts(aggregate.routePrimaryDomains, routerQuality.routePrimaryDomains);
    mergeCounts(aggregate.selectionModes, routerQuality.selectionModes);
    mergeCounts(aggregate.metadataCandidateCoverage.sourceQualities, routerQuality.metadataCandidateCoverage?.sourceQualities);
    mergeCounts(aggregate.metadataCandidateCoverage.scoringModes, routerQuality.metadataCandidateCoverage?.scoringModes);
    mergeCounts(aggregate.metadataCandidateCoverage.topSourceQualities, routerQuality.metadataCandidateCoverage?.topSourceQualities);
    mergeCounts(aggregate.metadataCandidateCoverage.topScoringModes, routerQuality.metadataCandidateCoverage?.topScoringModes);

    const coverage = routerQuality.metadataCandidateCoverage ?? {};
    aggregate.metadataCandidateCoverage.totalCases += suiteTotal;
    const casesWithCandidates = Number(coverage.casesWithCandidates ?? 0);
    aggregate.metadataCandidateCoverage.casesWithCandidates += casesWithCandidates;
    weightedCandidateCount += Number(coverage.averageCandidateCount ?? 0) * suiteTotal;
    weightedTopScore += Number(coverage.averageTopScore ?? 0) * casesWithCandidates;
    weightedTopMatchedTerms += Number(coverage.averageTopMatchedTerms ?? 0) * casesWithCandidates;
    topCandidateWeight += casesWithCandidates;
    for (const [key, value] of Object.entries(coverage.topSignalAverages ?? {})) {
      mergeWeightedAverage(weightedSignals, key, value, casesWithCandidates);
    }
    for (const [key, value] of Object.entries(coverage.topContributionAverages ?? {})) {
      mergeWeightedAverage(weightedContributions, key, value, casesWithCandidates);
    }

    for (const key of [
      "routeDecision",
      "usedCollections",
      "suggestedCollections",
      "topMetadataCandidateQuality",
      "forbiddenTopMetadataCandidateQuality",
      "topMetadataCandidateScoringMode",
    ]) {
      const expectation = routerQuality.expectations?.[key] ?? {};
      aggregate.expectations[key].total += Number(expectation.total ?? 0);
      aggregate.expectations[key].matched += Number(expectation.matched ?? 0);
      for (const mismatch of expectation.mismatches ?? []) {
        aggregate.expectations[key].mismatches.push({
          suite: artifact.suite,
          ...mismatch,
        });
      }
    }
  }

  aggregate.metadataCandidateCoverage.ratio =
    aggregate.metadataCandidateCoverage.totalCases === 0
      ? 0
      : Number(
          (
            aggregate.metadataCandidateCoverage.casesWithCandidates /
            aggregate.metadataCandidateCoverage.totalCases
          ).toFixed(3),
        );
  aggregate.metadataCandidateCoverage.averageCandidateCount =
    aggregate.metadataCandidateCoverage.totalCases === 0
      ? 0
      : Number((weightedCandidateCount / aggregate.metadataCandidateCoverage.totalCases).toFixed(3));
  aggregate.metadataCandidateCoverage.averageTopScore =
    topCandidateWeight === 0 ? 0 : Number((weightedTopScore / topCandidateWeight).toFixed(3));
  aggregate.metadataCandidateCoverage.averageTopMatchedTerms =
    topCandidateWeight === 0 ? 0 : Number((weightedTopMatchedTerms / topCandidateWeight).toFixed(3));
  aggregate.metadataCandidateCoverage.topSignalAverages = finalizeWeightedAverages(weightedSignals);
  aggregate.metadataCandidateCoverage.topContributionAverages = finalizeWeightedAverages(weightedContributions);

  return aggregate;
}

function summarizeBudgetQualityArtifacts(artifacts) {
  const budgetArtifacts = artifacts.filter((artifact) => artifact.summary?.budgetQuality);
  const aggregate = {
    observedSuites: budgetArtifacts.length,
    observedCases: 0,
    totalCases: 0,
    coverageRatio: 0,
    budgetModes: {},
    contextModes: {},
    averages: {
      requestedSourceLimit: 0,
      finalSourceLimit: 0,
      finalSourceCount: 0,
      contextTextChars: 0,
      evidenceDirectFacts: 0,
      evidenceSupportingFacts: 0,
      evidenceRiskFacts: 0,
      evidenceUsableFacts: 0,
    },
    expectations: {
      budgetMode: { total: 0, matched: 0, mismatches: [] },
    },
  };
  const weightedAverages = {};

  for (const artifact of budgetArtifacts) {
    const budgetQuality = artifact.summary.budgetQuality;
    const suiteTotal = Number(artifact.summary.total ?? 0);
    const observedCases = Number(budgetQuality.observedCases ?? 0);
    aggregate.totalCases += suiteTotal;
    aggregate.observedCases += observedCases;
    mergeCounts(aggregate.budgetModes, budgetQuality.budgetModes);
    mergeCounts(aggregate.contextModes, budgetQuality.contextModes);
    for (const [key, value] of Object.entries(budgetQuality.averages ?? {})) {
      mergeWeightedAverage(weightedAverages, key, value, observedCases);
    }

    const budgetModeExpectation = budgetQuality.expectations?.budgetMode ?? {};
    aggregate.expectations.budgetMode.total += Number(budgetModeExpectation.total ?? 0);
    aggregate.expectations.budgetMode.matched += Number(budgetModeExpectation.matched ?? 0);
    for (const mismatch of budgetModeExpectation.mismatches ?? []) {
      aggregate.expectations.budgetMode.mismatches.push({
        suite: artifact.suite,
        ...mismatch,
      });
    }
  }

  aggregate.coverageRatio =
    aggregate.totalCases === 0 ? 0 : Number((aggregate.observedCases / aggregate.totalCases).toFixed(3));
  aggregate.averages = {
    ...aggregate.averages,
    ...finalizeWeightedAverages(weightedAverages),
  };
  return aggregate;
}

function summarizeProfileHealthArtifact(artifact) {
  const summary = artifact?.summary;
  if (!summary) {
    return {
      observed: false,
      status: "missing_artifact",
      path: artifact?.path ?? null,
      updatedAt: null,
      total: 0,
      ok: false,
      failures: ["missing_profile_health_artifact"],
    };
  }
  return {
    observed: true,
    status: summary.ok === true ? "pass" : "fail",
    path: artifact.path,
    updatedAt: artifact.updatedAt,
    total: summary.total ?? 0,
    ok: summary.ok === true,
    failures: summary.failures ?? [],
    averageScore: summary.averageScore ?? null,
    usableRatio: summary.usableRatio ?? null,
    weakRatio: summary.weakRatio ?? null,
    levelCounts: summary.levelCounts ?? {},
    sourceQualityCounts: summary.sourceQualityCounts ?? {},
    warningCounts: summary.warningCounts ?? {},
    weakCollections: summary.weakCollections ?? [],
  };
}

async function main() {
  const opts = parseArgs();
  const suites = await listSuites(opts.evalRoot);
  const coverage = createEmptyCoverage();
  const suiteReports = [];
  let totalCases = 0;

  for (const suite of suites) {
    const cases = await readJsonl(suite.file);
    const bucketCounts = {};
    const classifiedCounts = {};
    totalCases += cases.length;

    for (const testCase of cases) {
      const bucket = testCase.bucket ?? "default";
      bucketCounts[bucket] = (bucketCounts[bucket] ?? 0) + 1;
      const classification = classifyCase(testCase, suite.name);
      for (const label of classification.labels) {
        classifiedCounts[label] = (classifiedCounts[label] ?? 0) + 1;
        coverage[label].caseCount += 1;
        coverage[label].suites[suite.name] = (coverage[label].suites[suite.name] ?? 0) + 1;
        if (coverage[label].examples.length < 5) {
          coverage[label].examples.push({
            suite: suite.name,
            id: testCase.id,
            bucket,
            query: testCase.query,
            reasons: classification.reasons[label] ?? [],
          });
        }
      }
    }

    const artifact = opts.includeArtifacts ? await readArtifactSummary(opts.artifactsRoot, suite.name) : null;
    suiteReports.push({
      name: suite.name,
      file: suite.file,
      caseCount: cases.length,
      buckets: bucketCounts,
      classifiedCoverage: classifiedCounts,
      latestArtifact: artifact,
    });
  }

  const artifacts = suiteReports.map((suite) => ({
    suite: suite.name,
    ...(suite.latestArtifact ?? { path: null, updatedAt: null, summary: null }),
  }));
  const profileHealthArtifact = opts.includeArtifacts
    ? await readOptionalEvalArtifact(opts.artifactsRoot, "profile-health")
    : null;
  const readiness = scoreReadiness({ totalCases, coverage, artifacts });
  const routerQuality = summarizeRouterQualityArtifacts(artifacts);
  const budgetQuality = summarizeBudgetQualityArtifacts(artifacts);
  const profileHealth = summarizeProfileHealthArtifact(profileHealthArtifact);
  const report = {
    generatedAt: new Date().toISOString(),
    readiness,
    routerQuality,
    budgetQuality,
    profileHealth,
    requiredBuckets: REQUIRED_BUCKETS,
    coverage,
    suites: suiteReports,
    nextActions: [
      readiness.missingBuckets.length > 0
        ? `Add eval cases for missing buckets: ${readiness.missingBuckets.join(", ")}.`
        : "All required readiness buckets have at least one case.",
      totalCases < 100
        ? `Expand total eval cases from ${totalCases} to at least 100 before promoting adaptive runtime changes.`
        : "Eval case target reached.",
      readiness.failedArtifactSuites.length > 0
        ? "Fix failing latest eval artifacts or regenerate baseline after code/data changes."
        : "No failing latest eval artifacts detected.",
      routerQuality.observedSuites < suiteReports.length
        ? `Regenerate grounded eval artifacts to populate routerQuality summaries (${routerQuality.observedSuites}/${suiteReports.length} suites observed).`
        : "Router quality summaries are present for all grounded eval artifacts.",
      budgetQuality.observedSuites < suiteReports.length
        ? `Regenerate grounded eval artifacts to populate budgetQuality summaries (${budgetQuality.observedSuites}/${suiteReports.length} suites observed).`
        : "Adaptive RAG budget summaries are present for all grounded eval artifacts.",
      profileHealth.observed
        ? profileHealth.ok
          ? "Profile health eval is passing."
          : `Profile health eval is failing: ${profileHealth.failures.join(", ")}.`
        : "Run pnpm run eval:profile-health to populate profile health readiness.",
    ],
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`wrote ${opts.out}`);
  console.log(
    JSON.stringify(
      {
        status: readiness.status,
        totalCases: readiness.totalCases,
        coverageScore: readiness.coverageScore,
        missingBuckets: readiness.missingBuckets,
        suites: suiteReports.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
