import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";
import type { EmbeddingResult } from "@r3mes/shared-types";

import { buildDocumentUnderstandingQuality } from "./documentUnderstandingQuality.js";
import { buildCanonicalArtifactGraph } from "./canonicalArtifactGraph.js";
import {
  attachKnowledgeChunkArtifactMetadata,
  buildIngestionQualityReport,
  inferKnowledgeAutoMetadata,
  mergeKnowledgeAutoMetadata,
  type KnowledgeAutoMetadata,
} from "./knowledgeAutoMetadata.js";
import {
  buildKnowledgeArtifactCreateManyInput,
  buildKnowledgeArtifactRowId,
} from "./knowledgeArtifactPersistence.js";
import { parseKnowledgeCard } from "./knowledgeCard.js";
import { embedKnowledgeText, formatVectorLiteral, getKnowledgeEmbeddingDimensions } from "./knowledgeEmbedding.js";
import { scoreKnowledgeParseQuality } from "./knowledgeParseQuality.js";
import { adaptKnowledgeChunkDraftsToV2 } from "./knowledgeChunkV2.js";
import { chunkParsedKnowledgeDocument, parseKnowledgeBuffer } from "./knowledgeText.js";
import { prisma } from "./prisma.js";
import { routeQuery } from "./queryRouter.js";
import { embeddingServiceV2 } from "./embeddingService.js";
import { buildQdrantPayloadV2, hashQdrantPayloadText } from "./qdrantPayloadV2.js";
import {
  buildQdrantPayloadMetadata,
  setQdrantCollectionProfileMetadata,
  upsertQdrantKnowledgePoints,
} from "./qdrantStore.js";

type DocumentStepStatus = "PENDING" | "RUNNING" | "READY" | "FAILED" | "PARTIAL_READY" | "SKIPPED";
type JobStage = "RECEIVED" | "STORAGE" | "PARSE" | "CHUNK" | "EMBEDDING" | "VECTOR_INDEX" | "QUALITY" | "READY";
type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL_READY";

type ProcessorPrisma = typeof prisma;

export interface ProcessKnowledgeIngestionJobInput {
  jobId: string;
}

export interface ProcessKnowledgeIngestionDocumentInput {
  documentId: string;
  jobId?: string;
}

export interface KnowledgeIngestionProcessorResult {
  jobId: string;
  documentId: string;
  collectionId: string;
  status: JobStatus;
  stage: JobStage;
  readinessStatus: "READY" | "PARTIAL_READY" | "FAILED";
  chunkCount: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface KnowledgeIngestionProcessorDependencies {
  prisma?: ProcessorPrisma;
  readRawFile?: (storagePath: string) => Promise<Buffer>;
  parseBuffer?: typeof parseKnowledgeBuffer;
  chunkParsedDocument?: typeof chunkParsedKnowledgeDocument;
  embedLexicalText?: typeof embedKnowledgeText;
  embedQdrant?: (input: {
    targetType: "chunk";
    targetId: string;
    purpose: "retrieval_dense";
    text: string;
    languageHint?: "tr" | "en" | "mixed" | "unknown";
  }) => Promise<EmbeddingResult>;
  upsertQdrantPoints?: typeof upsertQdrantKnowledgePoints;
  setQdrantProfileMetadata?: typeof setQdrantCollectionProfileMetadata;
  now?: () => Date;
  log?: Pick<Console, "warn" | "error">;
}

type LoadedJob = Prisma.IngestionJobGetPayload<{
  include: {
    document: {
      include: {
        collection: {
          include: { owner: { select: { walletAddress: true } } };
        };
        versions: true;
      };
    };
  };
}>;

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toPrismaJson(value: KnowledgeAutoMetadata): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function isKnowledgeAutoMetadata(value: unknown): value is KnowledgeAutoMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<KnowledgeAutoMetadata>;
  return typeof record.domain === "string" && Array.isArray(record.keywords);
}

function sourceFilename(document: { title: string; storagePath: string | null }): string {
  if (document.storagePath) return path.basename(document.storagePath);
  return document.title;
}

function parsedStructuredArtifacts(parsed: ReturnType<typeof parseKnowledgeBuffer>): unknown[] {
  const record = parsed as unknown as Record<string, unknown>;
  return Array.isArray(record.structuredArtifacts) ? record.structuredArtifacts : [];
}

