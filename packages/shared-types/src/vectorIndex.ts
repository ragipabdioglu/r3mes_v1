/**
 * Faz 3 storage/index contract surface.
 *
 * These types describe embedding and vector-index lineage without selecting
 * runtime implementations. Provider and index code may adopt them gradually.
 */

export type EmbeddingTargetType =
  | "query"
  | "chunk"
  | "artifact"
  | "fact"
  | "collection_profile"
  | "document_profile";

export type EmbeddingPurpose =
  | "retrieval_dense"
  | "retrieval_sparse"
  | "profile_scoring"
  | "rerank_prefilter"
  | "fact_matching";

export type EmbeddingProvider = "bge-m3" | "deterministic-dev" | "external";
export type EmbeddingTransport = "ai-engine-http" | "local-python" | "in-process";
export type EmbeddingPooling = "bge_m3_default" | "mean_pooling" | "cls" | "unknown";
export type EmbeddingDevice = "cpu" | "cuda" | "mps" | "auto" | "unknown";

export interface EmbeddingInput {
  targetType: EmbeddingTargetType;
  targetId?: string;
  purpose: EmbeddingPurpose;
  text: string;
  languageHint?: "tr" | "en" | "mixed" | "unknown";
  textVersion?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderLineageDiagnostics {
  requestedProvider?: string;
  actualProvider: EmbeddingProvider;
  model?: string;
  transport?: EmbeddingTransport;
  pooling?: EmbeddingPooling;
  device?: EmbeddingDevice;
  fallbackUsed: boolean;
  fallbackReason?: string;
  requiredRealProvider?: boolean;
  providerReady?: boolean;
  warnings?: string[];
}

export interface EmbeddingResult {
  targetType: EmbeddingTargetType;
  targetId?: string;
  purpose: EmbeddingPurpose;
  vector?: number[];
  normalized: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  provider: EmbeddingProvider;
  model: string;
  dimension: number;
  transport: EmbeddingTransport;
  pooling: EmbeddingPooling;
  device: EmbeddingDevice;
  inputHash: string;
  latencyMs: number;
  createdAt: string;
}

export type VectorIndexTargetKind =
  | "chunk"
  | "parent_chunk"
  | "structured_fact"
  | "table_row"
  | "collection_profile"
  | "document_profile";
export type VectorIndexHealthStatus = "ready" | "degraded" | "failed" | "unavailable";
export type VectorIndexOperationStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface QdrantPayloadV2 {
  payloadSchemaVersion: 2;
  targetKind: VectorIndexTargetKind;
  targetId: string;
  collectionId: string;
  documentId?: string;
  documentVersionId?: string;
  logicalChunkId?: string;
  visibility: "PRIVATE" | "PUBLIC";
  ownerScopeId: string;
  sourceQuality?: string;
  parseQualityLevel?: "clean" | "usable" | "noisy";
  strictRouteEligible?: boolean;
  strictAnswerEligible?: boolean;
  artifactKind?: string;
  evidenceTypes?: string[];
  contentHash: string;
  embeddingTextHash: string;
  payloadHash: string;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  embeddingDimension: number;
  indexedAt: string;
  metadata?: Record<string, unknown>;
}

export interface VectorIndexHealthReport {
  version: 1;
  generatedAt: string;
  indexName: string;
  status: VectorIndexHealthStatus;
  payloadSchemaVersion: 2;
  totalTargets: number;
  indexedTargets: number;
  missingPoints: number;
  orphanPoints: number;
  stalePoints: number;
  payloadDrift: number;
  providerMismatch: number;
  visibilityDrift: number;
  readyRatio: number;
  vectorDimension?: number;
  provider?: ProviderLineageDiagnostics;
  checkpoint?: ReindexCheckpoint;
  failures: string[];
  warnings: string[];
}

export interface ReindexCheckpoint {
  version: 1;
  operationId: string;
  indexName: string;
  collectionId?: string;
  targetKind: VectorIndexTargetKind;
  status: VectorIndexOperationStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  cursor?: string;
  processedCount: number;
  indexedCount: number;
  skippedCount: number;
  failedCount: number;
  failedIds: string[];
  totalCount?: number;
  payloadSchemaVersion: 2;
  embeddingProvider?: ProviderLineageDiagnostics;
  lastError?: string;
}
