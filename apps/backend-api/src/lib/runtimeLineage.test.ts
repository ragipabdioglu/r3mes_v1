import { describe, expect, it } from "vitest";

import { buildRuntimeLineage } from "./runtimeLineage.js";
import { resolveRuntimeProfile } from "./runtimeProfile.js";

describe("buildRuntimeLineage", () => {
  const profile = resolveRuntimeProfile({
    R3MES_RUNTIME_PROFILE: "eval",
    R3MES_AI_RUNTIME: "llama_cpp",
    R3MES_MODEL_ID: "qwen-test",
    R3MES_EMBEDDING_PROVIDER: "bge-m3",
    R3MES_RERANKER_MODE: "model",
  });

  it("classifies deterministic fast paths without a Qwen call", () => {
    const lineage = buildRuntimeLineage({
      profile,
      answerPath: "rag_fast_path",
      stream: false,
      composer: {
        plannedComposerUsed: true,
        fallbackTemplateUsed: true,
      },
      retrieval: {
        mode: "true_hybrid",
        runtime: {
          retrievalEngineRequested: "hybrid",
          retrievalEngineActual: "hybrid",
          embeddingProviderRequested: "bge-m3",
          embeddingProviderActual: "bge-m3",
          embeddingFallbackUsed: false,
          embeddingModel: "BAAI/bge-m3",
          embeddingDimension: 1024,
          rerankerModeRequested: "model",
          rerankerModeActual: "model",
          rerankerFallbackUsed: false,
        },
      },
      safety: {
        fallbackMode: undefined,
        blockedReasons: [],
      },
    });

    expect(lineage.answerPath).toBe("rag_fast_path");
    expect(lineage.fallbackPolicy).toEqual({
      mode: "failClosed",
      embedding: "failClosed",
      reranker: "failClosed",
      qdrant: "failClosed",
    });
    expect(lineage.qwen).toMatchObject({
      called: false,
      validatorCalled: false,
      callCount: 0,
      runtime: "llama_cpp",
      model: "qwen-test",
    });
    expect(lineage.composer.deterministicUsed).toBe(true);
    expect(lineage.embedding.fallbackUsed).toBe(false);
    expect(lineage.reranker.fallbackUsed).toBe(false);
    expect(lineage.controlTower.qualityFallbackUsed).toBe(false);
  });

  it("classifies ai-engine validated paths with provider fallbacks", () => {
    const lineage = buildRuntimeLineage({
      profile,
      answerPath: "ai_engine_validated",
      stream: false,
      validatorCalled: true,
      retrieval: {
        mode: "qdrant",
        runtime: {
          retrievalEngineRequested: "qdrant",
          retrievalEngineActual: "prisma",
          embeddingProviderRequested: "bge-m3",
          embeddingProviderActual: "deterministic",
          embeddingFallbackUsed: true,
          rerankerModeRequested: "model",
          rerankerModeActual: "model_fallback",
          rerankerFallbackUsed: true,
          rerankerFallbackReason: "timeout",
        },
      },
      safety: {
        fallbackMode: "privacy_safe",
        blockedReasons: ["NO_USABLE_FACTS", "QUERY_SOURCE_MISMATCH"],
      },
    });

    expect(lineage.qwen).toMatchObject({
      called: true,
      validatorCalled: true,
      callCount: 2,
    });
    expect(lineage.fallbackPolicy.mode).toBe("failClosed");
    expect(lineage.retrieval.qdrantFallbackUsed).toBe(true);
    expect(lineage.embedding).toMatchObject({
      requestedProvider: "bge-m3",
      actualProvider: "deterministic",
      fallbackUsed: true,
    });
    expect(lineage.reranker).toMatchObject({
      actualMode: "model_fallback",
      fallbackUsed: true,
      fallbackReason: "timeout",
    });
    expect(lineage.safety).toEqual({
      fallbackMode: "privacy_safe",
      blockedReasonCount: 2,
    });
    expect(lineage.controlTower.qualityFallbackUsed).toBe(true);
  });
});
