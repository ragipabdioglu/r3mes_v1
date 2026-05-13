import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  safeParseKnowledgeFeedbackApplyMutationPreviewResponse,
  safeParseKnowledgeFeedbackApplyRecordCreateResponse,
  safeParseKnowledgeFeedbackApplyRecordListResponse,
  safeParseKnowledgeFeedbackApplyPlanResponse,
  safeParseKnowledgeFeedbackAdjustmentRollbackResponse,
  safeParseKnowledgeFeedbackCreateRequest,
  safeParseKnowledgeFeedbackCreateResponse,
  safeParseKnowledgeFeedbackGateResultRequest,
  safeParseKnowledgeFeedbackGateResultResponse,
  safeParseKnowledgeFeedbackPassiveApplyResponse,
  safeParseKnowledgeFeedbackPromotionGateResponse,
  safeParseKnowledgeFeedbackProposalGenerateResponse,
  safeParseKnowledgeFeedbackProposalImpactResponse,
  safeParseKnowledgeFeedbackProposalListResponse,
  safeParseKnowledgeFeedbackProposalReviewResponse,
  safeParseKnowledgeFeedbackRouterAdjustmentListResponse,
  safeParseKnowledgeFeedbackRouterScoringSimulationResponse,
  safeParseKnowledgeFeedbackSummaryResponse,
  type KnowledgeFeedbackCreateResponse,
  type KnowledgeFeedbackAggregateItem,
  type KnowledgeFeedbackApplyMutationPreviewResponse,
  type KnowledgeFeedbackApplyMutationPreviewStep,
  type KnowledgeFeedbackApplyPlanResponse,
  type KnowledgeFeedbackApplyRecordCreateResponse,
  type KnowledgeFeedbackApplyRecordItem,
  type KnowledgeFeedbackApplyRecordListResponse,
  type KnowledgeFeedbackApplyPlanStep,
  type KnowledgeFeedbackAdjustmentRollbackResponse,
  type KnowledgeFeedbackGateResultResponse,
  type KnowledgeFeedbackPassiveApplyResponse,
  type KnowledgeFeedbackPromotionGateItem,
  type KnowledgeFeedbackPromotionGateResponse,
  type KnowledgeFeedbackProposalAction,
  type KnowledgeFeedbackProposalGenerateResponse,
  type KnowledgeFeedbackProposalImpactItem,
  type KnowledgeFeedbackProposalImpactResponse,
  type KnowledgeFeedbackProposalItem,
  type KnowledgeFeedbackProposalListResponse,
  type KnowledgeFeedbackProposalReviewResponse,
  type KnowledgeFeedbackRouterAdjustmentItem,
  type KnowledgeFeedbackRouterAdjustmentListResponse,
  type KnowledgeFeedbackRouterScoringSimulationItem,
  type KnowledgeFeedbackRouterScoringSimulationResponse,
  type KnowledgeFeedbackSummaryResponse,
} from "@r3mes/shared-types";

import { sendApiError } from "../lib/apiErrors.js";
import { getDecisionConfig } from "../lib/decisionConfig.js";
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
  const promotionMaxAbsDelta = getDecisionConfig().feedbackRuntime.promotionMaxAbsDelta;
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
      : Number((direction * Math.min(promotionMaxAbsDelta, 0.08 + signalCount * 0.04) * Math.max(confidence, 0.25)).toFixed(3));
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

