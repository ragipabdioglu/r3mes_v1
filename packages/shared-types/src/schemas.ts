/**
 * Faz 3 — Şema seviyesi doğrulama (Zod). Faz 2 / INTEGRATION_CONTRACT anlamlarını değiştirmez;
 * regression: `test/contractRegression.test.ts`.
 */
import { z } from "zod";

import type {
  AdapterListItem,
  AdapterListResponse,
  ChatSourceCitation,
  KnowledgeCollectionListItem,
  KnowledgeDetailResponse,
  KnowledgeFeedbackAggregateItem,
  KnowledgeFeedbackApplyPlanResponse,
  KnowledgeFeedbackApplyPlanStep,
  KnowledgeFeedbackApplyRecordCreateResponse,
  KnowledgeFeedbackApplyRecordItem,
  KnowledgeFeedbackCreateRequest,
  KnowledgeFeedbackCreateResponse,
  KnowledgeFeedbackProposalGenerateResponse,
  KnowledgeFeedbackProposalImpactItem,
  KnowledgeFeedbackProposalImpactResponse,
  KnowledgeFeedbackProposalItem,
  KnowledgeFeedbackProposalListResponse,
  KnowledgeFeedbackProposalReviewResponse,
  KnowledgeFeedbackSummaryResponse,
  KnowledgeDocumentListItem,
  KnowledgeListResponse,
  KnowledgeUploadAcceptedResponse,
  NotImplementedOnChainRestResponse,
} from "./apiContract.js";
import type {
  BenchmarkJobPayload,
  BenchmarkQueueJobMessage,
  LoRAUploadAcceptedResponse,
  QaResultWebhookPayload,
} from "./payloadTypes.js";

/** §2 — Prisma wire enum (tek kaynak string birleşimi) */
export const AdapterStatusWireSchema = z.enum([
  "PENDING_REVIEW",
  "ACTIVE",
  "REJECTED",
  "SLASHED",
  "DEPRECATED",
]);

/** §4 — QA özet skoru 0–100 veya null */
export const BenchmarkScoreSchema = z.union([z.number().min(0).max(100), z.null()]);

/** §3.1 — liste öğesi */
export const AdapterListItemSchema: z.ZodType<AdapterListItem> = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: AdapterStatusWireSchema,
  kind: z.string(),
  format: z.string().nullable().optional(),
  runtime: z.string().nullable().optional(),
  baseModel: z.string().nullable().optional(),
  storagePath: z.string().nullable().optional(),
  onChainAdapterId: z.string().nullable(),
  onChainObjectId: z.string().nullable(),
  ipfsCid: z.string().nullable(),
  benchmarkScore: BenchmarkScoreSchema,
  domainTags: z.array(z.string()),
  ownerWallet: z.string().min(1),
  createdAt: z.string().min(1),
});

export const AdapterListResponseSchema: z.ZodType<AdapterListResponse> = z.object({
  data: z.array(AdapterListItemSchema),
  nextCursor: z.string().nullable(),
});

export const KnowledgeVisibilitySchema = z.enum(["PRIVATE", "PUBLIC"]);

export const KnowledgeCollectionListItemSchema: z.ZodType<KnowledgeCollectionListItem> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  visibility: KnowledgeVisibilitySchema,
  ownerWallet: z.string().min(1),
  documentCount: z.number().int().nonnegative(),
  inferredDomain: z.string().nullable().optional(),
  inferredTopic: z.string().nullable().optional(),
  inferredTags: z.array(z.string()).optional(),
  sourceQuality: z.enum(["structured", "inferred", "thin"]).nullable().optional(),
  profileConfidence: z.enum(["low", "medium", "high"]).nullable().optional(),
  profileVersion: z.number().int().positive().nullable().optional(),
  lastProfiledAt: z.string().nullable().optional(),
  publishedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const KnowledgeListResponseSchema: z.ZodType<KnowledgeListResponse> = z.object({
  data: z.array(KnowledgeCollectionListItemSchema),
  nextCursor: z.string().nullable(),
});

export const KnowledgeDocumentListItemSchema: z.ZodType<KnowledgeDocumentListItem> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceType: z.string().min(1),
  parseStatus: z.string().min(1),
  storageCid: z.string().nullable(),
  chunkCount: z.number().int().nonnegative(),
  inferredTopic: z.string().nullable().optional(),
  inferredTags: z.array(z.string()).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const KnowledgeDetailResponseSchema: z.ZodType<KnowledgeDetailResponse> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  visibility: KnowledgeVisibilitySchema,
  ownerWallet: z.string().min(1),
  publishedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  documents: z.array(KnowledgeDocumentListItemSchema),
});

