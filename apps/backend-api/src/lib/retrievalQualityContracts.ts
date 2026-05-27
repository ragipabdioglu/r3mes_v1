import type { GroundingConfidence } from "./answerSchema.js";
import type { CandidateDeduplicationDiagnostics } from "./candidateDeduper.js";
import type { HybridKnowledgeCandidate, HybridRetrievedKnowledgeContext } from "./hybridKnowledgeRetrieval.js";
import type { RerankDiagnostics, RerankWithDiagnosticsResult } from "./modelRerank.js";
import type { AlignmentDiagnostics, AlignmentScore } from "./querySourceAlignment.js";
import type { RetrievalPlan } from "./retrievalPlan.js";

export const RETRIEVAL_QUALITY_CONTRACT_VERSION = 2 as const;

export type RetrievalChannel = "semantic_dense" | "lexical_exact" | "structured_signal";
export type ObservableLegacyRetrievalSource = HybridKnowledgeCandidate["sources"][number];

export interface RetrievalPlanV2 extends RetrievalPlan {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  compatibilityMode: "legacy_plan_adapter";
}

export interface RetrievalCandidate {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  candidate: HybridKnowledgeCandidate;
  channels: RetrievalChannel[];
  provenance: {
    legacySources: ObservableLegacyRetrievalSource[];
    channelDerivation: "legacy_source_mapping";
  };
}

export interface HybridCandidatePool {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  candidates: RetrievalCandidate[];
  channelCounts: Partial<Record<RetrievalChannel, number>>;
  legacyCandidateCount: number;
}

export interface CandidateDeduplicationResult {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  input: HybridCandidatePool;
  deduped: HybridCandidatePool;
  removedCandidateCount: number;
  diagnostics: CandidateDeduplicationDiagnostics;
  decisionMode: "legacy_dedupe_adapter" | "identity_safe_dedupe";
}

export interface HybridCandidatePoolTelemetry {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  input: {
    candidateCount: number;
    channelCounts: Partial<Record<RetrievalChannel, number>>;
  };
  deduped: {
    candidateCount: number;
    channelCounts: Partial<Record<RetrievalChannel, number>>;
  };
  deduplication: {
    inputCandidateCount: number;
    outputCandidateCount: number;
    mergedCandidateCount: number;
    removedCandidateCount: number;
    decisionMode: CandidateDeduplicationResult["decisionMode"];
  };
  provenanceDerivation: RetrievalCandidate["provenance"]["channelDerivation"];
}

export interface QuerySourceAlignmentResult {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  candidates: Array<HybridKnowledgeCandidate & { alignment: AlignmentScore }>;
  diagnostics: AlignmentDiagnostics;
  decisionMode: "legacy_alignment_adapter";
}

export interface RerankerOutput<TChunk> {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  candidates: RerankWithDiagnosticsResult<TChunk>["candidates"];
  diagnostics: RerankDiagnostics;
  decisionMode: "legacy_reranker_adapter";
}

export interface ContextSufficiencyResult {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  groundingConfidence: GroundingConfidence;
  lowGroundingConfidence: boolean;
  assessmentMode: "legacy_grounding_adapter";
}

export interface RetrievalQualityDiagnostics {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  candidateCounts: {
    semanticDense: number;
    lexicalExact: number;
    deduped: number;
    preRanked: number;
    reranked: number;
    final: number;
  };
  alignment: AlignmentDiagnostics;
  reranker: RerankDiagnostics;
  deduplication?: CandidateDeduplicationDiagnostics;
  candidatePool?: HybridCandidatePoolTelemetry;
  legacyDiagnostics: HybridRetrievedKnowledgeContext["diagnostics"];
}

export type RetrievalDiagnosticsCoverageStatus =
  | "complete"
  | "legacy_uninstrumented"
  | "not_executed"
  | "provider_failure";
export type RetrievalDiagnosticsCoverageMode =
  | "true_hybrid"
  | "qdrant"
  | "prisma"
  | "legacy_hybrid"
  | "not_executed";
