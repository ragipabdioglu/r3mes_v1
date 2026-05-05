import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  safeParseKnowledgeFeedbackCreateRequest,
  safeParseKnowledgeFeedbackCreateResponse,
  type KnowledgeFeedbackCreateResponse,
} from "@r3mes/shared-types";

import { sendApiError } from "../lib/apiErrors.js";
import { prisma } from "../lib/prisma.js";
import { walletAuthPreHandler } from "../lib/walletAuth.js";

const HASH_RE = /^[a-f0-9]{8,64}$/i;

function hashQuery(query: string): string {
  return createHash("sha256").update(query.trim(), "utf8").digest("hex").slice(0, 16);
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function ensureUser(walletAddress: string) {
  return prisma.user.upsert({
    where: { walletAddress },
    create: { walletAddress },
    update: {},
  });
}

async function assertCollectionIsAccessible(opts: {
  collectionId: string | null;
  walletAddress: string;
}): Promise<boolean> {
  if (!opts.collectionId) return true;
  const collection = await prisma.knowledgeCollection.findFirst({
    where: {
      id: opts.collectionId,
      OR: [
        { owner: { walletAddress: opts.walletAddress } },
        { visibility: "PUBLIC" },
      ],
    },
    select: { id: true },
  });
  return Boolean(collection);
}

function buildQueryHash(opts: { query?: string | null; queryHash?: string | null }): string | null {
  const suppliedHash = normalizeOptionalString(opts.queryHash);
  if (suppliedHash) return HASH_RE.test(suppliedHash) ? suppliedHash.toLowerCase() : "";
  const query = normalizeOptionalString(opts.query);
  return query ? hashQuery(query) : null;
}

export async function registerFeedbackRoutes(app: FastifyInstance) {
  app.post("/v1/feedback/knowledge", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }

    const parsed = safeParseKnowledgeFeedbackCreateRequest(req.body);
    if (!parsed.success) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_PAYLOAD", parsed.error.message);
    }

    const body = parsed.data;
    const queryHash = buildQueryHash({ query: body.query, queryHash: body.queryHash });
    if (queryHash === "") {
      return sendApiError(reply, 400, "INVALID_QUERY_HASH", "queryHash 8-64 karakter hex olmalı");
    }

    const collectionId = normalizeOptionalString(body.collectionId);
    const expectedCollectionId = normalizeOptionalString(body.expectedCollectionId);
    const [collectionAccessible, expectedCollectionAccessible] = await Promise.all([
      assertCollectionIsAccessible({ collectionId, walletAddress: wallet }),
      assertCollectionIsAccessible({ collectionId: expectedCollectionId, walletAddress: wallet }),
    ]);
    if (!collectionAccessible || !expectedCollectionAccessible) {
      return sendApiError(reply, 403, "KNOWLEDGE_FEEDBACK_ACCESS_DENIED", "Feedback verilen collection erişilebilir değil");
    }

    const user = await ensureUser(wallet);
    const feedback = await prisma.knowledgeFeedback.create({
      data: {
        userId: user.id,
        kind: body.kind,
        traceId: normalizeOptionalString(body.traceId),
        queryHash,
        collectionId,
        documentId: normalizeOptionalString(body.documentId),
        chunkId: normalizeOptionalString(body.chunkId),
        expectedCollectionId,
        reason: normalizeOptionalString(body.reason),
        metadata: (body.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: {
        id: true,
        kind: true,
        queryHash: true,
        collectionId: true,
        expectedCollectionId: true,
        createdAt: true,
      },
    });

    const response: KnowledgeFeedbackCreateResponse = {
      id: feedback.id,
      kind: feedback.kind,
      status: "recorded",
      queryHash: feedback.queryHash,
      collectionId: feedback.collectionId,
      expectedCollectionId: feedback.expectedCollectionId,
      createdAt: feedback.createdAt.toISOString(),
    };
    const checked = safeParseKnowledgeFeedbackCreateResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback response contract failed");
      return sendApiError(reply, 500, "FEEDBACK_RESPONSE_CONTRACT_FAILED", "Feedback kaydı yanıtı doğrulanamadı");
    }

    return reply.code(201).send(checked.data);
  });
}
