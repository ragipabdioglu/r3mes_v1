import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, "..", "..");
const inputFile = resolve(repoRoot, argValue("--input", "artifacts/evals/eval-100/latest.json"));
const outFile = resolve(repoRoot, argValue("--out", "artifacts/evals/beta-reality/latest.json"));
const markdownFile = resolve(repoRoot, argValue("--markdown", "artifacts/evals/beta-reality/latest.md"));
const highLatencyMs = parseNumber(argValue("--high-latency-ms", process.env.R3MES_BETA_REALITY_HIGH_LATENCY_MS), 3000);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function severityForSignals(signals) {
  if (signals.includes("failed_eval")) return "critical";
  if (signals.includes("private_or_debug_risk")) return "critical";
  if (signals.includes("no_source") || signals.includes("wrong_or_uncertain_source")) return "high";
  if (signals.includes("low_confidence") || signals.includes("safety_rewrite")) return "medium";
  if (signals.includes("high_latency") || signals.includes("raw_context")) return "low";
  return "info";
}

function signalsForResult(result) {
  const signals = [];
  const isConversational = result.answerPathName === "conversational_intent";
  const isExpectedAccessBoundary =
    result.bucket === "private_leak_regression" &&
    result.safetyPass == null &&
    Number(result.sourceCount ?? 0) === 0 &&
    asArray(result.failures).length === 0;
  if (!result.ok || asArray(result.failures).length > 0) signals.push("failed_eval");
  if (!isConversational && !isExpectedAccessBoundary && (result.sourceCount === 0 || result.fallbackMode === "no_source")) {
    signals.push("no_source");
  }
  if (result.routeDecisionMode === "suggest" || result.fallbackMode === "source_suggestion") {
    signals.push("wrong_or_uncertain_source");
  }
  if (result.confidence === "low" || result.routeDecisionConfidence === "low" || result.compiledEvidenceConfidence === "low") {
    signals.push("low_confidence");
  }
  if (result.safetyPass === false || result.safetySeverity === "rewrite") signals.push("safety_rewrite");
  if (asArray(result.safetyRailIds).some((rail) => /PRIVATE|DEBUG|LEAK|METADATA/i.test(String(rail)))) {
    signals.push("private_or_debug_risk");
  }
  if (Number(result.latencyMs ?? 0) > highLatencyMs) signals.push("high_latency");
  if (result.budgetEvidenceContextMode === "raw" && Number(result.sourceCount ?? 0) > 0) signals.push("raw_context");
  if (Number(result.budgetEvidenceContradictionSignalCount ?? 0) > 0 || Number(result.compiledEvidenceContradictionCount ?? 0) > 0) {
    signals.push("contradiction");
  }
  if (Number(result.alignmentDroppedCandidateCount ?? 0) > 0 || result.alignmentFastFailed === true) {
    signals.push("alignment_drop");
  }
  if (result.shadowRuntime?.runtimeAffected === true || result.shadowRuntime?.wouldChangeTopCandidate === true) {
    signals.push("shadow_runtime_change");
  }
  return unique(signals);
}

function clusterKey(result, signals) {
  if (signals.includes("failed_eval")) return "failed_eval";
  if (signals.includes("private_or_debug_risk")) return "privacy_or_debug_boundary";
  if (signals.includes("no_source") && signals.includes("wrong_or_uncertain_source")) return "suggest_or_no_source";
  if (signals.includes("no_source")) return "no_source";
  if (signals.includes("wrong_or_uncertain_source")) return "source_suggestion";
  if (signals.includes("contradiction")) return "contradiction";
  if (signals.includes("low_confidence")) return "low_confidence";
  if (signals.includes("safety_rewrite")) return "safety_rewrite";
  if (signals.includes("high_latency")) return "high_latency";
  if (signals.includes("raw_context")) return "raw_context";
  if (signals.includes("alignment_drop")) return "alignment_drop";
  if (signals.includes("shadow_runtime_change")) return "shadow_runtime_change";
  return `healthy_${result.routePrimaryDomain ?? "unknown"}`;
}

function recommendationForCluster(key) {
  const map = {
    failed_eval: "Treat as blocking regression; inspect failures and add/adjust a focused regression case.",
    privacy_or_debug_boundary: "Block release until private/debug leakage is fixed and covered by security regression.",
    suggest_or_no_source: "Review collection coverage and source suggestion quality; consider missing-source feedback cases.",
    no_source: "Cluster queries by concept to decide whether ingestion/profile coverage is missing.",
    source_suggestion: "Review router/profile scoring and ensure suggested collection is actionable.",
    contradiction: "Keep answer cautious; add contradiction regression if this came from beta feedback.",
    low_confidence: "Inspect retrieval breadth, profile quality, and evidence compiler output.",
    safety_rewrite: "Check whether safety policy is correctly cautious or overly aggressive.",
    high_latency: "Inspect trace stage durations and adaptive budget selection.",
    raw_context: "Improve parser/profile structure or fact pruning for this document shape.",
    alignment_drop: "Check if drops are correct wrong-topic protection or over-strict query understanding.",
    shadow_runtime_change: "Review feedback adjustment proposal before promotion.",
  };
  return map[key] ?? "Healthy cluster; sample periodically for drift.";
}

