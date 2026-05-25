import { describe, expect, it } from "vitest";

import {
  buildQdrantPayloadV2,
  computeQdrantPayloadV2Hash,
  QDRANT_PAYLOAD_V2_INDEX_FIELDS,
  validateQdrantPayloadV2,
  type QdrantPayloadV2BuildInput,
} from "./qdrantPayloadV2.js";

function deterministicInput(): QdrantPayloadV2BuildInput {
  return {
    targetKind: "chunk",
    targetId: "target-1",
    collectionId: "collection-1",
    documentId: "document-1",
    logicalChunkId: "logical-chunk-1",
    visibility: "PRIVATE",
    ownerScopeId: "scope-1",
    sourceQuality: "quality-label",
    parseQualityLevel: "usable",
    strictRouteEligible: true,
    strictAnswerEligible: false,
    artifactKind: "artifact-label",
    evidenceTypes: ["type-a", "type-b"],
    contentHash: "content-hash",
    embeddingTextHash: "embedding-text-hash",
    embeddingProvider: "bge-m3",
    embeddingModel: "embedding-model",
    embeddingDimension: 4,
    indexedAt: "2026-05-26T10:00:00.000Z",
    metadata: {
      secondary: 2,
      primary: "value",
    },
  };
}

describe("qdrantPayloadV2", () => {
  it("builds a versioned payload and generates its canonical payload hash", () => {
    const payload = buildQdrantPayloadV2(deterministicInput());

    expect(payload).toMatchObject({
      payloadSchemaVersion: 2,
      targetKind: "chunk",
      targetId: "target-1",
      collectionId: "collection-1",
      payloadHash: expect.any(String),
    });
    expect(payload.payloadHash).toBe(computeQdrantPayloadV2Hash(payload));
    expect(validateQdrantPayloadV2(payload)).toEqual({ valid: true, diagnostics: [] });
  });

  it("keeps hashes stable across key ordering while retaining array order semantics", () => {
    const first = buildQdrantPayloadV2(deterministicInput());
    const reordered = buildQdrantPayloadV2({
      ...deterministicInput(),
      metadata: {
        primary: "value",
        secondary: 2,
      },
    });
    const changedEvidenceOrder = buildQdrantPayloadV2({
      ...deterministicInput(),
      evidenceTypes: ["type-b", "type-a"],
    });

    expect(reordered.payloadHash).toBe(first.payloadHash);
    expect(changedEvidenceOrder.payloadHash).not.toBe(first.payloadHash);
  });

  it("reports missing and invalid schema fields plus payload integrity drift", () => {
    const payload = buildQdrantPayloadV2(deterministicInput());
    const result = validateQdrantPayloadV2({
      ...payload,
      payloadSchemaVersion: 1,
      targetKind: "unsupported",
      embeddingDimension: 0,
      strictRouteEligible: "true",
      embeddingModel: "",
      indexedAt: "not-a-date",
      payloadHash: "changed-hash",
      ownerScopeId: undefined,
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      { field: "payloadSchemaVersion", code: "invalid_field_value", expected: "2", received: 1 },
      { field: "targetKind", code: "invalid_field_value", expected: "VectorIndexTargetKind", received: "unsupported" },
      { field: "embeddingDimension", code: "invalid_field_value", expected: "positive integer", received: 0 },
      { field: "strictRouteEligible", code: "invalid_field_type", expected: "boolean", received: "true" },
      { field: "ownerScopeId", code: "missing_required_field", expected: "non-empty string" },
      { field: "embeddingModel", code: "invalid_field_value", expected: "non-empty string", received: "" },
      { field: "indexedAt", code: "invalid_field_value", expected: "ISO date string", received: "not-a-date" },
      expect.objectContaining({ field: "payloadHash", code: "payload_hash_mismatch" }),
    ]));
  });

  it("publishes one V2 index-field registry without unstructured metadata", () => {
    expect(QDRANT_PAYLOAD_V2_INDEX_FIELDS).toEqual([
      { fieldName: "payloadSchemaVersion", fieldSchema: "integer" },
      { fieldName: "targetKind", fieldSchema: "keyword" },
      { fieldName: "targetId", fieldSchema: "keyword" },
      { fieldName: "collectionId", fieldSchema: "keyword" },
      { fieldName: "documentId", fieldSchema: "keyword" },
      { fieldName: "documentVersionId", fieldSchema: "keyword" },
      { fieldName: "logicalChunkId", fieldSchema: "keyword" },
      { fieldName: "visibility", fieldSchema: "keyword" },
      { fieldName: "ownerScopeId", fieldSchema: "keyword" },
      { fieldName: "sourceQuality", fieldSchema: "keyword" },
      { fieldName: "parseQualityLevel", fieldSchema: "keyword" },
      { fieldName: "strictRouteEligible", fieldSchema: "bool" },
      { fieldName: "strictAnswerEligible", fieldSchema: "bool" },
      { fieldName: "artifactKind", fieldSchema: "keyword" },
      { fieldName: "evidenceTypes", fieldSchema: "keyword" },
      { fieldName: "contentHash", fieldSchema: "keyword" },
      { fieldName: "embeddingTextHash", fieldSchema: "keyword" },
      { fieldName: "payloadHash", fieldSchema: "keyword" },
      { fieldName: "embeddingProvider", fieldSchema: "keyword" },
      { fieldName: "embeddingModel", fieldSchema: "keyword" },
      { fieldName: "embeddingDimension", fieldSchema: "integer" },
      { fieldName: "indexedAt", fieldSchema: "datetime" },
    ]);
    expect(QDRANT_PAYLOAD_V2_INDEX_FIELDS.some(({ fieldName }) => fieldName === "metadata")).toBe(false);
  });
});
