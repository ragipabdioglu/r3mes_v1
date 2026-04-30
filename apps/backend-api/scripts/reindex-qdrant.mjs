import { PrismaClient } from "@prisma/client";
import { embedTextsForQdrantWithDiagnostics, getQdrantVectorSize } from "../dist/lib/qdrantEmbedding.js";
import { buildQdrantPayloadMetadata, upsertQdrantKnowledgePoints } from "../dist/lib/qdrantStore.js";
import { parseKnowledgeCard } from "../dist/lib/knowledgeCard.js";
import { routeQuery } from "../dist/lib/queryRouter.js";

const prisma = new PrismaClient();
const batchSize = Number.parseInt(process.env.R3MES_QDRANT_REINDEX_BATCH_SIZE || "32", 10);
const requestedEmbeddingProvider = (process.env.R3MES_EMBEDDING_PROVIDER ?? "deterministic").trim().toLowerCase();
const requireRealEmbeddings = process.env.R3MES_QDRANT_REINDEX_REQUIRE_REAL_EMBEDDINGS
  ? process.env.R3MES_QDRANT_REINDEX_REQUIRE_REAL_EMBEDDINGS === "1"
  : requestedEmbeddingProvider === "ai-engine" || requestedEmbeddingProvider === "bge-m3";

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
  const collection = encodeURIComponent(getQdrantCollectionName());
  const response = await fetch(`${getQdrantBaseUrl()}/collections/${collection}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return;
  if (!response.ok) {
    throw new Error(`Qdrant collection check failed: ${response.status} ${await response.text()}`);
  }
  const parsed = await response.json();
  const currentSize = resolveVectorSize(parsed);
  const expectedSize = getQdrantVectorSize();
  if (currentSize !== null && currentSize !== expectedSize) {
    throw new Error(
      `Qdrant vector size mismatch for ${getQdrantCollectionName()}: current=${currentSize}, expected=${expectedSize}. ` +
        "Use a fresh collection name or recreate the collection before reindexing.",
    );
  }
}

async function main() {
  await assertQdrantVectorSizeIfCollectionExists();
  console.log(JSON.stringify({
    phase: "qdrant_reindex_start",
    batchSize,
    requestedEmbeddingProvider,
    requireRealEmbeddings,
    vectorSize: getQdrantVectorSize(),
    collection: getQdrantCollectionName(),
  }));

  let cursor = undefined;
  let total = 0;

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
          content: chunk.content,
          createdAt: chunk.createdAt.toISOString(),
        },
      };
    });

    await upsertQdrantKnowledgePoints(points);
    total += points.length;
    cursor = chunks.at(-1)?.id;
    console.log(JSON.stringify({ indexed: total, lastChunkId: cursor, embedding: diagnostics }));
  }

  console.log(JSON.stringify({ ok: true, indexed: total }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
