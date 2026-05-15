import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import {
  type KnowledgeDetailResponse,
  type KnowledgeIngestionJobStatusResponse,
  type KnowledgeListResponse,
  type KnowledgeUploadAcceptedResponse,
  safeParseKnowledgeDetailResponse,
  safeParseKnowledgeIngestionJobStatusResponse,
  safeParseKnowledgeListResponse,
  safeParseKnowledgeParserCapabilitiesResponse,
  safeParseKnowledgeUploadAcceptedResponse,
} from "@r3mes/shared-types";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import { sendApiError } from "../lib/apiErrors.js";
import { type KnowledgeAutoMetadata } from "../lib/knowledgeAutoMetadata.js";
import { parseKnowledgeCard } from "../lib/knowledgeCard.js";
import { type KnowledgeParseQuality } from "../lib/knowledgeParseQuality.js";
import { scoreKnowledgeProfileHealth } from "../lib/knowledgeProfileHealth.js";
import { listKnowledgeParserCapabilities, type KnowledgeSourceType } from "../lib/knowledgeText.js";
import { enqueueKnowledgeIngestionJob } from "../lib/knowledgeIngestionQueue.js";
import { KnowledgeRawStorageError, storeKnowledgeRawUpload } from "../lib/knowledgeRawStorage.js";
import { setQdrantCollectionVisibility } from "../lib/qdrantStore.js";
import { prisma } from "../lib/prisma.js";
import { routeQuery } from "../lib/queryRouter.js";
import { walletAuthPreHandler } from "../lib/walletAuth.js";

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

async function ensureUser(walletAddress: string, displayName?: string | null) {
  return prisma.user.upsert({
    where: { walletAddress },
    create: { walletAddress, displayName: displayName ?? null },
    update: displayName ? { displayName } : {},
  });
}

function parseScope(raw: string | undefined): "mine" | "public" | "all" {
  if (raw === "public" || raw === "all") return raw;
  return "mine";
}

type DocumentStepStatus = "PENDING" | "RUNNING" | "READY" | "FAILED" | "PARTIAL_READY" | "SKIPPED";
type JobPersistenceStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL_READY";

function mapReadinessStatus(status: DocumentStepStatus | string | null | undefined): "PENDING" | "PROCESSING" | "READY" | "PARTIAL_READY" | "FAILED" {
  if (status === "READY") return "READY";
  if (status === "PARTIAL_READY") return "PARTIAL_READY";
  if (status === "FAILED") return "FAILED";
  if (status === "RUNNING") return "PROCESSING";
  return "PENDING";
}

function mapIndexStatus(status: DocumentStepStatus | string | null | undefined): "PENDING" | "INDEXING" | "READY" | "PARTIAL_READY" | "FAILED" | "SKIPPED" {
  if (status === "RUNNING") return "INDEXING";
  if (status === "READY") return "READY";
  if (status === "FAILED") return "FAILED";
  if (status === "PARTIAL_READY") return "PARTIAL_READY";
  if (status === "SKIPPED") return "SKIPPED";
  return "PENDING";
}

function mapJobHttpStatus(status: JobPersistenceStatus | string | null | undefined): "ACCEPTED" | "PROCESSING" | "READY" | "PARTIAL_READY" | "FAILED" {
  if (status === "SUCCEEDED") return "READY";
  if (status === "FAILED") return "FAILED";
  if (status === "PARTIAL_READY") return "PARTIAL_READY";
  if (status === "RUNNING") return "PROCESSING";
  return "ACCEPTED";
}

function statusUrlForJob(jobId: string): string {
  return `/v1/knowledge/jobs/${encodeURIComponent(jobId)}`;
}

function mapRawSourceType(sourceType: string): KnowledgeSourceType {
  const normalized = sourceType.toUpperCase();
  if (
    normalized === "PDF" ||
    normalized === "DOCX" ||
    normalized === "PPTX" ||
    normalized === "JSON" ||
    normalized === "HTML" ||
    normalized === "MARKDOWN" ||
    normalized === "TEXT"
  ) {
    return normalized;
  }
  return "TEXT";
}

