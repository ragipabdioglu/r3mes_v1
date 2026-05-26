import { Redis } from "ioredis";
import type { ProviderReadinessCheck, ProviderReadinessReport, ReadinessStatus, RuntimeProfile } from "@r3mes/shared-types";
import { prisma } from "./prisma.js";
import { embedTextsForQdrantWithDiagnostics, getQdrantVectorSize } from "./qdrantEmbedding.js";
import { validateQdrantPayloadV2 } from "./qdrantPayloadV2.js";
import { resolveRuntimeProfile } from "./runtimeFallbackPolicy.js";

export type ProviderReadinessMode = "summary" | "warm";

interface ProviderReadinessOptions {
  mode?: ProviderReadinessMode;
  env?: Record<string, string | undefined>;
}

const DEFAULT_AI_ENGINE_URL = "http://127.0.0.1:8000";
const DEFAULT_QDRANT_URL = "http://127.0.0.1:6333";
const DEFAULT_READY_TIMEOUT_MS = 3_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function baseUrl(value: string | undefined, fallback: string): string {
  return (value ?? fallback).replace(/\/$/, "");
}

function isBgeM3Model(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase().includes("bge-m3");
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function readCollectionVectorSize(parsed: unknown): number | undefined {
  const result = parsed && typeof parsed === "object" ? (parsed as { result?: unknown }).result : undefined;
  const config = result && typeof result === "object" ? (result as { config?: unknown }).config : undefined;
  const params = config && typeof config === "object" ? (config as { params?: unknown }).params : undefined;
  const vectors = params && typeof params === "object" ? (params as { vectors?: unknown }).vectors : undefined;
  if (vectors && typeof vectors === "object" && typeof (vectors as { size?: unknown }).size === "number") {
    return (vectors as { size: number }).size;
  }
  if (vectors && typeof vectors === "object") {
    for (const vectorConfig of Object.values(vectors as Record<string, unknown>)) {
      if (vectorConfig && typeof vectorConfig === "object" && typeof (vectorConfig as { size?: unknown }).size === "number") {
        return (vectorConfig as { size: number }).size;
      }
    }
  }
  return undefined;
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...init?.headers },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`status=${response.status} body=${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

async function measure(
  id: ProviderReadinessCheck["id"],
  requiredForProfile: boolean,
  fn: () => Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">>,
): Promise<ProviderReadinessCheck> {
  const started = Date.now();
  try {
    const result = await fn();
    return { id, requiredForProfile, latencyMs: Date.now() - started, ...result };
  } catch (error) {
    return {
      id,
      requiredForProfile,
      latencyMs: Date.now() - started,
      status: requiredForProfile ? "fail" : "degraded",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkDb(): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  await prisma.$queryRaw`SELECT 1`;
  return { status: "pass" };
}

async function checkRedis(env: Record<string, string | undefined>): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  const redisUrl = env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const redis = new Redis(redisUrl, {
    connectTimeout: parsePositiveInt(env.R3MES_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS),
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.ping();
    return { status: "pass" };
  } finally {
    redis.disconnect();
  }
}

async function checkAiEngineRuntime(
  env: Record<string, string | undefined>,
): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  const timeoutMs = parsePositiveInt(env.R3MES_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  const aiEngineUrl = baseUrl(env.R3MES_AI_ENGINE_URL ?? env.AI_ENGINE_URL, DEFAULT_AI_ENGINE_URL);
  const runtime = await fetchJson(`${aiEngineUrl}/health/runtime`, timeoutMs).catch(async () =>
    fetchJson(`${aiEngineUrl}/health`, timeoutMs),
  );
  return { status: "pass", details: { runtime } };
}

async function checkLlamaLoaded(
  env: Record<string, string | undefined>,
): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  const timeoutMs = parsePositiveInt(env.R3MES_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  const aiEngineUrl = baseUrl(env.R3MES_AI_ENGINE_URL ?? env.AI_ENGINE_URL, DEFAULT_AI_ENGINE_URL);
  const runtime = await fetchJson(`${aiEngineUrl}/health/runtime`, timeoutMs);
  const record = runtime && typeof runtime === "object" ? runtime as Record<string, unknown> : {};
  const loaded = record.llama_loaded ?? record.model_loaded ?? record.loaded;
  if (loaded === false) {
    return { status: "fail", details: { loaded } };
  }
  return { status: "pass", details: { loaded: loaded ?? "unknown" } };
}

export async function checkQdrantHealth(
  env: Record<string, string | undefined>,
): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  const timeoutMs = parsePositiveInt(env.R3MES_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  const qdrantUrl = baseUrl(env.R3MES_QDRANT_URL, DEFAULT_QDRANT_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let health: unknown;
  try {
    const response = await fetch(`${qdrantUrl}/healthz`, {
      headers: { accept: "text/plain, application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`status=${response.status} body=${text.slice(0, 200)}`);
    }
    try {
      health = text ? JSON.parse(text) : {};
    } catch {
      health = text;
    }
  } finally {
    clearTimeout(timeout);
  }
  return { status: "pass", details: { health } };
}

export async function hasStrictQdrantPayloadV2Integrity(
  profile: RuntimeProfile,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  const timeoutMs = parsePositiveInt(env.R3MES_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  const qdrantUrl = baseUrl(env.R3MES_QDRANT_URL, DEFAULT_QDRANT_URL);
  const collection = encodeURIComponent(profile.qdrant.collectionName);
  let offset: unknown;
  let auditedPointCount = 0;

  for (;;) {
    const parsed = await fetchJson(`${qdrantUrl}/collections/${collection}/points/scroll`, timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        limit: 256,
        with_payload: true,
        with_vector: false,
        ...(offset !== undefined ? { offset } : {}),
      }),
    });
    const result = parsed && typeof parsed === "object" ? (parsed as { result?: unknown }).result : undefined;
    const points = result && typeof result === "object" && Array.isArray((result as { points?: unknown }).points)
      ? (result as { points: unknown[] }).points
      : [];

    for (const point of points) {
      const payload = point && typeof point === "object" ? (point as { payload?: unknown }).payload : undefined;
      const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      if (
        !validateQdrantPayloadV2(payload).valid ||
        record.embeddingProvider !== "bge-m3" ||
        !isBgeM3Model(record.embeddingModel) ||
        record.embeddingDimension !== profile.qdrant.vectorSize
      ) {
        return false;
      }
      auditedPointCount += 1;
    }

    const nextPageOffset = result && typeof result === "object"
      ? (result as { next_page_offset?: unknown }).next_page_offset
      : undefined;
    if (nextPageOffset === undefined || nextPageOffset === null) {
      return auditedPointCount > 0;
    }
    offset = nextPageOffset;
  }
}

async function checkQdrantCollectionShape(
  profile: RuntimeProfile,
  env: Record<string, string | undefined>,
  strict: boolean,
): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  const timeoutMs = parsePositiveInt(env.R3MES_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  const qdrantUrl = baseUrl(env.R3MES_QDRANT_URL, DEFAULT_QDRANT_URL);
  const collection = encodeURIComponent(profile.qdrant.collectionName);
  const parsed = await fetchJson(`${qdrantUrl}/collections/${collection}`, timeoutMs);
  const actualVectorSize = readCollectionVectorSize(parsed);
  const expectedVectorSize = profile.qdrant.vectorSize;
  if (actualVectorSize !== undefined && actualVectorSize !== expectedVectorSize) {
    return {
      status: "fail",
      details: { collection: profile.qdrant.collectionName, expectedVectorSize, actualVectorSize },
    };
  }
  if (strict && !(await hasStrictQdrantPayloadV2Integrity(profile, env))) {
    return {
      status: "fail",
      details: { collection: profile.qdrant.collectionName, expectedVectorSize, actualVectorSize: actualVectorSize ?? "unknown" },
    };
  }
  return {
    status: "pass",
    details: { collection: profile.qdrant.collectionName, expectedVectorSize, actualVectorSize: actualVectorSize ?? "unknown" },
  };
}

function checkEmbeddingProviderSummary(profile: RuntimeProfile): Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs"> {
  const realProvider = profile.embedding.requestedProvider === "ai-engine" || profile.embedding.requestedProvider === "bge-m3";
  if (profile.embedding.requiredRealProvider && !realProvider) {
    return {
      status: "fail",
      details: { requestedProvider: profile.embedding.requestedProvider, requiredRealProvider: true },
    };
  }
  return {
    status: realProvider ? "pass" : "degraded",
    details: { requestedProvider: profile.embedding.requestedProvider, requiredRealProvider: profile.embedding.requiredRealProvider },
  };
}

async function checkEmbeddingSmoke(profile: RuntimeProfile): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  const samples = [
    "KAP finansal tabloda net kar ve hasılat değişimi nasıl okunur?",
    "Finansal tabloda net kar, hasılat ve dönemsel değişim birlikte değerlendirilir.",
    "Okulda BEP planı için veli ve rehberlik servisiyle görüşme yapılır.",
  ];
  const result = await embedTextsForQdrantWithDiagnostics(samples);
  const [queryVector, positiveVector, negativeVector] = result.vectors;
  const positiveSimilarity = cosineSimilarity(queryVector ?? [], positiveVector ?? []);
  const negativeSimilarity = cosineSimilarity(queryVector ?? [], negativeVector ?? []);
  const failures = [
    result.diagnostics.fallbackUsed ? "embedding_fallback_used" : null,
    result.diagnostics.actualProvider === "deterministic" && profile.embedding.requiredRealProvider ? "embedding_provider_not_real" : null,
    result.diagnostics.dimension !== getQdrantVectorSize() ? "embedding_dimension_mismatch" : null,
    !isBgeM3Model(result.diagnostics.model) && profile.embedding.requiredRealProvider ? "embedding_model_not_bge_m3" : null,
    positiveSimilarity <= negativeSimilarity ? "embedding_semantic_similarity_failed" : null,
  ].filter(Boolean);
  return {
    status: failures.length > 0 ? "fail" : "pass",
    details: {
      diagnostics: result.diagnostics,
      positiveSimilarity: Number(positiveSimilarity.toFixed(6)),
      negativeSimilarity: Number(negativeSimilarity.toFixed(6)),
      failures,
    },
  };
}

function checkRerankerProviderSummary(profile: RuntimeProfile): Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs"> {
  if (profile.reranker.requiredRealProvider && profile.reranker.requestedMode !== "model") {
    return {
      status: "fail",
      details: { requestedMode: profile.reranker.requestedMode, requiredRealProvider: true },
    };
  }
  return {
    status: profile.reranker.requestedMode === "model" ? "pass" : "degraded",
    details: { requestedMode: profile.reranker.requestedMode, requiredRealProvider: profile.reranker.requiredRealProvider },
  };
}

async function checkRerankerSmoke(
  profile: RuntimeProfile,
  env: Record<string, string | undefined>,
): Promise<Omit<ProviderReadinessCheck, "id" | "requiredForProfile" | "latencyMs">> {
  const timeoutMs = parsePositiveInt(env.R3MES_RERANKER_READINESS_TIMEOUT_MS, 120_000);
  const aiEngineUrl = baseUrl(env.R3MES_AI_ENGINE_URL ?? env.AI_ENGINE_URL, DEFAULT_AI_ENGINE_URL);
  const parsed = await fetchJson(`${aiEngineUrl}/v1/rerank`, timeoutMs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "Production migration öncesi hangi kontroller yapılmalı?",
      documents: [
        "Title: Veritabanı migration güvenliği\nMigration öncesi yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
        "Title: Tatil hazırlığı\nSeyahat öncesi pasaport geçerliliği ve rezervasyon bilgileri kontrol edilmelidir.",
        "Title: KAP kar dağıtım tablosu\nSPK'ya göre net dönem kârı ve dağıtılabilir kâr kalemleri tabloda ayrı satırlarda verilir.",
      ],
    }),
  });
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const scores = Array.isArray(record.scores) ? record.scores : [];
  const failures = [
    record.fallback_used === true ? "reranker_fallback_used" : null,
    record.provider !== profile.reranker.expectedProvider && profile.reranker.requiredRealProvider ? "reranker_provider_not_cross_encoder" : null,
    scores.length < 2 ? "reranker_scores_missing" : null,
  ].filter(Boolean);
  return {
    status: failures.length > 0 ? "fail" : "pass",
    details: {
      provider: record.provider ?? null,
      fallbackUsed: record.fallback_used === true,
      fallbackReason: record.fallback_reason ?? null,
      scores,
      failures,
    },
  };
}

function summarizeChecks(checks: ProviderReadinessCheck[]): Pick<ProviderReadinessReport, "status" | "failures" | "warnings"> {
  const failures = checks
    .filter((check) => check.requiredForProfile && check.status === "fail")
    .map((check) => check.id);
  const warnings = checks
    .filter((check) => check.status === "degraded" || (!check.requiredForProfile && check.status === "fail"))
    .map((check) => check.id);
  return {
    status: failures.length > 0 ? "fail" : warnings.length > 0 ? "degraded" : "pass",
    failures,
    warnings,
  };
}

export async function buildProviderReadinessReport(options: ProviderReadinessOptions = {}): Promise<ProviderReadinessReport> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? (env.R3MES_DEEP_READY_MODE === "warm" ? "warm" : "summary");
  const profile = resolveRuntimeProfile(env);
  const strict = profile.strictness === "quality_fallback_blocked";
  const checks: ProviderReadinessCheck[] = [
    await measure("backend_db", true, checkDb),
    await measure("backend_redis", true, () => checkRedis(env)),
    await measure("ai_engine_runtime", strict, () => checkAiEngineRuntime(env)),
    await measure("qdrant_health", profile.qdrant.required, () => checkQdrantHealth(env)),
    await measure("qdrant_collection_shape", profile.qdrant.required, () => checkQdrantCollectionShape(profile, env, strict)),
    await measure("embedding_real_provider", profile.embedding.requiredRealProvider, async () => checkEmbeddingProviderSummary(profile)),
    await measure("reranker_real_provider", profile.reranker.requiredRealProvider, async () => checkRerankerProviderSummary(profile)),
  ];

  if (strict) {
    checks.splice(3, 0, await measure("llama_loaded", true, () => checkLlamaLoaded(env)));
  }

  if (mode === "warm") {
    checks.push(
      await measure("embedding_semantic_smoke", profile.embedding.requiredRealProvider, () => checkEmbeddingSmoke(profile)),
      await measure("reranker_score_smoke", profile.reranker.requiredRealProvider, () => checkRerankerSmoke(profile, env)),
    );
  }

  const summary = summarizeChecks(checks);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile,
    ...summary,
    checks,
  };
}
