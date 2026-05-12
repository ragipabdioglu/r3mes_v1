import { describe, expect, it } from "vitest";

import { buildQueryUnderstanding } from "./queryUnderstanding.js";

describe("queryUnderstanding", () => {
  it("groups Turkish pelvic pain variants into the same concept family", () => {
    const examples = [
      "kasığım ağrıyor",
      "kasıklarım ağrıyor",
      "kasiklarim agriyo",
      "kasığm ağrıyo",
    ];

    for (const query of examples) {
      const understanding = buildQueryUnderstanding(query);

      expect(understanding.mode).toBe("knowledge");
      expect(understanding.concepts).toContain("concept:pelvic_pain");
      expect(understanding.normalized.expandedTokens).toEqual(
        expect.arrayContaining(["kasik agrisi", "pelvik agri"]),
      );
    }
  });

  it("routes short social turns away from RAG", () => {
    const understanding = buildQueryUnderstanding("merhaba");

    expect(understanding.mode).toBe("conversation");
    expect(understanding.retrievalIntent).toBe("conversation");
    expect(understanding.conversationalIntent?.kind).toBe("greeting");
    expect(understanding.confidence).toBe("high");
  });

  it("keeps weak domain router output as query signals, not a hard decision", () => {
    const understanding = buildQueryUnderstanding("Bu belgeyi kontrol eder misin?");

    expect(understanding.signals.routeHints.authority).toBe("weak");
    expect(understanding.mode).toBe("knowledge");
    expect(understanding.warnings).toContain("weak_query_understanding");
  });

  it("expands query concepts from collection profiles without a router keyword rule", () => {
    const understanding = buildQueryUnderstanding("karbon ayak izim için neye bakmalıyım?", {
      profiles: [
        {
          answerableConcepts: ["karbon ayak izi azaltım planı"],
          topicPhrases: ["sürdürülebilirlik raporu"],
          sampleQueries: ["Karbon ayak izi hedefleri nasıl izlenir?"],
        },
      ],
    });

    expect(understanding.mode).toBe("knowledge");
    expect(understanding.retrievalIntent).toBe("knowledge_lookup");
    expect(understanding.profileConcepts).toEqual(expect.arrayContaining(["karbon ayak izi azaltim plani"]));
    expect(understanding.normalized.expandedTokens).toEqual(expect.arrayContaining(["karbon ayak izi azaltim plani"]));
    expect(understanding.warnings).toContain("profile_concept_expansion_used");
  });
});
