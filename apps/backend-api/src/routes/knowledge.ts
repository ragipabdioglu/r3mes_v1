import type { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type KnowledgeDetailResponse,
  type KnowledgeListResponse,
  type KnowledgeUploadAcceptedResponse,
  safeParseKnowledgeDetailResponse,
  safeParseKnowledgeListResponse,
  safeParseKnowledgeUploadAcceptedResponse,
} from "@r3mes/shared-types";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import { sendApiError } from "../lib/apiErrors.js";
import {
  enrichKnowledgeChunkWithAutoMetadata,
  inferKnowledgeAutoMetadata,
  mergeKnowledgeAutoMetadata,
  type KnowledgeAutoMetadata,
} from "../lib/knowledgeAutoMetadata.js";
import { parseKnowledgeCard } from "../lib/knowledgeCard.js";
import { formatVectorLiteral, getKnowledgeEmbeddingDimensions, embedKnowledgeText } from "../lib/knowledgeEmbedding.js";
import { scoreKnowledgeParseQuality, type KnowledgeParseQuality } from "../lib/knowledgeParseQuality.js";
import { scoreKnowledgeProfileHealth } from "../lib/knowledgeProfileHealth.js";
import { normalizeKnowledgeChunkContent } from "../lib/knowledgeNormalize.js";
import { chunkKnowledgeText, isSupportedKnowledgeFilename, parseKnowledgeBuffer } from "../lib/knowledgeText.js";
import { embedTextForQdrant } from "../lib/qdrantEmbedding.js";
import {
  buildQdrantPayloadMetadata,
  setQdrantCollectionProfileMetadata,
  setQdrantCollectionVisibility,
  upsertQdrantKnowledgePoints,
} from "../lib/qdrantStore.js";
import { ipfsAddBuffer } from "../lib/ipfsAdd.js";
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

