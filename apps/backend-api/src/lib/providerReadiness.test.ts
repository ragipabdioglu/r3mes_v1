import { afterEach, describe, expect, it, vi } from "vitest";

import { buildQdrantPayloadV2, hashQdrantPayloadText } from "./qdrantPayloadV2.js";
import { checkQdrantHealth, hasStrictQdrantPayloadV2Integrity } from "./providerReadiness.js";
import { resolveRuntimeProfile } from "./runtimeFallbackPolicy.js";

function strictProfile() {
  return resolveRuntimeProfile({
    R3MES_RUNTIME_PROFILE: "pilot-rag",
    R3MES_EMBEDDING_PROVIDER: "bge-m3",
    R3MES_RERANKER_MODE: "model",
    R3MES_QDRANT_COLLECTION: "knowledge",
    R3MES_QDRANT_VECTOR_SIZE: "3",
  });
}

function pointPayload() {
  return buildQdrantPayloadV2({
    targetKind: "chunk",
    targetId: "chunk-1",
    collectionId: "collection-1",
    documentId: "document-1",
    visibility: "PRIVATE",
    ownerScopeId: "owner-1",
    contentHash: hashQdrantPayloadText("content"),
    embeddingTextHash: hashQdrantPayloadText("embedding text"),
    embeddingProvider: "bge-m3",
    embeddingModel: "BAAI/bge-m3",
    embeddingDimension: 3,
    indexedAt: "2026-05-26T00:00:00.000Z",
  });
}

function mockScroll(points: unknown[]): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    result: { points, next_page_offset: null },
  }), { status: 200 })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("strict Qdrant payload V2 integrity", () => {
  it("accepts a fully validated BGE-M3 point", async () => {
    mockScroll([{ payload: pointPayload() }]);

    await expect(hasStrictQdrantPayloadV2Integrity(strictProfile(), {
      R3MES_QDRANT_URL: "http://qdrant.test",
    })).resolves.toBe(true);
  });

  it("rejects legacy or drifted payloads", async () => {
    mockScroll([{ payload: { ...pointPayload(), payloadHash: "invalid" } }]);

    await expect(hasStrictQdrantPayloadV2Integrity(strictProfile(), {
      R3MES_QDRANT_URL: "http://qdrant.test",
    })).resolves.toBe(false);
  });

  it("does not consider an empty index product-ready", async () => {
    mockScroll([]);

    await expect(hasStrictQdrantPayloadV2Integrity(strictProfile(), {
      R3MES_QDRANT_URL: "http://qdrant.test",
    })).resolves.toBe(false);
  });
});

describe("Qdrant health probe", () => {
  it("accepts the text health response returned by Qdrant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("healthz check passed", { status: 200 })));

    await expect(checkQdrantHealth({
      R3MES_QDRANT_URL: "http://qdrant.test",
    })).resolves.toEqual({
      status: "pass",
      details: { health: "healthz check passed" },
    });
  });
});
