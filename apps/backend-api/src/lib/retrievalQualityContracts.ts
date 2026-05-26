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
  legacyDiagnostics: HybridRetrievedKnowledgeContext["diagnostics"];
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
    legacyDiagnostics: diagnostics,
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
