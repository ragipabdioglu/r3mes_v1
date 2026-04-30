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
        user_query: "karnım ağrıyor",
      },
      sources: [source],
      retrievalWasUsed: true,
    });

    expect(result.pass).toBe(true);
    expect(result.severity).toBe("pass");
    expect(result.blockedReasons).toEqual([]);
    expect(result.metrics.sourceCount).toBe(1);
    expect(result.metrics.answerLength).toBeGreaterThan(40);
  });

  it("blocks risky certainty and returns a safe fallback", () => {
    const result = evaluateSafetyGate({
      answerText: "Bu kesin kanserdir, hemen tedaviye başla.",
      answer: {
        ...EMPTY_GROUNDED_MEDICAL_ANSWER,
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
    expect(result.fallbackMode).toBe("privacy_safe");
    expect(result.blockedReasons).toContain("PRIVATE_SOURCE_SCOPE_MISMATCH");
  });
});
