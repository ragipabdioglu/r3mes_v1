import { describe, expect, it } from "vitest";

import { buildAnswerSpec } from "./answerSpec.js";
import type { CompiledEvidence } from "./compiledEvidence.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

function evidence(overrides: Partial<EvidenceExtractorOutput> = {}): EvidenceExtractorOutput {
  return {
    answerIntent: "steps",
    intentResolution: {
      intent: "steps",
      primarySignal: "checklist",
      confidence: "high",
      scores: { checklist: 85, steps: 65 },
      weakIntent: "steps",
      reasons: ["query asks for checklist/list output"],
    },
    directAnswerFacts: ["runbook: Migration öncesi yedek alınmalı ve staging çıktısı doğrulanmalıdır."],
    supportingContext: ["runbook: Rollback planı ve log izleme adımı net olmalıdır."],
    riskFacts: ["runbook: Yedeksiz işlem veya veri silen komutlar yüksek risklidir."],
    notSupported: [],
    usableFacts: ["runbook: Migration öncesi yedek alınmalı ve staging çıktısı doğrulanmalıdır."],
    uncertainOrUnusable: ["runbook: Ortama özel bağlantı ayarı kaynakta yok."],
    redFlags: ["runbook: Yedeksiz işlem veya veri silen komutlar yüksek risklidir."],
    sourceIds: ["runbook"],
    missingInfo: [],
    ...overrides,
  };
}

function compiledEvidence(overrides: Partial<CompiledEvidence> = {}): CompiledEvidence {
  return {
    facts: ["compiler: Kaynakta rollback planı gerektiği belirtiliyor."],
    risks: ["compiler: Yedeksiz işlem risklidir."],
    unknowns: [],
    contradictions: [],
    sourceIds: ["compiler-doc"],
    confidence: "high",
    usableFactCount: 1,
    riskFactCount: 1,
    unknownCount: 0,
    contradictionCount: 0,
    ...overrides,
  };
}