async function storeEmbeddings(rows: { embeddingId: string; values: number[] }[]) {
  const dimension = getKnowledgeEmbeddingDimensions();
  for (const row of rows) {
    if (row.values.length !== dimension) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE "KnowledgeEmbedding" SET "vector" = $1::vector WHERE "id" = $2`,
      formatVectorLiteral(row.values),
      row.embeddingId,
    );
  }
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
    profile: profileRecord as KnowledgeAutoMetadata["profile"],
  };
}

function toPrismaJson(value: KnowledgeAutoMetadata): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
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
        },
  };
}

export async function registerKnowledgeRoutes(app: FastifyInstance) {
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
            _count: { select: { chunks: true } },
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
          parseStatus: doc.parseStatus,
          storageCid: doc.storageCid,
          chunkCount: doc._count.chunks,
          parseQualityScore: docMetadata?.parseQuality?.score ?? null,
          parseQualityLevel: docMetadata?.parseQuality?.level ?? null,
          parseQualityWarnings: docMetadata?.parseQuality?.warnings ?? [],
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
    let fileName: string | undefined;
    let fileBuf: Buffer | undefined;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        fileName = part.filename || "knowledge.txt";
        fileBuf = await part.toBuffer();
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

    if (!fileBuf || !fileName) {
      return sendApiError(reply, 400, "FILE_REQUIRED", "Bir knowledge dosyası gerekli");
    }
    if (!isSupportedKnowledgeFilename(fileName)) {
      return sendApiError(reply, 400, "UNSUPPORTED_FILE_TYPE", "Yalnızca .txt, .md ve .json knowledge dosyaları desteklenir");
    }

    const parsed = parseKnowledgeBuffer(fileName, fileBuf);
    const rawChunks = chunkKnowledgeText(parsed.text);
    const documentTitle = title || fileName;
    const chunks = rawChunks.map((chunk) => ({
      ...chunk,
      ...enrichKnowledgeChunkWithAutoMetadata(
        {
          ...chunk,
          content: normalizeKnowledgeChunkContent(chunk.content, { title: documentTitle }),
        },
        { title: documentTitle },
      ),
    }));
    if (chunks.length === 0) {
      return sendApiError(reply, 400, "EMPTY_DOCUMENT", "Yüklenen knowledge dosyasında kullanılabilir içerik yok");
    }
    const parseQuality = scoreKnowledgeParseQuality({
      filename: fileName,
      sourceType: parsed.sourceType,
      text: parsed.text,
      chunks,
    });
    const chunksWithMetadata = chunks.map((chunk) => ({
      ...chunk,
      autoMetadata: inferKnowledgeAutoMetadata({
        title: documentTitle,
        content: chunk.content,
      }),
    }));
    const documentAutoMetadata = mergeKnowledgeAutoMetadata(chunksWithMetadata.map((chunk) => chunk.autoMetadata));
    if (!documentAutoMetadata) {
      return sendApiError(reply, 400, "EMPTY_DOCUMENT_METADATA", "Yüklenen knowledge dosyası için metadata üretilemedi");
    }
    documentAutoMetadata.parseQuality = parseQuality;

    const ipfsApi = process.env.IPFS_API_URL ?? "http://127.0.0.1:5001";
    const storageCid = await ipfsAddBuffer(ipfsApi, fileBuf, fileName);
    const user = await ensureUser(wallet);

    const collection = collectionId
      ? await prisma.knowledgeCollection.findFirst({
          where: { id: collectionId, ownerId: user.id },
        })
      : await prisma.knowledgeCollection.create({
          data: {
            ownerId: user.id,
            name: collectionName || title || fileName.replace(/\.[^.]+$/, ""),
            visibility: "PRIVATE",
          },
        });

    if (!collection) {
      return sendApiError(reply, 404, "COLLECTION_NOT_FOUND", "Belirtilen collection bulunamadı veya size ait değil");
    }

    const document = await prisma.$transaction(async (tx) => {
      const createdDocument = await tx.knowledgeDocument.create({
          data: {
            collectionId: collection.id,
            title: title || fileName,
            sourceType: parsed.sourceType,
            storageCid,
            autoMetadata: toPrismaJson(documentAutoMetadata),
            parseStatus: "PENDING",
          },
      });

      const createdChunks = [];
      for (const chunk of chunksWithMetadata) {
        const createdChunk = await tx.knowledgeChunk.create({
          data: {
            documentId: createdDocument.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            autoMetadata: toPrismaJson(chunk.autoMetadata),
          },
        });
        const values = embedKnowledgeText(chunk.content);
        const createdEmbedding = await tx.knowledgeEmbedding.create({
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
          chunkIndex: chunk.chunkIndex,
          autoMetadata: chunk.autoMetadata,
        });
      }

      await tx.knowledgeDocument.update({
        where: { id: createdDocument.id },
        data: { parseStatus: "READY" },
      });

      const existingCollectionMetadata = readKnowledgeAutoMetadata(collection.autoMetadata);
      const nextCollectionMetadata = mergeKnowledgeAutoMetadata(
        [existingCollectionMetadata, documentAutoMetadata].filter(
          (item): item is KnowledgeAutoMetadata => Boolean(item),
        ),
      );
      if (nextCollectionMetadata) {
        await tx.knowledgeCollection.update({
          where: { id: collection.id },
          data: { autoMetadata: toPrismaJson(nextCollectionMetadata) },
        });
      }

      return { createdDocument, createdChunks, collectionAutoMetadata: nextCollectionMetadata };
    });

    await storeEmbeddings(document.createdChunks);
    try {
      await upsertQdrantKnowledgePoints(
        await Promise.all(document.createdChunks.map(async (chunk) => {
          const card = parseKnowledgeCard(chunk.content);
          const route = routeQuery(`${documentTitle}\n${card.topic}\n${card.tags.join(" ")}\n${chunk.content.slice(0, 1000)}`);
          const tags = card.tags.length > 0 ? card.tags : [route.domain, ...route.subtopics];
          const payloadMetadata = buildQdrantPayloadMetadata({
            collectionMetadata: document.collectionAutoMetadata,
            documentMetadata: documentAutoMetadata,
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
              documentId: document.createdDocument.id,
              chunkId: chunk.chunkId,
              chunkIndex: chunk.chunkIndex,
              title: document.createdDocument.title,
              ...payloadMetadata,
              content: chunk.content,
              createdAt: document.createdDocument.createdAt.toISOString(),
            },
          };
        })),
      );
      await setQdrantCollectionProfileMetadata(collection.id, document.collectionAutoMetadata);
    } catch (error) {
      req.log.warn({ err: error }, "Qdrant dual-write failed; Prisma RAG remains available");
    }

    const payload: KnowledgeUploadAcceptedResponse = {
      collectionId: collection.id,
      documentId: document.createdDocument.id,
      visibility: collection.visibility,
      parseStatus: "READY",
      storageCid,
      chunkCount: chunks.length,
      parseQualityScore: parseQuality.score,
      parseQualityLevel: parseQuality.level,
      parseQualityWarnings: parseQuality.warnings,
    };

    const validated = safeParseKnowledgeUploadAcceptedResponse(payload);
    if (!validated.success) {
      req.log.error({ issues: validated.error.flatten() }, "KnowledgeUploadAcceptedResponse contract violation");
      return sendApiError(reply, 500, "CONTRACT_INVARIANT_VIOLATION", "Knowledge upload response failed contract validation");
    }

    reply.code(201);
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
