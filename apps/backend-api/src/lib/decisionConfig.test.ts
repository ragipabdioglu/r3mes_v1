import { describe, expect, it } from "vitest";

import { DECISION_CONFIG_VERSION, getDecisionConfig } from "./decisionConfig.js";

describe("decision config registry", () => {
  it("exposes a single versioned source for router, alignment, retrieval, reranker, and evidence decisions", () => {
    const config = getDecisionConfig({});

    expect(config.version).toBe(DECISION_CONFIG_VERSION);
    expect(config.router.weights.profileEmbedding).toBeCloseTo(0.45);
    expect(config.alignment.minScore).toBe(0.34);
    expect(config.retrievalBudget.fastSourceLimit).toBe(2);
    expect(config.hybridRetrieval.lexicalWeight).toBeCloseTo(0.75);
    expect(config.hybridRetrieval.embeddingWeight).toBeCloseTo(0.25);
    expect(config.reranker.mode).toBe("model");
    expect(config.reranker.fastCandidateLimit).toBe(3);
    expect(config.reranker.normalCandidateLimit).toBe(4);
    expect(config.reranker.deepCandidateLimit).toBe(8);
    expect(config.reranker.lowConfidenceCandidateLimit).toBe(4);
    expect(config.reranker.scopedCandidateLimit).toBe(3);
    expect(config.evidenceBudget.usableFactLimit).toBe(5);
    expect(config.evidenceCompiler.minUsableFactsForHigh).toBe(1);
    expect(config.evidencePruning.fastMaxChars).toBe(1200);
    expect(config.evidencePruning.maxFactSentences).toBe(6);
    expect(config.evidenceScoring.shareGroupDenseTableBonus).toBeGreaterThan(0);
    expect(config.evidenceScoring.answerFactOverlapWeight).toBe(6);
    expect(config.evidenceScoring.fragmentMinScore).toBe(-8);
    expect(config.evidenceLexicon.withholdingTerms).toContain("stopaj");
    expect(config.evidenceLexicon.cashRateTerms).toContain("cash");
    expect(config.evidencePlannerHints.some((hint) => hint.id === "medical_pelvic_pain")).toBe(true);
    expect(config.ingestionQuality.thinParseScore).toBe(48);
    expect(config.ingestionQuality.tableHighScore).toBe(65);
    expect(config.feedbackRuntime.mode).toBe("shadow");
    expect(config.feedbackRuntime.promotionMaxAbsDelta).toBe(0.35);
    expect(config.feedbackProposal.minSignals).toBe(2);
    expect(config.feedbackProposal.baseScoreDelta).toBe(0.08);
    expect(config.feedbackProposal.expectedBoostMultiplier).toBe(0.75);
  });

  it("keeps env overrides centralized without changing callers", () => {
    const config = getDecisionConfig({
      R3MES_DECISION_CONFIG_VERSION: "lab-v2",
      R3MES_ROUTER_WEIGHTS_JSON: JSON.stringify({ lexicalKeyword: 3, profileEmbedding: 1 }),
      R3MES_ROUTER_WEIGHT_DOMAIN_HINT: "2",
      R3MES_ALIGNMENT_MIN_SCORE: "0.42",
      R3MES_RAG_DEEP_SOURCE_LIMIT: "7",
      R3MES_HYBRID_LEXICAL_WEIGHT: "3",
      R3MES_HYBRID_EMBEDDING_WEIGHT: "1",
      R3MES_RERANKER_CANDIDATE_LIMIT: "9",
      R3MES_RERANKER_FAST_CANDIDATE_LIMIT: "2",
      R3MES_RERANKER_DEEP_CANDIDATE_LIMIT: "10",
      R3MES_RERANKER_SCOPED_CANDIDATE_LIMIT: "6",
      R3MES_EVIDENCE_COMPILER_MIN_FACTS_HIGH: "3",
      R3MES_EVIDENCE_COMPILER_REQUIRE_SOURCE_HIGH: "1",
      R3MES_EVIDENCE_PRUNING_JSON: JSON.stringify({ normalMaxChars: 1900, maxFactSentences: 8 }),
      R3MES_EVIDENCE_DEEP_MAX_CHARS: "2600",
      R3MES_EVIDENCE_SCORE_SHARE_GROUP_DENSE_TABLE_BONUS: "44",
      R3MES_EVIDENCE_SCORE_ANSWER_FACT_OVERLAP_WEIGHT: "7",
      R3MES_EVIDENCE_SCORE_FRAGMENT_MIN_SCORE: "0",
      R3MES_EVIDENCE_LEXICON_WITHHOLDING_TERMS: "tevkifat,withholding",
      R3MES_EVIDENCE_LEXICON_CASH_RATE_TERMS: "nakdi,oran",
      R3MES_EVIDENCE_PLANNER_HINTS_JSON: JSON.stringify([
        {
          id: "custom_docs",
          expectedEvidenceType: "guideline",
          matchTerms: ["dokuman"],
          searchQueries: ["{query} özel arama"],
          mustIncludeTerms: ["özel"],
        },
      ]),
      R3MES_INGESTION_QUALITY_JSON: JSON.stringify({ thinParseScore: 55, tableHighScore: 75 }),
      R3MES_INGESTION_OCR_HIGH_SCORE: "40",
      R3MES_FEEDBACK_RUNTIME_MODE: "active",
      R3MES_FEEDBACK_PROMOTION_MAX_ABS_DELTA: "0.2",
      R3MES_FEEDBACK_PROPOSAL_MIN_SIGNALS: "3",
      R3MES_FEEDBACK_PROPOSAL_BASE_SCORE_DELTA: "0.05",
      R3MES_FEEDBACK_PROPOSAL_EXPECTED_BOOST_MULTIPLIER: "0.5",
    });

    expect(config.version).toBe("lab-v2");
    expect(config.router.weights.lexicalKeyword).toBeGreaterThan(config.router.weights.profileEmbedding);
    expect(config.router.weights.domainHint).toBeGreaterThan(config.router.weights.profileEmbedding);
    expect(config.alignment.minScore).toBe(0.42);
    expect(config.retrievalBudget.deepSourceLimit).toBe(7);
    expect(config.hybridRetrieval.lexicalWeight).toBeCloseTo(0.75);
    expect(config.hybridRetrieval.embeddingWeight).toBeCloseTo(0.25);
    expect(config.reranker.candidateLimit).toBe(9);
    expect(config.reranker.fastCandidateLimit).toBe(2);
    expect(config.reranker.deepCandidateLimit).toBe(10);
    expect(config.reranker.scopedCandidateLimit).toBe(6);
    expect(config.evidenceCompiler.minUsableFactsForHigh).toBe(3);
    expect(config.evidenceCompiler.requireSourceForHigh).toBe(true);
    expect(config.evidencePruning.normalMaxChars).toBe(1900);
    expect(config.evidencePruning.deepMaxChars).toBe(2600);
    expect(config.evidencePruning.maxFactSentences).toBe(8);
    expect(config.evidenceScoring.shareGroupDenseTableBonus).toBe(44);
    expect(config.evidenceScoring.answerFactOverlapWeight).toBe(7);
    expect(config.evidenceScoring.fragmentMinScore).toBe(0);
    expect(config.evidenceLexicon.withholdingTerms).toEqual(["tevkifat", "withholding"]);
    expect(config.evidenceLexicon.cashRateTerms).toEqual(["nakdi", "oran"]);
    expect(config.evidencePlannerHints).toEqual([
      {
        id: "custom_docs",
        expectedEvidenceType: "guideline",
        matchTerms: ["dokuman"],
        searchQueries: ["{query} özel arama"],
        mustIncludeTerms: ["özel"],
      },
    ]);
    expect(config.ingestionQuality.thinParseScore).toBe(55);
    expect(config.ingestionQuality.tableHighScore).toBe(75);
    expect(config.ingestionQuality.ocrHighScore).toBe(40);
    expect(config.feedbackRuntime.mode).toBe("active");
    expect(config.feedbackRuntime.promotionMaxAbsDelta).toBe(0.2);
    expect(config.feedbackProposal.minSignals).toBe(3);
    expect(config.feedbackProposal.baseScoreDelta).toBe(0.05);
    expect(config.feedbackProposal.expectedBoostMultiplier).toBe(0.5);
  });
});