function rawStorageHttpStatus(error: KnowledgeRawStorageError): number {
  if (error.code === "KNOWLEDGE_UPLOAD_TOO_LARGE") return 413;
  if (
    error.code === "UNSUPPORTED_KNOWLEDGE_FILE_EXTENSION" ||
    error.code === "KNOWLEDGE_FILE_MAGIC_MISMATCH" ||
    error.code === "INVALID_KNOWLEDGE_JSON" ||
    error.code === "INVALID_KNOWLEDGE_TEXT"
  ) {
    return 400;
  }
  return 500;
}

function summarizeCollectionMetadata(
  documents: Array<{ title: string; autoMetadata?: unknown; chunks: Array<{ content: string; autoMetadata?: unknown }> }>,
  collectionAutoMetadata?: unknown,
): {
  inferredDomain: string | null;
  inferredTopic: string | null;
  inferredTags: string[];
  sourceQuality: "structured" | "inferred" | "thin" | null;
  profileConfidence: "low" | "medium" | "high" | null;
  profileVersion: number | null;
  lastProfiledAt: string | null;
  profileHealthScore: number | null;
  profileHealthLevel: "healthy" | "usable" | "weak" | null;
  profileHealthWarnings: string[];
} {
  const collectionMetadata = readKnowledgeAutoMetadata(collectionAutoMetadata);
  if (collectionMetadata) {
    const health = scoreKnowledgeProfileHealth(collectionAutoMetadata);
    const profile = collectionMetadata.profile;
    if (profile) {
      return {
        inferredDomain: profile.domains[0] ?? collectionMetadata.domain,
        inferredTopic: profile.subtopics[0] ?? profile.domains[0] ?? collectionMetadata.domain,
        inferredTags: [
          ...(profile.domains ?? []),
          ...(profile.subtopics ?? []),
          ...(profile.keywords ?? []),
        ].slice(0, 8),
        sourceQuality: profile.sourceQuality ?? collectionMetadata.sourceQuality,
        profileConfidence: profile.confidence ?? null,
        profileVersion: profile.profileVersion ?? profile.version ?? null,
        lastProfiledAt: profile.lastProfiledAt ?? null,
        profileHealthScore: health.score,
        profileHealthLevel: health.level,
        profileHealthWarnings: health.warnings,
      };
    }
    return {
      inferredDomain: collectionMetadata.domain,
      inferredTopic: collectionMetadata.subtopics[0] ?? collectionMetadata.domain,
      inferredTags: [collectionMetadata.domain, ...collectionMetadata.subtopics, ...collectionMetadata.keywords].slice(0, 8),
      sourceQuality: collectionMetadata.sourceQuality,
      profileConfidence: null,
      profileVersion: null,
      lastProfiledAt: null,
      profileHealthScore: health.score,
      profileHealthLevel: health.level,
      profileHealthWarnings: health.warnings,
    };
  }

  const topicCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const doc of documents) {
    const docMetadata = readKnowledgeAutoMetadata(doc.autoMetadata);
    if (docMetadata) {
      topicCounts.set(docMetadata.subtopics[0] ?? docMetadata.domain, (topicCounts.get(docMetadata.subtopics[0] ?? docMetadata.domain) ?? 0) + 1);
      for (const tag of [docMetadata.domain, ...docMetadata.subtopics, ...docMetadata.keywords]) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      continue;
    }
    const firstChunk = doc.chunks[0]?.content ?? "";
    const card = firstChunk ? parseKnowledgeCard(firstChunk) : null;
    const route = routeQuery(`${doc.title}\n${card?.topic ?? ""}\n${card?.tags.join(" ") ?? ""}`);
    const topics = [card?.topic, route.subtopics[0], route.domain].filter(
      (value): value is string => Boolean(value && value.trim()),
    );
    const tags = [...(card?.tags ?? []), route.domain, ...route.subtopics].filter(Boolean);

    for (const topic of topics.slice(0, 2)) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const inferredTopic = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const inferredTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .filter((tag, index, arr) => arr.indexOf(tag) === index)
    .slice(0, 8);

  return {
    inferredDomain: inferredTags[0] ?? null,
    inferredTopic,
    inferredTags,
    sourceQuality: null,
    profileConfidence: null,
    profileVersion: null,
    lastProfiledAt: null,
    profileHealthScore: null,
    profileHealthLevel: null,
    profileHealthWarnings: [],
  };
}

