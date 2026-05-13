import { describe, expect, it } from "vitest";

import { DECISION_CONFIG_VERSION, getDecisionConfig } from "./decisionConfig.js";

describe("decision config registry", () => {
  it("exposes a single versioned source for router, alignment, retrieval, reranker, and evidence decisions", () => {
    const config = getDecisionConfig({});

    expect(config.version).toBe(DECISION_CONFIG_VERSION);
    expect(config.router.weights.profileEmbedding).toBeCloseTo(0.45);
    expect(config.alignment.minScore).toBe(0.34);
    expect(config.retrievalBudget.fastSourceLimit).toBe(2);
    expect(config.reranker.mode).toBe("model");
    expect(config.evidenceBudget.usableFactLimit).toBe(5);
    expect(config.evidenceScoring.shareGroupDenseTableBonus).toBeGreaterThan(0);
  });

  it("keeps env overrides centralized without changing callers", () => {
    const config = getDecisionConfig({
      R3MES_DECISION_CONFIG_VERSION: "lab-v2",
      R3MES_ROUTER_WEIGHTS_JSON: JSON.stringify({ lexicalKeyword: 3, profileEmbedding: 1 }),
      R3MES_ROUTER_WEIGHT_DOMAIN_HINT: "2",
      R3MES_ALIGNMENT_MIN_SCORE: "0.42",
      R3MES_RAG_DEEP_SOURCE_LIMIT: "7",
      R3MES_RERANKER_CANDIDATE_LIMIT: "9",
      R3MES_EVIDENCE_SCORE_SHARE_GROUP_DENSE_TABLE_BONUS: "44",
    });

    expect(config.version).toBe("lab-v2");
    expect(config.router.weights.lexicalKeyword).toBeGreaterThan(config.router.weights.profileEmbedding);
    expect(config.router.weights.domainHint).toBeGreaterThan(config.router.weights.profileEmbedding);
    expect(config.alignment.minScore).toBe(0.42);
    expect(config.retrievalBudget.deepSourceLimit).toBe(7);
    expect(config.reranker.candidateLimit).toBe(9);
    expect(config.evidenceScoring.shareGroupDenseTableBonus).toBe(44);
  });
});
