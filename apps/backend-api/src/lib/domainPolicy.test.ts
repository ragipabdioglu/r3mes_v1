import { describe, expect, it } from "vitest";

import { getDomainPolicy, inferAnswerDomain } from "./domainPolicy.js";

describe("domain policy", () => {
  it("detects legal questions without forcing medical behavior", () => {
    const domain = inferAnswerDomain({
      userQuery: "Kira sözleşmem feshedildi, dava açabilir miyim?",
      evidence: {
        usableFacts: ["Kira uyuşmazlıklarında süre ve sözleşme maddeleri önemlidir."],
        uncertainOrUnusable: [],
        redFlags: [],
        sourceIds: ["legal-1"],
        missingInfo: [],
      },
      contextText: "",
    });

    expect(domain).toBe("legal");
    expect(getDomainPolicy(domain).rules.join(" ")).toContain("Kesin hukuki görüş");
  });

  it("keeps medical policy for health evidence", () => {
    const domain = inferAnswerDomain({
      userQuery: "Kasık ağrım var ne yapmalıyım?",
      evidence: {
        usableFacts: ["Kasık ağrısında şiddet, ateş ve kanama önemlidir."],
        uncertainOrUnusable: [],
        redFlags: ["Ateş veya anormal kanama varsa hızlı değerlendirme gerekir."],
        sourceIds: ["med-1"],
        missingInfo: [],
      },
      contextText: "",
    });

    expect(domain).toBe("medical");
    expect(getDomainPolicy(domain).rules.join(" ")).toContain("Tanı koyma");
  });

  it("trusts a confident route plan before noisy retrieved evidence", () => {
    const domain = inferAnswerDomain({
      userQuery: "Production veritabanında migration öncesi ne yapmalıyım?",
      routePlan: {
        domain: "technical",
        subtopics: ["migration"],
        riskLevel: "high",
        retrievalHints: ["veritabanı migration"],
        mustIncludeTerms: ["migration", "yedek", "rollback"],
        mustExcludeTerms: [],
        confidence: "high",
      },
      evidence: {
        usableFacts: ["Doktor muayenesi ve takip önemlidir."],
        uncertainOrUnusable: [],
        redFlags: [],
        sourceIds: ["noisy-medical-source"],
        missingInfo: [],
      },
      contextText: "",
    });

    expect(domain).toBe("technical");
  });

  it("uses selected collection domain when the route is weak and evidence has noisy terms", () => {
    const domain = inferAnswerDomain({
      userQuery: "Veli çocuğunda ateş veya öksürük belirtisi görürse ne yapmalı?",
      routePlan: {
        domain: "medical",
        subtopics: ["belirti"],
        riskLevel: "medium",
        retrievalHints: ["ateş", "öksürük"],
        mustIncludeTerms: ["ateş"],
        mustExcludeTerms: [],
        confidence: "low",
      },
      selectedCollectionDomain: "education",
      evidence: {
        usableFacts: ["Hastalık belirtisi olan öğrencinin okula gönderilmemesi ve okul idaresine bilgi verilmesi önerilir."],
        uncertainOrUnusable: [],
        redFlags: ["Yüksek ateş veya öksürük belirtisi varsa rehberdeki okul bilgilendirmesi izlenmelidir."],
        sourceIds: ["education-1"],
        missingInfo: [],
      },
      contextText: "",
    });

    expect(domain).toBe("education");
  });

  it("lets selected collection domain override medium route hints", () => {
    const domain = inferAnswerDomain({
      userQuery: "Veli ateş ve öksürük durumunda okula bildirim yapmalı mı?",
      routePlan: {
        domain: "medical",
        subtopics: ["belirti"],
        riskLevel: "medium",
        retrievalHints: ["ateş", "öksürük"],
        mustIncludeTerms: ["ateş"],
        mustExcludeTerms: [],
        confidence: "medium",
      },
      selectedCollectionDomain: "education",
      evidence: {
        usableFacts: ["Okula gönderilmeme ve idareyi bilgilendirme adımı veli rehberinde yer alır."],
        uncertainOrUnusable: [],
        redFlags: [],
        sourceIds: ["education-1"],
        missingInfo: [],
      },
      contextText: "",
    });

    expect(domain).toBe("education");
  });

  it("lets used collection domain override even high route hints", () => {
    const domain = inferAnswerDomain({
      userQuery: "Çocuğumda ateş ve öksürük var, okul açısından ne yapmalıyım?",
      routePlan: {
        domain: "medical",
        subtopics: ["pediatri_terleme"],
        riskLevel: "high",
        retrievalHints: ["ateş kontrolü", "çocuk doktoru"],
        mustIncludeTerms: ["ateş", "çocuk doktoru"],
        mustExcludeTerms: [],
        confidence: "high",
      },
      selectedCollectionDomain: "education",
      evidence: {
        usableFacts: ["Hastalık belirtisi olan öğrencinin okula gönderilmemesi ve idareye bilgi verilmesi rehberde yer alır."],
        uncertainOrUnusable: [],
        redFlags: [],
        sourceIds: ["education-1"],
        missingInfo: [],
      },
      contextText: "",
    });

    expect(domain).toBe("education");
  });

  it("supports education policy without falling back to general", () => {
    const domain = inferAnswerDomain({
      userQuery: "Öğrenci sınav sonucuna itiraz etmek istiyor, süreye nasıl bakmalı?",
      evidence: null,
      contextText: "",
    });

    expect(domain).toBe("education");
    expect(getDomainPolicy(domain).rules.join(" ")).toContain("sınav tarihi");
  });
});
