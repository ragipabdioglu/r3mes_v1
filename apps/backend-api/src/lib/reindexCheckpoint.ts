import type {
  ProviderLineageDiagnostics,
  ReindexCheckpoint,
  VectorIndexTargetKind,
} from "@r3mes/shared-types";

export interface StartReindexCheckpointInput {
  operationId: string;
  indexName: string;
  collectionId?: string;
  targetKind: VectorIndexTargetKind;
  startedAt: string;
  totalCount?: number;
  embeddingProvider?: ProviderLineageDiagnostics;
}

export interface AdvanceReindexCheckpointInput {
  cursor?: string;
  processedCount: number;
  indexedCount: number;
  skippedCount?: number;
  failedIds?: string[];
  updatedAt: string;
  embeddingProvider?: ProviderLineageDiagnostics;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

export function startReindexCheckpoint(input: StartReindexCheckpointInput): ReindexCheckpoint {
  return {
    version: 1,
    operationId: input.operationId,
    indexName: input.indexName,
    ...(input.collectionId ? { collectionId: input.collectionId } : {}),
    targetKind: input.targetKind,
    status: "running",
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    processedCount: 0,
    indexedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedIds: [],
    ...(input.totalCount !== undefined ? { totalCount: input.totalCount } : {}),
    payloadSchemaVersion: 2,
    ...(input.embeddingProvider ? { embeddingProvider: input.embeddingProvider } : {}),
  };
}

export function advanceReindexCheckpoint(
  checkpoint: ReindexCheckpoint,
  input: AdvanceReindexCheckpointInput,
): ReindexCheckpoint {
  const failedIds = uniqueIds([...(checkpoint.failedIds ?? []), ...(input.failedIds ?? [])]);
  return {
    ...checkpoint,
    status: "running",
    updatedAt: input.updatedAt,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    processedCount: checkpoint.processedCount + input.processedCount,
    indexedCount: checkpoint.indexedCount + input.indexedCount,
    skippedCount: checkpoint.skippedCount + (input.skippedCount ?? 0),
    failedCount: failedIds.length,
    failedIds,
    ...(input.embeddingProvider ? { embeddingProvider: input.embeddingProvider } : {}),
  };
}

export function completeReindexCheckpoint(
  checkpoint: ReindexCheckpoint,
  completedAt: string,
): ReindexCheckpoint {
  return {
    ...checkpoint,
    status: "completed",
    updatedAt: completedAt,
    completedAt,
  };
}

export function failReindexCheckpoint(
  checkpoint: ReindexCheckpoint,
  failedAt: string,
  error: unknown,
): ReindexCheckpoint {
  return {
    ...checkpoint,
    status: "failed",
    updatedAt: failedAt,
    lastError: error instanceof Error ? error.message : String(error),
  };
}
