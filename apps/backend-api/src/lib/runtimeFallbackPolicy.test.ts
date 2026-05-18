import { describe, expect, it } from "vitest";

import { getRuntimeFallbackPolicy, resolveRuntimeProfile } from "./runtimeFallbackPolicy.js";

describe("runtime fallback policy", () => {
  it("allows quality-provider fallback for local-dev", () => {
    const profile = resolveRuntimeProfile({
      R3MES_RUNTIME_PROFILE: "local-dev",
      R3MES_EMBEDDING_PROVIDER: "deterministic",
      R3MES_RERANKER_MODE: "deterministic",
    });
    const policy = getRuntimeFallbackPolicy({ R3MES_RUNTIME_PROFILE: "local-dev" });

    expect(profile.strictness).toBe("dev_fallback_allowed");
    expect(profile.embedding.requiredRealProvider).toBe(false);
    expect(policy.allowDeterministicEmbeddingFallback).toBe(true);
    expect(policy.allowBackendDeterministicRerankerFallback).toBe(true);
    expect(policy.failChatWhenQualityProviderFallbackUsed).toBe(false);
  });

  it("blocks quality-provider fallback for pilot-rag", () => {
    const profile = resolveRuntimeProfile({
      R3MES_RUNTIME_PROFILE: "pilot-rag",
      R3MES_EMBEDDING_PROVIDER: "bge-m3",
      R3MES_RERANKER_MODE: "model",
    });
    const policy = getRuntimeFallbackPolicy({ R3MES_RUNTIME_PROFILE: "pilot-rag" });

    expect(profile.strictness).toBe("quality_fallback_blocked");
    expect(profile.embedding.requiredRealProvider).toBe(true);
    expect(profile.reranker.requiredRealProvider).toBe(true);
    expect(policy.allowDeterministicEmbeddingFallback).toBe(false);
    expect(policy.allowLightweightRerankerFallback).toBe(false);
    expect(policy.failChatWhenQualityProviderFallbackUsed).toBe(true);
  });

  it("defaults to production profile when NODE_ENV is production", () => {
    const profile = resolveRuntimeProfile({ NODE_ENV: "production" });

    expect(profile.name).toBe("production");
    expect(profile.strictness).toBe("quality_fallback_blocked");
  });
});
