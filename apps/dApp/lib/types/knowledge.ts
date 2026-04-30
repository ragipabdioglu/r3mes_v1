export type KnowledgeVisibility = "PRIVATE" | "PUBLIC";

export type KnowledgeParseStatus = "PENDING" | "READY" | "FAILED";

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
  sourceType: "TEXT" | "MARKDOWN" | "JSON";
  parseStatus: KnowledgeParseStatus;
  storageCid: string | null;
  chunkCount: number;
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
  visibility: KnowledgeVisibility;
  parseStatus: KnowledgeParseStatus;
  storageCid: string | null;
  chunkCount: number;
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
      domain: string | null;
      subtopics: string[];
      matchedTerms: string[];
      reason: string;
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
