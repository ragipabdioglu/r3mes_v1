import { describe, expect, it } from "vitest";

import { buildExpandedQueryText, buildExpandedQueryTokens, normalizeTurkishQuery } from "./turkishQueryNormalizer.js";

describe("turkishQueryNormalizer", () => {
  it("keeps original Turkish query while adding folded and canonical retrieval terms", () => {
    const expanded = buildExpandedQueryText("Kasığım ağrıyor, kısa ve sakin ne yapmalıyım?");

    expect(expanded).toContain("Kasığım ağrıyor");
    expect(expanded).toContain("kasigim");
    expect(expanded).toContain("kasik agrisi");
    expect(expanded).toContain("pelvik agri");
  });

  it("normalizes plural/possessive and colloquial verb variants through concept expansion", () => {
    const tokens = buildExpandedQueryTokens("kasiklarim agriyo", null, 32);

    expect(tokens).toContain("kasik agrisi");
    expect(tokens).toContain("pelvik agri");
    expect(tokens).toContain("agriyor");
  });

  it("adds route hints as weak retrieval expansions without replacing the user query", () => {
    const normalized = normalizeTurkishQuery("Belgeyi nasıl kontrol etmeliyim?", {
      domain: "legal",
      subtopics: ["anlasmali_bosanma"],
      riskLevel: "medium",
      retrievalHints: ["nafaka velayet protokol"],
      mustIncludeTerms: ["bosanma", "nafaka", "velayet"],
      mustExcludeTerms: [],
      confidence: "high",
    });

    expect(normalized.expandedTokens).toContain("bosanma");
    expect(normalized.expandedTokens).toContain("nafaka");
    expect(normalized.expandedTokens).toContain("velayet");
    expect(normalized.variants[0]).toContain("Belgeyi nasıl kontrol");
  });
});
