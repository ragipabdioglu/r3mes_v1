import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  enrichKnowledgeChunkWithAutoMetadata,
  inferKnowledgeAutoMetadata,
  mergeKnowledgeAutoMetadata,
} from "../dist/lib/knowledgeAutoMetadata.js";
import { parseKnowledgeCard } from "../dist/lib/knowledgeCard.js";
import { embedKnowledgeText, formatVectorLiteral, getKnowledgeEmbeddingDimensions } from "../dist/lib/knowledgeEmbedding.js";
import { scoreKnowledgeParseQuality } from "../dist/lib/knowledgeParseQuality.js";
import { normalizeKnowledgeChunkContent } from "../dist/lib/knowledgeNormalize.js";
import { chunkKnowledgeText, parseKnowledgeBuffer } from "../dist/lib/knowledgeText.js";
import { embedTextsForQdrant } from "../dist/lib/qdrantEmbedding.js";
import {
  buildQdrantPayloadMetadata,
  setQdrantCollectionProfileMetadata,
  upsertQdrantKnowledgePoints,
} from "../dist/lib/qdrantStore.js";
import { routeQuery } from "../dist/lib/queryRouter.js";

const prisma = new PrismaClient();
const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

const DEFAULT_WALLET =
  "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const DEFAULT_COLLECTION_ID = "kap-pilot-real-disclosures";
