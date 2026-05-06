import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { embedTextsForQdrantWithDiagnostics, getQdrantVectorSize } from "../dist/lib/qdrantEmbedding.js";
import { buildQdrantPayloadMetadata, upsertQdrantKnowledgePoints } from "../dist/lib/qdrantStore.js";
import { parseKnowledgeCard } from "../dist/lib/knowledgeCard.js";
import { routeQuery } from "../dist/lib/queryRouter.js";

const prisma = new PrismaClient();
const batchSize = Number.parseInt(process.env.R3MES_QDRANT_REINDEX_BATCH_SIZE || "32", 10);
const checkpointPath = resolve(process.env.R3MES_QDRANT_REINDEX_CHECKPOINT || "../../artifacts/qdrant-reindex-checkpoint.json");
const requestedEmbeddingProvider = (process.env.R3MES_EMBEDDING_PROVIDER ?? "deterministic").trim().toLowerCase();
const requireRealEmbeddings = process.env.R3MES_QDRANT_REINDEX_REQUIRE_REAL_EMBEDDINGS
  ? process.env.R3MES_QDRANT_REINDEX_REQUIRE_REAL_EMBEDDINGS === "1"
  : requestedEmbeddingProvider === "ai-engine" || requestedEmbeddingProvider === "bge-m3";
const args = new Set(process.argv.slice(2));
const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const explicitAfter = argValue("--after");
const maxBatches = Number.parseInt(argValue("--max-batches") || "0", 10);
const resetCheckpoint = args.has("--reset-checkpoint");
const noCheckpoint = args.has("--no-checkpoint");
const statusOnly = args.has("--status");
const verifyCount = args.has("--verify-count") || statusOnly;
const CHECKPOINT_SCHEMA_VERSION = 2;

function getQdrantBaseUrl() {
  return (process.env.R3MES_QDRANT_URL ?? "http://127.0.0.1:6333").replace(/\/$/, "");
}

function getQdrantCollectionName() {
  return process.env.R3MES_QDRANT_COLLECTION ?? "r3mes_knowledge";
}

function readMetadata(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

function resolveVectorSize(collectionInfo) {
  const vectors = collectionInfo?.result?.config?.params?.vectors;
  if (!vectors || typeof vectors !== "object") return null;
  if (typeof vectors.size === "number") return vectors.size;
  const firstVector = Object.values(vectors)[0];
  return firstVector && typeof firstVector === "object" && typeof firstVector.size === "number"
    ? firstVector.size
    : null;
}

async function assertQdrantVectorSizeIfCollectionExists() {
  const parsed = await readQdrantCollectionInfo();
  if (!parsed) return;
  const currentSize = resolveVectorSize(parsed);
  const expectedSize = getQdrantVectorSize();
  if (currentSize !== null && currentSize !== expectedSize) {
    throw new Error(
      `Qdrant vector size mismatch for ${getQdrantCollectionName()}: current=${currentSize}, expected=${expectedSize}. ` +
        "Use a fresh collection name or recreate the collection before reindexing.",
    );
  }
}

async function readQdrantCollectionInfo() {
  const collection = encodeURIComponent(getQdrantCollectionName());
  const response = await fetch(`${getQdrantBaseUrl()}/collections/${collection}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Qdrant collection check failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function qdrantPointCount() {
  const info = await readQdrantCollectionInfo();
  const result = info?.result;
  if (!result || typeof result !== "object") return null;
  if (typeof result.points_count === "number") return result.points_count;
  if (typeof result.vectors_count === "number") return result.vectors_count;
  return null;
}

async function qdrantFilteredPointCount(filter) {
  const collection = encodeURIComponent(getQdrantCollectionName());
  const response = await fetch(`${getQdrantBaseUrl()}/collections/${collection}/points/count`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ exact: true, filter }),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Qdrant filtered count failed: ${response.status} ${await response.text()}`);
  }
  const parsed = await response.json();
  return typeof parsed?.result?.count === "number" ? parsed.result.count : null;
}

async function embeddingProviderPointCount() {
  return qdrantFilteredPointCount({
    must: [
      { key: "embeddingProvider", match: { value: requestedEmbeddingProvider } },
      { key: "embeddingVectorSize", match: { value: getQdrantVectorSize() } },
    ],
  });
}

