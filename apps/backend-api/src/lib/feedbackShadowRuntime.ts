import { createHash } from "node:crypto";

import { getDecisionConfig, getDecisionConfigVersion } from "./decisionConfig.js";
import { prisma } from "./prisma.js";

export type FeedbackRuntimeMode = "shadow" | "active";

export interface FeedbackShadowRuntimeImpact {
  collectionId: string;
  totalScoreDelta: number;
  activeAdjustmentCount: number;
  gatePassedCount: number;
  promotionStage: "eligible_shadow" | "blocked" | "review_only";
  rollbackRecommended: boolean;
  nextSafeAction:
    | "keep_passive"
    | "inspect_blockers"
    | "rollback_or_review"
    | "eligible_for_shadow_observation";
  recommendation: "eligible_for_shadow_runtime" | "keep_passive" | "review_only";
  blockedReasons: string[];
  adjustmentIds: string[];
}

export interface FeedbackShadowRuntimeReport {
  enabled: boolean;
  decisionConfigVersion: string;
  runtimeMode: FeedbackRuntimeMode;
  promotionMaxAbsDelta: number;
  runtimeAffected: boolean;
  queryHash: string | null;
  candidateCollectionIds: string[];
  adjustedCandidateCollectionIds: string[];
  activeAdjustmentCount: number;
  promotedCandidateCount: number;
  currentTopCandidateId: string | null;
  shadowTopCandidateId: string | null;
  wouldChangeTopCandidate: boolean;
  impacts: FeedbackShadowRuntimeImpact[];
}

function runtimeMode(): FeedbackRuntimeMode {
  return getDecisionConfig().feedbackRuntime.mode;
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query.trim(), "utf8").digest("hex").slice(0, 16);
}

function clampScore(value: number): number {
  return Math.max(-1, Math.min(1, Number(value.toFixed(4))));
}

