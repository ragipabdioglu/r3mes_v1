export type KnowledgeVisibility = "PRIVATE" | "PUBLIC";

export type KnowledgeParseStatus = "PENDING" | "READY" | "FAILED";
export type KnowledgeIngestionReadinessStatus = "PENDING" | "PROCESSING" | "READY" | "PARTIAL_READY" | "FAILED";
export type KnowledgeIndexingStatus = "PENDING" | "INDEXING" | "READY" | "PARTIAL_READY" | "FAILED" | "SKIPPED";
export type KnowledgeIngestionJobStage =
  | "RECEIVED"
  | "STORAGE"
  | "PARSE"
  | "CHUNK"
  | "EMBEDDING"
  | "VECTOR_INDEX"
  | "QUALITY"
  | "READY";
export type KnowledgeIngestionJobPersistenceStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL_READY";
export type KnowledgeSourceType = "TEXT" | "MARKDOWN" | "JSON" | "PDF" | "DOCX" | "PPTX" | "HTML";
export type KnowledgeParseQualityLevel = "clean" | "usable" | "noisy";
export type KnowledgeIngestionRiskLevel = "none" | "low" | "medium" | "high";
export type KnowledgeIngestionQualityReport = {
  version: 1;
  tableRisk: KnowledgeIngestionRiskLevel;
  ocrRisk: KnowledgeIngestionRiskLevel;
  thinSource: boolean;
  strictRouteEligible: boolean;
  warnings: string[];
};

