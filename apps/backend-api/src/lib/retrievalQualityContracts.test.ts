import { describe, expect, it } from "vitest";

import { dedupeCandidatesIdentitySafe } from "./candidateDeduper.js";
import type { HybridKnowledgeCandidate, HybridRetrievedKnowledgeContext } from "./hybridKnowledgeRetrieval.js";
import {
  adaptCandidateDeduplicationResult,
  adaptHybridCandidatePool,
  adaptQuerySourceAlignmentResult,
  adaptRerankerOutput,
  adaptRetrievalPlanV2,
  adaptTrueHybridContextPackage,
  RETRIEVAL_QUALITY_CONTRACT_VERSION,
} from "./retrievalQualityContracts.js";

function candidate(id: string, sources: HybridKnowledgeCandidate["sources"]): HybridKnowledgeCandidate {
  return {
    chunk: {
      id,
      documentId: `doc-${id}`,
      chunkIndex: 0,
      content: "Generic retrieval candidate.",
      document: {
        title: `title-${id}`,
        collectionId: "collection-1",
      },
    },
    card: {
      topic: "generic topic",
      tags: [],
      patientSummary: "",
      clinicalTakeaway: "",
      safeGuidance: "",
      redFlags: "",
      doNotInfer: "",
    },
    sources,
    preRankScore: 1,
  };
}

const alignment = {
  enabled: true,
  minScore: 0.2,
  weakScore: 0.4,
  inputCandidateCount: 1,
  alignedCandidateCount: 1,
  weakCandidateCount: 0,
  mismatchCandidateCount: 0,
  droppedCandidateCount: 0,
  fastFailed: false,
};

const reranker = {
  mode: "deterministic" as const,
  modelEnabled: false,
  fallbackUsed: false,
  inputCandidateCount: 1,
  deterministicCandidateCount: 1,
  modelCandidateCount: 0,
  returnedCandidateCount: 1,
  candidateLimit: 3,
  modelWeight: 0,
  timeoutMs: 0,
  topCandidates: [],
};

