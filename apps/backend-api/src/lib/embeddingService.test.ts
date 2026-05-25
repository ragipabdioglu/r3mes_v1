import { describe, expect, it, vi } from "vitest";

import {
  EMBEDDING_PROVIDER_REGISTRY,
  createEmbeddingServiceV2,
  mapEmbeddingProvider,
  resolveEmbeddingProviderRegistration,
  toProviderLineageDiagnostics,
} from "./embeddingService.js";

describe("EmbeddingServiceV2", () => {
  it("maps a proven BGE-M3 response to the typed embedding result", async () => {
    const service = createEmbeddingServiceV2({
      embedText: vi.fn().mockResolvedValue({
        vector: [0.1, 0.2],
        diagnostics: {
          requestedProvider: "ai-engine",
          actualProvider: "ai-engine",
          fallbackUsed: false,
          dimension: 2,
          model: "BAAI/bge-m3",
        },
      }),
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      startClock: () => 10,
      elapsedMs: () => 7,
    });

    const result = await service.embed({
      targetType: "chunk",
      targetId: "chunk-1",
      purpose: "retrieval_dense",
      text: "Ornek bilgi",
      languageHint: "tr",
    });

    expect(result).toMatchObject({
      targetType: "chunk",
      targetId: "chunk-1",
      purpose: "retrieval_dense",
      provider: "bge-m3",
      model: "BAAI/bge-m3",
      dimension: 2,
      transport: "ai-engine-http",
      fallbackUsed: false,
      normalized: true,
      latencyMs: 7,
      createdAt: "2026-05-25T12:00:00.000Z",
    });
    expect(result.vector).toEqual([0.1, 0.2]);
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps one proven BGE-M3 batch call to two typed embedding results", async () => {
    const embedTexts = vi.fn().mockResolvedValue({
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      diagnostics: {
        requestedProvider: "bge-m3",
        actualProvider: "bge-m3",
        fallbackUsed: false,
        dimension: 2,
        model: "BAAI/bge-m3",
        transport: "ai-engine-http",
        pooling: "mean_pooling",
        device: "cpu",
      },
    });
    const service = createEmbeddingServiceV2({
      embedTexts,
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      startClock: () => 10,
      elapsedMs: () => 7,
    });

    const results = await service.embedMany([
      {
        targetType: "chunk",
        targetId: "chunk-1",
        purpose: "retrieval_dense",
        text: "Birinci metin",
      },
      {
        targetType: "query",
        purpose: "profile_scoring",
        text: "Ikinci metin",
      },
    ]);

    expect(embedTexts).toHaveBeenCalledOnce();
    expect(embedTexts).toHaveBeenCalledWith(["Birinci metin", "Ikinci metin"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      targetType: "chunk",
      targetId: "chunk-1",
      purpose: "retrieval_dense",
      vector: [0.1, 0.2],
      provider: "bge-m3",
      model: "BAAI/bge-m3",
      dimension: 2,
      transport: "ai-engine-http",
      pooling: "mean_pooling",
      device: "cpu",
      fallbackUsed: false,
    });
    expect(results[1]).toMatchObject({
      targetType: "query",
      purpose: "profile_scoring",
      vector: [0.3, 0.4],
      provider: "bge-m3",
      model: "BAAI/bge-m3",
      dimension: 2,
      transport: "ai-engine-http",
      pooling: "mean_pooling",
      device: "cpu",
      fallbackUsed: false,
    });
    expect(results[0]?.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(results[1]?.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(results[0]?.inputHash).not.toBe(results[1]?.inputHash);
  });

  it("returns an empty batch without calling the embedding provider", async () => {
    const embedTexts = vi.fn();
    const service = createEmbeddingServiceV2({ embedTexts });

    await expect(service.embedMany([])).resolves.toEqual([]);
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("makes deterministic fallback explicit as a development-only provider", async () => {
    const service = createEmbeddingServiceV2({
      embedText: vi.fn().mockResolvedValue({
        vector: [1, 0],
        diagnostics: {
          requestedProvider: "bge-m3",
          actualProvider: "deterministic",
          fallbackUsed: true,
          dimension: 2,
          error: "provider unavailable",
        },
      }),
    });

    const result = await service.embed({
      targetType: "query",
      purpose: "profile_scoring",
      text: "kaynak secimi",
    });

    expect(result).toMatchObject({
      provider: "deterministic-dev",
      transport: "in-process",
      fallbackUsed: true,
      fallbackReason: "provider unavailable",
      purpose: "profile_scoring",
    });
    expect(resolveEmbeddingProviderRegistration({
      requestedProvider: "bge-m3",
      actualProvider: "deterministic",
      fallbackUsed: true,
      dimension: 2,
    })).toEqual(EMBEDDING_PROVIDER_REGISTRY["deterministic-dev"]);
  });

  it("does not report an unidentified ai-engine model as BGE-M3", () => {
    const diagnostics = {
      requestedProvider: "ai-engine",
      actualProvider: "ai-engine" as const,
      fallbackUsed: false,
      dimension: 1024,
      model: "custom-embedding-service",
    };

    expect(mapEmbeddingProvider(diagnostics)).toBe("external");
    expect(resolveEmbeddingProviderRegistration(diagnostics)).toBeUndefined();
    expect(toProviderLineageDiagnostics(diagnostics)).toMatchObject({
      actualProvider: "external",
      transport: "ai-engine-http",
      fallbackUsed: false,
      warnings: ["embedding model identity was not sufficient to prove BGE-M3 lineage"],
    });
  });
});
