import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { prisma } from "../dist/lib/prisma.js";
import {
  buildIngestionQualityReport,
  inferKnowledgeAutoMetadata,
  mergeKnowledgeAutoMetadata,
} from "../dist/lib/knowledgeAutoMetadata.js";
import { parseKnowledgeCard } from "../dist/lib/knowledgeCard.js";
import { embedKnowledgeText, formatVectorLiteral, getKnowledgeEmbeddingDimensions } from "../dist/lib/knowledgeEmbedding.js";
import { scoreKnowledgeParseQuality } from "../dist/lib/knowledgeParseQuality.js";
import { chunkParsedKnowledgeDocument, isSupportedKnowledgeFilename, parseKnowledgeBuffer } from "../dist/lib/knowledgeText.js";
import { embedTextForQdrant } from "../dist/lib/qdrantEmbedding.js";
import { buildQdrantPayloadMetadata, upsertQdrantKnowledgePoints } from "../dist/lib/qdrantStore.js";
import { routeQuery } from "../dist/lib/queryRouter.js";

function argValue(name, fallback = undefined) {
  const prefixed = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? fallback;
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toJson(value) {
  return value ?? undefined;
}

async function ensureUser(walletAddress) {
  return prisma.user.upsert({
    where: { walletAddress },
    create: { walletAddress },
    update: {},
  });
}

async function storePgVector(embeddingId, values) {
  const dimension = getKnowledgeEmbeddingDimensions();
  if (values.length !== dimension) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "KnowledgeEmbedding" SET "vector" = $1::vector WHERE "id" = $2`,
    formatVectorLiteral(values),
    embeddingId,
  );
}

function supportedFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(dir, entry.name))
    .filter((filePath) => isSupportedKnowledgeFilename(filePath))
    .sort((a, b) => basename(a).localeCompare(basename(b), "tr"));
}

async function main() {
  const dir = resolve(argValue("--dir", ""));
  const collectionName = argValue("--collection-name", basename(dir));
  const wallet = argValue("--wallet", process.env.R3MES_DEV_WALLET?.replace(/^"|"$/g, ""));
  const replace = hasFlag("--replace");
  const visibility = argValue("--visibility", "PRIVATE").toUpperCase() === "PUBLIC" ? "PUBLIC" : "PRIVATE";

  if (!dir || dir === resolve("")) throw new Error("--dir zorunlu");
  if (!wallet) throw new Error("--wallet veya R3MES_DEV_WALLET zorunlu");

  const user = await ensureUser(wallet);
  if (replace) {
    await prisma.knowledgeCollection.deleteMany({
      where: { ownerId: user.id, name: collectionName },
    });
  }

  const collection = await prisma.knowledgeCollection.create({
    data: {
      ownerId: user.id,
      name: collectionName,
      visibility,
      publishedAt: visibility === "PUBLIC" ? new Date() : null,
    },
  });

  const files = supportedFiles(dir);
  const allDocumentMetadata = [];
  const qdrantRows = [];
  const report = {
    collectionId: collection.id,
    collectionName,
    dir,
    filesFound: files.length,
    documentsImported: 0,
    chunksImported: 0,
    skipped: [],
    imported: [],
  };

  for (const filePath of files) {
    const fileName = basename(filePath);
    const title = fileName.replace(extname(fileName), "");
    try {
      const buffer = readFileSync(filePath);
      const parsed = parseKnowledgeBuffer(fileName, buffer);
      const rawChunks = chunkParsedKnowledgeDocument(parsed);
      const chunks = rawChunks.map((chunk) => ({
        ...chunk,
        content: chunk.content.trim(),
      }));
      if (chunks.length === 0) {
        report.skipped.push({ fileName, reason: "empty_after_chunking" });
        continue;
      }

      const parseQuality = scoreKnowledgeParseQuality({
        filename: fileName,
        sourceType: parsed.sourceType,
        text: parsed.text,
        chunks,
      });

      const chunksWithMetadata = chunks.map((chunk) => {
        const autoMetadata = inferKnowledgeAutoMetadata({ title, content: chunk.content });
        autoMetadata.sourceType = parsed.sourceType;
        autoMetadata.artifactKind = chunk.artifactKind;
        autoMetadata.sectionTitle = chunk.sectionTitle ?? null;
        autoMetadata.pageNumber = chunk.pageNumber ?? null;
        autoMetadata.isScaffold = chunk.isScaffold ?? false;
        autoMetadata.answerabilityScore = chunk.answerabilityScore;
        return { ...chunk, autoMetadata };
      });

      const documentAutoMetadata = mergeKnowledgeAutoMetadata(chunksWithMetadata.map((chunk) => chunk.autoMetadata));
      if (!documentAutoMetadata) {
        report.skipped.push({ fileName, reason: "empty_metadata" });
        continue;
      }
      documentAutoMetadata.parseQuality = parseQuality;
      documentAutoMetadata.ingestionQuality = buildIngestionQualityReport({
        parseQuality,
        sourceQuality: documentAutoMetadata.sourceQuality,
      });
      documentAutoMetadata.parseAdapter = {
        id: parsed.parser.id,
        version: parsed.parser.version,
        diagnostics: parsed.diagnostics,
      };
      documentAutoMetadata.sourceType = parsed.sourceType;
      allDocumentMetadata.push(documentAutoMetadata);

      const document = await prisma.knowledgeDocument.create({
        data: {
          collectionId: collection.id,
          title,
          sourceType: parsed.sourceType,
          storagePath: filePath,
          autoMetadata: toJson(documentAutoMetadata),
          parseStatus: "READY",
        },
      });

      const createdChunks = [];
      for (const chunk of chunksWithMetadata) {
        const createdChunk = await prisma.knowledgeChunk.create({
          data: {
            documentId: document.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            autoMetadata: toJson(chunk.autoMetadata),
          },
        });
        const values = embedKnowledgeText(chunk.content);
        const embedding = await prisma.knowledgeEmbedding.create({
          data: {
            chunkId: createdChunk.id,
            values,
          },
        });
        await storePgVector(embedding.id, values);
        createdChunks.push({
          chunkId: createdChunk.id,
          chunkIndex: createdChunk.chunkIndex,
          content: createdChunk.content,
          autoMetadata: chunk.autoMetadata,
        });
      }

      report.documentsImported += 1;
      report.chunksImported += createdChunks.length;
      report.imported.push({
        fileName,
        sourceType: parsed.sourceType,
        parseQuality: parseQuality.level,
        parseScore: parseQuality.score,
        artifacts: parsed.artifacts.length,
        chunks: createdChunks.length,
      });

      qdrantRows.push({ document, documentAutoMetadata, chunks: createdChunks });
      console.log(JSON.stringify({
        phase: "local_knowledge_document_imported",
        fileName,
        sourceType: parsed.sourceType,
        parseQuality: parseQuality.level,
        chunks: createdChunks.length,
      }));
    } catch (error) {
      report.skipped.push({
        fileName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const collectionAutoMetadata = mergeKnowledgeAutoMetadata(allDocumentMetadata);
  await prisma.knowledgeCollection.update({
    where: { id: collection.id },
    data: { autoMetadata: toJson(collectionAutoMetadata) },
  });

  for (const row of qdrantRows) {
    await upsertQdrantKnowledgePoints(
      await Promise.all(row.chunks.map(async (chunk) => {
        const card = parseKnowledgeCard(chunk.content);
        const route = routeQuery(`${row.document.title}\n${card.topic}\n${card.tags.join(" ")}\n${chunk.content.slice(0, 1000)}`);
        const tags = card.tags.length > 0 ? card.tags : [route.domain, ...route.subtopics];
        const payloadMetadata = buildQdrantPayloadMetadata({
          collectionMetadata: collectionAutoMetadata,
          documentMetadata: row.documentAutoMetadata,
          chunkMetadata: chunk.autoMetadata,
          fallbackDomain: route.domain,
          fallbackSubtopics: route.subtopics,
          fallbackTags: tags,
        });
        return {
          chunkId: chunk.chunkId,
          vector: await embedTextForQdrant(chunk.content),
          payload: {
            ownerWallet: wallet,
            visibility: collection.visibility,
            collectionId: collection.id,
            documentId: row.document.id,
            chunkId: chunk.chunkId,
            chunkIndex: chunk.chunkIndex,
            title: row.document.title,
            ...payloadMetadata,
            content: chunk.content,
            createdAt: row.document.createdAt.toISOString(),
          },
        };
      })),
    );
  }

  console.log(JSON.stringify({ phase: "local_knowledge_folder_import_complete", ...report }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      phase: "local_knowledge_folder_import_failed",
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
