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
    expect(result.blockedReasons).toEqual([]);
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
});