function compactCase(result, signals) {
  return {
    id: result.id,
    bucket: result.bucket,
    ok: result.ok,
    signals,
    severity: severityForSignals(signals),
    routeDecisionMode: result.routeDecisionMode ?? null,
    routeDecisionConfidence: result.routeDecisionConfidence ?? null,
    routePrimaryDomain: result.routePrimaryDomain ?? null,
    confidence: result.confidence ?? null,
    sourceCount: result.sourceCount ?? null,
    safetyPass: result.safetyPass ?? null,
    safetySeverity: result.safetySeverity ?? null,
    safetyRailIds: asArray(result.safetyRailIds),
    fallbackMode: result.fallbackMode ?? null,
    budgetMode: result.budgetMode ?? null,
    evidenceContextMode: result.budgetEvidenceContextMode ?? null,
    latencyMs: result.latencyMs ?? null,
    failures: asArray(result.failures),
    usedCollectionIds: asArray(result.usedCollectionIds),
    suggestedCollectionIds: asArray(result.suggestedCollectionIds),
    rejectedCollectionIds: asArray(result.rejectedCollectionIds),
  };
}

function summarizeClusters(cases) {
  const clusters = new Map();
  for (const item of cases) {
    const signals = signalsForResult(item);
    const key = clusterKey(item, signals);
    const current = clusters.get(key) ?? {
      key,
      count: 0,
      severities: {},
      domains: {},
      buckets: {},
      signalCounts: {},
      recommendation: recommendationForCluster(key),
      examples: [],
    };
    const compact = compactCase(item, signals);
    current.count += 1;
    current.severities[compact.severity] = (current.severities[compact.severity] ?? 0) + 1;
    current.domains[compact.routePrimaryDomain ?? "missing"] = (current.domains[compact.routePrimaryDomain ?? "missing"] ?? 0) + 1;
    current.buckets[compact.bucket ?? "missing"] = (current.buckets[compact.bucket ?? "missing"] ?? 0) + 1;
    for (const signal of signals) current.signalCounts[signal] = (current.signalCounts[signal] ?? 0) + 1;
    if (current.examples.length < 8 && (signals.length > 0 || !item.ok)) current.examples.push(compact);
    clusters.set(key, current);
  }
  return [...clusters.values()].sort((a, b) => {
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const aSeverity = Math.max(...Object.keys(a.severities).map((key) => severityRank[key] ?? 0));
    const bSeverity = Math.max(...Object.keys(b.severities).map((key) => severityRank[key] ?? 0));
    return bSeverity - aSeverity || b.count - a.count || a.key.localeCompare(b.key);
  });
}

function buildRegressionCandidates(clusters) {
  const actionable = new Set([
    "failed_eval",
    "privacy_or_debug_boundary",
    "suggest_or_no_source",
    "no_source",
    "source_suggestion",
    "contradiction",
    "low_confidence",
    "raw_context",
    "alignment_drop",
  ]);
  return clusters
    .filter((cluster) => actionable.has(cluster.key))
    .flatMap((cluster) => cluster.examples.slice(0, 5).map((example) => ({
      id: `beta-${cluster.key}-${example.id}`,
      sourceEvalId: example.id,
      cluster: cluster.key,
      suggestedFeedbackKind:
        cluster.key === "source_suggestion" || cluster.key === "suggest_or_no_source" ? "WRONG_SOURCE"
          : cluster.key === "no_source" ? "MISSING_SOURCE"
            : cluster.key === "failed_eval" ? "BAD_ANSWER"
              : "REVIEW_ONLY",
      reason: cluster.recommendation,
      routePrimaryDomain: example.routePrimaryDomain,
      usedCollectionIds: example.usedCollectionIds,
      suggestedCollectionIds: example.suggestedCollectionIds,
      rejectedCollectionIds: example.rejectedCollectionIds,
    })));
}

function toMarkdown(report) {
  const lines = [
    "# Beta Reality Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Input: ${report.inputFile}`,
    "",
    "## Summary",
    "",
    `- Total cases: ${report.summary.total}`,
    `- Failed cases: ${report.summary.failed}`,
    `- Risk cases: ${report.summary.riskCases}`,
    `- High latency threshold: ${report.summary.highLatencyMs}ms`,
    `- Regression candidates: ${report.regressionCandidates.length}`,
    "",
    "## Clusters",
    "",
  ];
  for (const cluster of report.clusters) {
    lines.push(`### ${cluster.key}`);
    lines.push("");
    lines.push(`- Count: ${cluster.count}`);
    lines.push(`- Severities: ${JSON.stringify(cluster.severities)}`);
    lines.push(`- Domains: ${JSON.stringify(cluster.domains)}`);
    lines.push(`- Recommendation: ${cluster.recommendation}`);
    if (cluster.examples.length > 0) {
      lines.push("- Examples:");
      for (const example of cluster.examples.slice(0, 5)) {
        lines.push(`  - ${example.id} | bucket=${example.bucket} | signals=${example.signals.join(",") || "none"} | route=${example.routeDecisionMode ?? "-"} | sources=${example.sourceCount ?? "-"}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const parsed = JSON.parse(await readFile(inputFile, "utf8"));
  const results = asArray(parsed.results);
  const clusters = summarizeClusters(results);
  const riskCases = results.filter((result) => {
    const signals = signalsForResult(result);
    return !result.ok || signals.some((signal) => !["contradiction", "alignment_drop"].includes(signal));
  });
  const report = {
    generatedAt: new Date().toISOString(),
    inputFile,
    summary: {
      total: results.length,
      failed: results.filter((result) => !result.ok).length,
      riskCases: riskCases.length,
      highLatencyMs,
      clusterCount: clusters.length,
    },
    clusters,
    regressionCandidates: buildRegressionCandidates(clusters),
  };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(dirname(markdownFile), { recursive: true });
  await writeFile(markdownFile, toMarkdown(report), "utf8");
  console.log(JSON.stringify({
    outFile,
    markdownFile,
    total: report.summary.total,
    failed: report.summary.failed,
    riskCases: report.summary.riskCases,
    clusters: clusters.map((cluster) => ({ key: cluster.key, count: cluster.count, severities: cluster.severities })),
    regressionCandidates: report.regressionCandidates.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
