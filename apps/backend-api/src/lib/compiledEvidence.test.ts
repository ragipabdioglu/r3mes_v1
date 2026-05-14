import { describe, expect, it } from "vitest";

import { compileEvidence, hasCompiledUsableGrounding } from "./compiledEvidence.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

function evidence(partial: Partial<EvidenceExtractorOutput>): EvidenceExtractorOutput {
  return {
    answerIntent: "explain",
    intentResolution: {
      intent: "explain",
      primarySignal: "explain",
      confidence: "medium",
      scores: {},
      weakIntent: "explain",
      reasons: [],
    },
    directAnswerFacts: [],
    supportingContext: [],
    riskFacts: [],
    notSupported: [],
    usableFacts: [],
    uncertainOrUnusable: [],
    redFlags: [],
    sourceIds: [],
    missingInfo: [],
    ...partial,
  };
}

describe("compileEvidence", () => {
  it("standardizes facts risks unknowns and source ids", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      sourceRefs: [{ id: "doc-1" }],
      evidence: evidence({
        directAnswerFacts: ["Açıklama tarihi 2024 olarak verilmiş."],
        usableFacts: ["Açıklama tarihi 2024 olarak verilmiş."],
        supportingContext: ["Tablo başlığı finansal sonuçlar bölümündedir."],
        riskFacts: ["Kaynakta kesin yatırım tavsiyesi yok."],
        missingInfo: ["Hisse fiyatı kaynakta yok."],
        sourceIds: ["doc-2"],
      }),
    });

    expect(compiled.facts).toEqual([
      "Açıklama tarihi 2024 olarak verilmiş.",
      "Tablo başlığı finansal sonuçlar bölümündedir.",
    ]);
    expect(compiled.risks).toEqual(["Kaynakta kesin yatırım tavsiyesi yok."]);
    expect(compiled.unknowns).toEqual(["Hisse fiyatı kaynakta yok."]);
    expect(compiled.sourceIds).toEqual(["doc-2", "doc-1"]);
    expect(compiled.confidence).toBe("high");
  });

  it("lowers confidence when contradiction signals are present", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        usableFacts: ["Kaynaklar arasında çelişen finansal değerler var."],
      }),
    });

    expect(compiled.contradictionCount).toBe(1);
    expect(compiled.confidence).toBe("low");
  });

  it("uses low confidence when no usable fact exists", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        missingInfo: ["Bu soru için kaynakta açık dayanak yok."],
      }),
    });

    expect(compiled.usableFactCount).toBe(0);
    expect(compiled.confidence).toBe("low");
    expect(hasCompiledUsableGrounding(compiled)).toBe(false);
  });

  it("treats remaining facts as usable even when contradiction lowers confidence", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        usableFacts: ["Kaynak, rollback planı hazırlanmalıdır diyor."],
        uncertainOrUnusable: ["Başka bir kaynak bununla çelişiyor."],
      }),
    });

    expect(compiled.usableFactCount).toBe(1);
    expect(compiled.contradictionCount).toBe(1);
    expect(compiled.confidence).toBe("low");
    expect(hasCompiledUsableGrounding(compiled)).toBe(true);
  });

  it("applies decision-config evidence limits and exposes diagnostics", () => {
    const previousLimit = process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT;
    process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT = "2";
    try {
      const compiled = compileEvidence({
        groundingConfidence: "high",
        evidence: evidence({
          usableFacts: ["Fact A.", "Fact B.", "Fact C."],
          sourceIds: ["doc-1"],
        }),
      });

      expect(compiled.facts).toEqual(["Fact A.", "Fact B."]);
      expect(compiled.usableFactCount).toBe(2);
      expect(compiled.diagnostics?.limits.facts).toBe(2);
      expect(compiled.diagnostics?.rawCounts.facts).toBe(3);
      expect(compiled.diagnostics?.confidenceReason).toBe("grounding_high");
    } finally {
      if (previousLimit == null) {
        delete process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT;
      } else {
        process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT = previousLimit;
      }
    }
  });

  it("carries structured facts without breaking legacy string facts", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        usableFacts: ["Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083 olarak geçiyor."],
        sourceIds: ["kap-doc"],
        structuredFacts: [
          {
            id: "fact-1",
            kind: "table_cell",
            sourceId: "kap-doc",
            field: "Dağıtılması Öngörülen Diğer Kaynaklar",
            value: "3.352.908.083",
            confidence: "high",
            table: {
              rowLabel: "Dağıtılması Öngörülen Diğer Kaynaklar",
              columnLabel: "SPK'ya Göre",
              rawRow: "Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083",
            },
            provenance: {
              quote: "Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083",
              extractor: "test",
            },
          },
        ],
      }),
    });

    expect(compiled.facts).toEqual(["Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083 olarak geçiyor."]);
    expect(compiled.structuredFactCount).toBe(1);
    expect(compiled.structuredFacts?.[0]?.field).toBe("Dağıtılması Öngörülen Diğer Kaynaklar");
    expect(compiled.structuredFacts?.[0]?.value).toBe("3.352.908.083");
  });
});