async function deterministicFallbackPointCount() {
  return qdrantFilteredPointCount({
    must: [
      { key: "embeddingProvider", match: { value: "deterministic" } },
    ],
  });
}

async function chunkStats(afterId = null) {
  const [totalChunks, remainingChunks] = await Promise.all([
    prisma.knowledgeChunk.count(),
    afterId
      ? prisma.knowledgeChunk.count({
          where: { id: { gt: afterId } },
        })
      : prisma.knowledgeChunk.count(),
  ]);
  return {
    totalChunks,
    remainingChunks,
    completedChunks: Math.max(0, totalChunks - remainingChunks),
  };
}

function readCheckpoint() {
  if (noCheckpoint || resetCheckpoint || !existsSync(checkpointPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(checkpointPath, "utf8"));
    if (parsed?.collection !== getQdrantCollectionName()) return null;
    if (parsed?.vectorSize !== getQdrantVectorSize()) return null;
    if (typeof parsed?.lastChunkId !== "string" || !parsed.lastChunkId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCheckpoint(payload) {
  if (noCheckpoint) return;
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(checkpointPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function clearCheckpoint() {
  if (noCheckpoint || !existsSync(checkpointPath)) return;
  unlinkSync(checkpointPath);
}

async function printStatus(startAfter) {
  const stats = await chunkStats(startAfter ?? null);
  const pointCount = verifyCount ? await qdrantPointCount() : null;
  const providerPointCount = verifyCount ? await embeddingProviderPointCount() : null;
  const fallbackPointCount = verifyCount ? await deterministicFallbackPointCount() : null;
  const indexComplete = pointCount == null ? null : pointCount >= stats.totalChunks;
  const providerMatches =
    providerPointCount == null ? null : providerPointCount >= stats.totalChunks && (fallbackPointCount ?? 0) === 0;
  const status = {
    phase: "qdrant_reindex_status",
    ok: providerMatches ?? indexComplete ?? true,
    checkpointPath: noCheckpoint ? null : checkpointPath,
    resumeAfter: startAfter ?? null,
    collection: getQdrantCollectionName(),
    vectorSize: getQdrantVectorSize(),
    requestedEmbeddingProvider,
    requireRealEmbeddings,
    totalChunks: stats.totalChunks,
    completedChunks: indexComplete ? stats.totalChunks : stats.completedChunks,
    remainingChunks: indexComplete ? 0 : stats.remainingChunks,
    qdrantPointCount: pointCount,
    countMatches: indexComplete,
    embeddingProviderPointCount: providerPointCount,
    deterministicFallbackPointCount: fallbackPointCount,
    providerMatches,
  };
  console.log(JSON.stringify(status, null, 2));
}

async function main() {
  if (resetCheckpoint) clearCheckpoint();
  await assertQdrantVectorSizeIfCollectionExists();
  const checkpoint = readCheckpoint();
  const startAfter = explicitAfter ?? checkpoint?.lastChunkId;
  if (statusOnly) {
    await printStatus(startAfter);
    return;
  }
  const statsAtStart = await chunkStats(startAfter ?? null);
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({
    phase: "qdrant_reindex_start",
    batchSize,
    checkpointPath: noCheckpoint ? null : checkpointPath,
    resumeAfter: startAfter ?? null,
    maxBatches: Number.isFinite(maxBatches) && maxBatches > 0 ? maxBatches : null,
    requestedEmbeddingProvider,
    requireRealEmbeddings,
    vectorSize: getQdrantVectorSize(),
    collection: getQdrantCollectionName(),
    totalChunks: statsAtStart.totalChunks,
    remainingChunks: statsAtStart.remainingChunks,
    qdrantPointCount: verifyCount ? await qdrantPointCount() : null,
  }));

  let cursor = startAfter;
  let total = 0;
  let batches = 0;

  for (;;) {
    const chunks = await prisma.knowledgeChunk.findMany({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      include: {
        document: {
          include: {
            collection: {
              include: {
                owner: { select: { walletAddress: true } },
              },
            },
          },
        },
      },
    });

    if (chunks.length === 0) break;

    const { vectors, diagnostics } = await embedTextsForQdrantWithDiagnostics(chunks.map((chunk) => chunk.content));
    if (requireRealEmbeddings && diagnostics.fallbackUsed) {
      throw new Error(
        `Qdrant reindex aborted: embedding provider fell back to ${diagnostics.actualProvider}. ` +
          `requested=${diagnostics.requestedProvider} error=${diagnostics.error ?? "unknown"}`,
      );
    }
    const points = chunks.map((chunk, index) => {
      const card = parseKnowledgeCard(chunk.content);
      const metadata = readMetadata(chunk.autoMetadata) ?? readMetadata(chunk.document.autoMetadata);
      const route = routeQuery(`${chunk.document.title}\n${card.topic}\n${card.tags.join(" ")}\n${chunk.content.slice(0, 1000)}`);
      const domain = typeof metadata?.domain === "string" ? metadata.domain : route.domain;
      const subtopics = Array.isArray(metadata?.subtopics) ? metadata.subtopics : route.subtopics;
      const tags = Array.isArray(metadata?.keywords) && metadata.keywords.length > 0
        ? metadata.keywords
        : card.tags.length > 0
          ? card.tags
          : [route.domain, ...route.subtopics];
      const payloadMetadata = buildQdrantPayloadMetadata({
        collectionMetadata: chunk.document.collection.autoMetadata,
        documentMetadata: chunk.document.autoMetadata,
        chunkMetadata: chunk.autoMetadata,
        fallbackDomain: domain,
        fallbackSubtopics: subtopics,
        fallbackTags: tags,
      });
      return {
        chunkId: chunk.id,
        vector: vectors[index],
        payload: {
          ownerWallet: chunk.document.collection.owner.walletAddress,
          visibility: chunk.document.collection.visibility,
          collectionId: chunk.document.collectionId,
          documentId: chunk.documentId,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          title: chunk.document.title,
          ...payloadMetadata,
          embeddingProvider: diagnostics.actualProvider,
          embeddingModel: diagnostics.model ?? "",
          embeddingFallbackUsed: diagnostics.fallbackUsed,
          embeddingVectorSize: diagnostics.dimension,
          indexedAt: new Date().toISOString(),
          content: chunk.content,
          createdAt: chunk.createdAt.toISOString(),
        },
      };
    });

    await upsertQdrantKnowledgePoints(points);
    total += points.length;
    batches += 1;
    cursor = chunks.at(-1)?.id;
    const progress = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      phase: "qdrant_reindex_progress",
      indexedThisRun: total,
      batchesThisRun: batches,
      batchSize: points.length,
      lastChunkId: cursor,
      collection: getQdrantCollectionName(),
      vectorSize: getQdrantVectorSize(),
      totalChunks: statsAtStart.totalChunks,
      completedChunksApprox: Math.min(statsAtStart.totalChunks, statsAtStart.completedChunks + total),
      remainingChunksApprox: Math.max(0, statsAtStart.remainingChunks - total),
      embedding: diagnostics,
      startedAt,
      updatedAt: new Date().toISOString(),
    };
    writeCheckpoint(progress);
    console.log(JSON.stringify(progress));

    if (Number.isFinite(maxBatches) && maxBatches > 0 && batches >= maxBatches) {
      console.log(JSON.stringify({
        ok: true,
        partial: true,
        indexedThisRun: total,
        batchesThisRun: batches,
        lastChunkId: cursor,
        checkpointPath: noCheckpoint ? null : checkpointPath,
        resumeCommand: `pnpm --filter @r3mes/backend-api run qdrant:reindex`,
      }, null, 2));
      return;
    }
  }

  const finalPointCount = verifyCount ? await qdrantPointCount() : null;
  clearCheckpoint();
  console.log(JSON.stringify({
    ok: true,
    partial: false,
    indexedThisRun: total,
    batchesThisRun: batches,
    totalChunks: statsAtStart.totalChunks,
    qdrantPointCount: finalPointCount,
    countMatches: finalPointCount == null ? null : finalPointCount >= statsAtStart.totalChunks,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
