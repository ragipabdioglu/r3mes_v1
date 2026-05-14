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
      expect(understanding.quality.clarityScore).toBeGreaterThanOrEqual(55);
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

  it("routes platform help turns away from RAG", () => {
    const understanding = buildQueryUnderstanding("PDF nasıl yüklerim?");

    expect(understanding.mode).toBe("conversation");
    expect(understanding.retrievalIntent).toBe("conversation");
    expect(understanding.conversationalIntent?.kind).toBe("usage_help");
  });

  it("keeps weak domain router output as query signals, not a hard decision", () => {
    const understanding = buildQueryUnderstanding("Bu belgeyi kontrol eder misin?");

    expect(understanding.signals.routeHints.authority).toBe("weak");
    expect(understanding.mode).toBe("knowledge");
    expect(understanding.warnings).toContain("weak_query_understanding");
    expect(understanding.quality.weakSignalCount).toBeLessThanOrEqual(1);
  });

  it("marks short knowledge turns as low-shape signals without hard routing them", () => {
    const understanding = buildQueryUnderstanding("LDL");

    expect(understanding.mode).toBe("knowledge");
    expect(understanding.quality.shape).toBe("short");
    expect(understanding.warnings).toContain("short_knowledge_query");
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

  it("matches profile concepts through generic typo-tolerant overlap", () => {
    const understanding = buildQueryUnderstanding("karbon ayak izim icin bilgilendirere raporuna bak", {
      profiles: [
        {
          answerableConcepts: ["karbon ayak izi bilgilendirme raporu"],
          topicPhrases: ["sürdürülebilirlik bilgilendirme dokümanı"],
        },
      ],
    });

    expect(understanding.mode).toBe("knowledge");
    expect(understanding.profileConcepts).toEqual(
      expect.arrayContaining(["karbon ayak izi bilgilendirme raporu"]),
    );
    expect(understanding.normalized.expandedTokens).toEqual(
      expect.arrayContaining(["karbon ayak izi bilgilendirme raporu"]),
    );
  });

  it("uses profile concepts for non-medical typo-tolerant matching", () => {
    const understanding = buildQueryUnderstanding("sozlesmede ceazi sart ve odme gecikmesi ne olur", {
      profiles: [
        {
          answerableConcepts: ["sözleşmede cezai şart", "ödeme gecikmesi"],
          topicPhrases: ["sözleşme feshi kontrol listesi"],
          sampleQueries: ["Sözleşmede cezai şart ve ödeme gecikmesi nasıl değerlendirilir?"],
        },
      ],
    });

    expect(understanding.mode).toBe("knowledge");
    expect(understanding.profileConcepts).toEqual(
      expect.arrayContaining(["sozlesmede cezai sart", "odeme gecikmesi"]),
    );
    expect(understanding.warnings).toContain("profile_concept_expansion_used");
    expect(understanding.quality.clarityScore).toBeGreaterThanOrEqual(55);
  });

  it("detects requested finance table fields and output constraints", () => {
    const understanding = buildQueryUnderstanding(
      "EREGL kar payında dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler nedir? Sadece rakamları kısa maddelerle yaz, risk yorumu ekleme.",
    );

    expect(understanding.mode).toBe("knowledge");
    expect(understanding.requestedFieldDetection.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["diger_kaynaklar", "olaganustu_yedekler"]),
    );
    expect(understanding.requestedFieldDetection.constraints.forbidCaution).toBe(true);
    expect(understanding.requestedFieldDetection.constraints.noRawTableDump).toBe(true);
    expect(understanding.requestedFieldDetection.constraints.format).toBe("bullets");
  });
});
