import { describe, expect, it } from "vitest";

import {
  buildDeterministicEvidenceExtraction,
  buildDeterministicQueryPlan,
  runEvidenceExtractorSkill,
  runQueryPlannerSkill,
} from "./skillPipeline.js";

describe("skill pipeline query planner", () => {
  it("expands short abdominal pain queries into retrieval-ready symptom searches", () => {
    const plan = buildDeterministicQueryPlan({ userQuery: "karnım ağrıyor", language: "tr" });

    expect(plan.expectedEvidenceType).toBe("symptom_card");
    expect(plan.routePlan.domain).toBe("medical");
    expect(plan.routePlan.subtopics).toEqual(expect.arrayContaining(["kasik_agrisi"]));
    expect(plan.searchQueries).toContain("karın ağrısı genel triyaj");
    expect(plan.searchQueries).toContain("karın ağrısı ateş kusma kanama acil belirtiler");
    expect(plan.mustIncludeTerms).toEqual(
      expect.arrayContaining(["karın", "ağrı", "ateş", "kusma", "kanama"]),
    );
    expect(plan.retrievalQuery).toContain("karnım ağrıyor");
    expect(plan.retrievalQuery).toContain("karın ağrısı genel triyaj");
  });

  it("keeps LoRA skill execution behind a stable envelope", async () => {
    const run = await runQueryPlannerSkill({ userQuery: "akıntım var", language: "tr" });

    expect(run.skill).toBe("query-planner");
    expect(run.runtime).toBe("deterministic");
    expect(run.output.routePlan.domain).toBe("medical");
    expect(run.output.routePlan.subtopics).toContain("akinti");
    expect(run.output.expectedEvidenceType).toBe("symptom_card");
    expect(run.output.searchQueries).toContain("vajinal akıntı triyaj");
  });
});

describe("skill pipeline evidence extractor", () => {
  it("infers action intent from preparation questions before generic risk wording", () => {
    expect(
      buildDeterministicEvidenceExtraction({
        userQuery: "Production migration öncesi ne yapmalıyım? Riskleri abartmadan açıkla.",
        cards: [],
      }).answerIntent,
    ).toBe("steps");

    expect(
      buildDeterministicEvidenceExtraction({
        userQuery: "Boşanma davası için hangi belgeleri hazırlamalıyım?",
        cards: [],
      }).answerIntent,
    ).toBe("steps");
  });

  it("turns retrieved cards into compact usable evidence and limits unsafe inference", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Smear temiz ama kasık ağrım var",
      cards: [
        {
          sourceId: "doc-1",
          title: "smear-kasik-karti",
          clinicalTakeaway:
            "Temiz smear iyi bir bulgudur, ancak kasık ağrısını tek başına açıklamaz.",
          safeGuidance:
            "Ağrı sürüyor veya artıyorsa kadın hastalıkları değerlendirmesi uygundur.",
          redFlags: "Şiddetli ağrı, ateş veya anormal kanama varsa daha hızlı değerlendirme gerekir.",
          doNotInfer: "Soruda açık dayanak yoksa CA-125 veya ileri tetkik gerekliliği çıkarma.",
        },
      ],
    });

    expect(extraction.usableFacts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Temiz smear iyi bir bulgudur"),
      ]),
    );
    expect(extraction.supportingContext).toEqual(
      expect.arrayContaining([expect.stringContaining("Ağrı sürüyor veya artıyorsa")]),
    );
    expect(extraction.redFlags).toEqual(expect.arrayContaining([expect.stringContaining("Şiddetli ağrı")]));
    expect(extraction.uncertainOrUnusable).toEqual(
      expect.arrayContaining([expect.stringContaining("CA-125")]),
    );
    expect(extraction.sourceIds).toContain("doc-1");
  });

  it("keeps evidence extraction behind the same stable skill envelope", async () => {
    const run = await runEvidenceExtractorSkill({
      userQuery: "karın ağrısı var",
      cards: [{ sourceId: "doc-2", title: "karin-karti", safeGuidance: "Karın ağrısının şiddeti izlenmelidir." }],
    });

    expect(run.skill).toBe("evidence-extractor");
    expect(run.runtime).toBe("deterministic");
    expect(run.output.usableFacts).toContain("karin-karti: Karın ağrısının şiddeti izlenmelidir.");
  });

  it("does not promote weak generic guidance without enough query overlap", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Bebeğim çok terliyor neden olabilir?",
      cards: [
        {
          sourceId: "doc-generic",
          title: "generic",
          clinicalTakeaway: "Genel değerlendirme gerekebilir.",
          safeGuidance: "Belirtiler devam ederse uygun uzmana başvurulmalıdır.",
          doNotInfer: "Kaynakta açık dayanak yoksa neden uydurma.",
        },
      ],
    });

    expect(extraction.usableFacts).toEqual([]);
    expect(extraction.missingInfo).toEqual(
      expect.arrayContaining(["Soruya doğrudan dayanak sağlayan yeterli kaynak cümlesi bulunamadı."]),
    );
  });

  it("extracts actionable education guidance with inflected query terms", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Özel eğitim desteği için okulda ilk hangi adımları konuşmalıyım?",
      cards: [
        {
          sourceId: "education-special-ram-bep",
          title: "education-special-ram-bep",
          clinicalTakeaway:
            "BEP planı öğrencinin ihtiyacına göre hazırlanır; veli, okul ve rehberlik birimi düzenli değerlendirme ve güncelleme yapmalıdır.",
          safeGuidance:
            "Veli rapor, okul görüşmesi, gözlem notu ve BEP hedeflerini saklamalı; belirsizlikte rehberlik servisi veya RAM ile görüşmelidir.",
          redFlags:
            "Çocuğun güvenliği, eğitimden kopma, raporun yanlış uygulanması veya ciddi uyum sorunu varsa hızlı okul/RAM değerlendirmesi gerekir.",
        },
      ],
    });

    expect(extraction.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("rehberlik")]));
    expect(extraction.missingInfo).toEqual([]);
  });
});