describe("retrieval quality contracts", () => {
  it("adds a versioned RetrievalPlanV2 surface without mutating the legacy plan", () => {
    const plan = {
      query: "generic query",
      normalizedQuery: "generic query",
      sourcePlan: { mode: "explicit", selectedCollectionIds: ["collection-1"] },
      runtime: {
        retrievalEngineRequested: "hybrid",
        retrievalEngineActual: "hybrid",
        embeddingProviderRequested: "bge-m3",
        embeddingProviderActual: "bge-m3",
        embeddingFallbackUsed: false,
        rerankerModeRequested: "model",
        rerankerModeActual: "model",
        rerankerFallbackUsed: false,
        warnings: [],
      },
      expectedEvidenceKinds: ["paragraph" as const],
      requestedFields: [],
      outputConstraints: [],
      warnings: [],
    };

    const adapted = adaptRetrievalPlanV2(plan);

    expect(adapted).toMatchObject({
      contractVersion: RETRIEVAL_QUALITY_CONTRACT_VERSION,
      compatibilityMode: "legacy_plan_adapter",
      query: plan.query,
      sourcePlan: plan.sourcePlan,
    });
    expect(plan).not.toHaveProperty("contractVersion");
  });

  it("projects existing provenance into observable channel counts only", () => {
    const semantic = candidate("semantic", ["qdrant"]);
    const hybrid = candidate("hybrid", ["qdrant", "prisma"]);

    const pool = adaptHybridCandidatePool([semantic, hybrid]);

    expect(pool.channelCounts).toEqual({ semantic_dense: 2, lexical_exact: 1 });
    expect(pool.candidates[1]?.candidate).toBe(hybrid);
    expect(pool.candidates[1]?.provenance.legacySources).toEqual(["qdrant", "prisma"]);
  });

  it("records the existing dedupe output without making new dedupe decisions", () => {
    const shared = candidate("shared", ["qdrant", "prisma"]);
    const removed = candidate("removed", ["prisma"]);

    const result = adaptCandidateDeduplicationResult([shared, removed], [shared]);

    expect(result.decisionMode).toBe("legacy_dedupe_adapter");
    expect(result.removedCandidateCount).toBe(1);
    expect(result.deduped.candidates[0]?.candidate).toBe(shared);
  });

  it("carries identity-safe dedupe rule diagnostics through the named contract", () => {
    const shared = candidate("shared", ["qdrant"]);
    const duplicate = { ...candidate("shared", ["prisma"]), chunk: { ...shared.chunk } };
    const dedupe = dedupeCandidatesIdentitySafe([shared, duplicate]);

    const result = adaptCandidateDeduplicationResult([shared, duplicate], dedupe.candidates, dedupe.diagnostics);

    expect(result.decisionMode).toBe("identity_safe_dedupe");
    expect(result.diagnostics).toBe(dedupe.diagnostics);
    expect(result.diagnostics.merges[0]?.rule).toBe("exact_chunk_identity");
    expect(result.deduped.candidates[0]?.provenance.legacySources.sort()).toEqual(["prisma", "qdrant"]);
  });

  it("names existing alignment output without recomputing alignment decisions", () => {
    const alignedCandidate = {
      ...candidate("aligned", ["prisma"]),
      alignment: {
        mode: "aligned" as const,
        score: 0.8,
        matchedTerms: ["term"],
        queryTerms: ["term"],
        sourceTerms: ["term"],
        genericMatchedTerms: [],
        reason: "Existing alignment result.",
      },
    };

    const result = adaptQuerySourceAlignmentResult({ candidates: [alignedCandidate], diagnostics: alignment });

    expect(result.decisionMode).toBe("legacy_alignment_adapter");
    expect(result.candidates[0]).toBe(alignedCandidate);
    expect(result.diagnostics).toBe(alignment);
  });

  it("names existing reranker output without changing rank order or diagnostics", () => {
    const candidates = [
      {
        chunk: { id: "first" },
        lexicalScore: 1,
        embeddingScore: 0.5,
        fusedScore: 1,
        rerankScore: 2,
        matchedIntentCount: 0,
        strictEligible: true,
      },
    ];

    const result = adaptRerankerOutput({ candidates, diagnostics: reranker });

    expect(result.decisionMode).toBe("legacy_reranker_adapter");
    expect(result.candidates).toBe(candidates);
    expect(result.diagnostics).toBe(reranker);
  });

  it("wraps true-hybrid context and diagnostics without changing context output", () => {
    const context: HybridRetrievedKnowledgeContext = {
      contextText: "Preserved context.",
      sources: [],
      lowGroundingConfidence: false,
      groundingConfidence: "medium",
      evidence: null,
      diagnostics: {
        qdrantCandidateCount: 2,
        prismaCandidateCount: 1,
        dedupedCandidateCount: 2,
        preRankedCandidateCount: 2,
        rerankedCandidateCount: 1,
        finalCandidateCount: 1,
        alignment,
        reranker,
        budget: {
          contextMode: "compact",
          budgetMode: "normal_rag",
          requestedSourceLimit: 3,
          finalSourceLimit: 3,
          finalSourceCount: 1,
          evidenceContextMode: "none",
          contextTextChars: 18,
          evidenceInputChars: 0,
          evidencePrunedInputChars: 0,
          evidenceFactCandidateCount: 0,
          evidenceFactSelectedCount: 0,
          evidenceFactDroppedCount: 0,
          evidenceContradictionSignalCount: 0,
          evidenceDirectFactLimit: 0,
          evidenceSupportingFactLimit: 0,
          evidenceRiskFactLimit: 0,
          evidenceUsableFactLimit: 0,
          evidenceDirectFactCount: 0,
          evidenceSupportingFactCount: 0,
          evidenceRiskFactCount: 0,
          evidenceUsableFactCount: 0,
        },
        qdrantEmbedding: null,
        retrievalMode: "true_hybrid",
      },
    };

    const result = adaptTrueHybridContextPackage(context);

    expect(result.contextText).toBe(context.contextText);
    expect(result.sources).toBe(context.sources);
    expect(result.diagnostics.legacyDiagnostics).toBe(context.diagnostics);
    expect(result.diagnostics.candidateCounts).toEqual({
      semanticDense: 2,
      lexicalExact: 1,
      deduped: 2,
      preRanked: 2,
      reranked: 1,
      final: 1,
    });
    expect(result.sufficiency).toMatchObject({
      groundingConfidence: "medium",
      lowGroundingConfidence: false,
      assessmentMode: "legacy_grounding_adapter",
    });
  });
});