function buildApplyPlan(proposal: KnowledgeFeedbackProposalItem): {
  steps: KnowledgeFeedbackApplyPlanStep[];
  blockedReasons: string[];
} {
  const { impact, nextSafeAction } = buildImpact(proposal);
  const blockedReasons = [
    "mutation disabled: controlled apply preview only",
    "feedback eval gate must pass before any durable router/profile change",
  ];
  if (proposal.status !== "APPROVED") {
    blockedReasons.push("proposal is not approved");
  }
  if (nextSafeAction !== "run_eval_before_apply") {
    blockedReasons.push(`next safe action is ${nextSafeAction}`);
  }

  const absDelta = Math.max(0.03, Math.min(0.25, Math.abs(impact.estimatedScoreDelta)));
  const base = {
    expectedCollectionId: proposal.expectedCollectionId,
    queryHash: proposal.queryHash,
    reversible: true as const,
  };
  const steps: KnowledgeFeedbackApplyPlanStep[] = [];

  if (proposal.action === "PENALIZE_SOURCE" && proposal.collectionId) {
    steps.push({
      ...base,
      id: `${proposal.id}:penalize:${proposal.collectionId}`,
      kind: "PENALIZE_COLLECTION_SCORE",
      targetCollectionId: proposal.collectionId,
      scoreDelta: -absDelta,
      rollback: "Remove or invert this query-scoped collection penalty.",
      rationale: "Wrong-source feedback says this collection should rank lower for the same query cluster.",
    });
    if (proposal.expectedCollectionId) {
      steps.push({
        ...base,
        id: `${proposal.id}:boost-expected:${proposal.expectedCollectionId}`,
        kind: "BOOST_COLLECTION_SCORE",
        targetCollectionId: proposal.expectedCollectionId,
        scoreDelta: Math.min(0.18, absDelta * 0.75),
        rollback: "Remove this query-scoped expected-source boost.",
        rationale: "Feedback included an expected collection, so the safer preview pairs penalty with a smaller expected-source boost.",
      });
    }
  } else if (proposal.action === "BOOST_SOURCE" && proposal.collectionId) {
    steps.push({
      ...base,
      id: `${proposal.id}:boost:${proposal.collectionId}`,
      kind: "BOOST_COLLECTION_SCORE",
      targetCollectionId: proposal.collectionId,
      scoreDelta: absDelta,
      rollback: "Remove or invert this query-scoped collection boost.",
      rationale: "Good-source feedback says this collection should rank higher for the same query cluster.",
    });
  } else if (proposal.action === "REVIEW_MISSING_SOURCE") {
    steps.push({
      ...base,
      id: `${proposal.id}:missing-source-review`,
      kind: "CREATE_MISSING_SOURCE_REVIEW",
      targetCollectionId: proposal.expectedCollectionId ?? proposal.collectionId,
      scoreDelta: 0,
      rollback: "Close the generated missing-source review item without router/profile changes.",
      rationale: "Missing-source feedback should become an ingestion/source coverage review before scoring changes.",
    });
  } else if (proposal.action === "REVIEW_ANSWER_QUALITY") {
    steps.push({
      ...base,
      id: `${proposal.id}:answer-quality-eval`,
      kind: "CREATE_ANSWER_QUALITY_EVAL",
      targetCollectionId: proposal.collectionId,
      scoreDelta: 0,
      rollback: "Remove the generated answer-quality eval case before it is promoted to a gate.",
      rationale: "Bad-answer feedback should become a regression eval before router/profile scoring changes.",
    });
  }

  return { steps, blockedReasons };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const FEEDBACK_METADATA_STRING_LIMIT = 1000;
const FEEDBACK_METADATA_ARRAY_LIMIT = 25;
const FEEDBACK_METADATA_OBJECT_KEYS_LIMIT = 80;
const FEEDBACK_METADATA_BLOCKED_KEYS = new Set(["query", "rawQuery", "question", "prompt", "messages"]);
const FEEDBACK_SAFE_QUERY_LIMIT = 500;

function sanitizeFeedbackMetadata(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, FEEDBACK_METADATA_STRING_LIMIT);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, FEEDBACK_METADATA_ARRAY_LIMIT)
      .map((item) => sanitizeFeedbackMetadata(item, depth + 1))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
    return items;
  }
  if (depth >= 3) return undefined;
  if (!value || typeof value !== "object") return undefined;

  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, entry] of Object.entries(value).slice(0, FEEDBACK_METADATA_OBJECT_KEYS_LIMIT)) {
    if (FEEDBACK_METADATA_BLOCKED_KEYS.has(key)) continue;
    const safeValue = sanitizeFeedbackMetadata(entry, depth + 1);
    if (safeValue !== undefined) out[key] = safeValue;
  }
  return out;
}

function redactFeedbackQueryForEval(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 3) return null;
  const redacted = normalized
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\bTR\d{2}(?:\s?[A-Z0-9]){16,30}\b/gi, "[iban]")
    .replace(/\b0x[a-f0-9]{16,}\b/gi, "[wallet]")
    .replace(/\b\d{11}\b/g, "[tckn]")
    .replace(/\b(?:\+?\d[\s-]?){7,}\b/g, "[number]")
    .replace(/\b[a-f0-9]{24,64}\b/gi, "[id]")
    .replace(/\bhttps?:\/\/\S+\b/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FEEDBACK_SAFE_QUERY_LIMIT)
    .trim();
  return redacted.length >= 3 ? redacted : null;
}

function metadataHasSafeEvalQuery(metadata: Record<string, unknown>): boolean {
  for (const key of ["evalQuery", "redactedQuery", "safeQuery"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length >= 3) return true;
  }
  return false;
}

function buildFeedbackMetadata(opts: {
  metadata: unknown;
  query?: string | null;
}): Prisma.InputJsonValue | undefined {
  const sanitized = sanitizeFeedbackMetadata(opts.metadata);
  const metadata = asObject(sanitized) ? { ...asObject(sanitized) } : {};
  if (!metadataHasSafeEvalQuery(metadata)) {
    const safeQuery = redactFeedbackQueryForEval(opts.query);
    if (safeQuery) {
      metadata.safeQuery = safeQuery;
      metadata.evalQuerySource = "server_redacted_v1";
    }
  }
  return Object.keys(metadata).length > 0 ? metadata as Prisma.InputJsonObject : undefined;
}

