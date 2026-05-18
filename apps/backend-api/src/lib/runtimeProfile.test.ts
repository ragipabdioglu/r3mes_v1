import { describe, expect, it } from "vitest";

import { resolveRuntimeProfile } from "./runtimeProfile.js";

describe("resolveRuntimeProfile", () => {
  it("keeps local-dev fallback-friendly while declaring the runtime contract", () => {
    const profile = resolveRuntimeProfile({
      R3MES_AI_RUNTIME: "llama_cpp",
      R3MES_EMBEDDING_PROVIDER: "deterministic",
      R3MES_RERANKER_MODE: "deterministic",
      R3MES_QDRANT_VECTOR_SIZE: "1024",
    });

    expect(profile).toMatchObject({
      version: 1,
      name: "local-dev",
      strictness: "dev_fallback_allowed",
      chat: {
        runtime: "llama_cpp",
        synthesisOnly: true,
        allowDeterministicComposerBypass: true,
      },
      embedding: {
        requestedProvider: "deterministic",
        requiredRealProvider: false,
        expectedDimension: 1024,
      },
      reranker: {
        requestedMode: "deterministic",
        requiredRealProvider: false,
      },
      stream: {
        productMode: "non_stream_json",
      },
    });
  });

  it("marks pilot-rag as strict and provider-backed", () => {
    const profile = resolveRuntimeProfile({
      R3MES_RUNTIME_PROFILE: "pilot-rag",
      R3MES_AI_RUNTIME: "transformers_peft",
      R3MES_EMBEDDING_PROVIDER: "bge-m3",
      R3MES_RERANKER_MODE: "model",
      R3MES_RETRIEVAL_ENGINE: "hybrid",
      R3MES_QDRANT_COLLECTION: "pilot",
      R3MES_QDRANT_VECTOR_SIZE: "768",
      R3MES_LORA_MAX_LOCK_WAIT_MS: "250",
    });

    expect(profile.name).toBe("pilot-rag");
    expect(profile.strictness).toBe("quality_fallback_blocked");
    expect(profile.chat.runtime).toBe("transformers_peft");
    expect(profile.chat.allowDeterministicComposerBypass).toBe(false);
    expect(profile.embedding.requiredRealProvider).toBe(true);
    expect(profile.reranker.requiredRealProvider).toBe(true);
    expect(profile.qdrant).toMatchObject({
      required: true,
      collectionName: "pilot",
      vectorSize: 768,
    });
    expect(profile.lora.maxLockWaitMs).toBe(250);
  });
});