const DEFAULT_COLLECTION_NAME = "KAP Pilot Real Company Disclosures";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseBoolArg(name, fallback = false) {
  if (process.argv.includes(name)) return true;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getQdrantBaseUrl() {
  return (process.env.R3MES_QDRANT_URL ?? "http://127.0.0.1:6333").replace(/\/$/, "");
}

function getQdrantCollectionName() {
  return process.env.R3MES_QDRANT_COLLECTION ?? "r3mes_knowledge";
}

function slugPart(value, fallback = "doc") {
  const normalized = String(value ?? fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function readManifest(manifestPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rows = Array.isArray(parsed?.downloaded) ? parsed.downloaded : [];
  return rows.filter((row) => row && typeof row.localPath === "string" && existsSync(row.localPath));
}

function sourceQualityFromParseQuality(parseQuality) {
  if (parseQuality.level === "clean") return "structured";
  if (parseQuality.level === "usable") return "inferred";
  return "thin";
}

function buildDocumentTitle(row) {
  const ticker = row.ticker ? `${row.ticker} ` : "";
  const subject = row.subject ? `${row.subject} ` : "";
  return `${ticker}${row.disclosureIndex ?? "kap"} ${subject}${row.attachmentFileName ?? basename(row.localPath)}`.trim();
}

function buildKapMetadata(row, parseQuality, parser) {
  const ticker = row.ticker ? String(row.ticker).toUpperCase() : "";
  const topic = [ticker, row.subject, row.summary].filter(Boolean).join(" - ");
  const keywords = [
    "KAP",
    "kamuyu aydınlatma platformu",
    ticker,
    row.companyTitle,
    row.subject,
    row.summary,
    row.disclosureType,
    row.disclosureClass,
    row.attachmentFileName,
  ].filter(Boolean);
  const questionsAnswered = [
    `${ticker} için bu KAP bildirimi hangi rapor veya ek türüne ait?`,
    `${ticker} ${row.disclosureIndex} numaralı bildirimde hangi belge kullanılmış?`,
    `${ticker} belgesinin dönemi, şirketi ve rapor türü nedir?`,
  ].filter((item) => !item.startsWith(" için"));

  return {
    domain: "finance",
    subtopics: ["kap", "company_disclosure", slugPart(row.subject, "disclosure")],
    keywords,
    entities: [ticker, row.companyTitle, row.disclosureIndex ? String(row.disclosureIndex) : ""].filter(Boolean),
    documentType: row.subject ?? row.disclosureType ?? "KAP disclosure",
    audience: "investor",
    riskLevel: "medium",
    summary: topic || "KAP şirket bildirimi",
    questionsAnswered,
    sourceQuality: sourceQualityFromParseQuality(parseQuality),
    parseQuality,
    parseAdapter: {
      id: parser.id,
      version: parser.version,
      diagnostics: parser.diagnostics,
    },
  };
}

function mergeKapMetadata(base, inferred) {
  const merged = mergeKnowledgeAutoMetadata([inferred, base].filter(Boolean));
  if (!merged) return base;
  return {
    ...merged,
    domain: "finance",
    subtopics: Array.from(new Set(["kap", "company_disclosure", ...(merged.subtopics ?? []), ...(base.subtopics ?? [])])).slice(0, 16),
    keywords: Array.from(new Set([...(base.keywords ?? []), ...(merged.keywords ?? [])])).slice(0, 32),
    entities: Array.from(new Set([...(base.entities ?? []), ...(merged.entities ?? [])])).slice(0, 24),
    documentType: base.documentType || merged.documentType,
    audience: "investor",
    riskLevel: merged.riskLevel ?? "medium",
    sourceQuality: base.sourceQuality,
    parseQuality: base.parseQuality,
    parseAdapter: base.parseAdapter,
  };
}

function buildChunkMetadata({ row, title, content }) {
  const inferred = inferKnowledgeAutoMetadata({ title, content });
  const route = routeQuery(`${title}\n${content.slice(0, 1200)}`);
  return {
    ...inferred,
    domain: "finance",
    subtopics: Array.from(new Set(["kap", "company_disclosure", ...(inferred?.subtopics ?? []), ...route.subtopics])).slice(0, 16),
    keywords: Array.from(new Set([row.ticker, row.companyTitle, row.subject, ...(inferred?.keywords ?? [])].filter(Boolean))).slice(0, 32),
    entities: Array.from(new Set([row.ticker, row.companyTitle, row.disclosureIndex ? String(row.disclosureIndex) : "", ...(inferred?.entities ?? [])].filter(Boolean))).slice(0, 24),
    documentType: row.subject ?? inferred?.documentType ?? "KAP disclosure",
    audience: "investor",
    sourceQuality: inferred?.sourceQuality ?? "inferred",
  };
}

function isLowSignalChunk(content) {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length < 80) return true;
  if (/^## Page \d+$/i.test(trimmed)) return true;
  return false;
}

async function deleteQdrantCollectionPoints(collectionId) {
  const response = await fetch(`${getQdrantBaseUrl()}/collections/${encodeURIComponent(getQdrantCollectionName())}/points/delete`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      wait: true,
      filter: {
        must: [{ key: "collectionId", match: { value: collectionId } }],
      },
    }),
  });
  if (response.status === 404) return { deleted: false, reason: "qdrant_collection_missing" };
  if (!response.ok) {
    return { deleted: false, reason: `qdrant_delete_failed:${response.status}:${(await response.text()).slice(0, 240)}` };
  }
  return { deleted: true, reason: null };
}

