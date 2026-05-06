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

  it("allows source limits to be tuned from env", () => {
    vi.stubEnv("R3MES_RAG_FAST_SOURCE_LIMIT", "1");
    vi.stubEnv("R3MES_RAG_DEEP_SOURCE_LIMIT", "5");

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

    vi.unstubAllEnvs();
  });
});
