import { PrismaClient } from "@prisma/client";
import { embedTextsForQdrant } from "../dist/lib/qdrantEmbedding.js";
import { buildQdrantPayloadMetadata, upsertQdrantKnowledgePoints } from "../dist/lib/qdrantStore.js";
import { parseKnowledgeCard } from "../dist/lib/knowledgeCard.js";
import { routeQuery } from "../dist/lib/queryRouter.js";

const prisma = new PrismaClient();
const batchSize = Number.parseInt(process.env.R3MES_QDRANT_REINDEX_BATCH_SIZE || "32", 10);

function readMetadata(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

async function main() {
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

    const vectors = await embedTextsForQdrant(chunks.map((chunk) => chunk.content));
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
    console.log(JSON.stringify({ indexed: total, lastChunkId: cursor }));
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