function gatePassed(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).ok === true);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function evaluateFeedbackShadowRuntime(opts: {
  walletAddress: string;
  query: string;
  candidateCollectionIds: string[];
}): Promise<FeedbackShadowRuntimeReport> {
  const config = getDecisionConfig();
  const candidateCollectionIds = uniqueStrings(opts.candidateCollectionIds).slice(0, config.feedbackRuntime.candidateLimit);
  const query = opts.query.trim();
  const queryHash = query ? hashQuery(query) : null;
  const mode = runtimeMode();
  const empty: FeedbackShadowRuntimeReport = {
    enabled: true,
    decisionConfigVersion: getDecisionConfigVersion(),
    runtimeMode: mode,
    promotionMaxAbsDelta: config.feedbackRuntime.promotionMaxAbsDelta,
    runtimeAffected: false,
    queryHash,
    candidateCollectionIds,
    adjustedCandidateCollectionIds: candidateCollectionIds,
    activeAdjustmentCount: 0,
    promotedCandidateCount: 0,
    currentTopCandidateId: candidateCollectionIds[0] ?? null,
    shadowTopCandidateId: candidateCollectionIds[0] ?? null,
    wouldChangeTopCandidate: false,
    impacts: [],
  };
  if (!queryHash || candidateCollectionIds.length === 0) return empty;

  const user = await prisma.user.findUnique({
    where: { walletAddress: opts.walletAddress },
    select: { id: true },
  });
  if (!user) return empty;

  const rows = await prisma.knowledgeFeedbackRouterAdjustment.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      queryHash,
      collectionId: { in: candidateCollectionIds },
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
    take: 250,
  });
  if (rows.length === 0) return empty;

  const grouped = new Map<string, FeedbackShadowRuntimeImpact>();
  for (const row of rows) {
    if (!row.collectionId) continue;
    const existing = grouped.get(row.collectionId) ?? {
      collectionId: row.collectionId,
      totalScoreDelta: 0,
      activeAdjustmentCount: 0,
      gatePassedCount: 0,
      promotionStage: "blocked" as const,
      rollbackRecommended: false,
      nextSafeAction: "keep_passive" as const,
      recommendation: "keep_passive" as const,
      blockedReasons: [],
      adjustmentIds: [],
    };
    existing.totalScoreDelta = clampScore(existing.totalScoreDelta + row.scoreDelta);
    existing.activeAdjustmentCount += 1;
    existing.gatePassedCount += row.applyRecord.status === "APPLIED" && gatePassed(row.applyRecord.gateReport) ? 1 : 0;
    existing.adjustmentIds.push(row.id);
    grouped.set(row.collectionId, existing);
  }

  const impacts = Array.from(grouped.values()).map((impact) => {
    const blockedReasons = new Set<string>();
    if (impact.gatePassedCount !== impact.activeAdjustmentCount) {
      blockedReasons.add("not all source apply records passed eval gate");
    }
    if (impact.totalScoreDelta === 0) {
      blockedReasons.add("review-only adjustment has no runtime score effect");
    }
    if (Math.abs(impact.totalScoreDelta) > config.feedbackRuntime.promotionMaxAbsDelta) {
      blockedReasons.add(`score delta exceeds promotion cap ${config.feedbackRuntime.promotionMaxAbsDelta}`);
    }
    const blocked = Array.from(blockedReasons);
    const recommendation = blocked.length === 0
      ? "eligible_for_shadow_runtime" as const
      : impact.totalScoreDelta === 0
        ? "review_only" as const
        : "keep_passive" as const;
    const rollbackRecommended =
      blockedReasons.has("not all source apply records passed eval gate") ||
      blockedReasons.has(`score delta exceeds promotion cap ${config.feedbackRuntime.promotionMaxAbsDelta}`);
    const promotionStage = recommendation === "eligible_for_shadow_runtime"
      ? "eligible_shadow" as const
      : recommendation === "review_only"
        ? "review_only" as const
        : "blocked" as const;
    const nextSafeAction = recommendation === "eligible_for_shadow_runtime"
      ? "eligible_for_shadow_observation" as const
      : rollbackRecommended
        ? "rollback_or_review" as const
        : blocked.length > 0
          ? "inspect_blockers" as const
          : "keep_passive" as const;
    return {
      ...impact,
      blockedReasons: blocked,
      promotionStage,
      rollbackRecommended,
      nextSafeAction,
      recommendation,
    };
  }).sort((a, b) => Math.abs(b.totalScoreDelta) - Math.abs(a.totalScoreDelta));

  const eligibleDeltaByCollection = new Map(
    impacts
      .filter((impact) => impact.recommendation === "eligible_for_shadow_runtime")
      .map((impact) => [impact.collectionId, impact.totalScoreDelta]),
  );
  const shadowRanked = [...candidateCollectionIds].sort((a, b) => {
    const deltaDiff = (eligibleDeltaByCollection.get(b) ?? 0) - (eligibleDeltaByCollection.get(a) ?? 0);
    if (deltaDiff !== 0) return deltaDiff;
    return candidateCollectionIds.indexOf(a) - candidateCollectionIds.indexOf(b);
  });
  const currentTopCandidateId = candidateCollectionIds[0] ?? null;
  const shadowTopCandidateId = shadowRanked[0] ?? null;
  const runtimeAffected =
    mode === "active" &&
    impacts.some((impact) => impact.recommendation === "eligible_for_shadow_runtime") &&
    shadowRanked.join("\u0000") !== candidateCollectionIds.join("\u0000");

  return {
    ...empty,
    runtimeAffected,
    adjustedCandidateCollectionIds: runtimeAffected ? shadowRanked : candidateCollectionIds,
    activeAdjustmentCount: rows.length,
    promotedCandidateCount: impacts.filter((impact) => impact.recommendation === "eligible_for_shadow_runtime").length,
    currentTopCandidateId,
    shadowTopCandidateId,
    wouldChangeTopCandidate: Boolean(currentTopCandidateId && shadowTopCandidateId && currentTopCandidateId !== shadowTopCandidateId),
    impacts,
  };
}
