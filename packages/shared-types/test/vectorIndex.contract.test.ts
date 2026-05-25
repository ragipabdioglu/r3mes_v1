import { describe, expect, it } from "vitest";

import type {
  EmbeddingInput,
  EmbeddingResult,
  QdrantPayloadV2,
  ReindexCheckpoint,
  VectorIndexHealthReport,
} from "../src/index.js";

describe("vector index contracts", () => {
  it("represents real-provider embedding lineage and versioned index payloads", () => {
    const input: EmbeddingInput = {
      targetType: "chunk",
      targetId: "chunk-1",
      purpose: "retrieval_dense",
      text: "generic indexed content",
      languageHint: "mixed",
    };
    const result: EmbeddingResult = {
      targetType: input.targetType,
      targetId: input.targetId,
      purpose: input.purpose,
      vector: [0.1, 0.2],
      normalized: true,
      fallbackUsed: false,
      provider: "bge-m3",
      model: "semantic-provider",
      dimension: 2,
      transport: "ai-engine-http",
      pooling: "bge_m3_default",
      device: "cpu",
      inputHash: "hash-1",
      latencyMs: 12,
      createdAt: "2026-05-25T12:00:00.000Z",
    };
    const payload: QdrantPayloadV2 = {
      payloadSchemaVersion: 2,
      targetKind: "chunk",
      targetId: result.targetId!,
      collectionId: "collection-1",
      logicalChunkId: result.targetId,
      visibility: "PRIVATE",
      ownerScopeId: "owner-scope-1",
      sourceQuality: "usable",
      strictRouteEligible: true,
      strictAnswerEligible: true,
      evidenceTypes: ["paragraph"],
      contentHash: "content-hash-1",
      embeddingTextHash: result.inputHash,
      payloadHash: "payload-hash-1",
      embeddingProvider: result.provider,
      embeddingModel: result.model,
      embeddingDimension: result.dimension,
      indexedAt: result.createdAt,
    };

    expect(payload.payloadSchemaVersion).toBe(2);
    expect(result.fallbackUsed).toBe(false);
    expect(payload.embeddingProvider).toBe("bge-m3");
    expect(payload.sourceQuality).toBe("usable");
  });

  it("represents checkpoint and health diagnostics without runtime implementation coupling", () => {
    const checkpoint: ReindexCheckpoint = {
      version: 1,
      operationId: "run-1",
      indexName: "knowledge",
      collectionId: "collection-1",
      targetKind: "chunk",
      status: "running",
      startedAt: "2026-05-25T12:00:00.000Z",
      updatedAt: "2026-05-25T12:01:00.000Z",
      processedCount: 12,
      indexedCount: 10,
      skippedCount: 1,
      failedCount: 1,
      failedIds: ["chunk-failed"],
      payloadSchemaVersion: 2,
      embeddingProvider: {
        requestedProvider: "legacy-request-alias",
        actualProvider: "bge-m3",
        transport: "ai-engine-http",
        pooling: "bge_m3_default",
        device: "cpu",
        fallbackUsed: false,
      },
    };
    const health: VectorIndexHealthReport = {
      version: 1,
      generatedAt: "2026-05-25T12:01:00.000Z",
      indexName: "knowledge",
      status: "degraded",
      payloadSchemaVersion: 2,
      totalTargets: 12,
      indexedTargets: 10,
      missingPoints: 2,
      orphanPoints: 0,
      stalePoints: 0,
      payloadDrift: 0,
      providerMismatch: 0,
      visibilityDrift: 0,
      readyRatio: 10 / 12,
      checkpoint,
      failures: [],
      warnings: ["partial_index"],
    };

    expect(health.checkpoint?.indexedCount).toBe(10);
    expect(health.status).toBe("degraded");
    expect(health.missingPoints).toBe(2);
  });
});
