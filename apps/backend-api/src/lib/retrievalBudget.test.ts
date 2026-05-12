import { describe, expect, it, vi } from "vitest";

import { resolveRetrievalBudget } from "./retrievalBudget.js";

describe("resolveRetrievalBudget", () => {
  it("uses fast grounded budget for explicit selected sources and high-confidence routes", () => {
    const decision = resolveRetrievalBudget({
      requestedCollectionIds: ["education-parents"],
      includePublic: false,
      query: "Veli ateş ve öksürük belirtisinde ne yapmalı?",
      routePlan: {
        domain: "education",
        subtopics: ["okul_yonetimi"],
        riskLevel: "medium",
        retrievalHints: ["veli rehberi"],
        mustIncludeTerms: ["veli"],
        mustExcludeTerms: [],
        confidence: "high",
      },
    });

    expect(decision).toMatchObject({ mode: "fast_grounded", sourceLimit: 2 });
  });

  it("uses deep retrieval for low-confidence or general routes", () => {
    const decision = resolveRetrievalBudget({
      requestedCollectionIds: [],
      includePublic: true,
      query: "Yeni yüklenen belgelerime göre bunu açıkla",
      routePlan: {
        domain: "general",
        subtopics: [],
        riskLevel: "low",
        retrievalHints: [],
        mustIncludeTerms: [],
        mustExcludeTerms: [],
        confidence: "low",
      },
    });

    expect(decision.mode).toBe("deep_rag");
    expect(decision.sourceLimit).toBeGreaterThan(2);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "low-confidence route",
      "general-domain route",
      "auto/public search without explicit selected collection",
    ]));
  });

  it("keeps normal budget for routed questions without explicit selected fast path", () => {
    const decision = resolveRetrievalBudget({
      requestedCollectionIds: [],
      includePublic: false,
      query: "Production migration öncesi ne yapmalıyım?",
      routePlan: {
        domain: "technical",
        subtopics: ["migration"],
        riskLevel: "high",
        retrievalHints: ["migration yedek rollback"],
        mustIncludeTerms: ["migration", "yedek"],
        mustExcludeTerms: [],
        confidence: "high",
      },
    });

    expect(decision).toMatchObject({ mode: "normal_rag", sourceLimit: 3 });
  });

  it("uses deep retrieval for short or low-clarity knowledge turns", () => {
    const decision = resolveRetrievalBudget({
      requestedCollectionIds: ["kap"],
      includePublic: false,
      query: "LDL",
      routePlan: {
        domain: "medical",
        subtopics: [],
        riskLevel: "medium",
        retrievalHints: [],
        mustIncludeTerms: [],
        mustExcludeTerms: [],
        confidence: "medium",
      },
      queryUnderstanding: {
        original: "LDL",
        normalized: {
          original: "LDL",
          normalized: "ldl",
          tokens: ["ldl"],
          expandedTokens: ["ldl"],
          variants: ["LDL", "ldl"],
        },
        signals: {
          normalizedQuery: "ldl",
          language: "unknown",
          intent: "unknown",
          riskLevel: "medium",
          lexicalTerms: ["ldl"],
          significantTerms: ["ldl"],
          phraseHints: [],
          namedEntities: ["LDL"],
          possibleDomains: ["medical"],
          routeHints: {
            domain: "medical",
            subtopics: [],
            confidence: "medium",
            authority: "weak",
            retrievalHints: [],
            mustIncludeTerms: [],
          },
        },
        concepts: [],
        profileConcepts: [],
        quality: {
          shape: "short",
          clarityScore: 40,
          tokenCount: 1,
          expandedTokenCount: 1,
          profileConceptCount: 0,
          conceptCount: 0,
          weakSignalCount: 1,
        },
        mode: "knowledge",
        retrievalIntent: "knowledge_lookup",
        conversationalIntent: null,
        confidence: "low",
        warnings: ["short_knowledge_query", "low_query_clarity"],
      },
    });

    expect(decision.mode).toBe("deep_rag");
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "short query needs broader evidence search",
      "low query clarity",
    ]));
  });

  it("allows source limits to be tuned from env", () => {
    vi.stubEnv("R3MES_RAG_FAST_SOURCE_LIMIT", "1");
    vi.stubEnv("R3MES_RAG_DEEP_SOURCE_LIMIT", "5");
    vi.stubEnv("R3MES_RAG_DEEP_QUERY_TERMS", "kapsamlı");

    expect(resolveRetrievalBudget({
      requestedCollectionIds: ["one"],
      routePlan: {
        domain: "legal",
        subtopics: ["sozlesme"],
        riskLevel: "medium",
        retrievalHints: [],
        mustIncludeTerms: [],
        mustExcludeTerms: [],
        confidence: "high",
      },
    }).sourceLimit).toBe(1);

    expect(resolveRetrievalBudget({
      requestedCollectionIds: [],
      includePublic: true,
      routePlan: null,
    }).sourceLimit).toBe(5);

    const deepByTerm = resolveRetrievalBudget({
      requestedCollectionIds: ["one"],
      includePublic: false,
      query: "Bu konuyu kapsamlı açıkla",
      routePlan: {
        domain: "legal",
        subtopics: ["sozlesme"],
        riskLevel: "medium",
        retrievalHints: [],
        mustIncludeTerms: [],
        mustExcludeTerms: [],
        confidence: "medium",
      },
    });
    expect(deepByTerm).toMatchObject({ mode: "deep_rag", sourceLimit: 5 });
    expect(deepByTerm.reasons).toContain("deep-query term matched: kapsamli");

    vi.unstubAllEnvs();
  });
});
