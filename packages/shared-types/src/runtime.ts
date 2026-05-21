export type RuntimeProfileName = "local-dev" | "eval" | "pilot-rag" | "production" | "peft-lab";
export type RuntimeStrictness = "dev_fallback_allowed" | "quality_fallback_blocked";

export interface RuntimeProfile {
  version: 1;
  name: RuntimeProfileName;
  strictness: RuntimeStrictness;
  chat: {
    runtime: "llama_cpp" | "transformers_peft";
    modelFamily: "qwen2_5_3b" | "unknown";
    modelId: string;
    synthesisOnly: boolean;
    allowDeterministicComposerBypass: boolean;
  };
  embedding: {
    requestedProvider: "ai-engine" | "bge-m3" | "deterministic";
    requiredRealProvider: boolean;
    expectedModelIncludes: string[];
    expectedDimension: number;
  };
  reranker: {
    requestedMode: "model" | "deterministic";
    requiredRealProvider: boolean;
    expectedProvider: "cross_encoder";
  };
  qdrant: {
    required: boolean;
    collectionName: string;
    vectorSize: number;
  };
  stream: {
    productMode: "non_stream_json" | "sse_stream";
  };
  lora: {
    role: "behavior_persona_only";
    optional: boolean;
    maxLockWaitMs?: number;
  };
}

export type AnswerPathName =
  | "conversational_intent"
  | "no_source_fallback"
  | "rag_fast_path"
  | "contradiction_fast_path"
  | "low_confidence_evidence_fast_path"
  | "fast_grounded_composer"
  | "ai_engine"
  | "ai_engine_validated"
  | "ai_engine_parsed"
  | "ai_engine_draft_wrapped"
  | "ai_engine_empty_wrapped"
  | "ai_engine_raw_json";

export interface RuntimeLineage {
  version: 1;
  profileName?: RuntimeProfileName;
  answerPath: AnswerPathName;
  stream: boolean;
  qwen: {
    called: boolean;
    validatorCalled: boolean;
    callCount: number;
    runtime?: "llama_cpp" | "transformers_peft";
    model?: string;
  };
  composer: {
    deterministicUsed: boolean;
    plannedComposerUsed?: boolean;
    fallbackTemplateUsed?: boolean;
  };
  retrieval: {
    mode?: "true_hybrid" | "qdrant" | "prisma" | "legacy_hybrid";
    qdrantUsed: boolean;
    qdrantFallbackUsed?: boolean;
  };
  embedding: {
    requestedProvider?: string;
    actualProvider?: string;
    fallbackUsed: boolean;
    model?: string;
    dimension?: number;
  };
  reranker: {
    requestedMode?: string;
    actualMode?: string;
    provider?: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
  };
  safety: {
    fallbackMode?: string;
    blockedReasonCount: number;
  };
  controlTower: {
    qualityFallbackUsed: boolean;
  };
}

export type ReadinessStatus = "pass" | "degraded" | "fail";

export interface ProviderReadinessCheck {
  id:
    | "backend_db"
    | "backend_redis"
    | "ai_engine_runtime"
    | "llama_loaded"
    | "qdrant_health"
    | "qdrant_collection_shape"
    | "embedding_real_provider"
    | "embedding_semantic_smoke"
    | "reranker_real_provider"
    | "reranker_score_smoke";
  status: ReadinessStatus;
  latencyMs?: number;
  details?: Record<string, unknown>;
  requiredForProfile: boolean;
}

export interface ProviderReadinessReport {
  version: 1;
  generatedAt: string;
  profile: RuntimeProfile;
  status: ReadinessStatus;
  checks: ProviderReadinessCheck[];
  failures: string[];
  warnings: string[];
}
