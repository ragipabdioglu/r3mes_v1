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

  it("detects requested table fields and output constraints without core aliases", () => {
    const understanding = buildQueryUnderstanding(
      "EREGL kar payında dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler nedir? Sadece rakamları kısa maddelerle yaz, risk yorumu ekleme.",
    );

    expect(understanding.mode).toBe("knowledge");
    expect(understanding.requestedFieldDetection.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["dagitilmasi_ongorulen_diger_kaynaklar", "olaganustu_yedekler"]),
    );
    expect(understanding.requestedFieldDetection.constraints.forbidCaution).toBe(true);
    expect(understanding.requestedFieldDetection.constraints.noRawTableDump).toBe(true);
    expect(understanding.requestedFieldDetection.constraints.format).toBe("bullets");
    expect(understanding.queryContract).toMatchObject({
      operation: "extract_fields",
      requiredEvidenceType: "structured_fields",
      outputFormat: "bullets",
      outputConstraints: {
        maxWords: 80,
        forbidCaution: true,
        noRawTableDump: true,
        format: "bullets",
        sourceGroundedOnly: false,
      },
      sourceOnly: false,
      forbiddenAdditions: expect.arrayContaining(["optional_caution", "risk_commentary", "raw_table_dump"]),
      queryQuality: {
        shape: understanding.quality.shape,
        clarityScore: understanding.quality.clarityScore,
        tokenCount: understanding.quality.tokenCount,
      },
    });
    expect(understanding.queryContract.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["dagitilmasi_ongorulen_diger_kaynaklar", "olaganustu_yedekler"]),
    );
    expect(understanding.queryContract.requestedFields[0]).not.toHaveProperty("aliases");
  });

  it("detects generic answer tasks for newly uploaded education or technical documents", () => {
    const list = buildQueryUnderstanding("Büyük verinin 5V özelliğini sadece madde madde yaz.");
    expect(list.answerTask.taskType).toBe("list_items");
    expect(list.answerTask.outputConstraints.format).toBe("bullets");
    expect(list.queryContract).toMatchObject({
      operation: "list",
      requiredEvidenceType: "source",
      outputFormat: "bullets",
      outputConstraints: {
        maxSentencesPerBullet: undefined,
        forbidCaution: true,
        noRawTableDump: true,
        format: "bullets",
        sourceGroundedOnly: false,
      },
      sourceOnly: false,
      requestedFields: [],
    });

    const compare = buildQueryUnderstanding("Web1, Web2 ve Web3 arasındaki temel fark nedir? Kaynağa göre açıkla.");
    expect(compare.answerTask.taskType).toBe("compare_concepts");
    expect(compare.answerTask.outputConstraints.sourceGroundedOnly).toBe(true);
    expect(compare.queryContract).toMatchObject({
      operation: "compare",
      requiredEvidenceType: "source",
      outputFormat: "freeform",
      outputConstraints: {
        forbidCaution: false,
        noRawTableDump: false,
        format: "freeform",
        sourceGroundedOnly: true,
      },
      sourceOnly: true,
      forbiddenAdditions: expect.arrayContaining(["source_external_inference"]),
    });

    const code = buildQueryUnderstanding("submitHandler içinde ne yapılıyor? Kaynağa göre açıkla.");
    expect(code.answerTask.taskType).toBe("code_explanation");
    expect(code.queryContract).toMatchObject({
      operation: "code_explanation",
      requiredEvidenceType: "source",
      outputFormat: "freeform",
      outputConstraints: {
        forbidCaution: false,
        noRawTableDump: false,
        format: "freeform",
        sourceGroundedOnly: true,
      },
      sourceOnly: true,
      requestedFields: [],
    });

    const categoryList = buildQueryUnderstanding("Varsayılan seçenek çeşitlerini madde madde yaz.");
    expect(categoryList.answerTask.taskType).toBe("list_items");
    expect(categoryList.queryContract).toMatchObject({
      operation: "list",
      outputFormat: "bullets",
    });

    const timing = buildQueryUnderstanding("Bir olay ne zaman çalışır?");
    expect(timing.answerTask.taskType).toBe("source_grounded_explain");
    expect(timing.queryContract).toMatchObject({
      operation: "explain_with_sources",
      outputFormat: "short",
    });
  });

  it("keeps conversation turns backward-compatible while emitting a no-evidence contract", () => {
    const understanding = buildQueryUnderstanding("merhaba");

    expect(understanding.mode).toBe("conversation");
    expect(understanding.queryContract).toMatchObject({
      operation: "conversation",
      requiredEvidenceType: "none",
      outputFormat: "freeform",
      outputConstraints: {
        forbidCaution: false,
        noRawTableDump: false,
        format: "freeform",
        sourceGroundedOnly: false,
      },
      sourceOnly: false,
      requestedFields: [],
    });
  });
});