export type RetrievalDiagnosticsStage =
  | "candidate_collection"
  | "deduplication"
  | "alignment"
  | "reranker"
  | "context_packaging";

const RETRIEVAL_DIAGNOSTICS_STAGES: RetrievalDiagnosticsStage[] = [
  "candidate_collection",
  "deduplication",
  "alignment",
  "reranker",
  "context_packaging",
];

export interface RetrievalDiagnosticsEnvelopeV2 extends Record<string, unknown> {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  coverageStatus: RetrievalDiagnosticsCoverageStatus;
  mode: RetrievalDiagnosticsCoverageMode;
  missingStages: RetrievalDiagnosticsStage[];
  qualityDiagnostics: RetrievalQualityDiagnostics | null;
  compatibilityMode:
    | "legacy_true_hybrid_observed"
    | "legacy_uninstrumented"
    | "not_executed"
    | "provider_failure";
}

export interface ContextPackage {
  contractVersion: typeof RETRIEVAL_QUALITY_CONTRACT_VERSION;
  contextText: string;
  sources: HybridRetrievedKnowledgeContext["sources"];
  sufficiency: ContextSufficiencyResult;
  diagnostics: RetrievalQualityDiagnostics;
  compatibilityMode: "legacy_true_hybrid_adapter";
}

function channelsForLegacySources(sources: ObservableLegacyRetrievalSource[]): RetrievalChannel[] {
  const channels = new Set<RetrievalChannel>();
  if (sources.includes("qdrant")) channels.add("semantic_dense");
  if (sources.includes("prisma")) channels.add("lexical_exact");
  return [...channels];
}

export function adaptRetrievalPlanV2(plan: RetrievalPlan): RetrievalPlanV2 {
  return {
    ...plan,
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    compatibilityMode: "legacy_plan_adapter",
  };
}

export function adaptRetrievalCandidate(candidate: HybridKnowledgeCandidate): RetrievalCandidate {
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    candidate,
    channels: channelsForLegacySources(candidate.sources),
    provenance: {
      legacySources: [...candidate.sources],
      channelDerivation: "legacy_source_mapping",
    },
  };
}

export function adaptHybridCandidatePool(candidates: HybridKnowledgeCandidate[]): HybridCandidatePool {
  const adapted = candidates.map((candidate) => adaptRetrievalCandidate(candidate));
  const channelCounts: Partial<Record<RetrievalChannel, number>> = {};
  for (const candidate of adapted) {
    for (const channel of candidate.channels) {
      channelCounts[channel] = (channelCounts[channel] ?? 0) + 1;
    }
  }
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    candidates: adapted,
    channelCounts,
    legacyCandidateCount: candidates.length,
  };
}

export function adaptCandidateDeduplicationResult(
  input: HybridKnowledgeCandidate[],
  deduped: HybridKnowledgeCandidate[],
  diagnostics?: CandidateDeduplicationDiagnostics,
): CandidateDeduplicationResult {
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    input: adaptHybridCandidatePool(input),
    deduped: adaptHybridCandidatePool(deduped),
    removedCandidateCount: Math.max(0, input.length - deduped.length),
    diagnostics: diagnostics ?? {
      inputCandidateCount: input.length,
      outputCandidateCount: deduped.length,
      mergedCandidateCount: Math.max(0, input.length - deduped.length),
      merges: [],
    },
    decisionMode: diagnostics ? "identity_safe_dedupe" : "legacy_dedupe_adapter",
  };
}

function summarizeObservableChannelCounts(
  pool: HybridCandidatePool,
): Partial<Record<RetrievalChannel, number>> {
  const channelCounts: Partial<Record<RetrievalChannel, number>> = {
    semantic_dense: pool.channelCounts.semantic_dense ?? 0,
    lexical_exact: pool.channelCounts.lexical_exact ?? 0,
  };
  if (pool.channelCounts.structured_signal !== undefined) {
    channelCounts.structured_signal = pool.channelCounts.structured_signal;
  }
  return channelCounts;
}