function summarizeGateReport(value: unknown): KnowledgeFeedbackApplyRecordItem["gateReportSummary"] {
  const report = asObject(value);
  if (!report) return null;
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const normalizedChecks = checks
    .map((check) => asObject(check))
    .filter((check): check is Record<string, unknown> => Boolean(check));
  const checksPassed = normalizedChecks.filter((check) => check.ok === true).length;
  const failedChecks = normalizedChecks
    .filter((check) => check.ok === false)
    .map((check) => typeof check.name === "string" && check.name.trim() ? check.name.trim() : "unnamed_check");
  const productionGate = normalizedChecks.find((check) => check.name === "production_rag_gate");
  return {
    ok: typeof report.ok === "boolean" ? report.ok : null,
    checksTotal: normalizedChecks.length,
    checksPassed,
    checksFailed: failedChecks.length,
    failedChecks,
    durationMs: typeof report.durationMs === "number" && Number.isFinite(report.durationMs) ? report.durationMs : null,
    quick: typeof report.quick === "boolean" ? report.quick : null,
    applyAllowed: typeof report.applyAllowed === "boolean" ? report.applyAllowed : null,
    feedbackCaseCount:
      typeof report.feedbackCaseCount === "number" && Number.isFinite(report.feedbackCaseCount)
        ? Math.max(0, Math.floor(report.feedbackCaseCount))
        : null,
    feedbackCaseCoverageOk:
      typeof report.feedbackCaseCoverageOk === "boolean" ? report.feedbackCaseCoverageOk : null,
    approvedProposalCount:
      typeof report.approvedProposalCount === "number" && Number.isFinite(report.approvedProposalCount)
        ? Math.max(0, Math.floor(report.approvedProposalCount))
        : null,
    productionGateRan: productionGate ? productionGate.skipped !== true : null,
    generatedAt: typeof report.generatedAt === "string" ? report.generatedAt : null,
  };
}

