import { describe, expect, it } from "vitest";

import {
  buildFallbackRetrievalRuntimeHealth,
  buildRetrievalRuntimeHealthFromEnv,
  summarizeRetrievalRuntimeHealth,
} from "./lib/retrievalRuntimeHealth.js";

describe("buildRetrievalRuntimeHealthFromEnv", () => {
  it("adapts qdrant embedding and reranker diagnostics without importing runtime providers", () => {
    const health = buildRetrievalRuntimeHealthFromEnv(
      {
        R3MES_RETRIEVAL_ENGINE: "hybrid",
        R3MES_EMBEDDING_PROVIDER: "bge-m3",
        R3MES_RERANKER_MODE: "model",
      },
      {
        diagnostics: {
          qdrantEmbedding: {
            requestedProvider: "bge-m3",
            actualProvider: "deterministic",
            fallbackUsed: true,
            dimension: 1024,
            error: "ai-engine unavailable",
          },
          reranker: {
            mode: "model_fallback",
            fallbackUsed: true,
            fallbackReason: "timeout",
          },
        },
      },
    );

    expect(health).toMatchObject({
      retrievalEngineRequested: "hybrid",
      retrievalEngineActual: "hybrid",
      embeddingProviderRequested: "bge-m3",
      embeddingProviderActual: "deterministic",
      embeddingFallbackUsed: true,
      rerankerModeRequested: "model",
      rerankerModeActual: "model_fallback",
      rerankerFallbackUsed: true,
    });
    expect(health.warnings).toEqual(["embedding_provider_fallback", "reranker_provider_fallback"]);
    expect(summarizeRetrievalRuntimeHealth(health)).toMatchObject({
      embeddingDimension: 1024,
      rerankerFallbackUsed: true,
    });
  });

  it("builds an explicit prisma fallback health snapshot", () => {
    const health = buildFallbackRetrievalRuntimeHealth("qdrant_failed", {
      env: { R3MES_RETRIEVAL_ENGINE: "qdrant", R3MES_RERANKER_MODE: "model" },
      rerankerModeActual: "model",
    });

    expect(health.retrievalEngineRequested).toBe("qdrant");
    expect(health.retrievalEngineActual).toBe("prisma");
    expect(health.rerankerModeActual).toBe("model_fallback");
    expect(health.warnings).toContain("qdrant_failed");
  });
});
