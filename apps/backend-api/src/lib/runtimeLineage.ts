import type { AnswerPathName, RuntimeLineage, RuntimeProfile } from "@r3mes/shared-types";

import { resolveRuntimeProfile } from "./runtimeProfile.js";

const DETERMINISTIC_PATHS = new Set<AnswerPathName>([
  "conversational_intent",
  "no_source_fallback",
  "rag_fast_path",
  "contradiction_fast_path",
  "low_confidence_evidence_fast_path",
  "fast_grounded_composer",
]);

const AI_ENGINE_PATHS = new Set<AnswerPathName>([
  "ai_engine",
  "ai_engine_validated",
  "ai_engine_parsed",
  "ai_engine_draft_wrapped",
  "ai_engine_empty_wrapped",
  "ai_engine_raw_json",
]);

export interface RuntimeLineageInput {
  answerPath: AnswerPathName;
  stream: boolean;
  profile?: RuntimeProfile;
  qwenCalled?: boolean;
  validatorCalled?: boolean;
  qwenCallCount?: number;
  composer?: {
    plannedComposerUsed?: boolean;
    fallbackTemplateUsed?: boolean;
  };
  retrieval?: {
    mode?: RuntimeLineage["retrieval"]["mode"];
    qdrantFallbackUsed?: boolean;
    runtime?: {
      retrievalEngineRequested?: string;
      retrievalEngineActual?: string;
      embeddingProviderRequested?: string;
      embeddingProviderActual?: string;
      embeddingFallbackUsed?: boolean;
      embeddingModel?: string;
      embeddingDimension?: number;
      rerankerModeRequested?: string;
      rerankerModeActual?: string;
      rerankerFallbackUsed?: boolean;
      rerankerFallbackReason?: string;
    } | null;
    diagnostics?: Record<string, unknown> | null;
  };
  safety?: {
    fallbackMode?: unknown;
    blockedReasons?: unknown;
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function blockedReasonCount(value: unknown): number {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).length : 0;
}

function qdrantWasUsed(input: RuntimeLineageInput): boolean {
  return input.retrieval?.mode === "qdrant" ||
    input.retrieval?.mode === "true_hybrid" ||
    input.retrieval?.runtime?.retrievalEngineActual === "qdrant" ||
    input.retrieval?.runtime?.retrievalEngineActual === "hybrid";
}

export function buildRuntimeLineage(input: RuntimeLineageInput): RuntimeLineage {
  const profile = input.profile ?? resolveRuntimeProfile();
  const runtime = input.retrieval?.runtime ?? {};
  const diagnostics = asRecord(input.retrieval?.diagnostics);
  const rerankerDiagnostics = asRecord(diagnostics.reranker ?? diagnostics.modelRerank);
  const deterministicPath = DETERMINISTIC_PATHS.has(input.answerPath);
  const inferredQwenCalled = AI_ENGINE_PATHS.has(input.answerPath);
  const validatorCalled = input.validatorCalled ?? input.answerPath === "ai_engine_validated";
  const qwenCalled = input.qwenCalled ?? inferredQwenCalled;
  const callCount = input.qwenCallCount ?? (qwenCalled ? 1 : 0) + (validatorCalled ? 1 : 0);

  const embeddingFallbackUsed = Boolean(runtime.embeddingFallbackUsed);
  const rerankerFallbackUsed = Boolean(runtime.rerankerFallbackUsed ?? readBoolean(rerankerDiagnostics.fallbackUsed));
  const qdrantFallbackFromDiagnostics = readBoolean(diagnostics.qdrantFallbackUsed) ??
    readBoolean(diagnostics.qdrantProviderFailed);
  const qdrantFallbackUsed = input.retrieval?.qdrantFallbackUsed ??
    qdrantFallbackFromDiagnostics ??
    ((
      runtime.retrievalEngineRequested === "qdrant" ||
      runtime.retrievalEngineRequested === "hybrid"
    ) && runtime.retrievalEngineActual === "prisma");

  return {
    version: 1,
    profileName: profile.name,
    answerPath: input.answerPath,
    stream: input.stream,
    qwen: {
      called: qwenCalled,
      validatorCalled,
      callCount,
      runtime: profile.chat.runtime,
      model: profile.chat.modelId,
    },
    composer: {
      deterministicUsed: deterministicPath || Boolean(input.composer?.plannedComposerUsed || input.composer?.fallbackTemplateUsed),
      plannedComposerUsed: input.composer?.plannedComposerUsed,
      fallbackTemplateUsed: input.composer?.fallbackTemplateUsed,
    },
    retrieval: {
      mode: input.retrieval?.mode,
      qdrantUsed: qdrantWasUsed(input),
      qdrantFallbackUsed,
    },
    embedding: {
      requestedProvider: runtime.embeddingProviderRequested,
      actualProvider: runtime.embeddingProviderActual,
      fallbackUsed: embeddingFallbackUsed,
      model: runtime.embeddingModel,
      dimension: runtime.embeddingDimension,
    },
    reranker: {
      requestedMode: runtime.rerankerModeRequested,
      actualMode: runtime.rerankerModeActual,
      provider: readString(rerankerDiagnostics.provider),
      fallbackUsed: rerankerFallbackUsed,
      fallbackReason: runtime.rerankerFallbackReason ?? readString(rerankerDiagnostics.fallbackReason),
    },
    safety: {
      fallbackMode: readString(input.safety?.fallbackMode),
      blockedReasonCount: blockedReasonCount(input.safety?.blockedReasons),
    },
    controlTower: {
      qualityFallbackUsed: Boolean(embeddingFallbackUsed || rerankerFallbackUsed || qdrantFallbackUsed),
    },
  };
}
