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
