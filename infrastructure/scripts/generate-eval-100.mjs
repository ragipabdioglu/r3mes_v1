import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultEvalRoot = resolve(root, "infrastructure/evals");
const defaultOut = resolve(root, "artifacts/evals/eval-100/golden.jsonl");
const defaultManifestOut = resolve(root, "artifacts/evals/eval-100/manifest.json");

const REQUIRED_BUCKETS = [
  "right_source_precision",
  "wrong_source",
  "same_domain_wrong_topic",
  "no_source",
  "private_leak",
  "dirty_ocr",
  "typo_normalization",
  "multi_domain",
  "contradiction",
  "latency",
  "shadow_runtime",
  "suggestion",
  "router_quality",
  "adaptive_budget",
  "context_pruning",
  "small_talk_no_rag",
];

const SUITE_PRIORITY = [
  "retrieval-quality",
  "context-pruning",
  "real-world-stress",
  "realistic-rag",
  "adaptive-rag",
  "rag-quality-gates",
  "collection-suggestion",
  "conversational-intent",
  "grounded-response",
  "multi-domain-basic",
  "domain-regression",
  "legal-divorce-basic",
  "legal-basic",
  "education-basic",
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs() {
  const target = parseNumber(argValue("--target", process.env.R3MES_EVAL_100_TARGET_CASES), 100);
  return {
    target,
    minPerBucket: parseNumber(argValue("--min-per-bucket", process.env.R3MES_EVAL_100_MIN_PER_BUCKET), 3),
    evalRoot: resolve(root, argValue("--eval-root", defaultEvalRoot)),
    out: resolve(root, argValue("--out", process.env.R3MES_EVAL_100_OUT || defaultOut)),
    manifestOut: resolve(
      root,
      argValue("--manifest-out", process.env.R3MES_EVAL_100_MANIFEST_OUT || defaultManifestOut),
    ),
  };
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
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

function hasChatShape(testCase) {
  return typeof testCase?.id === "string" && typeof testCase?.query === "string";
}

function classifyCase(testCase, suite) {
  const labels = new Set();
  const id = normalize(testCase.id);
  const bucket = normalize(testCase.bucket);
  const query = normalize(testCase.query);
  const suiteName = normalize(suite);
  const expectedRails = asArray(testCase.expectedSafetyRailIds).map(normalize);
  const forbiddenRails = asArray(testCase.forbiddenSafetyRailIds).map(normalize);
  const expectedDomain = asArray(testCase.expectedDomain).map(normalize);
  const combined = `${id} ${bucket} ${query} ${suiteName}`;

  function mark(label, condition) {
    if (condition) labels.add(label);
  }

  mark(
    "right_source_precision",
    testCase.mustHaveSources === true ||
      Number(testCase.minEvidenceFacts ?? 0) > 0 ||
      asArray(testCase.expectedUsedCollectionIds).length > 0,
  );
  mark(
    "wrong_source",
    includesAny(combined, ["wrong", "mismatch", "adversarial", "source_suggestion"]) ||
      expectedRails.includes("query_source_mismatch") ||
      Array.isArray(testCase.expectedRejectedCollectionIds),
  );
  mark(
    "same_domain_wrong_topic",
    testCase.expectedAlignmentFastFailed === true ||
      expectedRails.includes("query_source_mismatch") ||
      includesAny(combined, ["same_domain_wrong_topic", "wrong_topic", "wrong-topic", "headache-rejects-gyn"]),
  );
  mark(
    "no_source",
    testCase.mustHaveSources === false ||
      Number(testCase.maxSources ?? Number.NaN) === 0 ||
      expectedRails.includes("no_usable_facts") ||
      expectedRails.includes("missing_sources") ||
      expectedRails.includes("suggest_mode_no_grounded_sources") ||
      includesAny(testCase.expectedFallbackMode, ["no_source", "source_suggestion"]),
  );
  mark(
    "private_leak",
    includesAny(combined, ["private", "leak", "visibility"]) ||
      Number(testCase.expectedHttpStatus ?? 0) === 403 ||
      expectedRails.includes("private_source_scope_mismatch") ||
      forbiddenRails.includes("private_source_scope_mismatch"),
  );
  mark("dirty_ocr", includesAny(combined, ["dirty", "ocr", "noisy", "mojibake", "kirli", "bozuk"]));
  mark(
    "typo_normalization",
    includesAny(combined, [
      "typo",
      "ascii",
      "informal",
      "inflected",
      "plural",
      "agriyo",
      "kasigim",
      "kasiklarim",
      "maliyim",
      "bozuk turkce",
    ]),
  );
  mark(
    "multi_domain",
    includesAny(combined, ["multi-domain", "multi_domain", "domain-regression"]) || expectedDomain.length > 1,
  );
  mark("contradiction", includesAny(combined, ["contradiction", "contradictory", "celis", "çeliş"]));
  mark("contradiction", testCase.minEvidenceContradictionSignalCount !== undefined);
  mark("latency", Number.isFinite(Number(testCase.maxLatencyMs)));
  mark(
    "shadow_runtime",
    [
      testCase.expectedShadowRuntimeAffected,
      testCase.expectedShadowWouldChangeTopCandidate,
      testCase.minShadowPromotedCandidates,
      testCase.expectedShadowImpactCollectionIds,
    ].some((value) => value !== undefined),
  );
  mark(
    "suggestion",
    asArray(testCase.expectedSuggestedCollectionIds).length > 0 ||
      includesAny(testCase.expectedFallbackMode, ["source_suggestion"]) ||
      includesAny(combined, ["suggestion", "suggest"]),
  );
  mark(
    "router_quality",
    testCase.expectedRouteDecisionMode !== undefined ||
      testCase.expectedRoutePrimaryDomain !== undefined ||
      testCase.expectedRouteDecisionConfidence !== undefined,
  );
  mark(
    "adaptive_budget",
    testCase.expectedBudgetMode !== undefined ||
      testCase.expectedContextBudgetMode !== undefined ||
      includesAny(combined, ["budget", "adaptive"]),
  );
  mark(
    "context_pruning",
    testCase.expectedEvidenceContextMode !== undefined ||
      testCase.maxEvidencePrunedInputChars !== undefined ||
      testCase.maxEvidenceInputCompressionRatio !== undefined ||
      testCase.expectedEvidencePrunedNotGreaterThanRaw !== undefined ||
      testCase.minEvidenceFactDroppedCount !== undefined ||
      testCase.maxEvidenceFactSelectedCount !== undefined ||
      includesAny(combined, ["context-pruning", "context_pruning", "pruning", "pruned evidence"]),
  );
  mark(
    "small_talk_no_rag",
    testCase.expectedAnswerPathName === "conversational_intent" ||
      includesAny(combined, ["small_talk", "small-talk", "conversational", "merhaba", "selam", "tesekkur"]),
  );

  return [...labels].sort();
}

function sanitizeGeneratedCase(testCase) {
  const copy = { ...testCase };
  const expectedDomain = typeof copy.expectedDomain === "string" ? copy.expectedDomain : "";
  const expectedRoutePrimaryDomain =
    typeof copy.expectedRoutePrimaryDomain === "string" ? copy.expectedRoutePrimaryDomain : "";
  const noGroundedSourceExpected =
    copy.mustHaveSources === false ||
    Number(copy.maxSources ?? Number.NaN) === 0 ||
    asArray(copy.expectedSafetyRailIds).includes("QUERY_SOURCE_MISMATCH");

  if (noGroundedSourceExpected && expectedDomain) {
    delete copy.expectedDomain;
    copy._eval100Sanitized = [
      ...(Array.isArray(copy._eval100Sanitized) ? copy._eval100Sanitized : []),
      expectedRoutePrimaryDomain && expectedDomain !== expectedRoutePrimaryDomain
        ? "removed_conflicting_legacy_expected_domain_for_no_source_route"
        : "removed_legacy_expected_domain_for_no_source_case",
    ];
  }

  return copy;
}

function suiteRank(suite) {
  const index = SUITE_PRIORITY.indexOf(suite);
  return index === -1 ? SUITE_PRIORITY.length : index;
}

function caseScore(item) {
  const labels = new Set(item.labels);
  let score = Math.max(1, labels.size) * 20;
  if (labels.has("wrong_source")) score += 25;
  if (labels.has("same_domain_wrong_topic")) score += 25;
  if (labels.has("private_leak")) score += 25;
  if (labels.has("dirty_ocr")) score += 15;
  if (labels.has("typo_normalization")) score += 15;
  if (labels.has("contradiction")) score += 15;
  if (labels.has("shadow_runtime")) score += 12;
  if (labels.has("latency")) score += 8;
  score -= suiteRank(item.suite) * 2;
  return score;
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
    if (!entry.isDirectory() || entry.name === "eval-100") continue;
    const file = join(evalRoot, entry.name, "golden.jsonl");
    try {
      await stat(file);
      suites.push({ name: entry.name, file });
    } catch {
      // Non-chat eval directories can have their own runner and no golden file.
    }
  }
  return suites.sort((a, b) => suiteRank(a.name) - suiteRank(b.name) || a.name.localeCompare(b.name));
}

function addSelected(selected, selectedIds, item, reason) {
  if (selectedIds.has(item.testCase.id)) return false;
  selected.push({ ...item, selectionReason: reason });
  selectedIds.add(item.testCase.id);
  return true;
}

function countLabels(selected) {
  const counts = Object.fromEntries(REQUIRED_BUCKETS.map((bucket) => [bucket, 0]));
  for (const item of selected) {
    for (const label of item.labels) {
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }
  return counts;
}

function pickCases(candidates, target, minPerBucket) {
  const selected = [];
  const selectedIds = new Set();
  const sorted = [...candidates].sort((a, b) => caseScore(b) - caseScore(a) || a.testCase.id.localeCompare(b.testCase.id));

  for (const bucket of REQUIRED_BUCKETS) {
    const bucketCandidates = sorted.filter((item) => item.labels.includes(bucket));
    let current = 0;
    for (const item of bucketCandidates) {
      if (current >= minPerBucket) break;
      if (addSelected(selected, selectedIds, item, `bucket:${bucket}`)) current += 1;
    }
  }

  for (const item of sorted) {
    if (selected.length >= target) break;
    addSelected(selected, selectedIds, item, "diversity_fill");
  }

  return selected.slice(0, target);
}

function summarizeSelection(selected, allCandidates, target, minPerBucket) {
  const labelCounts = countLabels(selected);
  const availableLabelCounts = countLabels(allCandidates);
  const suiteCounts = {};
  const sourceFiles = {};
  for (const item of selected) {
    suiteCounts[item.suite] = (suiteCounts[item.suite] ?? 0) + 1;
    sourceFiles[item.sourceFile] = (sourceFiles[item.sourceFile] ?? 0) + 1;
  }
  const missingBuckets = REQUIRED_BUCKETS.filter((bucket) => (labelCounts[bucket] ?? 0) === 0);
  const underTargetBuckets = REQUIRED_BUCKETS.filter((bucket) => {
    const selectedCount = labelCounts[bucket] ?? 0;
    const availableCount = availableLabelCounts[bucket] ?? 0;
    return selectedCount > 0 && selectedCount < Math.min(minPerBucket, availableCount);
  });
  const thinBuckets = REQUIRED_BUCKETS.filter((bucket) => {
    const selectedCount = labelCounts[bucket] ?? 0;
    const availableCount = availableLabelCounts[bucket] ?? 0;
    return selectedCount > 0 && selectedCount < minPerBucket && availableCount < minPerBucket;
  });
  return {
    target,
    selectedCases: selected.length,
    availableChatCases: allCandidates.length,
    requiredBuckets: REQUIRED_BUCKETS,
    labelCounts,
    availableLabelCounts,
    missingBuckets,
    underTargetBuckets,
    thinBuckets,
    suiteCounts: Object.fromEntries(Object.entries(suiteCounts).sort(([a], [b]) => a.localeCompare(b))),
    sourceFiles: Object.fromEntries(Object.entries(sourceFiles).sort(([a], [b]) => a.localeCompare(b))),
    selected: selected.map((item) => ({
      id: item.testCase.id,
      suite: item.suite,
      labels: item.labels,
      selectionReason: item.selectionReason,
      sanitized: item.testCase._eval100Sanitized ?? [],
    })),
  };
}

async function main() {
  const opts = parseArgs();
  const suites = await listSuites(opts.evalRoot);
  const byId = new Map();

  for (const suite of suites) {
    const cases = await readJsonl(suite.file);
    for (const testCase of cases) {
      if (!hasChatShape(testCase)) continue;
      const labels = classifyCase(testCase, suite.name);
      const item = {
        suite: suite.name,
        sourceFile: relative(root, suite.file).replaceAll("\\", "/"),
        labels,
        testCase: sanitizeGeneratedCase(testCase),
        originalTestCase: testCase,
      };
      const existing = byId.get(testCase.id);
      if (!existing || caseScore(item) > caseScore(existing)) {
        byId.set(testCase.id, item);
      }
    }
  }

  const candidates = [...byId.values()];
  const selected = pickCases(candidates, Math.min(opts.target, candidates.length), opts.minPerBucket);
  const manifest = {
    generatedAt: new Date().toISOString(),
    evalRoot: relative(root, opts.evalRoot).replaceAll("\\", "/"),
    out: relative(root, opts.out).replaceAll("\\", "/"),
    minPerBucket: opts.minPerBucket,
    ...summarizeSelection(selected, candidates, opts.target, opts.minPerBucket),
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${selected.map((item) => JSON.stringify(item.testCase)).join("\n")}\n`, "utf8");
  await mkdir(dirname(opts.manifestOut), { recursive: true });
  await writeFile(opts.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`wrote ${relative(root, opts.out).replaceAll("\\", "/")}`);
  console.log(`wrote ${relative(root, opts.manifestOut).replaceAll("\\", "/")}`);
  console.log(
    JSON.stringify(
      {
        selectedCases: manifest.selectedCases,
        availableChatCases: manifest.availableChatCases,
        missingBuckets: manifest.missingBuckets,
        thinBuckets: manifest.thinBuckets,
        labelCounts: manifest.labelCounts,
      },
      null,
      2,
    ),
  );

  if (manifest.selectedCases < opts.target) {
    process.exitCode = 1;
    console.error(`not enough chat eval cases for target ${opts.target}; selected ${manifest.selectedCases}`);
  }
  if (manifest.missingBuckets.length > 0) {
    process.exitCode = 1;
    console.error(`missing eval buckets: ${manifest.missingBuckets.join(", ")}`);
  }
  if (manifest.underTargetBuckets.length > 0) {
    process.exitCode = 1;
    console.error(`under-target eval buckets: ${manifest.underTargetBuckets.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
