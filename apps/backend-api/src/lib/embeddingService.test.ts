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
