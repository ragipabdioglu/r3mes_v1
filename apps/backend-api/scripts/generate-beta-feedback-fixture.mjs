import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, "..", "..");
const reportFile = resolve(repoRoot, argValue("--report", "artifacts/evals/beta-reality/latest.json"));
const goldenFile = resolve(repoRoot, argValue("--golden", "artifacts/evals/eval-100/golden.jsonl"));
const outFile = resolve(repoRoot, argValue("--out", "artifacts/evals/beta-reality/feedback-fixture.jsonl"));
const limit = parseNumber(argValue("--limit", process.env.R3MES_BETA_FEEDBACK_FIXTURE_LIMIT), 30);

function parseJsonl(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function first(values) {
  return asArray(values)[0] ?? null;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function stableId(value) {
  return String(value ?? "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function rowKind(candidate) {
  if (candidate.suggestedFeedbackKind === "WRONG_SOURCE") return "WRONG_SOURCE";
  if (candidate.suggestedFeedbackKind === "MISSING_SOURCE") return "MISSING_SOURCE";
  if (candidate.suggestedFeedbackKind === "BAD_ANSWER") return "BAD_ANSWER";
  return null;
}

function routeConfidenceForKind(kind, candidate) {
  if (kind === "GOOD_SOURCE") return "high";
  if (kind === "BAD_ANSWER") return candidate.routeDecisionConfidence ?? "medium";
  return "low";
}

function fixtureFromCandidate(candidate, goldenById) {
  const kind = rowKind(candidate);
  if (!kind) return null;
  const golden = goldenById.get(candidate.sourceEvalId);
  if (!golden?.query || typeof golden.query !== "string") return null;

  const usedCollectionId = first(candidate.rejectedCollectionIds) ?? first(candidate.usedCollectionIds);
  const expectedCollectionId = first(candidate.suggestedCollectionIds);
  if (kind === "WRONG_SOURCE" && (!usedCollectionId || !expectedCollectionId)) return null;
  if (kind === "MISSING_SOURCE" && !expectedCollectionId) return null;

  const metadata = {
    redactedQuery: golden.query,
    evalQuerySource: "beta_reality_v1",
    betaRealityCluster: candidate.cluster,
    betaRealitySourceEvalId: candidate.sourceEvalId,
    includePublic: golden.includePublic === true,
    routeDecisionMode: kind === "WRONG_SOURCE" || kind === "MISSING_SOURCE" ? "suggest" : (golden.expectedRouteDecisionMode ?? undefined),
    routeDecisionConfidence: routeConfidenceForKind(kind, candidate),
    ...(candidate.usedCollectionIds?.length ? { usedCollectionIds: candidate.usedCollectionIds } : {}),
    ...(candidate.suggestedCollectionIds?.length ? { suggestedCollectionIds: candidate.suggestedCollectionIds } : {}),
    ...(candidate.rejectedCollectionIds?.length ? { rejectedCollectionIds: candidate.rejectedCollectionIds } : {}),
    ...(golden.expectedIntent ? { answerIntent: golden.expectedIntent } : {}),
    ...(golden.maxSources ? { maxSources: golden.maxSources } : {}),
  };

  return {
    id: stableId(`beta_${kind}_${candidate.cluster}_${candidate.sourceEvalId}`),
    kind,
    queryHash: `beta${hash(`${candidate.cluster}:${candidate.sourceEvalId}:${golden.query}`)}`,
    collectionId: kind === "MISSING_SOURCE" ? null : (usedCollectionId ?? first(golden.collectionIds)),
    expectedCollectionId: kind === "BAD_ANSWER" ? null : expectedCollectionId,
    metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)),
  };
}

async function main() {
  const report = JSON.parse(await readFile(reportFile, "utf8"));
  const goldenRows = parseJsonl(await readFile(goldenFile, "utf8"));
  const goldenById = new Map(goldenRows.map((row) => [row.id, row]));
  const candidates = Array.isArray(report.regressionCandidates) ? report.regressionCandidates : [];
  const rows = [];
  const seen = new Set();
  const skipped = [];
  for (const candidate of candidates) {
    if (rows.length >= limit) break;
    const row = fixtureFromCandidate(candidate, goldenById);
    if (!row) {
      skipped.push({
        sourceEvalId: candidate.sourceEvalId,
        cluster: candidate.cluster,
        suggestedFeedbackKind: candidate.suggestedFeedbackKind,
      });
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "", "utf8");
  console.log(JSON.stringify({
    reportFile,
    goldenFile,
    outFile,
    candidateCount: candidates.length,
    generatedRows: rows.length,
    skippedRows: skipped.length,
    skippedPreview: skipped.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
