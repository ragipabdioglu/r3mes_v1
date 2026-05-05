import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  safeParseKnowledgeFeedbackCreateRequest,
  safeParseKnowledgeFeedbackCreateResponse,
  safeParseKnowledgeFeedbackProposalGenerateResponse,
  safeParseKnowledgeFeedbackProposalImpactResponse,
  safeParseKnowledgeFeedbackProposalReviewResponse,
  safeParseKnowledgeFeedbackSummaryResponse,
  type KnowledgeFeedbackCreateResponse,
  type KnowledgeFeedbackAggregateItem,
  type KnowledgeFeedbackProposalAction,
  type KnowledgeFeedbackProposalGenerateResponse,
  type KnowledgeFeedbackProposalImpactItem,
  type KnowledgeFeedbackProposalImpactResponse,
  type KnowledgeFeedbackProposalItem,
  type KnowledgeFeedbackProposalReviewResponse,
  type KnowledgeFeedbackSummaryResponse,
} from "@r3mes/shared-types";

import { sendApiError } from "../lib/apiErrors.js";
import { prisma } from "../lib/prisma.js";
import { walletAuthPreHandler } from "../lib/walletAuth.js";

const HASH_RE = /^[a-f0-9]{8,64}$/i;
const DEFAULT_FEEDBACK_LIMIT = 200;
const DEFAULT_PROPOSAL_MIN_SIGNALS = 2;

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

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

type FeedbackRow = {
  kind: string;
  collectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
};

function aggregateKey(row: FeedbackRow): string {
  return [
    row.collectionId ?? "-",
    row.expectedCollectionId ?? "-",
    row.queryHash ?? "-",
  ].join("|");
}

function suggestedActionForAggregate(item: KnowledgeFeedbackAggregateItem): KnowledgeFeedbackProposalAction | null {
  if (item.wrongSourceCount > 0 && item.collectionId) return "PENALIZE_SOURCE";
  if (item.missingSourceCount > 0) return "REVIEW_MISSING_SOURCE";
  if (item.badAnswerCount > 0) return "REVIEW_ANSWER_QUALITY";
  if (item.goodSourceCount > 0 && item.collectionId) return "BOOST_SOURCE";
  return null;
}

function aggregateFeedback(rows: FeedbackRow[]): KnowledgeFeedbackAggregateItem[] {
  const buckets = new Map<string, KnowledgeFeedbackAggregateItem>();
  for (const row of rows) {
    const key = aggregateKey(row);
    const existing = buckets.get(key) ?? {
      key,
      collectionId: row.collectionId,
      expectedCollectionId: row.expectedCollectionId,
      queryHash: row.queryHash,
      total: 0,
      goodSourceCount: 0,
      wrongSourceCount: 0,
      missingSourceCount: 0,
      badAnswerCount: 0,
      goodAnswerCount: 0,
      negativeRate: 0,
      suggestedAction: null,
    };
    existing.total += 1;
    if (row.kind === "GOOD_SOURCE") existing.goodSourceCount += 1;
    if (row.kind === "WRONG_SOURCE") existing.wrongSourceCount += 1;
    if (row.kind === "MISSING_SOURCE") existing.missingSourceCount += 1;
    if (row.kind === "BAD_ANSWER") existing.badAnswerCount += 1;
    if (row.kind === "GOOD_ANSWER") existing.goodAnswerCount += 1;
    buckets.set(key, existing);
  }
  return [...buckets.values()]
    .map((item) => {
      const negativeCount = item.wrongSourceCount + item.missingSourceCount + item.badAnswerCount;
      const negativeRate = item.total > 0 ? Number((negativeCount / item.total).toFixed(3)) : 0;
      const withRate = { ...item, negativeRate };
      return { ...withRate, suggestedAction: suggestedActionForAggregate(withRate) };
    })
    .sort((a, b) => {
      const bSignal = b.wrongSourceCount + b.missingSourceCount + b.badAnswerCount + b.goodSourceCount;
      const aSignal = a.wrongSourceCount + a.missingSourceCount + a.badAnswerCount + a.goodSourceCount;
      return bSignal - aSignal || b.total - a.total;
    });
}

function proposalReason(item: KnowledgeFeedbackAggregateItem, action: KnowledgeFeedbackProposalAction): string {
  if (action === "PENALIZE_SOURCE") {
    return `${item.wrongSourceCount} wrong-source feedback sinyali bu collection için temkinli ceza öneriyor.`;
  }
  if (action === "BOOST_SOURCE") {
    return `${item.goodSourceCount} good-source feedback sinyali bu collection için temkinli boost öneriyor.`;
  }
  if (action === "REVIEW_MISSING_SOURCE") {
    return `${item.missingSourceCount} missing-source feedback sinyali yeni/eksik kaynak incelemesi öneriyor.`;
  }
  return `${item.badAnswerCount} bad-answer feedback sinyali cevap kalitesi incelemesi öneriyor.`;
}