export function adaptHybridCandidatePoolTelemetry(
  input: HybridKnowledgeCandidate[],
  deduped: HybridKnowledgeCandidate[],
  diagnostics?: CandidateDeduplicationDiagnostics,
): HybridCandidatePoolTelemetry {
  const result = adaptCandidateDeduplicationResult(input, deduped, diagnostics);
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    input: {
      candidateCount: result.input.legacyCandidateCount,
      channelCounts: summarizeObservableChannelCounts(result.input),
    },
    deduped: {
      candidateCount: result.deduped.legacyCandidateCount,
      channelCounts: summarizeObservableChannelCounts(result.deduped),
    },
    deduplication: {
      inputCandidateCount: result.diagnostics.inputCandidateCount,
      outputCandidateCount: result.diagnostics.outputCandidateCount,
      mergedCandidateCount: result.diagnostics.mergedCandidateCount,
      removedCandidateCount: result.removedCandidateCount,
      decisionMode: result.decisionMode,
    },
    provenanceDerivation: "legacy_source_mapping",
  };
}

export function adaptQuerySourceAlignmentResult(result: {
  candidates: Array<HybridKnowledgeCandidate & { alignment: AlignmentScore }>;
  diagnostics: AlignmentDiagnostics;
}): QuerySourceAlignmentResult {
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    candidates: result.candidates,
    diagnostics: result.diagnostics,
    decisionMode: "legacy_alignment_adapter",
  };
}

export function adaptRerankerOutput<TChunk>(result: RerankWithDiagnosticsResult<TChunk>): RerankerOutput<TChunk> {
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    candidates: result.candidates,
    diagnostics: result.diagnostics,
    decisionMode: "legacy_reranker_adapter",
  };
}

export function adaptRetrievalQualityDiagnostics(
  diagnostics: HybridRetrievedKnowledgeContext["diagnostics"],
): RetrievalQualityDiagnostics {
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    candidateCounts: {
      semanticDense: diagnostics.qdrantCandidateCount,
      lexicalExact: diagnostics.prismaCandidateCount,
      deduped: diagnostics.dedupedCandidateCount,
      preRanked: diagnostics.preRankedCandidateCount,
      reranked: diagnostics.rerankedCandidateCount,
      final: diagnostics.finalCandidateCount,
    },
    alignment: diagnostics.alignment,
    reranker: diagnostics.reranker,
    deduplication: diagnostics.deduplication,
    candidatePool: diagnostics.candidatePool,
    legacyDiagnostics: diagnostics,
  };
}

export function buildCompleteRetrievalDiagnosticsEnvelope(
  diagnostics: HybridRetrievedKnowledgeContext["diagnostics"],
): RetrievalDiagnosticsEnvelopeV2 & HybridRetrievedKnowledgeContext["diagnostics"] {
  return {
    ...diagnostics,
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    coverageStatus: "complete",
    mode: "true_hybrid",
    missingStages: [],
    qualityDiagnostics: adaptRetrievalQualityDiagnostics(diagnostics),
    compatibilityMode: "legacy_true_hybrid_observed",
  };
}

export function buildRetrievalDiagnosticsCoverageEnvelope(opts: {
  mode: RetrievalDiagnosticsCoverageMode;
  coverageStatus: Exclude<RetrievalDiagnosticsCoverageStatus, "complete">;
}): RetrievalDiagnosticsEnvelopeV2 {
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    coverageStatus: opts.coverageStatus,
    mode: opts.mode,
    missingStages: [...RETRIEVAL_DIAGNOSTICS_STAGES],
    qualityDiagnostics: null,
    compatibilityMode: opts.coverageStatus,
  };
}

export function adaptTrueHybridContextPackage(context: HybridRetrievedKnowledgeContext): ContextPackage {
  return {
    contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
    contextText: context.contextText,
    sources: context.sources,
    sufficiency: {
      contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
      groundingConfidence: context.groundingConfidence,
      lowGroundingConfidence: context.lowGroundingConfidence,
      assessmentMode: "legacy_grounding_adapter",
    },
    diagnostics: adaptRetrievalQualityDiagnostics(context.diagnostics),
    compatibilityMode: "legacy_true_hybrid_adapter",
  };
}