async function storePgVector(embeddingId, values) {
  if (values.length !== getKnowledgeEmbeddingDimensions()) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "KnowledgeEmbedding" SET "vector" = $1::vector WHERE "id" = $2`,
    formatVectorLiteral(values),
    embeddingId,
  );
}

async function upsertQdrantChunks({ ownerWallet, collection, collectionMetadata, document, documentMetadata, chunks }) {
  const batchSize = parsePositiveInt(process.env.R3MES_KAP_QDRANT_BATCH_SIZE, 16);
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embedTextsForQdrant(batch.map((chunk) => chunk.content));
    await upsertQdrantKnowledgePoints(
      await Promise.all(
        batch.map(async (chunk, index) => {
          const card = parseKnowledgeCard(chunk.content);
          const route = routeQuery(`${document.title}\n${card.topic}\n${card.tags.join(" ")}\n${chunk.content.slice(0, 1000)}`);
          const tags = card.tags.length > 0 ? card.tags : [route.domain, ...route.subtopics];
          const payloadMetadata = buildQdrantPayloadMetadata({
            collectionMetadata,
            documentMetadata,
            chunkMetadata: chunk.autoMetadata,
            fallbackDomain: "finance",
            fallbackSubtopics: ["kap", "company_disclosure", ...route.subtopics],
            fallbackTags: tags,
          });
          return {
            chunkId: chunk.id,
            vector: vectors[index],
            payload: {
              ownerWallet,
              visibility: collection.visibility,
              collectionId: collection.id,
              documentId: document.id,
              chunkId: chunk.id,
              chunkIndex: chunk.chunkIndex,
              title: document.title,
              ...payloadMetadata,
              content: chunk.content,
              createdAt: document.createdAt.toISOString(),
            },
          };
        }),
      ),
    );
    console.log(JSON.stringify({
      phase: "kap_qdrant_batch",
      documentId: document.id,
      batchStart: i,
      batchSize: batch.length,
      totalChunks: chunks.length,
    }));
  }
}

async function main() {
  const manifestPath = resolve(repoRoot, argValue("--manifest", "data/kap-pilot/manifest.json"));
  const collectionId = argValue("--collection-id", DEFAULT_COLLECTION_ID);
  const collectionName = argValue("--collection-name", DEFAULT_COLLECTION_NAME);
  const wallet = argValue("--wallet", process.env.R3MES_DEV_WALLET || DEFAULT_WALLET);
  const maxFiles = parsePositiveInt(argValue("--max-files", "12"), 12);
  const maxChunksPerDocument = parsePositiveInt(argValue("--max-chunks-per-doc", "120"), 120);
  const allowNoisy = parseBoolArg("--allow-noisy", false);
  const append = parseBoolArg("--append", false);

  const manifestRows = readManifest(manifestPath).slice(0, maxFiles);
  const user = await prisma.user.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet },
  });

  if (!append) {
    await deleteQdrantCollectionPoints(collectionId);
    await prisma.knowledgeDocument.deleteMany({ where: { collectionId } });
    await prisma.knowledgeCollection.deleteMany({ where: { id: collectionId } });
  }

  const collection = await prisma.knowledgeCollection.upsert({
    where: { id: collectionId },
    update: {
      ownerId: user.id,
      name: collectionName,
      visibility: "PRIVATE",
      publishedAt: null,
    },
    create: {
      id: collectionId,
      ownerId: user.id,
      name: collectionName,
      visibility: "PRIVATE",
      publishedAt: null,
    },
  });

  const report = {
    collectionId,
    collectionName,
    wallet,
    manifestPath,
    maxFiles,
    maxChunksPerDocument,
    documentsAttempted: manifestRows.length,
    documentsImported: 0,
    documentsSkipped: 0,
    chunksImported: 0,
    qdrantUpsertedChunks: 0,
    skipped: [],
    imported: [],
  };

  const documentMetadatas = [];

  for (const row of manifestRows) {
    const filePath = row.localPath;
    const fileName = basename(filePath);
    const title = buildDocumentTitle(row);
    try {
      console.log(JSON.stringify({
        phase: "kap_import_document_start",
        ticker: row.ticker,
        disclosureIndex: row.disclosureIndex,
        fileName,
      }));
      const buffer = readFileSync(filePath);
      const parsed = parseKnowledgeBuffer(fileName, buffer);
      const parsedChunks = chunkKnowledgeText(parsed.text)
        .filter((chunk) => !isLowSignalChunk(chunk.content))
        .slice(0, maxChunksPerDocument);
      const parseQuality = scoreKnowledgeParseQuality({
        filename: fileName,
        sourceType: parsed.sourceType,
        text: parsed.text,
        chunks: parsedChunks,
      });
      if (parseQuality.level === "noisy" && !allowNoisy) {
        report.documentsSkipped += 1;
        report.skipped.push({ fileName, reason: "noisy_parse", parseQuality });
        console.log(JSON.stringify({
          phase: "kap_import_document_skipped",
          fileName,
          reason: "noisy_parse",
          parseQuality: parseQuality.level,
          parseScore: parseQuality.score,
        }));
        continue;
      }

      const baseMetadata = buildKapMetadata(row, parseQuality, {
        ...parsed.parser,
        diagnostics: parsed.diagnostics,
      });
      const chunkDrafts = parsedChunks.map((chunk) => {
        const normalized = normalizeKnowledgeChunkContent(chunk.content, { title });
        return {
          ...chunk,
          content: normalized,
          ...enrichKnowledgeChunkWithAutoMetadata({ ...chunk, content: normalized }, { title }),
        };
      });
      const chunksWithMetadata = chunkDrafts.map((chunk) => ({
        ...chunk,
        autoMetadata: buildChunkMetadata({ row, title, content: chunk.content }),
      }));
      const inferredDocumentMetadata = mergeKnowledgeAutoMetadata(chunksWithMetadata.map((chunk) => chunk.autoMetadata));
      const documentMetadata = mergeKapMetadata(baseMetadata, inferredDocumentMetadata);
      documentMetadatas.push(documentMetadata);

      const documentId = `kap-${row.disclosureIndex ?? createHash("sha1").update(fileName).digest("hex").slice(0, 10)}-${slugPart(row.ticker, "ticker")}-${slugPart(row.attachmentFileName ?? fileName)}`;
      await prisma.knowledgeDocument.deleteMany({ where: { id: documentId } });
      const document = await prisma.knowledgeDocument.create({
        data: {
          id: documentId,
          collectionId: collection.id,
          title,
          sourceType: parsed.sourceType,
          storagePath: filePath,
          autoMetadata: documentMetadata,
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
            autoMetadata: chunk.autoMetadata,
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
          id: createdChunk.id,
          chunkIndex: createdChunk.chunkIndex,
          content: createdChunk.content,
          autoMetadata: chunk.autoMetadata,
        });
      }

      report.documentsImported += 1;
      report.chunksImported += createdChunks.length;
      report.imported.push({
        fileName,
        ticker: row.ticker,
        disclosureIndex: row.disclosureIndex,
        subject: row.subject,
        parseQuality: parseQuality.level,
        parseScore: parseQuality.score,
        chunks: createdChunks.length,
        truncated: parsedChunks.length >= maxChunksPerDocument,
      });

      await upsertQdrantChunks({
        ownerWallet: wallet,
        collection,
        collectionMetadata: null,
        document,
        documentMetadata,
        chunks: createdChunks,
      });
      report.qdrantUpsertedChunks += createdChunks.length;
      console.log(JSON.stringify({
        phase: "kap_import_document_done",
        fileName,
        parseQuality: parseQuality.level,
        parseScore: parseQuality.score,
        chunks: createdChunks.length,
      }));
    } catch (error) {
      report.documentsSkipped += 1;
      report.skipped.push({
        fileName,
        reason: "parse_or_import_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(JSON.stringify({
        phase: "kap_import_document_skipped",
        fileName,
        reason: "parse_or_import_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const collectionMetadata = mergeKnowledgeAutoMetadata(documentMetadatas);
  if (collectionMetadata) {
    collectionMetadata.domain = "finance";
    collectionMetadata.subtopics = Array.from(new Set(["kap", "company_disclosure", ...(collectionMetadata.subtopics ?? [])])).slice(0, 18);
    collectionMetadata.keywords = Array.from(new Set(["KAP", "kamuyu aydınlatma platformu", ...(collectionMetadata.keywords ?? [])])).slice(0, 40);
    collectionMetadata.audience = "investor";
    collectionMetadata.documentType = "KAP corpus";
    collectionMetadata.sourceQuality = documentMetadatas.some((item) => item.sourceQuality === "thin") ? "inferred" : "structured";
    await prisma.knowledgeCollection.update({
      where: { id: collectionId },
      data: { autoMetadata: collectionMetadata },
    });
    await setQdrantCollectionProfileMetadata(collectionId, collectionMetadata);
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
