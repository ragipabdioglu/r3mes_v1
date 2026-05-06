import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const outFile = resolve(
  process.cwd(),
  "..",
  "..",
  argValue("--out", "artifacts/evals/feedback-regression/golden.jsonl"),
);
const wallet = process.env.R3MES_DEV_WALLET || "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const limit = Number(argValue("--limit", "100"));

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalize(value)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
}

function metadataObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readEvalQuery(metadata) {
  const query =
    typeof metadata.evalQuery === "string"
      ? metadata.evalQuery
      : typeof metadata.redactedQuery === "string"
        ? metadata.redactedQuery
        : typeof metadata.safeQuery === "string"
          ? metadata.safeQuery
          : "";
  const trimmed = query.trim();
  return trimmed.length >= 3 ? trimmed : null;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function expectedSeverity(kind) {
  return kind === "GOOD_SOURCE" || kind === "GOOD_ANSWER" ? ["pass", "warn"] : ["warn", "rewrite"];
}

function expectedIntent(metadata) {
  const value = metadata.expectedIntent ?? metadata.answerIntent;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value.filter((item) => typeof item === "string" && item.trim());
    return values.length > 0 ? values : null;
  }
  return null;
}

function caseFromFeedback(row) {
  const metadata = metadataObject(row.metadata);
  const query = readEvalQuery(metadata);
  if (!query) return null;

  const collectionIds = row.collectionId ? [row.collectionId] : readStringArray(metadata.collectionIds);
  const expectedCollectionIds = row.expectedCollectionId
    ? [row.expectedCollectionId]
    : readStringArray(metadata.expectedCollectionIds);
  const rejectedCollectionIds = row.collectionId ? [row.collectionId] : readStringArray(metadata.rejectedCollectionIds);
  const idParts = [
    "feedback",
    row.kind,
    row.queryHash ?? slug(query),
    row.collectionId ?? "auto",
    row.expectedCollectionId ?? "none",
  ];

  const base = {
    id: slug(idParts.join("-")),
    bucket: `feedback_${normalize(row.kind).replace(/-/g, "_")}`,
    query,
    ...(collectionIds.length > 0 ? { collectionIds } : {}),
    includePublic: metadata.includePublic === true,
    expectedRetrievalMode: "true_hybrid",
    ...(expectedIntent(metadata) ? { expectedIntent: expectedIntent(metadata) } : {}),
    mustPassSafety: false,
    expectedSafetySeverity: expectedSeverity(row.kind),
    mustNotHaveLowLanguageQuality: true,
    maxLatencyMs: Number(metadata.maxLatencyMs ?? 30000),
  };

  if (row.kind === "WRONG_SOURCE") {
    return {
      ...base,
      ...(expectedCollectionIds.length > 0 ? { expectedSuggestedCollectionIds: expectedCollectionIds } : {}),
      ...(rejectedCollectionIds.length > 0 ? { expectedRejectedCollectionIds: rejectedCollectionIds } : {}),
      expectedRouteDecisionMode: "suggest",
      expectedConfidence: ["low"],
      expectedFallbackMode: "source_suggestion",
      expectedSafetyRailIds: ["SUGGEST_MODE_NO_GROUNDED_SOURCES"],
      maxSources: 0,
      mustHaveSources: false,
      minEvidenceFacts: 0,
    };
  }

  if (row.kind === "MISSING_SOURCE") {
    return {
      ...base,
      ...(expectedCollectionIds.length > 0 ? { expectedSuggestedCollectionIds: expectedCollectionIds } : {}),
      expectedRouteDecisionMode: expectedCollectionIds.length > 0 ? "suggest" : undefined,
      expectedConfidence: ["low"],
      expectedFallbackMode: "source_suggestion",
      expectedSafetyRailIds: ["SUGGEST_MODE_NO_GROUNDED_SOURCES"],
      maxSources: 0,
      mustHaveSources: false,
      minEvidenceFacts: 0,
    };
  }

  if (row.kind === "BAD_ANSWER") {
    return {
      ...base,
      expectedSafetySeverity: ["warn", "rewrite"],
      forbiddenSafetyRailIds: ["LOW_LANGUAGE_QUALITY"],
      mustHaveSources: collectionIds.length > 0,
      minEvidenceFacts: collectionIds.length > 0 ? 1 : 0,
      maxSources: Number(metadata.maxSources ?? 3),
    };
  }

  return {
    ...base,
    expectedConfidence: ["medium", "high"],
    expectedRouteDecisionMode: collectionIds.length > 0 ? "strict" : undefined,
    forbiddenSafetyRailIds: ["MISSING_SOURCES", "NO_USABLE_FACTS", "SOURCE_METADATA_MISMATCH", "LOW_LANGUAGE_QUALITY"],
    ...(collectionIds.length > 0 ? { expectedUsedCollectionIds: collectionIds } : {}),
    mustHaveSources: collectionIds.length > 0,
    minEvidenceFacts: collectionIds.length > 0 ? 1 : 0,
    maxSources: Number(metadata.maxSources ?? 3),
  };
}

async function main() {
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!user) {
    throw new Error(`No dev user found for wallet ${wallet}`);
  }
  const rows = await prisma.knowledgeFeedback.findMany({
    where: {
      userId: user.id,
    },
    orderBy: { createdAt: "desc" },
    take: Number.isFinite(limit) && limit > 0 ? limit : 100,
  });

  const cases = [];
  const seen = new Set();
  const skippedWithoutQuery = [];
  for (const row of rows) {
    const testCase = caseFromFeedback(row);
    if (!testCase) {
      skippedWithoutQuery.push({
        id: row.id,
        kind: row.kind,
        queryHash: row.queryHash,
        collectionId: row.collectionId,
        expectedCollectionId: row.expectedCollectionId,
      });
      continue;
    }
    if (seen.has(testCase.id)) continue;
    seen.add(testCase.id);
    cases.push(testCase);
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, cases.length > 0 ? `${cases.map((testCase) => JSON.stringify(testCase)).join("\n")}\n` : "", "utf8");
  console.log(JSON.stringify({
    outFile,
    feedbackRows: rows.length,
    generatedCases: cases.length,
    skippedWithoutSafeQuery: skippedWithoutQuery.length,
    skippedPreview: skippedWithoutQuery.slice(0, 10),
    note: "Only feedback rows with metadata.evalQuery/redactedQuery/safeQuery become eval cases.",
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