function readKnowledgeAutoMetadata(value: unknown): KnowledgeAutoMetadata | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<KnowledgeAutoMetadata>;
  if (typeof record.domain !== "string" || !Array.isArray(record.keywords)) return null;
  const profileRecord = record.profile && typeof record.profile === "object" ? record.profile : undefined;
  return {
    domain: record.domain,
    subtopics: Array.isArray(record.subtopics) ? record.subtopics.filter((item): item is string => typeof item === "string") : [],
    keywords: record.keywords.filter((item): item is string => typeof item === "string"),
    entities: Array.isArray(record.entities) ? record.entities.filter((item): item is string => typeof item === "string") : [],
    documentType: typeof record.documentType === "string" ? record.documentType : "knowledge_note",
    audience: typeof record.audience === "string" ? record.audience : "general_user",
    riskLevel: record.riskLevel === "high" || record.riskLevel === "medium" || record.riskLevel === "low" ? record.riskLevel : "low",
    summary: typeof record.summary === "string" ? record.summary : "",
    questionsAnswered: Array.isArray(record.questionsAnswered) ? record.questionsAnswered.filter((item): item is string => typeof item === "string") : [],
    sourceQuality: record.sourceQuality === "structured" || record.sourceQuality === "inferred" || record.sourceQuality === "thin" ? record.sourceQuality : "thin",
    parseQuality: readKnowledgeParseQuality(record.parseQuality),
    parseAdapter: readKnowledgeParseAdapter(record.parseAdapter),
    sourceType: typeof record.sourceType === "string" ? record.sourceType as KnowledgeAutoMetadata["sourceType"] : undefined,
    artifactId: typeof record.artifactId === "string" ? record.artifactId : undefined,
    artifactKind: typeof record.artifactKind === "string" ? record.artifactKind as KnowledgeAutoMetadata["artifactKind"] : undefined,
    artifactMetadata:
      record.artifactMetadata && typeof record.artifactMetadata === "object" && !Array.isArray(record.artifactMetadata)
        ? record.artifactMetadata as Record<string, unknown>
        : undefined,
    artifactSplitIndex: typeof record.artifactSplitIndex === "number" ? record.artifactSplitIndex : undefined,
    sectionTitle: typeof record.sectionTitle === "string" ? record.sectionTitle : null,
    pageNumber: typeof record.pageNumber === "number" ? record.pageNumber : null,
    isScaffold: typeof record.isScaffold === "boolean" ? record.isScaffold : undefined,
    answerabilityScore: typeof record.answerabilityScore === "number" ? record.answerabilityScore : undefined,
    profile: profileRecord as KnowledgeAutoMetadata["profile"],
  };
}

function readKnowledgeParseQuality(value: unknown): KnowledgeParseQuality | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<KnowledgeParseQuality>;
  if (typeof record.score !== "number") return undefined;
  if (record.level !== "clean" && record.level !== "usable" && record.level !== "noisy") return undefined;
  return {
    score: Math.max(0, Math.min(100, Math.round(record.score))),
    level: record.level,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((item): item is string => typeof item === "string")
      : [],
    signals: record.signals && typeof record.signals === "object"
      ? record.signals as KnowledgeParseQuality["signals"]
      : {
          textLength: 0,
          chunkCount: 0,
          averageChunkChars: 0,
          replacementCharRatio: 0,
          mojibakeMarkerCount: 0,
          controlCharRatio: 0,
          symbolRatio: 0,
          shortLineRatio: 0,
          structureSignalCount: 0,
          tableSignalCount: 0,
          numericDensity: 0,
          ocrRiskScore: 0,
        },
  };
}

function readKnowledgeParseAdapter(value: unknown): KnowledgeAutoMetadata["parseAdapter"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as {
    id?: unknown;
    version?: unknown;
    diagnostics?: unknown;
  };
  if (typeof record.id !== "string" || typeof record.version !== "number") return undefined;
  const diagnosticsRecord = record.diagnostics && typeof record.diagnostics === "object"
    ? record.diagnostics as { originalBytes?: unknown; normalizedChars?: unknown; warnings?: unknown }
    : null;
  return {
    id: record.id,
    version: record.version,
    diagnostics: diagnosticsRecord
      ? {
          originalBytes: typeof diagnosticsRecord.originalBytes === "number" ? diagnosticsRecord.originalBytes : 0,
          normalizedChars: typeof diagnosticsRecord.normalizedChars === "number" ? diagnosticsRecord.normalizedChars : 0,
          warnings: Array.isArray(diagnosticsRecord.warnings)
            ? diagnosticsRecord.warnings.filter((item): item is string => typeof item === "string")
            : [],
        }
      : undefined,
  };
}

