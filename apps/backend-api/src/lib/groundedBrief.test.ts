import { describe, expect, it } from "vitest";

import { buildEvidenceGroundedBrief, buildGroundedBrief } from "./groundedBrief.js";
import type { KnowledgeCard } from "./knowledgeCard.js";

function card(overrides: Partial<KnowledgeCard>): KnowledgeCard {
  return {
    topic: overrides.topic ?? "bebek terlemesi",
    tags: overrides.tags ?? ["medical", "pediatri_terleme"],
    patientSummary: overrides.patientSummary ?? "",
    clinicalTakeaway:
      overrides.clinicalTakeaway ??
      "Bebeklerde terleme ateş, oda sıcaklığı ve beslenme durumu ile birlikte değerlendirilmelidir.",
    safeGuidance:
      overrides.safeGuidance ??
      "Ateş, beslenememe veya nefes alma zorluğu varsa çocuk doktoru değerlendirmesi gerekir.",
    redFlags: overrides.redFlags ?? "Yüksek ateş, morarma veya nefes alma zorluğu acil değerlendirme gerektirir.",
    doNotInfer: overrides.doNotInfer ?? "Kaynakta açık dayanak yoksa kesin neden veya tanı söyleme.",
  };
}

describe("buildGroundedBrief", () => {
  it("keeps compact facts, intent and source references in the context brief", () => {
    const brief = buildGroundedBrief([card({})], {
      groundingConfidence: "high",
      answerIntent: "explain",
      sourceRefs: [{ id: "doc-1", title: "bebek-terleme" }],
    });

    expect(brief).toContain("CEVAP NIYETI: explain");
    expect(brief).toContain("KULLANILABILIR GERCEKLER:");
    expect(brief).toContain("Bebeklerde terleme ateş");
    expect(brief).toContain("KAYNAK KIMLIKLARI:");
    expect(brief).toContain("doc-1: bebek-terleme");
  });

  it("builds an evidence-first brief without re-expanding raw card text", () => {
    const brief = buildEvidenceGroundedBrief(
      {
        answerIntent: "steps",
        directAnswerFacts: ["source-a: Migration öncesi yedek alınmalıdır."],
        supportingContext: ["source-a: Staging ortamında denenmelidir."],
        riskFacts: ["source-a: Yedeksiz işlem risklidir."],
        notSupported: ["source-a: Kaynakta kesin süre yok."],
        usableFacts: [
          "source-a: Migration öncesi yedek alınmalıdır.",
          "source-a: Staging ortamında denenmelidir.",
        ],
        uncertainOrUnusable: ["source-a: Kaynakta kesin süre yok."],
        redFlags: ["source-a: Yedeksiz işlem risklidir."],
        sourceIds: ["source-a"],
        missingInfo: [],
      },
      {
        groundingConfidence: "high",
        sourceRefs: [{ id: "source-a", title: "migration-card" }],
      },
    );

    expect(brief).toContain("CEVAP NIYETI: steps");
    expect(brief).toContain("KULLANILABILIR GERCEKLER:");
    expect(brief).toContain("DESTEKLEYICI BAGLAM:");
    expect(brief).toContain("BELIRSIZ / KULLANILAMAYAN:");
    expect(brief).toContain("RED FLAGS:");
    expect(brief).toContain("source-a: migration-card");
  });
});
