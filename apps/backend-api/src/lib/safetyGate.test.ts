import { describe, expect, it } from "vitest";

import { EMPTY_GROUNDED_MEDICAL_ANSWER } from "./answerSchema.js";
import { evaluateSafetyGate } from "./safetyGate.js";

const source = {
  collectionId: "kc_1",
  documentId: "doc_1",
  title: "clinical-card",
  chunkIndex: 0,
};

describe("deterministic safety gate", () => {
  it("passes grounded, cautious answers", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Genel değerlendirme: Karın ağrısı tek başına kesin tanı göstermez.\n2. Ne yapmalı: Ağrı sürerse muayene planlanmalıdır.\n3. Ne zaman doktora başvurmalı: Şiddetli ağrı, ateş veya kusma varsa gecikmeden başvurun.\n4. Kısa özet: Alarm bulgusu varsa değerlendirme gerekir.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "medical",
        user_query: "karnım ağrıyor",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(true);
    expect(result.severity).toBe("pass");
    expect(result.blockedReasons).toEqual([]);
    expect(result.railChecks).toEqual([]);
    expect(result.metrics.sourceCount).toBe(1);
    expect(result.metrics.answerLength).toBeGreaterThan(40);
  });

  it("blocks risky certainty and returns a safe fallback", () => {
    const result = evaluateSafetyGate({
      answerText: "Bu kesin kanserdir, hemen tedaviye başla.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "medical",
        user_query: "kasık ağrım var",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.severity).toBe("rewrite");
    expect(result.fallbackMode).toBe("domain_safe");
    expect(result.blockedReasons).toContain("RISKY_CERTAINTY_OR_TREATMENT");
    expect(result.safeFallback).toContain("Kesin tanı veya tedavi önermek doğru olmaz");
  });

  it("blocks red-flag queries when the answer lacks urgent guidance", () => {
    const result = evaluateSafetyGate({
      answerText: "Biraz dinlenin ve su için.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "medical",
        user_query: "şiddetli karın ağrısı ve ateşim var",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("RED_FLAG_WITHOUT_URGENT_GUIDANCE");
  });

  it("blocks malformed multilingual output before it reaches the user", () => {
    const result = evaluateSafetyGate({
      answerText: "Bebeğin fiziksel运动（这可能是翻译错误） nedeniyle terliyor olabilir.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "medical",
        user_query: "bebeğim çok terliyor neden olabilir",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("LOW_LANGUAGE_QUALITY");
    expect(result.safeFallback).toContain("Kesin tanı veya tedavi önermek doğru olmaz");
  });

  it("blocks overconfident answers when grounding is low", () => {
    const result = evaluateSafetyGate({
      answerText: "Net olarak bu durum normaldir, hiç gerek yok doktora gitmeye.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        grounding_confidence: "low",
        user_query: "bu belirti riskli mi",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("LOW_GROUNDING_OVERCONFIDENCE");
  });

  it("does not block cautious low-grounding uncertainty", () => {
    const result = evaluateSafetyGate({
      answerText:
        "Bu kaynaklarla net olarak söylenemez. Yakınma sürerse uygun değerlendirme planlanmalıdır.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        grounding_confidence: "low",
        user_query: "bu belirti riskli mi",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.blockedReasons).not.toContain("LOW_GROUNDING_OVERCONFIDENCE");
  });

  it("blocks source id mismatch when an answer claims an unavailable source", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Genel değerlendirme: Kaynağa göre temkinli ilerlemek gerekir.\n2. Ne yapmalı: Değerlendirme planlanmalıdır.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        user_query: "kasık ağrım var",
        used_source_ids: ["unknown-doc"],
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("SOURCE_METADATA_MISMATCH");
  });

  it("tracks evidence metrics from AnswerSpec and evidence inputs", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Kaynağa göre durum: Kaynak, kontrollü takip öneriyor.\n2. Ne yapmalı: Belirti sürerse uzmanla görüşülmelidir.\n3. Dikkat: Alarm bulgusu varsa gecikmeden başvurulmalıdır.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        grounding_confidence: "medium",
        user_query: "belirti sürerse ne yapmalıyım",
      },
      answerSpec: {
        answerDomain: "medical",
        answerIntent: "triage",
        groundingConfidence: "medium",
        userQuery: "belirti sürerse ne yapmalıyım",
        tone: "direct",
        sections: ["caution", "assessment", "action", "summary"],
        assessment: "Kaynak, kontrollü takip öneriyor.",
        action: "Belirti sürerse uzmanla görüşülmelidir.",
        caution: ["Alarm bulgusu varsa gecikmeden başvurulmalıdır."],
        summary: "Kontrollü takip gerekir.",
        unknowns: [],
        sourceIds: ["doc_1"],
        facts: ["Kaynak, kontrollü takip öneriyor."],
      },
      sources: [source],
      retrievalWasUsed: true,
      evidence: {
        answerIntent: "triage",
        directAnswerFacts: ["doc_1: Kaynak, kontrollü takip öneriyor."],
        supportingContext: [],
        riskFacts: ["doc_1: Alarm bulgusu varsa gecikmeden başvurulmalıdır."],
        notSupported: [],
        usableFacts: ["doc_1: Kaynak, kontrollü takip öneriyor."],
        uncertainOrUnusable: [],
        redFlags: ["doc_1: Alarm bulgusu varsa gecikmeden başvurulmalıdır."],
        sourceIds: ["doc_1"],
        missingInfo: [],
      },
    });

    expect(result.pass).toBe(true);
    expect(result.metrics.usableFactCount).toBe(1);
    expect(result.metrics.redFlagCount).toBe(1);
  });

  it("blocks sources outside accessible collection scope", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Genel değerlendirme: Kaynağa göre temkinli ilerlemek gerekir.\n2. Ne yapmalı: Değerlendirme planlanmalıdır.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "medical",
        user_query: "kasık ağrım var",
      },
      sources: [{ ...source, collectionId: "private-other" }],
      retrievalWasUsed: true,
      sourceSelection: {
        accessibleCollectionIds: ["allowed-collection"],
        usedCollectionIds: ["private-other"],
      },
    });

    expect(result.pass).toBe(false);
    expect(result.severity).toBe("block");
    expect(result.fallbackMode).toBe("privacy_safe");
    expect(result.blockedReasons).toContain("PRIVATE_SOURCE_SCOPE_MISMATCH");
    expect(result.railChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "PRIVATE_SOURCE_SCOPE_MISMATCH", category: "privacy", status: "block" }),
      ]),
    );
  });

  it("keeps source suggestion responses as warnings instead of unsafe failures", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Kaynağa göre durum: Bu soru için yeterli güvenilir kaynak bulunamadı.\n2. Ne yapılabilir: Doğru collection seçilirse kaynaklı cevap verilebilir.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "technical",
        grounding_confidence: "low",
        user_query: "Production migration öncesi ne yapmalıyım?",
      },
      sources: [],
      retrievalWasUsed: false,
      sourceSelection: {
        routeDecision: {
          mode: "suggest",
          confidence: "medium",
          suggestedCollectionIds: ["technical-demo"],
          rejectedCollectionIds: ["legal-demo"],
        },
      },
    });

    expect(result.pass).toBe(true);
    expect(result.severity).toBe("warn");
    expect(result.warnings).toContain("SUGGEST_MODE_NO_GROUNDED_SOURCES");
    expect(result.fallbackMode).toBe("source_suggestion");
  });

  it("blocks no-source route contradictions when sources are still attached", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Kaynağa göre durum: Kaynak kullanıldı gibi görünüyor.\n2. Ne yapılabilir: Yine de cevap verildi.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        user_query: "kaynak var mı",
      },
      sources: [source],
      retrievalWasUsed: true,
      sourceSelection: {
        routeDecision: { mode: "no_source", confidence: "low" },
      },
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("NO_SOURCE_MODE_WITH_SOURCES");
  });

  it("warns when too many context chunks survive pruning for Qwen 3B", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Kaynağa göre durum: Kaynaklı cevap var.\n2. Ne yapılabilir: Kısa ve kontrollü ilerlenmelidir.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        user_query: "özetler misin",
      },
      sources: [source],
      retrievalWasUsed: true,
      retrievalDiagnostics: { finalCandidateCount: 8 },
    });

    expect(result.pass).toBe(true);
    expect(result.severity).toBe("warn");
    expect(result.warnings).toContain("TOO_MANY_CONTEXT_CHUNKS_FOR_3B");
    expect(result.metrics.finalCandidateCount).toBe(8);
  });

  it("rewrites when alignment fast-fails all retrieved candidates", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Kaynağa göre durum: Bu seçili kaynaklarda doğrudan yanıt yok.\n2. Ne yapılabilir: Daha uygun kaynak seçilmelidir.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        grounding_confidence: "low",
        user_query: "başım ağrıyor",
      },
      sources: [],
      retrievalWasUsed: false,
      retrievalDiagnostics: {
        finalCandidateCount: 0,
        alignment: {
          fastFailed: true,
          droppedCandidateCount: 3,
        },
      },
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("QUERY_SOURCE_MISMATCH");
    expect(result.railChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "QUERY_SOURCE_MISMATCH", category: "retrieval", status: "rewrite" }),
      ]),
    );
  });

  it("uses evidence red flags as safety rails even when the query wording is mild", () => {
    const result = evaluateSafetyGate({
      answerText: "Kaynak, durumun izlenebileceğini söylüyor.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "medical",
        user_query: "bu durumda ne yapmalıyım",
      },
      sources: [source],
      retrievalWasUsed: true,
      evidence: {
        answerIntent: "triage",
        intentResolution: {
          intent: "triage",
          primarySignal: "triage",
          confidence: "high",
          scores: { triage: 100 },
          weakIntent: "triage",
          reasons: ["test red flag"],
        },
        directAnswerFacts: ["doc_1: Kaynak, durumun izlenebileceğini söylüyor."],
        supportingContext: [],
        riskFacts: ["doc_1: Şiddetli ağrı varsa gecikmeden değerlendirme gerekir."],
        notSupported: [],
        usableFacts: ["doc_1: Kaynak, durumun izlenebileceğini söylüyor."],
        uncertainOrUnusable: [],
        redFlags: ["doc_1: Şiddetli ağrı varsa gecikmeden değerlendirme gerekir."],
        sourceIds: ["doc_1"],
        missingInfo: [],
      },
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("RED_FLAG_WITHOUT_URGENT_GUIDANCE");
    expect(result.railChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "RED_FLAG_WITHOUT_URGENT_GUIDANCE", category: "evidence" }),
      ]),
    );
  });

  it("renders safety fallbacks through AnswerSpec instead of reusing unsafe model text", () => {
    const result = evaluateSafetyGate({
      answerText: "Bu kesin apandisittir, antibiyotik kullan.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "medical",
        answer_intent: "triage",
        user_query: "şiddetli karın ağrım var",
      },
      answerSpec: {
        answerDomain: "medical",
        answerIntent: "triage",
        groundingConfidence: "medium",
        userQuery: "şiddetli karın ağrım var",
        tone: "direct",
        sections: ["caution", "assessment", "action", "summary"],
        assessment: "Kaynak ağrının şiddeti ve eşlik eden belirtilerin değerlendirilmesi gerektiğini söylüyor.",
        action: "Yakınma sürerse sağlık profesyoneliyle görüşülmelidir.",
        caution: ["Şiddetli ağrı ve ateş varsa gecikmeden başvurulmalıdır."],
        summary: "Alarm bulguları varsa değerlendirme gerekir.",
        unknowns: [],
        sourceIds: ["doc_1"],
        facts: ["Ağrının şiddeti ve eşlik eden belirtiler önemlidir."],
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.safeFallback).toContain("Bu kaynaklarla net ve kesin bir cevap vermek doğru olmaz");
    expect(result.safeFallback).toContain("Ne zaman doktora başvurmalı:");
    expect(result.safeFallback).toContain("Kesin tanı veya tedavi önermek doğru olmaz");
    expect(result.safeFallback).not.toContain("apandisittir");
    expect(result.safeFallback).not.toContain("antibiyotik kullan");
  });

  it("uses privacy-safe AnswerSpec fallback without exposing blocked source ids", () => {
    const result = evaluateSafetyGate({
      answerText:
        "1. Genel değerlendirme: Gizli kaynağa göre cevap verildi.\n2. Ne yapmalı: İşlem yapılabilir.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "legal",
        answer_intent: "steps",
        user_query: "özel dosyamdaki sözleşmeye göre ne yapmalıyım",
        used_source_ids: ["private-doc-9"],
      },
      answerSpec: {
        answerDomain: "legal",
        answerIntent: "steps",
        groundingConfidence: "medium",
        userQuery: "özel dosyamdaki sözleşmeye göre ne yapmalıyım",
        tone: "direct",
        sections: ["action", "assessment", "caution", "summary"],
        assessment: "Özel sözleşme kaynağı kullanıldı.",
        action: "Belgeye göre işlem yapılabilir.",
        caution: ["Hak kaybı riski olabilir."],
        summary: "Belgeye göre ilerlenebilir.",
        unknowns: [],
        sourceIds: ["private-doc-9"],
        facts: ["Özel kaynak faktı."],
      },
      sources: [{ ...source, collectionId: "private-other", documentId: "private-doc-9" }],
      retrievalWasUsed: true,
      sourceSelection: {
        accessibleCollectionIds: ["allowed-collection"],
        usedCollectionIds: ["private-other"],
      },
    });

    expect(result.severity).toBe("block");
    expect(result.safeFallback).toContain("erişim sınırlarıyla uyuşmadığı");
    expect(result.safeFallback).toContain("Kesin hukuki görüş");
    expect(result.safeFallback).not.toContain("private-doc-9");
    expect(result.safeFallback).not.toContain("Özel kaynak faktı");
  });

  it("uses legal safety policy for guaranteed legal outcomes", () => {
    const result = evaluateSafetyGate({
      answerText: "Davayı kesin kazanırsınız, avukata gerek yok.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "legal",
        user_query: "Bu davayı kazanır mıyım?",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("RISKY_CERTAINTY_OR_TREATMENT");
    expect(result.safeFallback).toContain("Kesin hukuki görüş");
  });

  it("uses technical safety policy for unsafe production operations", () => {
    const result = evaluateSafetyGate({
      answerText: "Productionda doğrudan drop çalıştır, rollbacke gerek yok.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
        answer_domain: "technical",
        user_query: "Production migration nasıl yapayım?",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(false);
    expect(result.blockedReasons).toContain("RISKY_CERTAINTY_OR_TREATMENT");
    expect(result.safeFallback).toContain("riskli komut");
  });
});