describe("buildAnswerSpec", () => {
  it("builds an evidence-driven answer plan for step/checklist questions", () => {
    const spec = buildAnswerSpec({
      answerDomain: "technical",
      groundingConfidence: "high",
      userQuery: "Production migration öncesi kontrol listesi verir misin?",
      evidence: evidence(),
    });

    expect(spec.answerIntent).toBe("steps");
    expect(spec.tone).toBe("direct");
    expect(spec.sections).toEqual(["action", "assessment", "caution", "summary"]);
    expect(spec.assessment).toContain("yedek alınmalı");
    expect(spec.action).toContain("Rollback planı");
    expect(spec.caution[0]).toContain("Yedeksiz işlem");
    expect(spec.unknowns[0]).toContain("bağlantı ayarı");
    expect(spec.sourceIds).toEqual(["runbook"]);
  });

  it("uses compiled evidence risks and source ids when available", () => {
    const spec = buildAnswerSpec({
      answerDomain: "technical",
      groundingConfidence: "high",
      userQuery: "Rollback gerekli mi?",
      evidence: evidence({
        riskFacts: [],
        redFlags: [],
        sourceIds: ["legacy-doc"],
      }),
      compiledEvidence: compiledEvidence(),
    });

    expect(spec.caution[0]).toContain("Yedeksiz işlem risklidir");
    expect(spec.sourceIds).toEqual(["compiler-doc"]);
    expect(spec.groundingConfidence).toBe("high");
  });

  it("downgrades answer plan when compiled evidence detects contradiction", () => {
    const spec = buildAnswerSpec({
      answerDomain: "technical",
      groundingConfidence: "high",
      userQuery: "Rollback gerekli mi?",
      evidence: evidence({
        uncertainOrUnusable: [],
        missingInfo: [],
      }),
      compiledEvidence: compiledEvidence({
        confidence: "low",
        contradictions: ["Kaynaklar rollback gerekliliği konusunda çelişiyor."],
        contradictionCount: 1,
      }),
    });

    expect(spec.groundingConfidence).toBe("low");
    expect(spec.tone).toBe("cautious");
    expect(spec.caution[0]).toContain("çelişiyor");
  });

  it("keeps low-grounding/no-source answers cautious and explicit", () => {
    const spec = buildAnswerSpec({
      answerDomain: "legal",
      groundingConfidence: "low",
      userQuery: "Bu belgeye göre kesin sonuç nedir?",
      evidence: evidence({
        answerIntent: "unknown",
        directAnswerFacts: [],
        supportingContext: [],
        usableFacts: [],
        redFlags: [],
        riskFacts: [],
        uncertainOrUnusable: [],
        missingInfo: ["Soruya doğrudan dayanak sağlayan yeterli kaynak cümlesi bulunamadı."],
        sourceIds: [],
      }),
    });

    expect(spec.answerIntent).toBe("unknown");
    expect(spec.tone).toBe("cautious");
    expect(spec.assessment).toContain("sınırlı bilgi");
    expect(spec.action).toContain("Belgeleri saklayıp");
    expect(spec.caution[0]).toContain("kesin sonuç");
    expect(spec.unknowns).toEqual(
      expect.arrayContaining(["Soruya doğrudan dayanak sağlayan yeterli kaynak cümlesi bulunamadı."]),
    );
  });

  it("orders triage sections with caution first", () => {
    const spec = buildAnswerSpec({
      answerDomain: "medical",
      groundingConfidence: "medium",
      userQuery: "Ne zaman doktora gitmeliyim?",
      evidence: evidence({ answerIntent: "triage" }),
    });

    expect(spec.sections[0]).toBe("caution");
    expect(spec.tone).toBe("direct");
  });

  it("strips parser and document scaffold from evidence facts", () => {
    const spec = buildAnswerSpec({
      answerDomain: "medical",
      groundingConfidence: "high",
      userQuery: "Antikoagülan kullanan hasta nelere dikkat etmeli?",
      evidence: evidence({
        answerIntent: "explain",
        directAnswerFacts: [
          "Antikoagülan Kartı: ANTİKOAGÜLAN ( PIHTI ÖNLEYİCİ ) İLAÇ KULLANAN HASTADA DİKKAT EDİLECEK HUSUSLAR Bu ilaçların ortak özelliği kanın pıhtılaşmasını azaltmasıdır.",
        ],
        supportingContext: ["Antikoagülan Kartı: ## Page 2 Cerrahi işlem öncesi hekime bilgi verilmelidir."],
        usableFacts: [],
        redFlags: [],
        riskFacts: [],
      }),
    });

    expect(spec.assessment).toBe("Bu ilaçların ortak özelliği kanın pıhtılaşmasını azaltmasıdır.");
    expect(spec.action).toBe("Cerrahi işlem öncesi hekime bilgi verilmelidir.");
  });

  it("keeps salient medical query context without turning it into a diagnosis", () => {
    const spec = buildAnswerSpec({
      answerDomain: "medical",
      groundingConfidence: "high",
      userQuery: "HPV pozitif çıktı, takip gerekli mi?",
      evidence: evidence({
        answerIntent: "reassure",
        directAnswerFacts: ["clinical-card: Bu sonuç tek başına panik gerektiren bir anlam taşımaz."],
        supportingContext: [],
        usableFacts: [],
        redFlags: [],
        riskFacts: [],
      }),
    });

    expect(spec.action).toContain("hpv");
    expect(spec.action).toContain("takip");
    expect(spec.action).toContain("muayene");
    expect(spec.action).toContain("kontrol");
    expect(spec.action).toContain("tanı koymadan");
    expect(spec.facts[0]).toContain("hpv");
  });

  it("removes dirty OCR scaffolding before composing medical facts", () => {
    const spec = buildAnswerSpec({
      answerDomain: "medical",
      groundingConfidence: "high",
      userQuery: "Smear temiz ama kasık ağrım var, ne yapmalıyım?",
      evidence: evidence({
        answerIntent: "steps",
        directAnswerFacts: [
          "dirty-note: PDF COPY >>> Kadın doğum poliklinik notu / tarama sonucu TABLO - bulgu - yorum smear: normal gorunuyor - yakınma: ara ara kasık ağrısı OCR HATASI: kasik agriyo.",
        ],
        supportingContext: [],
        usableFacts: [],
        redFlags: [],
        riskFacts: [],
      }),
    });

    expect(spec.assessment).not.toContain("PDF COPY");
    expect(spec.assessment).not.toContain("OCR HATASI");
    expect(spec.assessment).toContain("smear");
  });

  it("removes repeated document headers from extracted facts", () => {
    const spec = buildAnswerSpec({
      answerDomain: "education",
      groundingConfidence: "high",
      userQuery: "Veli ateş ve öksürük durumunda ne yapmalı?",
      evidence: evidence({
        answerIntent: "steps",
        directAnswerFacts: [],
        supportingContext: [],
        usableFacts: [
          "VELİ BİLGİLENDİRME REHBERİ 15 • Doğru ve güvenilir kaynaklardan bilgi edinerek öğrencimizi bilinçlendiriniz.",
          "VELİ BİLGİLENDİRME REHBERİ 13 ÖNEMSEYİNİZ!",
        ],
        redFlags: [],
        riskFacts: [],
      }),
    });

    expect(spec.assessment).toBe("Doğru ve güvenilir kaynaklardan bilgi edinerek öğrencimizi bilinçlendiriniz.");
    expect(spec.facts).not.toContain("ÖNEMSEYİNİZ!");
    expect(spec.facts).not.toContain("VELİ BİLGİLENDİRME REHBERİ 13 ÖNEMSEYİNİZ!");
  });

  it("prioritizes query-aligned action facts over generic PDF guidance", () => {
    const spec = buildAnswerSpec({
      answerDomain: "education",
      groundingConfidence: "high",
      userQuery: "Veli çocuğunda ateş veya öksürük belirtisi görürse ne yapmalı?",
      evidence: evidence({
        answerIntent: "steps",
        directAnswerFacts: [
          "MEB Veli Bilgilendirme Rehberi: Doğru ve güvenilir kaynaklardan bilgi edinerek salgın hastalıklar konusunda öğrencimizi bilinçlendiriniz.(*) • Bakanlığımız ve yetkili kurumlarc….",
          "MEB Veli Bilgilendirme Rehberi: Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa idareyi bilgilendirerek okuluna göndermeyiniz.",
        ],
        supportingContext: [],
        usableFacts: [],
        redFlags: [],
        riskFacts: [],
      }),
    });

    expect(spec.assessment).toBe("Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa idareyi bilgilendirerek okuluna göndermeyiniz.");
    expect(spec.action).toBe("Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa idareyi bilgilendirerek okuluna göndermeyiniz.");
  });

  it("prefers complete duplicate evidence over a clipped duplicate", () => {
    const spec = buildAnswerSpec({
      answerDomain: "education",
      groundingConfidence: "high",
      userQuery: "Veli çocuğunda ateş veya öksürük belirtisi görürse ne yapmalı?",
      evidence: evidence({
        answerIntent: "steps",
        directAnswerFacts: [
          "MEB Veli Bilgilendirme Rehberi: Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa idareyi bilgilendirere",
          "MEB Veli Bilgilendirme Rehberi: Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa idareyi bilgilendirerek okuluna göndermeyiniz.",
        ],
        supportingContext: [],
        usableFacts: [],
        redFlags: [],
        riskFacts: [],
      }),
    });

    expect(spec.assessment).toContain("okuluna göndermeyiniz");
    expect(spec.assessment).not.toMatch(/bilgilendirere(?:\s|$)/u);
  });

  it("keeps both source-title facts ahead of table rows for disclosure matching questions", () => {
    const spec = buildAnswerSpec({
      answerDomain: "finance",
      groundingConfidence: "high",
      userQuery: "EREGL 1576833 için Türkçe tablo ile İngilizce profit distribution table aynı bildirim indeksine mi ait? Kaynak başlıklarına göre cevapla.",
      evidence: evidence({
        answerIntent: "explain",
        directAnswerFacts: [
          "en-doc: İngilizce kaynak başlığı: EREGL 1576833 Profit Distribution Table.pdf",
          "en-doc: 3. Profit for the Period 3.497.911.571",
          "tr-doc: Türkçe kaynak başlığı: EREGL 1576833 Yılı Kar Dağıtım Tablosu.pdf",
        ],
        supportingContext: [],
        usableFacts: [],
        redFlags: [],
        riskFacts: [],
      }),
    });

    expect(spec.assessment).toContain("İngilizce kaynak başlığı");
    expect(spec.action).toContain("Türkçe kaynak başlığı");
    expect(spec.facts.join(" ")).toContain("1576833");
  });
});
