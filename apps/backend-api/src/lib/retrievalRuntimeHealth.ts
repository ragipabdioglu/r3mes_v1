export type RetrievalEngineMode = "prisma" | "qdrant" | "hybrid";
export type EmbeddingProviderMode = "deterministic" | "ai-engine" | "bge-m3";
export type RerankerModeRequested = "model" | "deterministic" | "disabled";
export type RerankerModeActual = "model" | "model_fallback" | "deterministic" | "disabled";

export interface RetrievalRuntimeHealth {
  retrievalEngineRequested: RetrievalEngineMode;
  retrievalEngineActual: RetrievalEngineMode;
  embeddingProviderRequested: EmbeddingProviderMode;
  embeddingProviderActual: EmbeddingProviderMode;
  embeddingFallbackUsed: boolean;
  embeddingModel?: string;
  embeddingDimension?: number;
  embeddingFallbackReason?: string;
  rerankerModeRequested: RerankerModeRequested;
  rerankerModeActual: RerankerModeActual;
  rerankerFallbackUsed: boolean;
  rerankerFallbackReason?: string;
  strictRuntime: boolean;
  warnings: string[];
}

export interface RetrievalRuntimeHealthInput {
  env?: Record<string, string | undefined>;
  retrievalEngineRequested?: unknown;
  retrievalEngineActual?: unknown;
  embeddingProviderRequested?: unknown;
  embeddingProviderActual?: unknown;
  embeddingFallbackUsed?: unknown;
  rerankerModeRequested?: unknown;
  rerankerModeActual?: unknown;
  rerankerFallbackUsed?: unknown;
  strictRuntime?: unknown;
  qdrantEmbedding?: unknown;
  reranker?: unknown;
  modelRerank?: unknown;
  diagnostics?: unknown;
  warnings?: unknown;
}

