/**
 * Kanonik JSON şekilleri — `docs/api/INTEGRATION_CONTRACT.md` ile uyumlu.
 * Breaking değişiklikler belge + semver ile yönetilir.
 */

/** GET /v1/adapters — `data[]` öğesi (§3.1) */
export interface AdapterListItem {
  id: string;
  name: string;
  status: string;
  kind: string;
  format?: string | null;
  runtime?: string | null;
  baseModel?: string | null;
  storagePath?: string | null;
  onChainAdapterId: string | null;
  onChainObjectId: string | null;
  /** Türetilmiş: weightsCid ?? manifestCid */
  ipfsCid: string | null;
  benchmarkScore: number | null;
  domainTags: string[];
  ownerWallet: string;
  createdAt: string;
}

/** Liste yanıtı kabı */
export interface AdapterListResponse {
  data: AdapterListItem[];
  nextCursor: string | null;
}

export type KnowledgeVisibility = "PRIVATE" | "PUBLIC";
export type KnowledgeParseQualityLevel = "clean" | "usable" | "noisy";

export interface KnowledgeCollectionListItem {
  id: string;
  name: string;
  visibility: KnowledgeVisibility;
  ownerWallet: string;
  documentCount: number;
  inferredDomain?: string | null;
  inferredTopic?: string | null;
  inferredTags?: string[];
  sourceQuality?: "structured" | "inferred" | "thin" | null;
  profileConfidence?: "low" | "medium" | "high" | null;
  profileVersion?: number | null;
  lastProfiledAt?: string | null;
  profileHealthScore?: number | null;
  profileHealthLevel?: "healthy" | "usable" | "weak" | null;
  profileHealthWarnings?: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeListResponse {
  data: KnowledgeCollectionListItem[];
  nextCursor: string | null;
}

export interface KnowledgeDocumentListItem {
  id: string;
  title: string;
  sourceType: string;
  parseStatus: string;
  storageCid: string | null;
  chunkCount: number;
  parseQualityScore?: number | null;
  parseQualityLevel?: KnowledgeParseQualityLevel | null;
  parseQualityWarnings?: string[];
  inferredTopic?: string | null;
  inferredTags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDetailResponse {
  id: string;
  name: string;
  visibility: KnowledgeVisibility;
  ownerWallet: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: KnowledgeDocumentListItem[];
}

export interface KnowledgeUploadAcceptedResponse {
  collectionId: string;
  documentId: string;
  visibility: KnowledgeVisibility;
  parseStatus: string;
  storageCid: string | null;
  chunkCount: number;
  parseQualityScore?: number | null;
  parseQualityLevel?: KnowledgeParseQualityLevel | null;
  parseQualityWarnings?: string[];
}

export interface ChatSourceCitation {
  collectionId: string;
  documentId: string;
  title: string;
  chunkIndex: number;
  excerpt?: string | null;
}

export type KnowledgeFeedbackKind =
  | "GOOD_SOURCE"
  | "WRONG_SOURCE"
  | "MISSING_SOURCE"
  | "BAD_ANSWER"
  | "GOOD_ANSWER";

export interface KnowledgeFeedbackCreateRequest {
  kind: KnowledgeFeedbackKind;
  traceId?: string | null;
  query?: string | null;
  queryHash?: string | null;
  collectionId?: string | null;
  documentId?: string | null;
  chunkId?: string | null;
  expectedCollectionId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface KnowledgeFeedbackCreateResponse {
  id: string;
  kind: KnowledgeFeedbackKind;
  status: "recorded";
  queryHash: string | null;
  collectionId: string | null;
  expectedCollectionId: string | null;
  createdAt: string;
}

export type KnowledgeFeedbackProposalAction =
  | "BOOST_SOURCE"
  | "PENALIZE_SOURCE"
  | "REVIEW_MISSING_SOURCE"
  | "REVIEW_ANSWER_QUALITY";

export type KnowledgeFeedbackProposalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface KnowledgeFeedbackAggregateItem {
  key: string;
  collectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  total: number;
  goodSourceCount: number;
  wrongSourceCount: number;
  missingSourceCount: number;
  badAnswerCount: number;
  goodAnswerCount: number;
  negativeRate: number;
  suggestedAction: KnowledgeFeedbackProposalAction | null;
}

export interface KnowledgeFeedbackSummaryResponse {
  data: KnowledgeFeedbackAggregateItem[];
  totalFeedback: number;
  generatedAt: string;
}

export interface KnowledgeFeedbackProposalItem {
  id: string;
  action: KnowledgeFeedbackProposalAction;
  status: KnowledgeFeedbackProposalStatus;
  collectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  confidence: number;
  reason: string;
  evidence: Record<string, unknown>;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeFeedbackProposalGenerateResponse {
  data: KnowledgeFeedbackProposalItem[];
  generatedCount: number;
}

export interface KnowledgeFeedbackProposalListResponse {
  data: KnowledgeFeedbackProposalItem[];
  nextCursor: string | null;
}

export interface KnowledgeFeedbackProposalReviewResponse {
  proposal: KnowledgeFeedbackProposalItem;
}

export interface KnowledgeFeedbackProposalImpactItem {
  proposalId: string;
  action: KnowledgeFeedbackProposalAction;
  targetCollectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  estimatedScoreDelta: number;
  riskLevel: "low" | "medium" | "high";
  wouldAutoApply: false;
  rationale: string[];
}

export interface KnowledgeFeedbackProposalImpactResponse {
  proposal: KnowledgeFeedbackProposalItem;
  impact: KnowledgeFeedbackProposalImpactItem;
  nextSafeAction: "review_only" | "run_eval_before_apply" | "needs_more_feedback";
}

export interface KnowledgeFeedbackApplyPlanStep {
  id: string;
  kind:
    | "BOOST_COLLECTION_SCORE"
    | "PENALIZE_COLLECTION_SCORE"
    | "CREATE_MISSING_SOURCE_REVIEW"
    | "CREATE_ANSWER_QUALITY_EVAL";
  targetCollectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  scoreDelta: number;
  reversible: true;
  rollback: string;
  rationale: string;
}

export interface KnowledgeFeedbackApplyPlanResponse {
  proposal: KnowledgeFeedbackProposalItem;
  impact: KnowledgeFeedbackProposalImpactItem;
  steps: KnowledgeFeedbackApplyPlanStep[];
  mutationEnabled: false;
  applyAllowed: false;
  requiredGate: "feedback_eval_gate";
  blockedReasons: string[];
}

export interface KnowledgeFeedbackApplyRecordItem {
  id: string;
  proposalId: string;
  status: "PLANNED" | "GATE_PASSED" | "APPLIED" | "ROLLED_BACK" | "BLOCKED";
  plan: KnowledgeFeedbackApplyPlanResponse;
  gateReportSummary: {
    ok: boolean | null;
    checksTotal: number;
    checksPassed: number;
    checksFailed: number;
    failedChecks: string[];
    durationMs: number | null;
    quick: boolean | null;
    generatedAt: string | null;
  } | null;
  reason: string | null;
  plannedAt: string;
  gateCheckedAt: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeFeedbackApplyRecordCreateResponse {
  record: KnowledgeFeedbackApplyRecordItem;
  mutationApplied: false;
  nextSafeAction: "run_feedback_eval_gate";
}

export interface KnowledgeFeedbackApplyRecordListResponse {
  data: KnowledgeFeedbackApplyRecordItem[];
  total: number;
  generatedAt: string;
}

export interface KnowledgeFeedbackApplyMutationPreviewStep {
  stepId: string;
  kind: KnowledgeFeedbackApplyPlanStep["kind"];
  targetCollectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  mutationPath: "query_scoped_collection_adjustment" | "missing_source_review" | "answer_quality_eval";
  simulatedCurrentScore: number | null;
  scoreDelta: number;
  simulatedNextScore: number | null;
  effect: "boost" | "penalty" | "review_only";
  reversible: true;
  rollback: string;
  rationale: string;
}

export interface KnowledgeFeedbackApplyMutationPreviewResponse {
  record: KnowledgeFeedbackApplyRecordItem;
  previewSteps: KnowledgeFeedbackApplyMutationPreviewStep[];
  mutationApplied: false;
  applyAllowed: false;
  blockedReasons: string[];
  generatedAt: string;
}

export interface KnowledgeFeedbackRouterAdjustmentItem {
  id: string;
  proposalId: string;
  applyRecordId: string;
  status: "ACTIVE" | "ROLLED_BACK";
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
  createdAt: string;
  rolledBackAt: string | null;
  updatedAt: string;
}

export interface KnowledgeFeedbackPassiveApplyResponse {
  record: KnowledgeFeedbackApplyRecordItem;
  adjustments: KnowledgeFeedbackRouterAdjustmentItem[];
  mutationApplied: false;
  routerRuntimeAffected: false;
  nextSafeAction: "router_integration_disabled";
}

export interface KnowledgeFeedbackAdjustmentRollbackResponse {
  adjustment: KnowledgeFeedbackRouterAdjustmentItem;
  mutationApplied: false;
  routerRuntimeAffected: false;
}

export interface KnowledgeFeedbackRouterAdjustmentListResponse {
  data: KnowledgeFeedbackRouterAdjustmentItem[];
  total: number;
  generatedAt: string;
}

export interface KnowledgeFeedbackRouterScoringSimulationItem {
  collectionId: string | null;
  queryHash: string | null;
  activeAdjustmentCount: number;
  totalScoreDelta: number;
  appliedStepIds: string[];
  adjustmentIds: string[];
  simulatedBefore: number;
  simulatedAfter: number;
}

export interface KnowledgeFeedbackRouterScoringSimulationResponse {
  queryHash: string | null;
  collectionIds: string[];
  results: KnowledgeFeedbackRouterScoringSimulationItem[];
  runtimeAffected: false;
  generatedAt: string;
}

export interface KnowledgeFeedbackPromotionGateItem {
  collectionId: string | null;
  queryHash: string | null;
  activeAdjustmentCount: number;
  gatePassedCount: number;
  totalScoreDelta: number;
  promotionCandidate: boolean;
  blockedReasons: string[];
  recommendation: "eligible_for_shadow_runtime" | "keep_passive" | "review_only";
  adjustmentIds: string[];
}

export interface KnowledgeFeedbackPromotionGateResponse {
  data: KnowledgeFeedbackPromotionGateItem[];
  total: number;
  runtimeAffected: false;
  promotionApplied: false;
  generatedAt: string;
}

export interface KnowledgeFeedbackGateResultRequest {
  ok: boolean;
  report?: Record<string, unknown> | null;
  reason?: string | null;
}

export interface KnowledgeFeedbackGateResultResponse {
  record: KnowledgeFeedbackApplyRecordItem;
  gatePassed: boolean;
  mutationApplied: false;
  nextSafeAction: "manual_apply_review" | "inspect_gate_failures";
}

export interface ChatRetrievalDebug {
  groundingConfidence: "high" | "medium" | "low";
  domain: "medical" | "legal" | "finance" | "technical" | "education" | "general";
  responseMode?: "json" | "natural";
  quality?: {
    sourceCount: number;
    directFactCount: number;
    riskFactCount: number;
    hasUsableGrounding: boolean;
  };
  retrievalMode?: "true_hybrid" | "qdrant" | "prisma" | "legacy_hybrid";
  retrievalDiagnostics?: Record<string, unknown>;
  sourceSelection?: {
    selectionMode: "none" | "selected" | "public" | "selected_plus_public";
    requestedCollectionIds: string[];
    accessibleCollectionIds: string[];
    usedCollectionIds: string[];
    unusedSelectedCollectionIds: string[];
    suggestedCollections: Array<{ id: string; name: string; reason: string }>;
    metadataRouteCandidates?: Array<{
      id: string;
      name: string;
      score: number;
      scoreBreakdown?: {
        finalScore: number;
        signals: Record<string, number | null>;
        contributions: Record<string, number>;
        missingSignals: string[];
        scoringMode?: "route_profile" | "query_profile";
        adaptiveBonus?: number;
      };
      domain: string | null;
      subtopics: string[];
      matchedTerms: string[];
      reason: string;
      sourceQuality?: "structured" | "inferred" | "thin" | null;
    }>;
    includePublic: boolean;
    routeDomain: "medical" | "legal" | "finance" | "technical" | "education" | "general" | null;
    hasSources: boolean;
    warning: string | null;
    routeDecision?: {
      mode: "strict" | "broad" | "suggest" | "no_source";
      primaryDomain: "medical" | "legal" | "finance" | "technical" | "education" | "general" | null;
      confidence: "low" | "medium" | "high";
      selectedCollectionIds: string[];
      usedCollectionIds: string[];
      suggestedCollectionIds: string[];
      rejectedCollectionIds: string[];
      reasons: string[];
    };
    shadowRuntime?: {
      enabled: boolean;
      runtimeAffected: false;
      queryHash: string | null;
      candidateCollectionIds: string[];
      activeAdjustmentCount: number;
      promotedCandidateCount: number;
      currentTopCandidateId: string | null;
      shadowTopCandidateId: string | null;
      wouldChangeTopCandidate: boolean;
      impacts: Array<{
        collectionId: string;
        totalScoreDelta: number;
        activeAdjustmentCount: number;
        gatePassedCount: number;
        recommendation: "eligible_for_shadow_runtime" | "keep_passive" | "review_only";
        blockedReasons: string[];
        adjustmentIds: string[];
      }>;
    };
  };
  queryPlan: {
    routePlan?: {
      domain: "medical" | "legal" | "finance" | "technical" | "education" | "general";
      subtopics: string[];
      riskLevel: "low" | "medium" | "high";
      retrievalHints: string[];
      mustIncludeTerms: string[];
      mustExcludeTerms: string[];
      confidence: "low" | "medium" | "high";
    };
    searchQueries: string[];
    mustIncludeTerms: string[];
    mustExcludeTerms: string[];
    expectedEvidenceType: string;
    retrievalQuery: string;
  } | null;
  routePlan?: {
    domain: "medical" | "legal" | "finance" | "technical" | "education" | "general";
    subtopics: string[];
    riskLevel: "low" | "medium" | "high";
    retrievalHints: string[];
    mustIncludeTerms: string[];
    mustExcludeTerms: string[];
    confidence: "low" | "medium" | "high";
  } | null;
  evidence: {
    usableFacts: string[];
    uncertainOrUnusable: string[];
    redFlags: string[];
    sourceIds: string[];
    missingInfo: string[];
  } | null;
}

/**
 * Sunucu tarafı stake/claim REST henüz yok; Sui cüzdan işlemi gerekir.
 * HTTP 501 ile dönülür (§3.6 genişletmesi).
 */
export interface NotImplementedOnChainRestResponse {
  success: false;
  code: "NOT_IMPLEMENTED";
  message: string;
  surface: "POST /v1/stake" | "POST /v1/user/:wallet/rewards/claim";
}
