import type { RuntimeProfile, RuntimeProfileName, RuntimeStrictness } from "@r3mes/shared-types";

const DEFAULT_QDRANT_COLLECTION = "r3mes_knowledge";
const DEFAULT_QDRANT_VECTOR_SIZE = 1024;

function normalizeProfileName(value: string | undefined, env: Record<string, string | undefined>): RuntimeProfileName {
  const raw = value?.trim().toLowerCase();
  if (raw === "local-dev" || raw === "eval" || raw === "pilot-rag" || raw === "production" || raw === "peft-lab") {
    return raw;
  }
  return env.NODE_ENV === "production" ? "production" : "local-dev";
}

function strictnessForProfile(name: RuntimeProfileName, env: Record<string, string | undefined>): RuntimeStrictness {
  if (
    name === "eval" ||
    name === "pilot-rag" ||
    name === "production" ||
    env.R3MES_REQUIRE_REAL_EMBEDDINGS === "1" ||
    env.R3MES_REQUIRE_REAL_RERANKER === "1"
  ) {
    return "quality_fallback_blocked";
  }
  return "dev_fallback_allowed";
}

function normalizeChatRuntime(value: string | undefined): RuntimeProfile["chat"]["runtime"] {
  return value?.trim().toLowerCase() === "transformers_peft" ? "transformers_peft" : "llama_cpp";
}

function normalizeEmbeddingProvider(value: string | undefined): RuntimeProfile["embedding"]["requestedProvider"] {
  const raw = value?.trim().toLowerCase();
  if (raw === "ai-engine" || raw === "ai_engine") return "ai-engine";
  if (raw === "bge-m3") return "bge-m3";
  return "deterministic";
}

function normalizeRerankerMode(value: string | undefined): RuntimeProfile["reranker"]["requestedMode"] {
  return value?.trim().toLowerCase() === "deterministic" ? "deterministic" : "model";
}

function positiveInt(value: string | undefined, fallback?: number): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function qdrantRequired(env: Record<string, string | undefined>, realProvidersRequired: boolean): boolean {
  const retrievalEngine = env.R3MES_RETRIEVAL_ENGINE?.trim().toLowerCase();
  return realProvidersRequired || retrievalEngine === "qdrant" || retrievalEngine === "hybrid";
}

export function resolveRuntimeProfile(env: Record<string, string | undefined> = process.env): RuntimeProfile {
  const name = normalizeProfileName(env.R3MES_RUNTIME_PROFILE, env);
  const strictness = strictnessForProfile(name, env);
  const realProvidersRequired = strictness === "quality_fallback_blocked";
  const vectorSize = positiveInt(env.R3MES_QDRANT_VECTOR_SIZE, DEFAULT_QDRANT_VECTOR_SIZE) ?? DEFAULT_QDRANT_VECTOR_SIZE;

  return {
    version: 1,
    name,
    strictness,
    chat: {
      runtime: normalizeChatRuntime(env.R3MES_CHAT_RUNTIME ?? env.R3MES_AI_RUNTIME ?? env.R3MES_INFERENCE_BACKEND),
      modelFamily: env.R3MES_MODEL_FAMILY === "unknown" ? "unknown" : "qwen2_5_3b",
      modelId: env.R3MES_MODEL_ID ?? env.R3MES_CHAT_MODEL ?? "qwen2.5-3b",
      synthesisOnly: env.R3MES_CHAT_SYNTHESIS_ONLY !== "0",
      allowDeterministicComposerBypass: !realProvidersRequired,
    },
    embedding: {
      requestedProvider: normalizeEmbeddingProvider(env.R3MES_EMBEDDING_PROVIDER),
      requiredRealProvider: realProvidersRequired,
      expectedModelIncludes: ["bge-m3"],
      expectedDimension: vectorSize,
    },
    reranker: {
      requestedMode: normalizeRerankerMode(env.R3MES_RERANKER_MODE),
      requiredRealProvider: realProvidersRequired,
      expectedProvider: "cross_encoder",
    },
    qdrant: {
      required: qdrantRequired(env, realProvidersRequired),
      collectionName: env.R3MES_QDRANT_COLLECTION ?? DEFAULT_QDRANT_COLLECTION,
      vectorSize,
    },
    stream: {
      productMode: env.R3MES_STREAM_PRODUCT_MODE === "sse_stream" ? "sse_stream" : "non_stream_json",
    },
    lora: {
      role: "behavior_persona_only",
      optional: true,
      maxLockWaitMs: positiveInt(env.R3MES_LORA_MAX_LOCK_WAIT_MS),
    },
  };
}