const DEFAULT_RUNTIME_HEALTH: RetrievalRuntimeHealth = {
  retrievalEngineRequested: "prisma",
  retrievalEngineActual: "prisma",
  embeddingProviderRequested: "deterministic",
  embeddingProviderActual: "deterministic",
  embeddingFallbackUsed: false,
  rerankerModeRequested: "model",
  rerankerModeActual: "disabled",
  rerankerFallbackUsed: false,
  strictRuntime: false,
  warnings: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRetrievalEngine(value: unknown, fallback: RetrievalEngineMode): RetrievalEngineMode {
  const raw = readString(value)?.toLowerCase();
  return raw === "qdrant" || raw === "hybrid" || raw === "prisma" ? raw : fallback;
}

function normalizeEmbeddingProvider(value: unknown, fallback: EmbeddingProviderMode): EmbeddingProviderMode {
  const raw = readString(value)?.toLowerCase();
  if (raw === "ai-engine" || raw === "ai_engine") return "ai-engine";
  return raw === "bge-m3" || raw === "deterministic" ? raw : fallback;
}

function normalizeRerankerRequested(value: unknown, fallback: RerankerModeRequested): RerankerModeRequested {
  const raw = readString(value)?.toLowerCase();
  if (raw === "model" || raw === "deterministic" || raw === "disabled") return raw;
  return fallback;
}

function normalizeRerankerActual(value: unknown, fallback: RerankerModeActual): RerankerModeActual {
  const raw = readString(value)?.toLowerCase();
  if (raw === "model" || raw === "model_fallback" || raw === "deterministic" || raw === "disabled") return raw;
  return fallback;
}

function strictRuntimeFromEnv(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production" ||
    env.R3MES_REQUIRE_REAL_EMBEDDINGS === "1" ||
    env.R3MES_REQUIRE_REAL_RERANKER === "1";
}

function requestedRerankerFromEnv(env: Record<string, string | undefined>): RerankerModeRequested {
  const raw = (env.R3MES_RERANKER_MODE ?? "model").trim().toLowerCase();
  if (raw === "deterministic" || raw === "disabled") return raw;
  return "model";
}

function warningsForRuntime(health: RetrievalRuntimeHealth): string[] {
  const warnings = [...health.warnings];
  if (health.retrievalEngineRequested !== health.retrievalEngineActual) {
    warnings.push("retrieval_engine_fallback");
  }
  if (health.embeddingFallbackUsed) {
    warnings.push("embedding_provider_fallback");
  }
  if (health.rerankerFallbackUsed) {
    warnings.push("reranker_provider_fallback");
  }
  if (health.strictRuntime && (health.embeddingFallbackUsed || health.rerankerFallbackUsed)) {
    warnings.push("strict_runtime_fallback_detected");
  }
  return [...new Set(warnings)];
}

function diagnosticsFromInput(input: RetrievalRuntimeHealthInput): {
  qdrantEmbedding: Record<string, unknown>;
  reranker: Record<string, unknown>;
} {
  const diagnostics = asRecord(input.diagnostics);
  return {
    qdrantEmbedding: asRecord(input.qdrantEmbedding ?? diagnostics.qdrantEmbedding),
    reranker: asRecord(input.reranker ?? input.modelRerank ?? diagnostics.reranker ?? diagnostics.modelRerank),
  };
}

export function buildDefaultRetrievalRuntimeHealth(): RetrievalRuntimeHealth {
  return { ...DEFAULT_RUNTIME_HEALTH, warnings: [] };
}

export function buildRetrievalRuntimeHealthFromEnv(
  env: Record<string, string | undefined> = process.env,
  input: Omit<RetrievalRuntimeHealthInput, "env"> = {},
): RetrievalRuntimeHealth {
  return buildRetrievalRuntimeHealth({ ...input, env });
}

export function buildFallbackRetrievalRuntimeHealth(
  reason: string,
  input: RetrievalRuntimeHealthInput = {},
): RetrievalRuntimeHealth {
  const health = buildRetrievalRuntimeHealth(input);
  const warnings = [...health.warnings, reason].filter(Boolean);
  return {
    ...health,
    retrievalEngineActual: "prisma",
    embeddingProviderActual: health.embeddingProviderActual,
    embeddingFallbackUsed: health.embeddingFallbackUsed,
    rerankerModeActual: health.rerankerModeActual === "model" ? "model_fallback" : health.rerankerModeActual,
    rerankerFallbackUsed: health.rerankerFallbackUsed || health.rerankerModeActual === "model",
    rerankerFallbackReason: health.rerankerFallbackReason ?? reason,
    warnings: [...new Set(warnings)],
  };
}

export function buildRetrievalRuntimeHealth(input: RetrievalRuntimeHealthInput = {}): RetrievalRuntimeHealth {
  const env = input.env ?? {};
  const diagnostics = diagnosticsFromInput(input);
  const qdrantEmbedding = diagnostics.qdrantEmbedding;
  const reranker = diagnostics.reranker;
  const retrievalEngineRequested = normalizeRetrievalEngine(
    input.retrievalEngineRequested ?? env.R3MES_RETRIEVAL_ENGINE,
    DEFAULT_RUNTIME_HEALTH.retrievalEngineRequested,
  );
  const embeddingProviderRequested = normalizeEmbeddingProvider(
    input.embeddingProviderRequested ?? qdrantEmbedding.requestedProvider ?? env.R3MES_EMBEDDING_PROVIDER,
    DEFAULT_RUNTIME_HEALTH.embeddingProviderRequested,
  );
  const rerankerModeRequested = normalizeRerankerRequested(
    input.rerankerModeRequested ?? env.R3MES_RERANKER_MODE,
    requestedRerankerFromEnv(env),
  );
  const rerankerModeActual = normalizeRerankerActual(
    input.rerankerModeActual ?? reranker.mode,
    rerankerModeRequested === "disabled" ? "disabled" : DEFAULT_RUNTIME_HEALTH.rerankerModeActual,
  );
  const health: RetrievalRuntimeHealth = {
    retrievalEngineRequested,
    retrievalEngineActual: normalizeRetrievalEngine(input.retrievalEngineActual, retrievalEngineRequested),
    embeddingProviderRequested,
    embeddingProviderActual: normalizeEmbeddingProvider(
      input.embeddingProviderActual ?? qdrantEmbedding.actualProvider,
      embeddingProviderRequested,
    ),
    embeddingFallbackUsed: readBoolean(input.embeddingFallbackUsed) ?? readBoolean(qdrantEmbedding.fallbackUsed) ?? false,
    embeddingModel: readString(qdrantEmbedding.model),
    embeddingDimension: readNumber(qdrantEmbedding.dimension),
    embeddingFallbackReason: readString(qdrantEmbedding.error),
    rerankerModeRequested,
    rerankerModeActual,
    rerankerFallbackUsed: readBoolean(input.rerankerFallbackUsed) ?? readBoolean(reranker.fallbackUsed) ?? false,
    rerankerFallbackReason: readString(reranker.fallbackReason),
    strictRuntime: readBoolean(input.strictRuntime) ?? strictRuntimeFromEnv(env),
    warnings: Array.isArray(input.warnings)
      ? input.warnings
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim())
      : [],
  };

  return {
    ...health,
    warnings: warningsForRuntime(health),
  };
}

export function summarizeRetrievalRuntimeHealth(health: RetrievalRuntimeHealth): Record<string, unknown> {
  return {
    retrievalEngineRequested: health.retrievalEngineRequested,
    retrievalEngineActual: health.retrievalEngineActual,
    embeddingProviderRequested: health.embeddingProviderRequested,
    embeddingProviderActual: health.embeddingProviderActual,
    embeddingFallbackUsed: health.embeddingFallbackUsed,
    embeddingModel: health.embeddingModel,
    embeddingDimension: health.embeddingDimension,
    rerankerModeRequested: health.rerankerModeRequested,
    rerankerModeActual: health.rerankerModeActual,
    rerankerFallbackUsed: health.rerankerFallbackUsed,
    strictRuntime: health.strictRuntime,
    warnings: health.warnings,
  };
}