export async function registerKnowledgeRoutes(app: FastifyInstance) {
  app.get("/v1/knowledge/parsers", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const payload = { data: listKnowledgeParserCapabilities() };
    const validated = safeParseKnowledgeParserCapabilitiesResponse(payload);
    if (!validated.success) {
      req.log.error({ issues: validated.error.flatten() }, "KnowledgeParserCapabilitiesResponse contract violation");
      return sendApiError(reply, 500, "CONTRACT_INVARIANT_VIOLATION", "Knowledge parser capabilities response failed contract validation");
    }
    return validated.data;
  });

  app.get("/v1/knowledge", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }

    const q = req.query as Record<string, string | undefined>;
    const limit = parseLimit(q.limit, 20, 100);
    const cursor = q.cursor;
    const scope = parseScope(q.scope);

    const where: Prisma.KnowledgeCollectionWhereInput =
      scope === "mine"
        ? { owner: { walletAddress: wallet } }
        : scope === "public"
          ? { visibility: "PUBLIC" }
          : {
              OR: [{ owner: { walletAddress: wallet } }, { visibility: "PUBLIC" }],
            };

    const rows = await prisma.knowledgeCollection.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { walletAddress: true } },
        _count: { select: { documents: true } },
        documents: {
          select: {
            title: true,
            autoMetadata: true,
            chunks: {
              select: { content: true, autoMetadata: true },
              orderBy: { chunkIndex: "asc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    let nextCursor: string | null = null;
    let list = rows;
    if (rows.length > limit) {
      nextCursor = rows.at(-1)?.id ?? null;
      list = rows.slice(0, limit);
    }

    const payload: KnowledgeListResponse = {
      data: list.map((row) => {
        const metadata = summarizeCollectionMetadata(row.documents ?? [], row.autoMetadata);
        return {
          id: row.id,
          name: row.name,
          visibility: row.visibility,
          ownerWallet: row.owner.walletAddress,
          documentCount: row._count.documents,
          inferredDomain: metadata.inferredDomain,
          inferredTopic: metadata.inferredTopic,
          inferredTags: metadata.inferredTags,
          sourceQuality: metadata.sourceQuality,
          profileConfidence: metadata.profileConfidence,
          profileVersion: metadata.profileVersion,
          lastProfiledAt: metadata.lastProfiledAt,
          profileHealthScore: metadata.profileHealthScore,
          profileHealthLevel: metadata.profileHealthLevel,
          profileHealthWarnings: metadata.profileHealthWarnings,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      nextCursor,
    };

    const validated = safeParseKnowledgeListResponse(payload);
    if (!validated.success) {
      req.log.error({ issues: validated.error.flatten() }, "KnowledgeListResponse contract violation");
      return sendApiError(reply, 500, "CONTRACT_INVARIANT_VIOLATION", "Knowledge list response failed contract validation");
    }
    return validated.data;
  });

  app.get("/v1/knowledge/jobs/:id", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const { id } = req.params as { id: string };
    const job = await prisma.ingestionJob.findUnique({
      where: { jobId: id },
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
            _count: { select: { chunks: true, artifacts: true } },
          },
        },
      },
    });
    if (!job) {
      return sendApiError(reply, 404, "NOT_FOUND", "Ingestion job not found");
    }
    const collection = job.document.collection;
    if (collection.visibility !== "PUBLIC" && collection.owner.walletAddress !== wallet) {
      return sendApiError(reply, 403, "FORBIDDEN", "Bu ingestion job size ait değil");
    }

    const indexStatus = mapIndexStatus(job.document.vectorIndexStatus);
    const payload: KnowledgeIngestionJobStatusResponse = {
      jobId: job.jobId,
      collectionId: collection.id,
      documentId: job.documentId,
      status: mapJobHttpStatus(job.status),
      stage: job.stage,
      jobStatus: job.status,
      attempts: job.attempts,
      readiness: mapReadinessStatus(job.document.readinessStatus),
      parseStatus: job.document.parseStatus,
      sourceMime: job.document.sourceMime,
      sourceExtension: job.document.sourceExtension,
      contentHash: job.document.contentHash,
      storagePath: job.document.storagePath,
      parserId: job.document.parserId,
      parserVersion: job.document.parserVersion,
      scanStatus: job.document.scanStatus,
      storageStatus: job.document.storageStatus,
      documentVersionId: job.document.versions?.[0]?.id ?? null,
      artifactCount: job.document._count.artifacts ?? null,
      indexStatus,
      chunkStatus: job.document.chunkStatus,
      embeddingStatus: job.document.embeddingStatus,
      vectorIndexStatus: job.document.vectorIndexStatus,
      qualityStatus: job.document.qualityStatus,
      readinessStatus: job.document.readinessStatus,
      indexing: {
        status: indexStatus,
        vectorIndexStatus: indexStatus,
        indexedChunkCount: indexStatus === "READY" ? job.document._count.chunks : null,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
      },
      chunkCount: job.document._count.chunks,
      indexedChunkCount: indexStatus === "READY" ? job.document._count.chunks : null,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      indexingError: job.errorCode === "QDRANT_DUAL_WRITE_FAILED" ? job.errorMessage : null,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
    const validated = safeParseKnowledgeIngestionJobStatusResponse(payload);
    if (!validated.success) {
      req.log.error({ issues: validated.error.flatten() }, "KnowledgeIngestionJobStatusResponse contract violation");
      return sendApiError(reply, 500, "CONTRACT_INVARIANT_VIOLATION", "Knowledge ingestion job response failed contract validation");
    }
    return validated.data;
  });

  app.get("/v1/knowledge/:id", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const { id } = req.params as { id: string };
    const row = await prisma.knowledgeCollection.findUnique({
      where: { id },
      include: {
        owner: { select: { walletAddress: true } },
        documents: {
          include: {
            _count: { select: { chunks: true, artifacts: true } },
            versions: {
              orderBy: { versionIndex: "desc" },
              take: 1,
            },
            chunks: {
              orderBy: { chunkIndex: "asc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!row) {
      return sendApiError(reply, 404, "NOT_FOUND", "Knowledge collection not found");
    }
    if (row.visibility !== "PUBLIC" && row.owner.walletAddress !== wallet) {
      return sendApiError(reply, 403, "FORBIDDEN", "Bu knowledge collection size ait değil");
    }

    const payload: KnowledgeDetailResponse = {
      id: row.id,
      name: row.name,
      visibility: row.visibility,
      ownerWallet: row.owner.walletAddress,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      documents: row.documents.map((doc) => {
        const docMetadata = readKnowledgeAutoMetadata(doc.autoMetadata);
        const chunkMetadata = readKnowledgeAutoMetadata(doc.chunks[0]?.autoMetadata);
        const card = doc.chunks[0]?.content ? parseKnowledgeCard(doc.chunks[0].content) : null;
        return {
          id: doc.id,
          title: doc.title,
          sourceType: doc.sourceType,
          sourceMime: doc.sourceMime,
          sourceExtension: doc.sourceExtension,
          contentHash: doc.contentHash,
          storagePath: doc.storagePath,
          parserId: doc.parserId,
          parserVersion: doc.parserVersion,
          scanStatus: doc.scanStatus,
          storageStatus: doc.storageStatus,
          documentVersionId: doc.versions?.[0]?.id ?? null,
          parseStatus: doc.parseStatus,
          storageCid: doc.storageCid,
          chunkCount: doc._count.chunks,
          artifactCount: doc._count.artifacts ?? null,
          chunkStatus: doc.chunkStatus,
          embeddingStatus: doc.embeddingStatus,
          vectorIndexStatus: doc.vectorIndexStatus,
          qualityStatus: doc.qualityStatus,
          readinessStatus: doc.readinessStatus,
          parseQualityScore: docMetadata?.parseQuality?.score ?? null,
          parseQualityLevel: docMetadata?.parseQuality?.level ?? null,
          parseQualityWarnings: docMetadata?.parseQuality?.warnings ?? [],
          ingestionQuality: docMetadata?.ingestionQuality ?? null,
          inferredTopic: docMetadata?.subtopics[0] ?? chunkMetadata?.subtopics[0] ?? card?.topic ?? null,
          inferredTags: [
            ...(docMetadata ? [docMetadata.domain, ...docMetadata.subtopics, ...docMetadata.keywords] : []),
            ...(chunkMetadata ? [chunkMetadata.domain, ...chunkMetadata.subtopics, ...chunkMetadata.keywords] : []),
            ...(card?.tags ?? []),
          ].filter((tag, index, arr) => arr.indexOf(tag) === index).slice(0, 8),
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
        };
      }),
    };
    const validated = safeParseKnowledgeDetailResponse(payload);
    if (!validated.success) {
      req.log.error({ issues: validated.error.flatten() }, "KnowledgeDetailResponse contract violation");
      return sendApiError(reply, 500, "CONTRACT_INVARIANT_VIOLATION", "Knowledge detail response failed contract validation");
    }
    return validated.data;
  });

  app.post("/v1/knowledge/upload", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }

    let collectionId: string | undefined;
    let collectionName: string | undefined;
    let title: string | undefined;
    let walletRaw: string | undefined;
    let rawUpload: Awaited<ReturnType<typeof storeKnowledgeRawUpload>> | null = null;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        if (rawUpload) {
          part.file.resume();
          continue;
        }
        try {
          rawUpload = await storeKnowledgeRawUpload({
            filename: part.filename || "knowledge.txt",
            stream: part.file,
            declaredMime: part.mimetype,
            maxBytes: Number.parseInt(process.env.R3MES_KNOWLEDGE_UPLOAD_MAX_BYTES ?? "", 10) || undefined,
          });
        } catch (error) {
          if (error instanceof KnowledgeRawStorageError) {
            return sendApiError(reply, rawStorageHttpStatus(error), error.code, error.message);
          }
          throw error;
        }
      } else if (part.type === "field") {
        const value = String(part.value ?? "").trim();
        if (part.fieldname === "collectionId") collectionId = value || undefined;
        if (part.fieldname === "collectionName") collectionName = value || undefined;
        if (part.fieldname === "title") title = value || undefined;
        if (part.fieldname === "wallet") walletRaw = value || undefined;
      }
    }

    if (walletRaw) {
      try {
        if (normalizeSuiAddress(walletRaw) !== wallet) {
          return sendApiError(reply, 403, "WALLET_MISMATCH", "wallet alanı imzalı X-Wallet-Address ile aynı olmalıdır");
        }
      } catch {
        return sendApiError(reply, 400, "INVALID_WALLET", "Geçersiz Sui adresi (wallet alanı)");
      }
    }

    if (!rawUpload) {
      return sendApiError(reply, 400, "FILE_REQUIRED", "Bir knowledge dosyası gerekli");
    }

    const user = await ensureUser(wallet);

    const collection = collectionId
      ? await prisma.knowledgeCollection.findFirst({
          where: { id: collectionId, ownerId: user.id },
        })
      : await prisma.knowledgeCollection.create({
          data: {
            ownerId: user.id,
            name: collectionName || title || rawUpload.sanitizedFilename.replace(/\.[^.]+$/, ""),
            visibility: "PRIVATE",
          },
        });

    if (!collection) {
      return sendApiError(reply, 404, "COLLECTION_NOT_FOUND", "Belirtilen collection bulunamadı veya size ait değil");
    }

    const existingDocument = await prisma.knowledgeDocument.findFirst({
      where: {
        collectionId: collection.id,
        contentHash: rawUpload.contentHash,
      },
      include: {
        ingestionJob: true,
        versions: { orderBy: { versionIndex: "desc" }, take: 1 },
        _count: { select: { chunks: true, artifacts: true } },
      },
    });

    if (existingDocument?.ingestionJob) {
      const indexStatus = mapIndexStatus(existingDocument.vectorIndexStatus);
      const readiness = mapReadinessStatus(existingDocument.readinessStatus);
      const payload: KnowledgeUploadAcceptedResponse = {
        collectionId: collection.id,
        documentId: existingDocument.id,
        jobId: existingDocument.ingestionJob.jobId,
        statusUrl: statusUrlForJob(existingDocument.ingestionJob.jobId),
        status: mapJobHttpStatus(existingDocument.ingestionJob.status),
        readiness,
        visibility: collection.visibility,
        parseStatus: existingDocument.parseStatus,
        sourceMime: existingDocument.sourceMime,
        sourceExtension: existingDocument.sourceExtension,
        contentHash: existingDocument.contentHash,
        storagePath: existingDocument.storagePath,
        parserId: existingDocument.parserId,
        parserVersion: existingDocument.parserVersion,
        scanStatus: existingDocument.scanStatus,
        storageStatus: existingDocument.storageStatus,
        documentVersionId: existingDocument.versions[0]?.id ?? null,
        artifactCount: existingDocument._count.artifacts,
        indexStatus,
        indexing: {
          status: indexStatus,
          vectorIndexStatus: indexStatus,
          indexedChunkCount: indexStatus === "READY" ? existingDocument._count.chunks : null,
          errorCode: existingDocument.ingestionJob.errorCode,
          errorMessage: existingDocument.ingestionJob.errorMessage,
        },
        indexedChunkCount: indexStatus === "READY" ? existingDocument._count.chunks : null,
        indexingError: existingDocument.ingestionJob.errorCode === "QDRANT_DUAL_WRITE_FAILED"
          ? existingDocument.ingestionJob.errorMessage
          : null,
        storageCid: existingDocument.storageCid,
        chunkCount: existingDocument._count.chunks,
      };
      const validated = safeParseKnowledgeUploadAcceptedResponse(payload);
      if (!validated.success) {
        req.log.error({ issues: validated.error.flatten() }, "KnowledgeUploadAcceptedResponse contract violation");
        return sendApiError(reply, 500, "CONTRACT_INVARIANT_VIOLATION", "Knowledge upload response failed contract validation");
      }
      reply.code(202);
      return validated.data;
    }

    const sourceType = mapRawSourceType(rawUpload.detectedSourceType);
    const isQuarantined = rawUpload.quarantined;
    const document = await prisma.$transaction(async (tx) => {
      const createdDocument = await tx.knowledgeDocument.create({
        data: {
          collectionId: collection.id,
          title: title || rawUpload.sanitizedFilename,
          sourceType,
          sourceMime: rawUpload.detectedMime,
          sourceExtension: rawUpload.sourceExtension,
          contentHash: rawUpload.contentHash,
          storagePath: rawUpload.storagePath,
          scanStatus: isQuarantined ? "FAILED" : "READY",
          storageStatus: "READY",
          parseStatus: isQuarantined ? "FAILED" : "PENDING",
          chunkStatus: isQuarantined ? "SKIPPED" : "PENDING",
          embeddingStatus: isQuarantined ? "SKIPPED" : "PENDING",
          vectorIndexStatus: isQuarantined ? "SKIPPED" : "PENDING",
          qualityStatus: isQuarantined ? "SKIPPED" : "PENDING",
          readinessStatus: isQuarantined ? "FAILED" : "PENDING",
          errorMessage: rawUpload.scan.reason ?? null,
        },
      });
      const createdJob = await tx.ingestionJob.create({
        data: {
          documentId: createdDocument.id,
          stage: isQuarantined ? "STORAGE" : "RECEIVED",
          status: isQuarantined ? "FAILED" : "QUEUED",
          attempts: 0,
          errorCode: isQuarantined ? "KNOWLEDGE_UPLOAD_QUARANTINED" : null,
          errorMessage: rawUpload.scan.reason ?? null,
          completedAt: isQuarantined ? new Date() : null,
        },
      });
      return { createdDocument, createdJob };
    });

    let enqueueMode: string | null = null;
    if (!isQuarantined) {
      try {
        const queued = await enqueueKnowledgeIngestionJob(document.createdJob.jobId);
        enqueueMode = queued.mode;
      } catch (error) {
        req.log.error({ err: error, jobId: document.createdJob.jobId }, "Knowledge ingestion enqueue failed");
        await prisma.knowledgeDocument.update({
          where: { id: document.createdDocument.id },
          data: {
            readinessStatus: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Knowledge ingestion enqueue failed",
          },
        });
        await prisma.ingestionJob.update({
          where: { jobId: document.createdJob.jobId },
          data: {
            status: "FAILED",
            errorCode: "KNOWLEDGE_INGESTION_ENQUEUE_FAILED",
            errorMessage: error instanceof Error ? error.message : "Knowledge ingestion enqueue failed",
            completedAt: new Date(),
          },
        });
      }
    }

    const payload: KnowledgeUploadAcceptedResponse = {
      collectionId: collection.id,
      documentId: document.createdDocument.id,
      jobId: document.createdJob.jobId,
      statusUrl: statusUrlForJob(document.createdJob.jobId),
      status: isQuarantined ? "FAILED" : "ACCEPTED",
      readiness: isQuarantined ? "FAILED" : "PENDING",
      visibility: collection.visibility,
      parseStatus: isQuarantined ? "FAILED" : "PENDING",
      sourceMime: rawUpload.detectedMime,
      sourceExtension: rawUpload.sourceExtension,
      contentHash: rawUpload.contentHash,
      storagePath: rawUpload.storagePath,
      parserId: null,
      parserVersion: null,
      scanStatus: isQuarantined ? "FAILED" : "READY",
      storageStatus: "READY",
      documentVersionId: null,
      artifactCount: 0,
      indexStatus: isQuarantined ? "SKIPPED" : "PENDING",
      indexing: {
        status: isQuarantined ? "SKIPPED" : "PENDING",
        vectorIndexStatus: isQuarantined ? "SKIPPED" : "PENDING",
        indexedChunkCount: null,
        errorCode: isQuarantined ? "KNOWLEDGE_UPLOAD_QUARANTINED" : null,
        errorMessage: rawUpload.scan.reason ?? null,
      },
      indexedChunkCount: null,
      indexingError: null,
      storageCid: null,
      chunkCount: 0,
      parseQualityWarnings: enqueueMode ? [`ingestion_mode:${enqueueMode}`] : [],
    };

    const validated = safeParseKnowledgeUploadAcceptedResponse(payload);
    if (!validated.success) {
      req.log.error({ issues: validated.error.flatten() }, "KnowledgeUploadAcceptedResponse contract violation");
      return sendApiError(reply, 500, "CONTRACT_INVARIANT_VIOLATION", "Knowledge upload response failed contract validation");
    }

    reply.code(202);
    return validated.data;
  });

  app.post("/v1/knowledge/:id/publish", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const { id } = req.params as { id: string };
    const row = await prisma.knowledgeCollection.findFirst({
      where: { id, owner: { walletAddress: wallet } },
    });
    if (!row) {
      return sendApiError(reply, 404, "NOT_FOUND", "Knowledge collection bulunamadı veya size ait değil");
    }
    const updated = await prisma.knowledgeCollection.update({
      where: { id },
      data: { visibility: "PUBLIC", publishedAt: new Date() },
      include: { owner: { select: { walletAddress: true } }, _count: { select: { documents: true } } },
    });
    try {
      await setQdrantCollectionVisibility(id, "PUBLIC");
    } catch (error) {
      req.log.warn({ err: error }, "Qdrant publish visibility sync failed");
    }
    return {
      id: updated.id,
      visibility: updated.visibility,
      publishedAt: updated.publishedAt?.toISOString() ?? null,
    };
  });

  app.post("/v1/knowledge/:id/unpublish", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const { id } = req.params as { id: string };
    const row = await prisma.knowledgeCollection.findFirst({
      where: { id, owner: { walletAddress: wallet } },
    });
    if (!row) {
      return sendApiError(reply, 404, "NOT_FOUND", "Knowledge collection bulunamadı veya size ait değil");
    }
    const updated = await prisma.knowledgeCollection.update({
      where: { id },
      data: { visibility: "PRIVATE", publishedAt: null },
    });
    try {
      await setQdrantCollectionVisibility(id, "PRIVATE");
    } catch (error) {
      req.log.warn({ err: error }, "Qdrant unpublish visibility sync failed");
    }
    return {
      id: updated.id,
      visibility: updated.visibility,
      publishedAt: null,
    };
  });
}