function parsedPageCount(parsed: ReturnType<typeof parseKnowledgeBuffer>): number | null {
  const explicit = (parsed as unknown as Record<string, unknown>).pageCount;
  if (typeof explicit === "number" && Number.isInteger(explicit) && explicit > 0) return explicit;
  const pages = parsed.artifacts
    .map((artifact) => artifact.page)
    .filter((page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0);
  return pages.length > 0 ? Math.max(...pages) : null;
}

async function storeEmbeddings(
  db: ProcessorPrisma,
  rows: { embeddingId: string; values: number[] }[],
): Promise<void> {
  const dimension = getKnowledgeEmbeddingDimensions();
  for (const row of rows) {
    if (row.values.length !== dimension) continue;
    await db.$executeRawUnsafe(
      `UPDATE "KnowledgeEmbedding" SET "vector" = $1::vector WHERE "id" = $2`,
      formatVectorLiteral(row.values),
      row.embeddingId,
    );
  }
}

async function updateJobStage(
  db: ProcessorPrisma,
  jobId: string,
  data: {
    stage: JobStage;
    status?: JobStatus;
    errorCode?: string | null;
    errorMessage?: string | null;
    completedAt?: Date | null;
  },
): Promise<void> {
  await db.ingestionJob.update({
    where: { jobId },
    data,
  });
}

async function failStage(opts: {
  db: ProcessorPrisma;
  jobId: string;
  documentId: string;
  stage: JobStage;
  documentData: Record<string, unknown>;
  errorCode: string;
  error: unknown;
  now: () => Date;
}): Promise<never> {
  const message = errorMessageOf(opts.error);
  await opts.db.knowledgeDocument.update({
    where: { id: opts.documentId },
    data: {
      ...opts.documentData,
      readinessStatus: "FAILED",
      errorMessage: message,
    },
  });
  await updateJobStage(opts.db, opts.jobId, {
    stage: opts.stage,
    status: "FAILED",
    errorCode: opts.errorCode,
    errorMessage: message,
    completedAt: opts.now(),
  });
  throw opts.error;
}

async function loadJobByJobId(db: ProcessorPrisma, jobId: string): Promise<LoadedJob> {
  const job = await db.ingestionJob.findUnique({
    where: { jobId },
    include: {
      document: {
        include: {
          collection: {
            include: { owner: { select: { walletAddress: true } } },
          },
          versions: {
            orderBy: { versionIndex: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!job) throw new Error(`Knowledge ingestion job not found: ${jobId}`);
  return job as LoadedJob;
}

async function loadJobByDocumentId(db: ProcessorPrisma, input: ProcessKnowledgeIngestionDocumentInput): Promise<LoadedJob> {
  if (input.jobId) return loadJobByJobId(db, input.jobId);
  const document = await db.knowledgeDocument.findUnique({
    where: { id: input.documentId },
    include: {
      ingestionJob: true,
    },
  });
  if (!document?.ingestionJob) throw new Error(`Knowledge ingestion job not found for document: ${input.documentId}`);
  return loadJobByJobId(db, document.ingestionJob.jobId);
}

async function runProcessor(job: LoadedJob, deps: Required<Omit<KnowledgeIngestionProcessorDependencies, "prisma" | "log">> & {
  prisma: ProcessorPrisma;
  log: Pick<Console, "warn" | "error">;
}): Promise<KnowledgeIngestionProcessorResult> {
  const db = deps.prisma;
  const document = job.document;
  const collection = document.collection;
  const jobId = job.jobId;

  await db.ingestionJob.update({
    where: { jobId },
    data: {
      stage: "PARSE",
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: job.startedAt ?? deps.now(),
      completedAt: null,
      errorCode: null,
      errorMessage: null,
    },
  });
  await db.knowledgeDocument.update({
    where: { id: document.id },
    data: {
      parseStatus: "PENDING",
      chunkStatus: "PENDING",
      embeddingStatus: "PENDING",
      vectorIndexStatus: "PENDING",
      qualityStatus: "PENDING",
      readinessStatus: "RUNNING",
      errorMessage: null,
    },
  });

  let fileBuffer: Buffer;
  let parsed: ReturnType<typeof parseKnowledgeBuffer>;
  let chunksWithMetadata: Array<ReturnType<typeof chunkParsedKnowledgeDocument>[number] & {
    autoMetadata: KnowledgeAutoMetadata;
    embeddingText: string;
  }>;
  let documentAutoMetadata: KnowledgeAutoMetadata;
  let artifactGraph: ReturnType<typeof buildCanonicalArtifactGraph> | null = null;

  try {
    if (!document.storagePath) {
      throw new Error("Knowledge document storagePath is required for async ingestion");
    }
    fileBuffer = await deps.readRawFile(document.storagePath);
    parsed = deps.parseBuffer(sourceFilename(document), fileBuffer);
  } catch (error) {
    return failStage({
      db,
      jobId,
      documentId: document.id,
      stage: "PARSE",
      documentData: {
        parseStatus: "FAILED",
        chunkStatus: "SKIPPED",
        embeddingStatus: "SKIPPED",
        vectorIndexStatus: "SKIPPED",
        qualityStatus: "SKIPPED",
      },
      errorCode: "PARSE_FAILED",
      error,
      now: deps.now,
    });
  }

  try {
    await db.knowledgeDocument.update({
      where: { id: document.id },
      data: { parseStatus: "READY", chunkStatus: "RUNNING", sourceType: parsed.sourceType },
    });
    await updateJobStage(db, jobId, { stage: "CHUNK", status: "RUNNING" });

    const rawChunks = deps.chunkParsedDocument(parsed);
    const chunks = rawChunks.map((chunk) => ({ ...chunk, content: chunk.content.trim() }));
    if (chunks.length === 0) {
      throw new Error("Knowledge document produced no usable chunks");
    }
    const parseQuality = scoreKnowledgeParseQuality({
      filename: sourceFilename(document),
      sourceType: parsed.sourceType,
      text: parsed.text,
      chunks,
    });
    artifactGraph = buildCanonicalArtifactGraph(parsed);
    const chunkV2 = adaptKnowledgeChunkDraftsToV2(chunks, {
      documentId: document.id,
      filename: sourceFilename(document),
      sourceType: parsed.sourceType,
    });
    chunksWithMetadata = chunks.map((chunk, index) => {
      const autoMetadata = attachKnowledgeChunkArtifactMetadata(
        inferKnowledgeAutoMetadata({
          title: document.title,
          content: chunk.content,
        }),
        chunk,
      );
      autoMetadata.sourceType = parsed.sourceType;
      autoMetadata.artifactKind = chunk.artifactKind;
      autoMetadata.sectionTitle = chunk.sectionTitle ?? null;
      autoMetadata.pageNumber = chunk.pageNumber ?? null;
      autoMetadata.isScaffold = chunk.isScaffold ?? false;
      autoMetadata.answerabilityScore = chunk.answerabilityScore;
      return {
        ...chunk,
        autoMetadata,
        embeddingText: chunkV2.chunks[index]?.embeddingText ?? chunk.content,
      };
    });
    const merged = mergeKnowledgeAutoMetadata(chunksWithMetadata.map((chunk) => chunk.autoMetadata));
    if (!merged) {
      throw new Error("Knowledge document metadata could not be generated");
    }
    documentAutoMetadata = merged;
    documentAutoMetadata.parseQuality = parseQuality;
    documentAutoMetadata.ingestionQuality = buildIngestionQualityReport({
      parseQuality,
      sourceQuality: documentAutoMetadata.sourceQuality,
    });
    documentAutoMetadata.documentUnderstanding = buildDocumentUnderstandingQuality({
      parseQuality,
      artifacts: parsed.artifacts,
      structuredArtifacts: parsedStructuredArtifacts(parsed),
      parserFallbackUsed: parsed.diagnostics.warnings.some((warning) => warning.includes("fallback")),
      parserWarnings: parsed.diagnostics.warnings,
      tableWarnings: parseQuality.warnings.filter((warning) => warning.includes("table")),
      ocrWarnings: parseQuality.warnings.filter((warning) => warning.includes("ocr")),
      sourceType: parsed.sourceType,
      pageCount: parsedPageCount(parsed),
    });
    documentAutoMetadata.artifactGraph = {
      version: artifactGraph.version,
      diagnostics: artifactGraph.diagnostics,
    };
    documentAutoMetadata.chunkingDiagnostics = chunkV2.diagnostics;
    documentAutoMetadata.parseAdapter = {
      id: parsed.parser.id,
      version: parsed.parser.version,
      diagnostics: parsed.diagnostics,
    };
    documentAutoMetadata.parserRun = {
      id: parsed.parserRun.id,
      version: parsed.parserRun.version,
      profile: parsed.parserRun.profile ?? "unknown",
      ...(parsed.parserRun.durationMs !== undefined ? { durationMs: parsed.parserRun.durationMs } : {}),
      fallbackUsed: parsed.parserRun.fallbackUsed,
      outputSchemaVersion: parsed.parserRun.outputSchemaVersion,
      warnings: parsed.parserRun.warnings,
    };
    documentAutoMetadata.sourceType = parsed.sourceType;
  } catch (error) {
    return failStage({
      db,
      jobId,
      documentId: document.id,
      stage: "CHUNK",
      documentData: {
        parseStatus: "READY",
        chunkStatus: "FAILED",
        embeddingStatus: "SKIPPED",
        vectorIndexStatus: "SKIPPED",
        qualityStatus: "SKIPPED",
      },
      errorCode: "CHUNK_FAILED",
      error,
      now: deps.now,
    });
  }

  const createdChunks: Array<{
    chunkId: string;
    embeddingId: string;
    values: number[];
    content: string;
    embeddingText: string;
    chunkIndex: number;
    autoMetadata: KnowledgeAutoMetadata;
  }> = [];
  let collectionAutoMetadata: KnowledgeAutoMetadata | null = null;
  let versionId: string | null = null;

  try {
    await updateJobStage(db, jobId, { stage: "EMBEDDING", status: "RUNNING" });
    await db.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        autoMetadata: toPrismaJson(documentAutoMetadata),
        sourceType: parsed.sourceType,
        parserId: parsed.parser.id,
        parserVersion: parsed.parser.version,
        parseStatus: "READY",
        chunkStatus: "RUNNING",
        embeddingStatus: "RUNNING",
        vectorIndexStatus: "PENDING",
        qualityStatus: "READY",
        readinessStatus: "RUNNING",
      },
    });
    await db.knowledgeChunk.deleteMany({ where: { documentId: document.id } });

    const previousVersionIndex = document.versions?.[0]?.versionIndex ?? 0;
    const version = await db.knowledgeDocumentVersion.create({
      data: {
        documentId: document.id,
        version: previousVersionIndex + 1,
        versionIndex: previousVersionIndex + 1,
        sourceType: parsed.sourceType,
        sourceMime: document.sourceMime,
        sourceExtension: document.sourceExtension,
        parserId: parsed.parser.id,
        parserVersion: parsed.parser.version,
        contentHash: document.contentHash,
        storagePath: document.storagePath,
        storageCid: document.storageCid,
        readinessStatus: "RUNNING",
        textHash: document.contentHash ?? "",
        originalBytes: parsed.diagnostics.originalBytes,
        normalizedChars: parsed.diagnostics.normalizedChars,
        warnings: parsed.diagnostics.warnings,
        metadata: toPrismaJson(documentAutoMetadata),
      },
    });
    versionId = version.id;

    await db.knowledgeArtifact.createMany({
      data: buildKnowledgeArtifactCreateManyInput({
        documentId: document.id,
        parsed,
        versionId,
        artifactGraph: artifactGraph ?? undefined,
      }),
      skipDuplicates: true,
    });

    for (const chunk of chunksWithMetadata) {
      const createdChunk = await db.knowledgeChunk.create({
        data: {
          documentId: document.id,
          versionId,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          autoMetadata: toPrismaJson(chunk.autoMetadata),
          artifactId: chunk.artifactId,
          artifactRowId: chunk.artifactId
            ? buildKnowledgeArtifactRowId({ documentId: document.id, artifactId: chunk.artifactId, versionId })
            : undefined,
          artifactSplitIndex: chunk.artifactSplitIndex,
        },
      });
      const values = deps.embedLexicalText(chunk.content);
      const createdEmbedding = await db.knowledgeEmbedding.create({
        data: {
          chunkId: createdChunk.id,
          values,
        },
      });
      createdChunks.push({
        chunkId: createdChunk.id,
        embeddingId: createdEmbedding.id,
        values,
        content: chunk.content,
        embeddingText: chunk.embeddingText,
        chunkIndex: chunk.chunkIndex,
        autoMetadata: chunk.autoMetadata,
      });
    }

    await storeEmbeddings(db, createdChunks);

    const existingCollectionMetadata = isKnowledgeAutoMetadata(collection.autoMetadata) ? collection.autoMetadata : null;
    collectionAutoMetadata = mergeKnowledgeAutoMetadata(
      [existingCollectionMetadata, documentAutoMetadata].filter(
        (item): item is KnowledgeAutoMetadata => Boolean(item),
      ),
    );
    if (collectionAutoMetadata) {
      await db.knowledgeCollection.update({
        where: { id: collection.id },
        data: { autoMetadata: toPrismaJson(collectionAutoMetadata) },
      });
    }
    await db.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        chunkStatus: "READY",
        embeddingStatus: "READY",
        vectorIndexStatus: "RUNNING",
        readinessStatus: "RUNNING",
      },
    });
    if (versionId) {
      await db.knowledgeDocumentVersion.update({
        where: { id: versionId },
        data: { readinessStatus: "RUNNING" },
      });
    }
  } catch (error) {
    if (versionId) {
      await db.knowledgeDocumentVersion.update({
        where: { id: versionId },
        data: { readinessStatus: "FAILED" },
      }).catch(() => undefined);
    }
    return failStage({
      db,
      jobId,
      documentId: document.id,
      stage: "EMBEDDING",
      documentData: {
        parseStatus: "READY",
        chunkStatus: createdChunks.length > 0 ? "READY" : "FAILED",
        embeddingStatus: "FAILED",
        vectorIndexStatus: "SKIPPED",
        qualityStatus: "READY",
      },
      errorCode: "EMBEDDING_WRITE_FAILED",
      error,
      now: deps.now,
    });
  }

  await updateJobStage(db, jobId, { stage: "VECTOR_INDEX", status: "RUNNING" });
  let vectorIndexStatus: DocumentStepStatus = "READY";
  let readinessStatus: "READY" | "PARTIAL_READY" = "READY";
  let indexingError: string | null = null;

  try {
    await deps.upsertQdrantPoints(
      await Promise.all(createdChunks.map(async (chunk) => {
        const card = parseKnowledgeCard(chunk.content);
        const route = routeQuery(`${document.title}\n${card.topic}\n${card.tags.join(" ")}\n${chunk.content.slice(0, 1000)}`);
        const tags = card.tags.length > 0 ? card.tags : [route.domain, ...route.subtopics];
        const payloadMetadata = buildQdrantPayloadMetadata({
          collectionMetadata: collectionAutoMetadata,
          documentMetadata: documentAutoMetadata,
          chunkMetadata: chunk.autoMetadata,
          fallbackDomain: route.domain,
          fallbackSubtopics: route.subtopics,
          fallbackTags: tags,
        });
        const embedding = await deps.embedQdrant({
          targetType: "chunk",
          targetId: chunk.chunkId,
          purpose: "retrieval_dense",
          text: chunk.embeddingText,
          languageHint: "unknown",
        });
        if (!embedding.vector || embedding.vector.length === 0) {
          throw new Error(`Qdrant embedding vector is missing for chunk ${chunk.chunkId}`);
        }
        const payloadV2 = buildQdrantPayloadV2({
          targetKind: "chunk",
          targetId: chunk.chunkId,
          collectionId: collection.id,
          documentId: document.id,
          documentVersionId: versionId ?? undefined,
          logicalChunkId: chunk.chunkId,
          visibility: collection.visibility,
          ownerScopeId: collection.owner.walletAddress,
          sourceQuality: payloadMetadata.sourceQuality,
          parseQualityLevel: documentAutoMetadata.parseQuality?.level,
          strictRouteEligible: payloadMetadata.strictRouteEligible,
          strictAnswerEligible: payloadMetadata.strictAnswerEligible,
          artifactKind: chunk.autoMetadata.artifactKind,
          contentHash: hashQdrantPayloadText(chunk.content),
          embeddingTextHash: hashQdrantPayloadText(chunk.embeddingText),
          embeddingProvider: embedding.provider,
          embeddingModel: embedding.model,
          embeddingDimension: embedding.dimension,
          indexedAt: deps.now().toISOString(),
        });
        return {
          chunkId: chunk.chunkId,
          vector: embedding.vector,
          payload: {
            ownerWallet: collection.owner.walletAddress,
            chunkId: chunk.chunkId,
            chunkIndex: chunk.chunkIndex,
            title: document.title,
            ...payloadV2,
            ...payloadMetadata,
            collectionId: collection.id,
            documentId: document.id,
            embeddingFallbackUsed: embedding.fallbackUsed,
            embeddingVectorSize: embedding.dimension,
            content: chunk.content,
            createdAt: document.createdAt.toISOString(),
          },
        };
      })),
    );
    await deps.setQdrantProfileMetadata(collection.id, collectionAutoMetadata);
  } catch (error) {
    vectorIndexStatus = "FAILED";
    readinessStatus = "PARTIAL_READY";
    indexingError = errorMessageOf(error);
    deps.log.warn({ err: error }, "Qdrant dual-write failed; Prisma RAG remains available");
  }

  await db.knowledgeDocument.update({
    where: { id: document.id },
    data: {
      vectorIndexStatus,
      readinessStatus,
      errorMessage: indexingError,
    },
  });
  if (versionId) {
    await db.knowledgeDocumentVersion.update({
      where: { id: versionId },
      data: { readinessStatus },
    });
  }
  await updateJobStage(db, jobId, {
    stage: vectorIndexStatus === "READY" ? "READY" : "VECTOR_INDEX",
    status: vectorIndexStatus === "READY" ? "SUCCEEDED" : "PARTIAL_READY",
    errorCode: vectorIndexStatus === "READY" ? null : "QDRANT_DUAL_WRITE_FAILED",
    errorMessage: indexingError,
    completedAt: deps.now(),
  });

  return {
    jobId,
    documentId: document.id,
    collectionId: collection.id,
    status: vectorIndexStatus === "READY" ? "SUCCEEDED" : "PARTIAL_READY",
    stage: vectorIndexStatus === "READY" ? "READY" : "VECTOR_INDEX",
    readinessStatus,
    chunkCount: createdChunks.length,
    errorCode: vectorIndexStatus === "READY" ? null : "QDRANT_DUAL_WRITE_FAILED",
    errorMessage: indexingError,
  };
}

function withDefaults(deps: KnowledgeIngestionProcessorDependencies = {}) {
  return {
    prisma: deps.prisma ?? prisma,
    readRawFile: deps.readRawFile ?? readFile,
    parseBuffer: deps.parseBuffer ?? parseKnowledgeBuffer,
    chunkParsedDocument: deps.chunkParsedDocument ?? chunkParsedKnowledgeDocument,
    embedLexicalText: deps.embedLexicalText ?? embedKnowledgeText,
    embedQdrant: deps.embedQdrant ?? ((input) => embeddingServiceV2.embed(input)),
    upsertQdrantPoints: deps.upsertQdrantPoints ?? upsertQdrantKnowledgePoints,
    setQdrantProfileMetadata: deps.setQdrantProfileMetadata ?? setQdrantCollectionProfileMetadata,
    now: deps.now ?? (() => new Date()),
    log: deps.log ?? console,
  };
}

export async function processKnowledgeIngestionJob(
  input: ProcessKnowledgeIngestionJobInput,
  deps?: KnowledgeIngestionProcessorDependencies,
): Promise<KnowledgeIngestionProcessorResult> {
  const resolved = withDefaults(deps);
  const job = await loadJobByJobId(resolved.prisma, input.jobId);
  return runProcessor(job, resolved);
}

export async function processKnowledgeIngestionDocument(
  input: ProcessKnowledgeIngestionDocumentInput,
  deps?: KnowledgeIngestionProcessorDependencies,
): Promise<KnowledgeIngestionProcessorResult> {
  const resolved = withDefaults(deps);
  const job = await loadJobByDocumentId(resolved.prisma, input);
  return runProcessor(job, resolved);
}