export type KnowledgeIndexingState = {
  status: KnowledgeIndexingStatus;
  vectorIndexStatus: KnowledgeIndexingStatus;
  indexedChunkCount?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type KnowledgeCollectionListItem = {
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
};

export type KnowledgeCollectionListResponse = {
  data: KnowledgeCollectionListItem[];
  nextCursor: string | null;
};

export type KnowledgeDocumentDetail = {
  id: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceMime?: string | null;
  sourceExtension?: string | null;
  contentHash?: string | null;
  storagePath?: string | null;
  parserId?: string | null;
  parserVersion?: number | null;
  scanStatus?: string | null;
  storageStatus?: string | null;
  documentVersionId?: string | null;
  parseStatus: KnowledgeParseStatus;
  storageCid: string | null;
  chunkCount: number;
  artifactCount?: number | null;
  chunkStatus?: string | null;
  embeddingStatus?: string | null;
  vectorIndexStatus?: string | null;
  qualityStatus?: string | null;
  readinessStatus?: string | null;
  parseQualityScore?: number | null;
  parseQualityLevel?: KnowledgeParseQualityLevel | null;
  parseQualityWarnings?: string[];
  ingestionQuality?: KnowledgeIngestionQualityReport | null;
  inferredTopic?: string | null;
  inferredTags?: string[];
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeCollectionDetail = {
  id: string;
  name: string;
  visibility: KnowledgeVisibility;
  ownerWallet: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: KnowledgeDocumentDetail[];
};

export type KnowledgeUploadAcceptedResponse = {
  collectionId: string;
  documentId: string;
  jobId?: string | null;
  statusUrl?: string | null;
  status?: "ACCEPTED" | "PROCESSING" | "READY" | "PARTIAL_READY" | "FAILED" | null;
  readiness?: KnowledgeIngestionReadinessStatus | null;
  visibility: KnowledgeVisibility;
  parseStatus: KnowledgeParseStatus;
  sourceMime?: string | null;
  sourceExtension?: string | null;
  contentHash?: string | null;
  storagePath?: string | null;
  parserId?: string | null;
  parserVersion?: number | null;
  scanStatus?: string | null;
  storageStatus?: string | null;
  documentVersionId?: string | null;
  artifactCount?: number | null;
  indexStatus?: KnowledgeIndexingStatus | null;
  indexing?: KnowledgeIndexingState | null;
  indexedChunkCount?: number | null;
  indexingError?: string | null;
  storageCid: string | null;
  chunkCount: number;
  parseQualityScore?: number | null;
  parseQualityLevel?: KnowledgeParseQualityLevel | null;
  parseQualityWarnings?: string[];
  ingestionQuality?: KnowledgeIngestionQualityReport | null;
};

export type KnowledgeIngestionJobStatusResponse = {
  jobId: string;
  collectionId: string;
  documentId: string;
  status: "ACCEPTED" | "PROCESSING" | "READY" | "PARTIAL_READY" | "FAILED";
  stage?: KnowledgeIngestionJobStage | null;
  jobStatus?: KnowledgeIngestionJobPersistenceStatus | null;
  attempts?: number | null;
  readiness: KnowledgeIngestionReadinessStatus;
  parseStatus: KnowledgeParseStatus;
  sourceMime?: string | null;
  sourceExtension?: string | null;
  contentHash?: string | null;
  storagePath?: string | null;
  parserId?: string | null;
  parserVersion?: number | null;
  scanStatus?: string | null;
  storageStatus?: string | null;
  documentVersionId?: string | null;
  artifactCount?: number | null;
  indexStatus: KnowledgeIndexingStatus;
  chunkStatus?: string | null;
  embeddingStatus?: string | null;
  vectorIndexStatus?: string | null;
  qualityStatus?: string | null;
  readinessStatus?: string | null;
  indexing?: KnowledgeIndexingState | null;
  chunkCount: number;
  indexedChunkCount?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  indexingError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type KnowledgeParserCapabilityItem = {
  id: string;
  version: number;
  sourceType: KnowledgeSourceType;
  extensions: string[];
  inputMode: "utf8" | "binary";
  available: boolean;
  kind: "built_in" | "external";
  health?: "ready" | "unavailable";
  profile?: "docling" | "marker" | "external" | null;
  reason?: string | null;
};

export type KnowledgeParserCapabilitiesResponse = {
  data: KnowledgeParserCapabilityItem[];
};

export type KnowledgeVisibilityMutationResponse = {
  id: string;
  visibility: KnowledgeVisibility;
  publishedAt: string | null;
};

export type ChatSourceCitation = {
  collectionId: string;
  documentId: string;
  title: string;
  chunkIndex: number;
  excerpt?: string | null;
};

export type ChatRetrievalDebug = {
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
      runtimeAffected: boolean;
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
        promotionStage: "eligible_shadow" | "blocked" | "review_only";
        rollbackRecommended: boolean;
        nextSafeAction:
          | "keep_passive"
          | "inspect_blockers"
          | "rollback_or_review"
          | "eligible_for_shadow_observation";
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
};

export function isKnowledgeCollectionListResponse(
  json: unknown,
): json is KnowledgeCollectionListResponse {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return Array.isArray(o.data);
}

export function isKnowledgeCollectionDetail(
  json: unknown,
): json is KnowledgeCollectionDetail {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return typeof o.id === "string" && Array.isArray(o.documents);
}

export function isKnowledgeParserCapabilitiesResponse(
  json: unknown,
): json is KnowledgeParserCapabilitiesResponse {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return Array.isArray(o.data);
}

export function isKnowledgeUploadAcceptedResponse(
  json: unknown,
): json is KnowledgeUploadAcceptedResponse {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return (
    typeof o.collectionId === "string" &&
    typeof o.documentId === "string" &&
    typeof o.visibility === "string" &&
    typeof o.parseStatus === "string" &&
    typeof o.chunkCount === "number"
  );
}

export function isKnowledgeIngestionJobStatusResponse(
  json: unknown,
): json is KnowledgeIngestionJobStatusResponse {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return (
    typeof o.jobId === "string" &&
    typeof o.collectionId === "string" &&
    typeof o.documentId === "string" &&
    typeof o.status === "string" &&
    typeof o.readiness === "string" &&
    typeof o.parseStatus === "string" &&
    typeof o.indexStatus === "string" &&
    typeof o.chunkCount === "number"
  );
}