function proposalSignalCount(item: KnowledgeFeedbackAggregateItem, action: KnowledgeFeedbackProposalAction): number {
  if (action === "PENALIZE_SOURCE") return item.wrongSourceCount;
  if (action === "BOOST_SOURCE") return item.goodSourceCount;
  if (action === "REVIEW_MISSING_SOURCE") return item.missingSourceCount;
  return item.badAnswerCount;
}

function toProposalItem(row: {
  id: string;
  action: string;
  status: string;
  collectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  confidence: number;
  reason: string;
  evidence: unknown;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeFeedbackProposalItem {
  return {
    id: row.id,
    action: row.action as KnowledgeFeedbackProposalAction,
    status: row.status as KnowledgeFeedbackProposalItem["status"],
    collectionId: row.collectionId,
    expectedCollectionId: row.expectedCollectionId,
    queryHash: row.queryHash,
    confidence: Math.max(0, Math.min(1, row.confidence)),
    reason: row.reason,
    evidence: row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
      ? row.evidence as Record<string, unknown>
      : {},
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function evidenceSignalCount(proposal: KnowledgeFeedbackProposalItem): number {
  const evidence = proposal.evidence;
  const key =
    proposal.action === "PENALIZE_SOURCE"
      ? "wrongSourceCount"
      : proposal.action === "BOOST_SOURCE"
        ? "goodSourceCount"
        : proposal.action === "REVIEW_MISSING_SOURCE"
          ? "missingSourceCount"
          : "badAnswerCount";
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function buildImpact(proposal: KnowledgeFeedbackProposalItem): {
  impact: KnowledgeFeedbackProposalImpactItem;
  nextSafeAction: KnowledgeFeedbackProposalImpactResponse["nextSafeAction"];
} {
  const signalCount = evidenceSignalCount(proposal);
  const confidence = Math.max(0, Math.min(1, proposal.confidence));
  const direction =
    proposal.action === "BOOST_SOURCE"
      ? 1
      : proposal.action === "PENALIZE_SOURCE"
        ? -1
        : 0;
  const estimatedScoreDelta =
    direction === 0
      ? 0
      : Number((direction * Math.min(0.35, 0.08 + signalCount * 0.04) * Math.max(confidence, 0.25)).toFixed(3));
  const riskLevel =
    proposal.status !== "APPROVED"
      ? "low"
      : Math.abs(estimatedScoreDelta) >= 0.2 || proposal.action === "PENALIZE_SOURCE"
        ? "medium"
        : "low";
  const rationale = [
    `action=${proposal.action}`,
    `status=${proposal.status}`,
    `signalCount=${signalCount}`,
    `confidence=${confidence.toFixed(2)}`,
    "dry-run only: router/profile state is not mutated",
  ];
  if (proposal.action === "REVIEW_MISSING_SOURCE") {
    rationale.push("missing source proposals require ingestion/source review before any router change");
  }
  if (proposal.action === "REVIEW_ANSWER_QUALITY") {
    rationale.push("answer quality proposals should become eval cases before router scoring changes");
  }

  return {
    impact: {
      proposalId: proposal.id,
      action: proposal.action,
      targetCollectionId: proposal.collectionId,
      expectedCollectionId: proposal.expectedCollectionId,
      queryHash: proposal.queryHash,
      estimatedScoreDelta,
      riskLevel,
      wouldAutoApply: false,
      rationale,
    },
    nextSafeAction:
      signalCount < DEFAULT_PROPOSAL_MIN_SIGNALS
        ? "needs_more_feedback"
        : proposal.status === "APPROVED"
          ? "run_eval_before_apply"
          : "review_only",
  };
}

export async function registerFeedbackRoutes(app: FastifyInstance) {
  app.get("/v1/feedback/knowledge/summary", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const user = await ensureUser(wallet);
    const query = req.query as Record<string, unknown>;
    const limit = parsePositiveInt(query.limit, DEFAULT_FEEDBACK_LIMIT, 1000);
    const rows = await prisma.knowledgeFeedback.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        kind: true,
        collectionId: true,
        expectedCollectionId: true,
        queryHash: true,
      },
    });
    const response: KnowledgeFeedbackSummaryResponse = {
      data: aggregateFeedback(rows),
      totalFeedback: rows.length,
      generatedAt: new Date().toISOString(),
    };
    const checked = safeParseKnowledgeFeedbackSummaryResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback summary contract failed");
      return sendApiError(reply, 500, "FEEDBACK_SUMMARY_CONTRACT_FAILED", "Feedback özeti doğrulanamadı");
    }
    return reply.send(checked.data);
  });

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

  app.post("/v1/feedback/knowledge/proposals/generate", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const user = await ensureUser(wallet);
    const query = req.query as Record<string, unknown>;
    const minSignals = parsePositiveInt(query.minSignals, DEFAULT_PROPOSAL_MIN_SIGNALS, 20);
    const rows = await prisma.knowledgeFeedback.findMany({
      where: { userId: user.id, appliedAt: null },
      orderBy: { createdAt: "desc" },
      take: parsePositiveInt(query.limit, DEFAULT_FEEDBACK_LIMIT, 1000),
      select: {
        kind: true,
        collectionId: true,
        expectedCollectionId: true,
        queryHash: true,
      },
    });
    const generated = [];
    for (const item of aggregateFeedback(rows)) {
      const action = item.suggestedAction;
      if (!action) continue;
      const signalCount = proposalSignalCount(item, action);
      if (signalCount < minSignals) continue;
      const existing = await prisma.knowledgeFeedbackProposal.findFirst({
        where: {
          userId: user.id,
          status: "PENDING",
          action,
          collectionId: item.collectionId,
          expectedCollectionId: item.expectedCollectionId,
          queryHash: item.queryHash,
        },
        select: { id: true },
      });
      if (existing) continue;
      const proposal = await prisma.knowledgeFeedbackProposal.create({
        data: {
          userId: user.id,
          action,
          collectionId: item.collectionId,
          expectedCollectionId: item.expectedCollectionId,
          queryHash: item.queryHash,
          confidence: Math.min(1, signalCount / Math.max(minSignals, 1)),
          reason: proposalReason(item, action),
          evidence: item as unknown as Prisma.InputJsonValue,
        },
      });
      generated.push(toProposalItem(proposal));
    }
    const response: KnowledgeFeedbackProposalGenerateResponse = {
      data: generated,
      generatedCount: generated.length,
    };
    const checked = safeParseKnowledgeFeedbackProposalGenerateResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback proposal response contract failed");
      return sendApiError(reply, 500, "FEEDBACK_PROPOSAL_CONTRACT_FAILED", "Feedback proposal yanıtı doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.post("/v1/feedback/knowledge/proposals/:id/:decision", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const params = req.params as { id?: string; decision?: string };
    const decision = params.decision === "approve" ? "APPROVED" : params.decision === "reject" ? "REJECTED" : null;
    if (!params.id || !decision) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_PROPOSAL_DECISION", "Karar approve veya reject olmalı");
    }
    const user = await ensureUser(wallet);
    const existing = await prisma.knowledgeFeedbackProposal.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return sendApiError(reply, 404, "FEEDBACK_PROPOSAL_NOT_FOUND", "Feedback proposal bulunamadı");
    }
    const proposal = await prisma.knowledgeFeedbackProposal.update({
      where: { id: params.id },
      data: {
        status: decision,
        reviewedAt: new Date(),
      },
    });
    const response: KnowledgeFeedbackProposalReviewResponse = {
      proposal: toProposalItem(proposal),
    };
    const checked = safeParseKnowledgeFeedbackProposalReviewResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback proposal review contract failed");
      return sendApiError(reply, 500, "FEEDBACK_PROPOSAL_REVIEW_CONTRACT_FAILED", "Feedback proposal karar yanıtı doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.get("/v1/feedback/knowledge/proposals/:id/impact", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const params = req.params as { id?: string };
    if (!params.id) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_PROPOSAL_ID", "Proposal id gerekli");
    }
    const user = await ensureUser(wallet);
    const proposalRow = await prisma.knowledgeFeedbackProposal.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!proposalRow) {
      return sendApiError(reply, 404, "FEEDBACK_PROPOSAL_NOT_FOUND", "Feedback proposal bulunamadı");
    }
    const proposal = toProposalItem(proposalRow);
    const impact = buildImpact(proposal);
    const response: KnowledgeFeedbackProposalImpactResponse = {
      proposal,
      ...impact,
    };
    const checked = safeParseKnowledgeFeedbackProposalImpactResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback proposal impact contract failed");
      return sendApiError(reply, 500, "FEEDBACK_PROPOSAL_IMPACT_CONTRACT_FAILED", "Feedback proposal etki raporu doğrulanamadı");
    }
    return reply.send(checked.data);
  });
}
