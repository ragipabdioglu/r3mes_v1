import { PrismaClient } from "@prisma/client";
import {
  inferKnowledgeAutoMetadata,
  mergeKnowledgeAutoMetadata,
} from "../dist/lib/knowledgeAutoMetadata.js";

const prisma = new PrismaClient();
const batchSize = Number.parseInt(process.env.R3MES_KNOWLEDGE_METADATA_BACKFILL_BATCH_SIZE || "50", 10);
const dryRun = process.argv.includes("--dry-run");
const forceSourceQuality = process.argv.includes("--force-source-quality");

function toJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readSourceQuality(value) {
  if (!value || typeof value !== "object") return null;
  const quality = value.sourceQuality;
  return quality === "structured" || quality === "inferred" || quality === "thin" ? quality : null;
}

function preserveExplicitSourceQuality(nextMetadata, previousMetadata) {
  if (forceSourceQuality) return nextMetadata;
  const previousQuality = readSourceQuality(previousMetadata);
  if (previousQuality !== "thin") return nextMetadata;
  return {
    ...nextMetadata,
    sourceQuality: "thin",
  };
}

async function backfillChunks() {
  let cursor = undefined;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const chunks = await prisma.knowledgeChunk.findMany({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      include: {
        document: {
          select: {
            title: true,
          },
        },
      },
    });
    if (chunks.length === 0) break;

    for (const chunk of chunks) {
      scanned += 1;
      const autoMetadata = preserveExplicitSourceQuality(inferKnowledgeAutoMetadata({
        title: chunk.document.title,
        content: chunk.content,
      }), chunk.autoMetadata);
      if (!dryRun) {
        await prisma.knowledgeChunk.update({
          where: { id: chunk.id },
          data: { autoMetadata: toJson(autoMetadata) },
        });
      }
      updated += 1;
    }

    cursor = chunks.at(-1)?.id;
    console.log(JSON.stringify({ stage: "chunks", scanned, updated, lastChunkId: cursor, dryRun }));
  }

  return { scanned, updated };
}

async function backfillDocuments() {
  const documents = await prisma.knowledgeDocument.findMany({
    include: {
      chunks: {
        select: { autoMetadata: true },
        orderBy: { chunkIndex: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  let updated = 0;

  for (const document of documents) {
    const merged = mergeKnowledgeAutoMetadata(document.chunks.map((chunk) => chunk.autoMetadata).filter(Boolean));
    if (!merged) continue;
    if (!dryRun) {
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { autoMetadata: toJson(merged) },
      });
    }
    updated += 1;
  }

  console.log(JSON.stringify({ stage: "documents", scanned: documents.length, updated, dryRun }));
  return { scanned: documents.length, updated };
}

async function backfillCollections() {
  const collections = await prisma.knowledgeCollection.findMany({
    include: {
      documents: {
        select: { autoMetadata: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  let updated = 0;

  for (const collection of collections) {
    const merged = mergeKnowledgeAutoMetadata(collection.documents.map((document) => document.autoMetadata).filter(Boolean));
    if (!merged) continue;
    if (!dryRun) {
      await prisma.knowledgeCollection.update({
        where: { id: collection.id },
        data: { autoMetadata: toJson(merged) },
      });
    }
    updated += 1;
  }

  console.log(JSON.stringify({ stage: "collections", scanned: collections.length, updated, dryRun }));
  return { scanned: collections.length, updated };
}

async function main() {
  const chunks = await backfillChunks();
  const documents = await backfillDocuments();
  const collections = await backfillCollections();
  console.log(JSON.stringify({ ok: true, dryRun, chunks, documents, collections }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
