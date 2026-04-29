import { describe, expect, it } from "vitest";
import { rerankKnowledgeCards } from "./rerank.js";

describe("rerankKnowledgeCards", () => {
  it("prefers cards that match smear and kasik agri over unrelated kist/kanama cards", () => {
    const candidates = [
      {
        fusedScore: 1.2,
        lexicalScore: 1,
        embeddingScore: 0.2,
        chunk: { id: "bad-1" },
        card: {
          topic: "anormal kanama",
          tags: ["kanama"],
          patientSummary: "Adet sonrası kanama yakınması var.",
          clinicalTakeaway: "Anormal kanama değerlendirilmelidir.",
          safeGuidance: "Muayene gerekir.",
          redFlags: "Aşırı kanama olursa acil değerlendirme gerekir.",
          doNotInfer: "",
        },
      },
      {
        fusedScore: 1.15,
        lexicalScore: 0.95,
        embeddingScore: 0.2,
        chunk: { id: "bad-2" },
        card: {
          topic: "yumurtalık kisti",
          tags: ["kist"],
          patientSummary: "Yumurtalık kisti saptanmış.",
          clinicalTakeaway: "Kist için takip önerilmiş.",
          safeGuidance: "Kontrol gerekir.",
          redFlags: "Şiddetli ağrı olursa acil değerlendirme gerekir.",
          doNotInfer: "",
        },
      },
      {
        fusedScore: 1.0,
        lexicalScore: 0.8,
        embeddingScore: 0.2,
        chunk: { id: "good" },
        card: {
          topic: "smear sonucu ve servikal tarama",
          tags: ["smear", "kasik", "agri"],
          patientSummary: "Smear sonucu temiz, ara ara kasık ağrısı tarifleniyor.",
          clinicalTakeaway: "Temiz smear iyi bir bulgudur ancak kasık ağrısını tek başına açıklamaz.",
          safeGuidance: "Ağrı sürerse kadın hastalıkları değerlendirmesi uygundur.",
          redFlags: "Şiddetli ağrı veya ateş varsa daha hızlı değerlendirme gerekir.",
          doNotInfer: "CA-125 gibi ileri test gerekliliği çıkarma.",
        },
      },
    ];

    const ranked = rerankKnowledgeCards(
      "Smear sonucum temiz çıktı ama ara ara kasık ağrım oluyor.",
      candidates,
      3,
    );

    expect(ranked[0]?.chunk.id).toBe("good");
    expect(ranked[0]?.rerankScore).toBeGreaterThan(ranked[1]?.rerankScore ?? -Infinity);
  });

  it("keeps complementary cards for multi-intent questions", () => {
    const candidates = [
      {
        fusedScore: 1.4,
        lexicalScore: 1,
        embeddingScore: 0.4,
        chunk: { id: "smear-only" },
        card: {
          topic: "smear sonucu",
          tags: ["smear"],
          patientSummary: "Smear sonucu temiz olarak belirtilmiş.",
          clinicalTakeaway: "Temiz smear iyi bir bulgudur.",
          safeGuidance: "Şikayet sürerse hekim değerlendirmesi uygundur.",
          redFlags: "",
          doNotInfer: "Kasık ağrısının nedeni smear sonucundan çıkarılmaz.",
        },
      },
      {
        fusedScore: 1.3,
        lexicalScore: 1,
        embeddingScore: 0.3,
        chunk: { id: "kasik-only" },
        card: {
          topic: "kasık ağrısı",
          tags: ["kasik", "agri"],
          patientSummary: "Ara ara kasık ağrısı tarifleniyor.",
          clinicalTakeaway: "Kasık ağrısı devam ederse kadın doğum muayenesi uygundur.",
          safeGuidance: "Ateş, şiddetli ağrı veya kanama varsa daha hızlı değerlendirme gerekir.",
          redFlags: "Şiddetli ağrı veya ateş varsa hızlı değerlendirme gerekir.",
          doNotInfer: "",
        },
      },
    ];

    const ranked = rerankKnowledgeCards(
      "Smear sonucum temiz çıktı ama ara ara kasık ağrım oluyor.",
      candidates,
      3,
    );

    expect(ranked.map((candidate) => candidate.chunk.id)).toEqual(["smear-only", "kasik-only"]);
  });
});