function toApplyRecordItem(row: {
  id: string;
  proposalId: string;
  status: string;
  plan: unknown;
  gateReport?: unknown;
  reason: string | null;
  plannedAt: Date;
  gateCheckedAt: Date | null;
  appliedAt: Date | null;
  rolledBackAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeFeedbackApplyRecordItem {
  return {
    id: row.id,
    proposalId: row.proposalId,
    status: row.status as KnowledgeFeedbackApplyRecordItem["status"],
    plan: row.plan as KnowledgeFeedbackApplyPlanResponse,
    gateReportSummary: summarizeGateReport(row.gateReport),
    reason: row.reason,
    plannedAt: row.plannedAt.toISOString(),
    gateCheckedAt: row.gateCheckedAt?.toISOString() ?? null,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRouterAdjustmentItem(row: {
  id: string;
  proposalId: string;
  applyRecordId: string;
  status: string;
  stepId: string;
  kind: string;
  mutationPath: string;
  collectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  scoreDelta: number;
  simulatedBefore: number | null;
  simulatedAfter: number | null;
  rollbackReason: string | null;
  createdAt: Date;
  rolledBackAt: Date | null;
  updatedAt: Date;
}): KnowledgeFeedbackRouterAdjustmentItem {
  return {
    id: row.id,
    proposalId: row.proposalId,
    applyRecordId: row.applyRecordId,
    status: row.status as KnowledgeFeedbackRouterAdjustmentItem["status"],
    stepId: row.stepId,
    kind: row.kind,
    mutationPath: row.mutationPath,
    collectionId: row.collectionId,
    expectedCollectionId: row.expectedCollectionId,
    queryHash: row.queryHash,
    scoreDelta: row.scoreDelta,
    simulatedBefore: row.simulatedBefore,
    simulatedAfter: row.simulatedAfter,
    rollbackReason: row.rollbackReason,
    createdAt: row.createdAt.toISOString(),
    rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildApplyPlanResponse(proposal: KnowledgeFeedbackProposalItem): KnowledgeFeedbackApplyPlanResponse {
  const { impact } = buildImpact(proposal);
  const plan = buildApplyPlan(proposal);
  return {
    proposal,
    impact,
    steps: plan.steps,
    mutationEnabled: false,
    applyAllowed: false,
    requiredGate: "feedback_eval_gate",
    blockedReasons: plan.blockedReasons,
  };
}

function clampPreviewScore(value: number): number {
  return Math.max(-1, Math.min(1, Number(value.toFixed(4))));
}

function parseCollectionIds(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return Array.from(
    new Set(
      rawValues
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

function groupRouterScoringSimulation(
  adjustments: Array<{
    id: string;
    stepId: string;
    collectionId: string | null;
    queryHash: string | null;
    scoreDelta: number;
  }>,
): KnowledgeFeedbackRouterScoringSimulationItem[] {
  const grouped = new Map<string, KnowledgeFeedbackRouterScoringSimulationItem>();
  for (const adjustment of adjustments) {
    const key = `${adjustment.collectionId ?? "-"}|${adjustment.queryHash ?? "-"}`;
    const existing = grouped.get(key) ?? {
      collectionId: adjustment.collectionId,
      queryHash: adjustment.queryHash,
      activeAdjustmentCount: 0,
      totalScoreDelta: 0,
      appliedStepIds: [],
      adjustmentIds: [],
      simulatedBefore: 0,
      simulatedAfter: 0,
    };
    existing.activeAdjustmentCount += 1;
    existing.totalScoreDelta = clampPreviewScore(existing.totalScoreDelta + adjustment.scoreDelta);
    existing.simulatedAfter = clampPreviewScore(existing.simulatedBefore + existing.totalScoreDelta);
    existing.appliedStepIds.push(adjustment.stepId);
    existing.adjustmentIds.push(adjustment.id);
    grouped.set(key, existing);
  }
  return Array.from(grouped.values()).sort((a, b) => {
    const impactDiff = Math.abs(b.totalScoreDelta) - Math.abs(a.totalScoreDelta);
    if (impactDiff !== 0) return impactDiff;
    return b.activeAdjustmentCount - a.activeAdjustmentCount;
  });
}

function buildPromotionGateReport(
  adjustments: Array<{
    id: string;
    collectionId: string | null;
    queryHash: string | null;
    scoreDelta: number;
    applyRecord: {
      status: string;
      gateReport: unknown;
    };
  }>,
): KnowledgeFeedbackPromotionGateItem[] {
  const promotionMaxAbsDelta = getDecisionConfig().feedbackRuntime.promotionMaxAbsDelta;
  const grouped = new Map<string, KnowledgeFeedbackPromotionGateItem>();
  for (const adjustment of adjustments) {
    const key = `${adjustment.collectionId ?? "-"}|${adjustment.queryHash ?? "-"}`;
    const gateSummary = summarizeGateReport(adjustment.applyRecord.gateReport);
    const existing = grouped.get(key) ?? {
      collectionId: adjustment.collectionId,
      queryHash: adjustment.queryHash,
      activeAdjustmentCount: 0,
      gatePassedCount: 0,
      totalScoreDelta: 0,
      promotionCandidate: false,
      promotionStage: "blocked",
      rollbackRecommended: false,
      nextSafeAction: "keep_passive",
      blockedReasons: [] as string[],
      recommendation: "keep_passive" as const,
      adjustmentIds: [] as string[],
    };
    existing.activeAdjustmentCount += 1;
    existing.gatePassedCount += adjustment.applyRecord.status === "APPLIED" && gateSummary?.ok === true ? 1 : 0;
    existing.totalScoreDelta = clampPreviewScore(existing.totalScoreDelta + adjustment.scoreDelta);
    existing.adjustmentIds.push(adjustment.id);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).map((item) => {
    const blockedReasons = new Set<string>();
    if (!item.collectionId) blockedReasons.add("missing target collection");
    if (!item.queryHash) blockedReasons.add("missing query hash");
    if (item.gatePassedCount !== item.activeAdjustmentCount) blockedReasons.add("not all source apply records passed eval gate");
    if (item.totalScoreDelta === 0) blockedReasons.add("review-only adjustment has no runtime score effect");
    if (Math.abs(item.totalScoreDelta) > promotionMaxAbsDelta) {
      blockedReasons.add(`score delta exceeds promotion cap ${promotionMaxAbsDelta}`);
    }
    const blocked = Array.from(blockedReasons);
    const promotionCandidate = blocked.length === 0;
    const recommendation: KnowledgeFeedbackPromotionGateItem["recommendation"] = promotionCandidate
      ? "eligible_for_shadow_runtime"
      : item.totalScoreDelta === 0
        ? "review_only"
        : "keep_passive";
    const rollbackRecommended =
      blockedReasons.has("not all source apply records passed eval gate") ||
      blockedReasons.has(`score delta exceeds promotion cap ${promotionMaxAbsDelta}`);
    const promotionStage: KnowledgeFeedbackPromotionGateItem["promotionStage"] = promotionCandidate
      ? "eligible_shadow"
      : recommendation === "review_only"
        ? "review_only"
        : "blocked";
    const nextSafeAction: KnowledgeFeedbackPromotionGateItem["nextSafeAction"] = promotionCandidate
      ? "eligible_for_shadow_observation"
      : rollbackRecommended
        ? "rollback_or_review"
        : blocked.length > 0
          ? "inspect_blockers"
          : "keep_passive";
    return {
      ...item,
      promotionCandidate,
      promotionStage,
      rollbackRecommended,
      nextSafeAction,
      blockedReasons: blocked,
      recommendation,
    };
  }).sort((a, b) => {
    if (a.promotionCandidate !== b.promotionCandidate) return a.promotionCandidate ? -1 : 1;
    return Math.abs(b.totalScoreDelta) - Math.abs(a.totalScoreDelta);
  });
}

function mutationPathForStep(step: KnowledgeFeedbackApplyPlanStep): KnowledgeFeedbackApplyMutationPreviewStep["mutationPath"] {
  if (step.kind === "CREATE_MISSING_SOURCE_REVIEW") return "missing_source_review";
  if (step.kind === "CREATE_ANSWER_QUALITY_EVAL") return "answer_quality_eval";
  return "query_scoped_collection_adjustment";
}

function previewStepEffect(step: KnowledgeFeedbackApplyPlanStep): KnowledgeFeedbackApplyMutationPreviewStep["effect"] {
  if (step.kind === "BOOST_COLLECTION_SCORE") return "boost";
  if (step.kind === "PENALIZE_COLLECTION_SCORE") return "penalty";
  return "review_only";
}

function buildMutationPreview(record: KnowledgeFeedbackApplyRecordItem): KnowledgeFeedbackApplyMutationPreviewResponse {
  const previewSteps: KnowledgeFeedbackApplyMutationPreviewStep[] = record.plan.steps.map((step) => {
    const isScoreAdjustment = step.kind === "BOOST_COLLECTION_SCORE" || step.kind === "PENALIZE_COLLECTION_SCORE";
    const simulatedCurrentScore = isScoreAdjustment ? 0 : null;
    const simulatedNextScore = isScoreAdjustment ? clampPreviewScore((simulatedCurrentScore ?? 0) + step.scoreDelta) : null;
    return {
      stepId: step.id,
      kind: step.kind,
      targetCollectionId: step.targetCollectionId,
      expectedCollectionId: step.expectedCollectionId,
      queryHash: step.queryHash,
      mutationPath: mutationPathForStep(step),
      simulatedCurrentScore,
      scoreDelta: step.scoreDelta,
      simulatedNextScore,
      effect: previewStepEffect(step),
      reversible: true as const,
      rollback: step.rollback,
      rationale: step.rationale,
    };
  });
  const blockedReasons = [
    "mutation preview only: no router/profile state was changed",
    "durable feedback weights do not exist yet; score values are simulated from neutral baseline",
  ];
  if (record.status !== "GATE_PASSED") {
    blockedReasons.push(`apply record status is ${record.status}, expected GATE_PASSED`);
  }
  if (record.gateReportSummary?.ok !== true) {
    blockedReasons.push("feedback eval gate has not passed");
  }
  return {
    record,
    previewSteps,
    mutationApplied: false,
    applyAllowed: false,
    blockedReasons,
    generatedAt: new Date().toISOString(),
  };
}

function adjustmentDataFromPreviewStep(opts: {
  userId: string;
  record: KnowledgeFeedbackApplyRecordItem;
  step: KnowledgeFeedbackApplyMutationPreviewStep;
}) {
  return {
    userId: opts.userId,
    proposalId: opts.record.proposalId,
    applyRecordId: opts.record.id,
    stepId: opts.step.stepId,
    kind: opts.step.kind,
    mutationPath: opts.step.mutationPath,
    collectionId: opts.step.targetCollectionId,
    expectedCollectionId: opts.step.expectedCollectionId,
    queryHash: opts.step.queryHash,
    scoreDelta: opts.step.scoreDelta,
    simulatedBefore: opts.step.simulatedCurrentScore,
    simulatedAfter: opts.step.simulatedNextScore,
    metadata: {
      passive: true,
      routerRuntimeAffected: false,
      rationale: opts.step.rationale,
      effect: opts.step.effect,
      rollback: opts.step.rollback,
    },
  };
}

export async function registerFeedbackRoutes(app: FastifyInstance) {
  app.get("/v1/feedback/knowledge/proposals", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const user = await ensureUser(wallet);
    const query = req.query as Record<string, unknown>;
    const status =
      query.status === "PENDING" || query.status === "APPROVED" || query.status === "REJECTED"
        ? query.status
        : undefined;
    const limit = parsePositiveInt(query.limit, 50, 200);
    const rows = await prisma.knowledgeFeedbackProposal.findMany({
      where: {
        userId: user.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });
    const response: KnowledgeFeedbackProposalListResponse = {
      data: rows.slice(0, limit).map(toProposalItem),
      nextCursor: rows.length > limit ? rows[limit]?.id ?? null : null,
    };
    const checked = safeParseKnowledgeFeedbackProposalListResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback proposal list contract failed");
      return sendApiError(reply, 500, "FEEDBACK_PROPOSAL_LIST_CONTRACT_FAILED", "Feedback proposal listesi doğrulanamadı");
    }
    return reply.send(checked.data);
  });

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
        metadata: buildFeedbackMetadata({ metadata: body.metadata, query: body.query }),
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

  app.get("/v1/feedback/knowledge/proposals/:id/apply-plan", { preHandler: walletAuthPreHandler }, async (req, reply) => {
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
    const response = buildApplyPlanResponse(proposal);
    const checked = safeParseKnowledgeFeedbackApplyPlanResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback apply plan contract failed");
      return sendApiError(reply, 500, "FEEDBACK_APPLY_PLAN_CONTRACT_FAILED", "Feedback apply plan doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.get("/v1/feedback/knowledge/apply-records", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const query = req.query as { status?: string; limit?: string };
    const allowedStatuses = new Set(["PLANNED", "GATE_PASSED", "APPLIED", "ROLLED_BACK", "BLOCKED"]);
    const status = typeof query.status === "string" && allowedStatuses.has(query.status) ? query.status : null;
    const limit = Math.max(1, Math.min(100, Number(query.limit ?? 25) || 25));
    const user = await ensureUser(wallet);
    const rows = await prisma.knowledgeFeedbackApplyRecord.findMany({
      where: {
        userId: user.id,
        ...(status ? { status: status as "PLANNED" | "GATE_PASSED" | "APPLIED" | "ROLLED_BACK" | "BLOCKED" } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const response: KnowledgeFeedbackApplyRecordListResponse = {
      data: rows.map(toApplyRecordItem),
      total: rows.length,
      generatedAt: new Date().toISOString(),
    };
    const checked = safeParseKnowledgeFeedbackApplyRecordListResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback apply record list contract failed");
      return sendApiError(reply, 500, "FEEDBACK_APPLY_RECORD_LIST_CONTRACT_FAILED", "Feedback apply record listesi doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.get("/v1/feedback/knowledge/apply-records/:recordId/mutation-preview", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const params = req.params as { recordId?: string };
    if (!params.recordId) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_APPLY_RECORD_ID", "Apply record id gerekli");
    }
    const user = await ensureUser(wallet);
    const row = await prisma.knowledgeFeedbackApplyRecord.findFirst({
      where: { id: params.recordId, userId: user.id },
    });
    if (!row) {
      return sendApiError(reply, 404, "FEEDBACK_APPLY_RECORD_NOT_FOUND", "Feedback apply record bulunamadı");
    }
    const response = buildMutationPreview(toApplyRecordItem(row));
    const checked = safeParseKnowledgeFeedbackApplyMutationPreviewResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback mutation preview contract failed");
      return sendApiError(reply, 500, "FEEDBACK_MUTATION_PREVIEW_CONTRACT_FAILED", "Feedback mutation preview doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.post("/v1/feedback/knowledge/apply-records/:recordId/apply-passive", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const params = req.params as { recordId?: string };
    if (!params.recordId) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_APPLY_RECORD_ID", "Apply record id gerekli");
    }
    const user = await ensureUser(wallet);
    const row = await prisma.knowledgeFeedbackApplyRecord.findFirst({
      where: { id: params.recordId, userId: user.id },
    });
    if (!row) {
      return sendApiError(reply, 404, "FEEDBACK_APPLY_RECORD_NOT_FOUND", "Feedback apply record bulunamadı");
    }
    const record = toApplyRecordItem(row);
    if (record.status !== "GATE_PASSED" && record.status !== "APPLIED") {
      return sendApiError(reply, 409, "FEEDBACK_APPLY_RECORD_NOT_READY", "Apply record önce eval gate'ten geçmeli");
    }
    if (record.gateReportSummary?.ok !== true) {
      return sendApiError(reply, 409, "FEEDBACK_GATE_NOT_PASSED", "Feedback eval gate geçmeden passive apply yapılamaz");
    }

    let adjustments = await prisma.knowledgeFeedbackRouterAdjustment.findMany({
      where: { userId: user.id, applyRecordId: record.id },
      orderBy: { createdAt: "asc" },
    });
    let nextRecord = record;

    if (adjustments.length === 0) {
      const preview = buildMutationPreview(record);
      await prisma.knowledgeFeedbackRouterAdjustment.createMany({
        data: preview.previewSteps.map((step) => adjustmentDataFromPreviewStep({ userId: user.id, record, step })),
      });
      adjustments = await prisma.knowledgeFeedbackRouterAdjustment.findMany({
        where: { userId: user.id, applyRecordId: record.id },
        orderBy: { createdAt: "asc" },
      });
      const updatedRecord = await prisma.knowledgeFeedbackApplyRecord.update({
        where: { id: record.id },
        data: {
          status: "APPLIED",
          appliedAt: new Date(),
          appliedDelta: {
            passive: true,
            routerRuntimeAffected: false,
            adjustmentIds: adjustments.map((item) => item.id),
            previewSteps: preview.previewSteps,
          } as unknown as Prisma.InputJsonValue,
          reason: "passive router adjustments recorded; router runtime integration remains disabled",
        },
      });
      nextRecord = toApplyRecordItem(updatedRecord);
    }

    const response: KnowledgeFeedbackPassiveApplyResponse = {
      record: nextRecord,
      adjustments: adjustments.map(toRouterAdjustmentItem),
      mutationApplied: false,
      routerRuntimeAffected: false,
      nextSafeAction: "router_integration_disabled",
    };
    const checked = safeParseKnowledgeFeedbackPassiveApplyResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback passive apply contract failed");
      return sendApiError(reply, 500, "FEEDBACK_PASSIVE_APPLY_CONTRACT_FAILED", "Feedback passive apply doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.get("/v1/feedback/knowledge/router-adjustments/simulation", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const query = asObject(req.query) ?? {};
    const queryHash = normalizeOptionalString(typeof query.queryHash === "string" ? query.queryHash : null);
    if (queryHash && !HASH_RE.test(queryHash)) {
      return sendApiError(reply, 400, "INVALID_QUERY_HASH", "queryHash 8-64 karakter hex olmalı");
    }
    const collectionIds = parseCollectionIds(query.collectionIds);
    const user = await ensureUser(wallet);
    const rows = await prisma.knowledgeFeedbackRouterAdjustment.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        ...(queryHash ? { queryHash } : {}),
        ...(collectionIds.length > 0 ? { collectionId: { in: collectionIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const response: KnowledgeFeedbackRouterScoringSimulationResponse = {
      queryHash,
      collectionIds,
      results: groupRouterScoringSimulation(rows),
      runtimeAffected: false,
      generatedAt: new Date().toISOString(),
    };
    const checked = safeParseKnowledgeFeedbackRouterScoringSimulationResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback router scoring simulation contract failed");
      return sendApiError(reply, 500, "FEEDBACK_SCORING_SIMULATION_CONTRACT_FAILED", "Feedback scoring simulation doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.get("/v1/feedback/knowledge/router-adjustments/promotion-gate", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const query = asObject(req.query) ?? {};
    const queryHash = normalizeOptionalString(typeof query.queryHash === "string" ? query.queryHash : null);
    if (queryHash && !HASH_RE.test(queryHash)) {
      return sendApiError(reply, 400, "INVALID_QUERY_HASH", "queryHash 8-64 karakter hex olmalı");
    }
    const collectionIds = parseCollectionIds(query.collectionIds);
    const user = await ensureUser(wallet);
    const rows = await prisma.knowledgeFeedbackRouterAdjustment.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        ...(queryHash ? { queryHash } : {}),
        ...(collectionIds.length > 0 ? { collectionId: { in: collectionIds } } : {}),
      },
      include: {
        applyRecord: {
          select: {
            status: true,
            gateReport: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const data = buildPromotionGateReport(rows);
    const response: KnowledgeFeedbackPromotionGateResponse = {
      data,
      total: data.length,
      runtimeAffected: false,
      promotionApplied: false,
      generatedAt: new Date().toISOString(),
    };
    const checked = safeParseKnowledgeFeedbackPromotionGateResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback promotion gate contract failed");
      return sendApiError(reply, 500, "FEEDBACK_PROMOTION_GATE_CONTRACT_FAILED", "Feedback promotion gate doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.post("/v1/feedback/knowledge/router-adjustments/:adjustmentId/rollback", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const params = req.params as { adjustmentId?: string };
    if (!params.adjustmentId) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_ADJUSTMENT_ID", "Adjustment id gerekli");
    }
    const user = await ensureUser(wallet);
    const existing = await prisma.knowledgeFeedbackRouterAdjustment.findFirst({
      where: { id: params.adjustmentId, userId: user.id },
    });
    if (!existing) {
      return sendApiError(reply, 404, "FEEDBACK_ADJUSTMENT_NOT_FOUND", "Feedback adjustment bulunamadı");
    }
    const body = asObject(req.body);
    const rollbackReason = normalizeOptionalString(typeof body?.reason === "string" ? body.reason : null)
      ?? "manual passive adjustment rollback";
    const adjustment = existing.status === "ROLLED_BACK"
      ? existing
      : await prisma.knowledgeFeedbackRouterAdjustment.update({
          where: { id: existing.id },
          data: {
            status: "ROLLED_BACK",
            rolledBackAt: new Date(),
            rollbackReason,
          },
        });
    const response: KnowledgeFeedbackAdjustmentRollbackResponse = {
      adjustment: toRouterAdjustmentItem(adjustment),
      mutationApplied: false,
      routerRuntimeAffected: false,
    };
    const checked = safeParseKnowledgeFeedbackAdjustmentRollbackResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback adjustment rollback contract failed");
      return sendApiError(reply, 500, "FEEDBACK_ADJUSTMENT_ROLLBACK_CONTRACT_FAILED", "Feedback adjustment rollback doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.get("/v1/feedback/knowledge/router-adjustments", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const query = req.query as { status?: string; limit?: string };
    const status = query.status === "ACTIVE" || query.status === "ROLLED_BACK" ? query.status : null;
    const limit = Math.max(1, Math.min(100, Number(query.limit ?? 25) || 25));
    const user = await ensureUser(wallet);
    const rows = await prisma.knowledgeFeedbackRouterAdjustment.findMany({
      where: {
        userId: user.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const response: KnowledgeFeedbackRouterAdjustmentListResponse = {
      data: rows.map(toRouterAdjustmentItem),
      total: rows.length,
      generatedAt: new Date().toISOString(),
    };
    const checked = safeParseKnowledgeFeedbackRouterAdjustmentListResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback router adjustment list contract failed");
      return sendApiError(reply, 500, "FEEDBACK_ADJUSTMENT_LIST_CONTRACT_FAILED", "Feedback adjustment listesi doğrulanamadı");
    }
    return reply.send(checked.data);
  });

  app.post("/v1/feedback/knowledge/proposals/:id/apply-records", { preHandler: walletAuthPreHandler }, async (req, reply) => {
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
    const plan = buildApplyPlanResponse(proposal);
    const checkedPlan = safeParseKnowledgeFeedbackApplyPlanResponse(plan);
    if (!checkedPlan.success) {
      req.log.error({ err: checkedPlan.error }, "Knowledge feedback apply plan contract failed before record create");
      return sendApiError(reply, 500, "FEEDBACK_APPLY_PLAN_CONTRACT_FAILED", "Feedback apply plan doğrulanamadı");
    }
    const record = await prisma.knowledgeFeedbackApplyRecord.create({
      data: {
        userId: user.id,
        proposalId: proposal.id,
        status: "PLANNED",
        plan: checkedPlan.data as unknown as Prisma.InputJsonValue,
        rollbackPlan: {
          steps: checkedPlan.data.steps.map((step) => ({
            stepId: step.id,
            rollback: step.rollback,
          })),
        },
        reason: "controlled apply preview recorded; no router/profile mutation applied",
      },
    });
    const response: KnowledgeFeedbackApplyRecordCreateResponse = {
      record: toApplyRecordItem(record),
      mutationApplied: false,
      nextSafeAction: "run_feedback_eval_gate",
    };
    const checked = safeParseKnowledgeFeedbackApplyRecordCreateResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback apply record contract failed");
      return sendApiError(reply, 500, "FEEDBACK_APPLY_RECORD_CONTRACT_FAILED", "Feedback apply record doğrulanamadı");
    }
    return reply.code(201).send(checked.data);
  });

  app.post("/v1/feedback/knowledge/apply-records/:recordId/gate-result", { preHandler: walletAuthPreHandler }, async (req, reply) => {
    const wallet = req.verifiedWalletAddress;
    if (!wallet) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    const params = req.params as { recordId?: string };
    if (!params.recordId) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_APPLY_RECORD_ID", "Apply record id gerekli");
    }
    const parsed = safeParseKnowledgeFeedbackGateResultRequest(req.body);
    if (!parsed.success) {
      return sendApiError(reply, 400, "INVALID_FEEDBACK_GATE_RESULT", parsed.error.message);
    }
    const user = await ensureUser(wallet);
    const existing = await prisma.knowledgeFeedbackApplyRecord.findFirst({
      where: { id: params.recordId, userId: user.id },
      select: { id: true, status: true },
    });
    if (!existing) {
      return sendApiError(reply, 404, "FEEDBACK_APPLY_RECORD_NOT_FOUND", "Feedback apply record bulunamadı");
    }
    if (existing.status === "APPLIED" || existing.status === "ROLLED_BACK") {
      return sendApiError(reply, 409, "FEEDBACK_APPLY_RECORD_FINALIZED", "Final durumdaki apply record güncellenemez");
    }
    const nextStatus = parsed.data.ok ? "GATE_PASSED" : "BLOCKED";
    const record = await prisma.knowledgeFeedbackApplyRecord.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        gateReport: (parsed.data.report ?? { ok: parsed.data.ok }) as Prisma.InputJsonValue,
        gateCheckedAt: new Date(),
        reason: normalizeOptionalString(parsed.data.reason) ?? (parsed.data.ok
          ? "feedback eval gate passed; awaiting manual apply review"
          : "feedback eval gate failed; inspect gate report before retry"),
      },
    });
    const response: KnowledgeFeedbackGateResultResponse = {
      record: toApplyRecordItem(record),
      gatePassed: parsed.data.ok,
      mutationApplied: false,
      nextSafeAction: parsed.data.ok ? "manual_apply_review" : "inspect_gate_failures",
    };
    const checked = safeParseKnowledgeFeedbackGateResultResponse(response);
    if (!checked.success) {
      req.log.error({ err: checked.error }, "Knowledge feedback gate result contract failed");
      return sendApiError(reply, 500, "FEEDBACK_GATE_RESULT_CONTRACT_FAILED", "Feedback gate sonucu doğrulanamadı");
    }
    return reply.send(checked.data);
  });
}