export const KnowledgeUploadAcceptedResponseSchema: z.ZodType<KnowledgeUploadAcceptedResponse> = z.object({
  collectionId: z.string().min(1),
  documentId: z.string().min(1),
  visibility: KnowledgeVisibilitySchema,
  parseStatus: z.string().min(1),
  storageCid: z.string().nullable(),
  chunkCount: z.number().int().nonnegative(),
});

export const ChatSourceCitationSchema: z.ZodType<ChatSourceCitation> = z.object({
  collectionId: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  excerpt: z.string().nullable().optional(),
});

export const KnowledgeFeedbackKindSchema = z.enum([
  "GOOD_SOURCE",
  "WRONG_SOURCE",
  "MISSING_SOURCE",
  "BAD_ANSWER",
  "GOOD_ANSWER",
]);

export const KnowledgeFeedbackCreateRequestSchema: z.ZodType<KnowledgeFeedbackCreateRequest> = z.object({
  kind: KnowledgeFeedbackKindSchema,
  traceId: z.string().min(1).max(128).nullable().optional(),
  query: z.string().max(4000).nullable().optional(),
  queryHash: z.string().min(8).max(64).nullable().optional(),
  collectionId: z.string().min(1).max(128).nullable().optional(),
  documentId: z.string().min(1).max(128).nullable().optional(),
  chunkId: z.string().min(1).max(128).nullable().optional(),
  expectedCollectionId: z.string().min(1).max(128).nullable().optional(),
  reason: z.string().max(1000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const KnowledgeFeedbackCreateResponseSchema: z.ZodType<KnowledgeFeedbackCreateResponse> = z.object({
  id: z.string().min(1),
  kind: KnowledgeFeedbackKindSchema,
  status: z.literal("recorded"),
  queryHash: z.string().nullable(),
  collectionId: z.string().nullable(),
  expectedCollectionId: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const KnowledgeFeedbackProposalActionSchema = z.enum([
  "BOOST_SOURCE",
  "PENALIZE_SOURCE",
  "REVIEW_MISSING_SOURCE",
  "REVIEW_ANSWER_QUALITY",
]);

export const KnowledgeFeedbackProposalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const KnowledgeFeedbackAggregateItemSchema: z.ZodType<KnowledgeFeedbackAggregateItem> = z.object({
  key: z.string().min(1),
  collectionId: z.string().nullable(),
  expectedCollectionId: z.string().nullable(),
  queryHash: z.string().nullable(),
  total: z.number().int().nonnegative(),
  goodSourceCount: z.number().int().nonnegative(),
  wrongSourceCount: z.number().int().nonnegative(),
  missingSourceCount: z.number().int().nonnegative(),
  badAnswerCount: z.number().int().nonnegative(),
  goodAnswerCount: z.number().int().nonnegative(),
  negativeRate: z.number().min(0).max(1),
  suggestedAction: KnowledgeFeedbackProposalActionSchema.nullable(),
});

export const KnowledgeFeedbackSummaryResponseSchema: z.ZodType<KnowledgeFeedbackSummaryResponse> = z.object({
  data: z.array(KnowledgeFeedbackAggregateItemSchema),
  totalFeedback: z.number().int().nonnegative(),
  generatedAt: z.string().min(1),
});

export const KnowledgeFeedbackProposalItemSchema: z.ZodType<KnowledgeFeedbackProposalItem> = z.object({
  id: z.string().min(1),
  action: KnowledgeFeedbackProposalActionSchema,
  status: KnowledgeFeedbackProposalStatusSchema,
  collectionId: z.string().nullable(),
  expectedCollectionId: z.string().nullable(),
  queryHash: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()),
  reviewedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const KnowledgeFeedbackProposalGenerateResponseSchema: z.ZodType<KnowledgeFeedbackProposalGenerateResponse> =
  z.object({
    data: z.array(KnowledgeFeedbackProposalItemSchema),
    generatedCount: z.number().int().nonnegative(),
  });

export const KnowledgeFeedbackProposalListResponseSchema: z.ZodType<KnowledgeFeedbackProposalListResponse> =
  z.object({
    data: z.array(KnowledgeFeedbackProposalItemSchema),
    nextCursor: z.string().nullable(),
  });

export const KnowledgeFeedbackProposalReviewResponseSchema: z.ZodType<KnowledgeFeedbackProposalReviewResponse> =
  z.object({
    proposal: KnowledgeFeedbackProposalItemSchema,
  });

export const KnowledgeFeedbackProposalImpactItemSchema: z.ZodType<KnowledgeFeedbackProposalImpactItem> = z.object({
  proposalId: z.string().min(1),
  action: KnowledgeFeedbackProposalActionSchema,
  targetCollectionId: z.string().nullable(),
  expectedCollectionId: z.string().nullable(),
  queryHash: z.string().nullable(),
  estimatedScoreDelta: z.number().min(-1).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  wouldAutoApply: z.literal(false),
  rationale: z.array(z.string()),
});

export const KnowledgeFeedbackProposalImpactResponseSchema: z.ZodType<KnowledgeFeedbackProposalImpactResponse> =
  z.object({
    proposal: KnowledgeFeedbackProposalItemSchema,
    impact: KnowledgeFeedbackProposalImpactItemSchema,
    nextSafeAction: z.enum(["review_only", "run_eval_before_apply", "needs_more_feedback"]),
  });

export const KnowledgeFeedbackApplyPlanStepSchema: z.ZodType<KnowledgeFeedbackApplyPlanStep> = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "BOOST_COLLECTION_SCORE",
    "PENALIZE_COLLECTION_SCORE",
    "CREATE_MISSING_SOURCE_REVIEW",
    "CREATE_ANSWER_QUALITY_EVAL",
  ]),
  targetCollectionId: z.string().nullable(),
  expectedCollectionId: z.string().nullable(),
  queryHash: z.string().nullable(),
  scoreDelta: z.number().min(-1).max(1),
  reversible: z.literal(true),
  rollback: z.string().min(1),
  rationale: z.string().min(1),
});

export const KnowledgeFeedbackApplyPlanResponseSchema: z.ZodType<KnowledgeFeedbackApplyPlanResponse> = z.object({
  proposal: KnowledgeFeedbackProposalItemSchema,
  impact: KnowledgeFeedbackProposalImpactItemSchema,
  steps: z.array(KnowledgeFeedbackApplyPlanStepSchema),
  mutationEnabled: z.literal(false),
  applyAllowed: z.literal(false),
  requiredGate: z.literal("feedback_eval_gate"),
  blockedReasons: z.array(z.string()),
});

export const KnowledgeFeedbackApplyRecordItemSchema: z.ZodType<KnowledgeFeedbackApplyRecordItem> = z.object({
  id: z.string().min(1),
  proposalId: z.string().min(1),
  status: z.enum(["PLANNED", "GATE_PASSED", "APPLIED", "ROLLED_BACK", "BLOCKED"]),
  plan: KnowledgeFeedbackApplyPlanResponseSchema,
  reason: z.string().nullable(),
  plannedAt: z.string(),
  gateCheckedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  rolledBackAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const KnowledgeFeedbackApplyRecordCreateResponseSchema: z.ZodType<KnowledgeFeedbackApplyRecordCreateResponse> =
  z.object({
    record: KnowledgeFeedbackApplyRecordItemSchema,
    mutationApplied: z.literal(false),
    nextSafeAction: z.literal("run_feedback_eval_gate"),
  });

/** §3.6 — 501 stake / claim (kasıtlı yüzey; runtime çıkış doğrulaması) */
export const NotImplementedOnChainRestResponseSchema: z.ZodType<NotImplementedOnChainRestResponse> =
  z.object({
    success: z.literal(false),
    code: z.literal("NOT_IMPLEMENTED"),
    message: z.string().min(1),
    surface: z.union([
      z.literal("POST /v1/stake"),
      z.literal("POST /v1/user/:wallet/rewards/claim"),
    ]),
  });

/** Kuyruk — BenchmarkJobPayload */
export const BenchmarkJobPayloadSchema: z.ZodType<BenchmarkJobPayload> = z.object({
  adapterDbId: z.string().min(1),
  onChainAdapterId: z.string(),
  ipfsCid: z.string().min(1),
  ownerWallet: z.string().min(1),
});

export const BenchmarkQueueJobMessageSchema: z.ZodType<BenchmarkQueueJobMessage> = z.object({
  adapterDbId: z.string().min(1),
  onChainAdapterId: z.string(),
  ipfsCid: z.string().min(1),
  ownerWallet: z.string().min(1),
  jobId: z.string().min(1),
  adapterCid: z.string().min(1),
});

/** §3.4 — QA webhook */
export const QaResultWebhookPayloadSchema: z.ZodType<QaResultWebhookPayload> = z.object({
  jobId: z.string().min(1),
  adapterCid: z.string().min(1),
  adapterDbId: z.string().min(1).optional(),
  status: z.string().min(1),
  score: z.number(),
  threshold: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});

/** §3.3 — yükleme yanıtı */
export const LoRAUploadAcceptedResponseSchema: z.ZodType<LoRAUploadAcceptedResponse> = z.object({
  adapterId: z.string().min(1),
  adapterDbId: z.string().min(1),
  weightsCid: z.string().min(1),
  manifestCid: z.string().nullable(),
  benchmarkJobId: z.string().min(1),
  status: z.string().min(1),
  devQaBypassApplied: z.boolean().optional(),
});

/** Runtime-safe parse — başarısızda ayrıntılı ZodError */
export function parseAdapterListResponse(input: unknown): AdapterListResponse {
  return AdapterListResponseSchema.parse(input);
}

export function safeParseAdapterListResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, AdapterListResponse> {
  return AdapterListResponseSchema.safeParse(input);
}

export function parseKnowledgeListResponse(input: unknown): KnowledgeListResponse {
  return KnowledgeListResponseSchema.parse(input);
}

export function safeParseKnowledgeListResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeListResponse> {
  return KnowledgeListResponseSchema.safeParse(input);
}

export function parseKnowledgeDetailResponse(input: unknown): KnowledgeDetailResponse {
  return KnowledgeDetailResponseSchema.parse(input);
}

export function safeParseKnowledgeDetailResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeDetailResponse> {
  return KnowledgeDetailResponseSchema.safeParse(input);
}

export function parseKnowledgeUploadAcceptedResponse(input: unknown): KnowledgeUploadAcceptedResponse {
  return KnowledgeUploadAcceptedResponseSchema.parse(input);
}

export function safeParseKnowledgeUploadAcceptedResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeUploadAcceptedResponse> {
  return KnowledgeUploadAcceptedResponseSchema.safeParse(input);
}

export function parseKnowledgeFeedbackCreateRequest(input: unknown): KnowledgeFeedbackCreateRequest {
  return KnowledgeFeedbackCreateRequestSchema.parse(input);
}

export function safeParseKnowledgeFeedbackCreateRequest(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackCreateRequest> {
  return KnowledgeFeedbackCreateRequestSchema.safeParse(input);
}

export function parseKnowledgeFeedbackCreateResponse(input: unknown): KnowledgeFeedbackCreateResponse {
  return KnowledgeFeedbackCreateResponseSchema.parse(input);
}

export function safeParseKnowledgeFeedbackCreateResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackCreateResponse> {
  return KnowledgeFeedbackCreateResponseSchema.safeParse(input);
}

export function safeParseKnowledgeFeedbackSummaryResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackSummaryResponse> {
  return KnowledgeFeedbackSummaryResponseSchema.safeParse(input);
}

export function safeParseKnowledgeFeedbackProposalGenerateResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackProposalGenerateResponse> {
  return KnowledgeFeedbackProposalGenerateResponseSchema.safeParse(input);
}

export function safeParseKnowledgeFeedbackProposalListResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackProposalListResponse> {
  return KnowledgeFeedbackProposalListResponseSchema.safeParse(input);
}

export function safeParseKnowledgeFeedbackProposalReviewResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackProposalReviewResponse> {
  return KnowledgeFeedbackProposalReviewResponseSchema.safeParse(input);
}

export function safeParseKnowledgeFeedbackProposalImpactResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackProposalImpactResponse> {
  return KnowledgeFeedbackProposalImpactResponseSchema.safeParse(input);
}

export function safeParseKnowledgeFeedbackApplyPlanResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackApplyPlanResponse> {
  return KnowledgeFeedbackApplyPlanResponseSchema.safeParse(input);
}

export function safeParseKnowledgeFeedbackApplyRecordCreateResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, KnowledgeFeedbackApplyRecordCreateResponse> {
  return KnowledgeFeedbackApplyRecordCreateResponseSchema.safeParse(input);
}

export function parseNotImplementedOnChainRestResponse(
  input: unknown,
): NotImplementedOnChainRestResponse {
  return NotImplementedOnChainRestResponseSchema.parse(input);
}

export function safeParseNotImplementedOnChainRestResponse(
  input: unknown,
): z.SafeParseReturnType<unknown, NotImplementedOnChainRestResponse> {
  return NotImplementedOnChainRestResponseSchema.safeParse(input);
}

export function parseQaResultWebhookPayload(input: unknown): QaResultWebhookPayload {
  return QaResultWebhookPayloadSchema.parse(input);
}

export function safeParseQaResultWebhookPayload(
  input: unknown,
): z.SafeParseReturnType<unknown, QaResultWebhookPayload> {
  return QaResultWebhookPayloadSchema.safeParse(input);
}

export function parseBenchmarkQueueJobMessage(input: unknown): BenchmarkQueueJobMessage {
  return BenchmarkQueueJobMessageSchema.parse(input);
}

export function safeParseBenchmarkQueueJobMessage(
  input: unknown,
): z.SafeParseReturnType<unknown, BenchmarkQueueJobMessage> {
  return BenchmarkQueueJobMessageSchema.safeParse(input);
}
