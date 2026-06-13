import { describe, expect, it } from "vitest";

import { compileEvidence, hasCompiledUsableGrounding } from "./compiledEvidence.js";
import { buildEvidenceBundle } from "./evidenceBundle.js";
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

  it("carries evidence bundle and exposes bundle diagnostics", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Belgedeki toplam tutar nedir?",
      textFacts: ["doc-1: Toplam tutar 120 olarak geçiyor."],
      notSupported: ["Kaynakta ikinci dönem belirtilmiyor."],
      sourceIds: ["doc-1"],
      requestedFieldIds: ["total_amount"],
    });

    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        usableFacts: ["doc-1: Toplam tutar 120 olarak geçiyor."],
        sourceIds: ["doc-1"],
        evidenceBundle: bundle,
      }),
    });

    expect(compiled.evidenceBundle).toBe(bundle);
    expect(compiled.diagnostics?.evidenceBundle).toMatchObject({
      itemCount: 2,
      usableItemCount: 1,
      stringFactCount: 1,
      sourceLimitCount: 1,
      kindCounts: {
        text_fact: 1,
        definition: 0,
        list_item: 0,
        comparison_point: 0,
        code_fact: 0,
        table_fact: 0,
        numeric_fact: 0,
        procedure_step: 0,
        source_limit: 1,
        contradiction: 0,
      },
    });
    expect(compiled.evidenceBundle?.requestedFieldIds).toEqual(["total_amount"]);
  });

  it("treats structured-only evidence as usable grounding", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-structured"],
        structuredFacts: [
          {
            id: "sf-structured-only",
            kind: "numeric_value",
            sourceId: "doc-structured",
            field: "Toplam",
            value: "120",
            confidence: "high",
            provenance: {
              quote: "Toplam 120",
              extractor: "test",
            },
          },
        ],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Toplam nedir?",
          structuredFacts: [
            {
              id: "sf-structured-only",
              kind: "numeric_value",
              sourceId: "doc-structured",
              field: "Toplam",
              value: "120",
              confidence: "high",
              provenance: {
                quote: "Toplam 120",
                extractor: "test",
              },
            },
          ],
          sourceIds: ["doc-structured"],
        }),
      }),
    });

    expect(compiled.facts).toEqual([]);
    expect(compiled.structuredFactCount).toBe(1);
    expect(compiled.usableFactCount).toBe(1);
    expect(compiled.confidence).toBe("high");
    expect(hasCompiledUsableGrounding(compiled)).toBe(true);
  });

  it("exposes V2 complete coverage and sufficiency diagnostics", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-structured"],
        structuredFacts: [
          {
            id: "sf-total",
            kind: "numeric_value",
            sourceId: "doc-structured",
            field: "total_amount",
            value: "120",
            confidence: "high",
            provenance: {
              quote: "Total amount 120",
              extractor: "test",
            },
          },
        ],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Toplam tutar nedir?",
          requestedFieldIds: ["total_amount"],
          structuredFacts: [
            {
              id: "sf-total",
              kind: "numeric_value",
              sourceId: "doc-structured",
              field: "total_amount",
              value: "120",
              confidence: "high",
              provenance: {
                quote: "Total amount 120",
                extractor: "test",
              },
            },
          ],
          sourceIds: ["doc-structured"],
        }),
      }),
    });

    expect(compiled.version).toBe(2);
    expect(compiled.coverage).toMatchObject({
      status: "complete",
      requestedFieldIds: ["total_amount"],
      coveredFieldIds: ["total_amount"],
      missingFieldIds: [],
      structuredFactCount: 1,
    });
    expect(compiled.sufficiency).toMatchObject({
      status: "sufficient",
      shouldAnswer: true,
      reason: "sufficient_evidence",
      coverage: "complete",
      confidence: "high",
    });
    expect(compiled.factLevelDiagnostics).toMatchObject({
      usableEvidenceItemCount: 1,
      selectedTextFactCount: 0,
      selectedStructuredFactCount: 1,
      selectedRiskFactCount: 0,
      selectedUnknownCount: 0,
      selectedContradictionCount: 0,
      selectedSourceCount: 1,
      diagnosticsMode: "observed_only",
      structuredFactKinds: {
        table_cell: 0,
        table_row: 0,
        numeric_value: 1,
        text_claim: 0,
      },
      structuredFactConfidenceCounts: {
        low: 0,
        medium: 0,
        high: 1,
      },
      sourceDistribution: [{ sourceId: "doc-structured", count: 2 }],
      contradictionSources: [],
    });
    expect(compiled.factLevelDiagnostics?.bundleKindCounts.numeric_fact).toBe(1);
  });

  it("marks requested field coverage as partial without changing usable grounding", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        usableFacts: ["Kaynak toplam tutarı açıkça veriyor."],
        sourceIds: ["doc-partial"],
        structuredFacts: [
          {
            id: "sf-total",
            kind: "numeric_value",
            sourceId: "doc-partial",
            field: "total_amount",
            value: "120",
            confidence: "high",
            provenance: {
              quote: "Toplam 120",
              extractor: "test",
            },
          },
        ],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Toplam ve net tutar nedir?",
          requestedFieldIds: ["total_amount", "net_amount"],
          textFacts: ["Kaynak toplam tutarı açıkça veriyor."],
          sourceIds: ["doc-partial"],
        }),
      }),
    });

    expect(compiled.coverage?.status).toBe("partial");
    expect(compiled.coverage?.coveredFieldIds).toEqual(["total_amount"]);
    expect(compiled.coverage?.missingFieldIds).toEqual(["net_amount"]);
    expect(compiled.sufficiency).toMatchObject({
      status: "partial",
      shouldAnswer: true,
      reason: "partial_requested_field_coverage",
    });
    expect(hasCompiledUsableGrounding(compiled)).toBe(true);
  });

  it("covers snake-case requested fields with readable structured fact labels", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-readable"],
        structuredFacts: [
          {
            id: "sf-total-readable",
            kind: "numeric_value",
            sourceId: "doc-readable",
            field: "Total Amount",
            value: "120",
            confidence: "high",
            provenance: {
              quote: "Total Amount 120",
              extractor: "test",
            },
          },
        ],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Total amount?",
          requestedFieldIds: ["total_amount"],
          sourceIds: ["doc-readable"],
        }),
      }),
    });

    expect(compiled.coverage).toMatchObject({
      status: "complete",
      coveredFieldIds: ["total_amount"],
      missingFieldIds: [],
    });
    expect(compiled.sufficiency.status).toBe("sufficient");
  });

  it("marks no usable evidence as insufficient", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        notSupported: ["Kaynakta istenen bilgi yok."],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Kaynakta olmayan alan nedir?",
          requestedFieldIds: ["missing_field"],
          notSupported: ["Kaynakta istenen bilgi yok."],
        }),
      }),
    });

    expect(compiled.coverage?.status).toBe("none");
    expect(compiled.sufficiency).toMatchObject({
      status: "insufficient",
      shouldAnswer: false,
      reason: "no_usable_evidence",
      coverage: "none",
      confidence: "low",
    });
  });

  it("marks contradiction as a sufficiency diagnostic without dropping usable facts", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Kaynaklar aynı mı?",
      textFacts: ["Source A says value is 120."],
      notSupported: ["doc-b: Source B contradicts that value."],
      sourceIds: ["doc-a", "doc-b"],
    });
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        usableFacts: ["Kaynak A tutarı 120 olarak verir."],
        uncertainOrUnusable: ["Kaynak B bununla çelişiyor."],
        sourceIds: ["doc-a", "doc-b"],
        evidenceBundle: bundle,
      }),
    });

    expect(compiled.confidence).toBe("low");
    expect(compiled.sufficiency).toMatchObject({
      status: "contradictory",
      shouldAnswer: true,
      reason: "contradiction_present",
      confidence: "low",
    });
    expect(hasCompiledUsableGrounding(compiled)).toBe(true);
    expect(compiled.factLevelDiagnostics).toMatchObject({
      selectedContradictionCount: 1,
      contradictionSources: ["doc-b"],
    });
    expect(compiled.factLevelDiagnostics?.bundleKindCounts.contradiction).toBe(1);
  });

  it("builds V2 source map, confidence contract, readiness and legacy text", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Toplam tutar nedir?",
      textFacts: ["doc-a: Toplam tutar 120 olarak geçiyor."],
      sourceIds: ["doc-a"],
      requestedFieldIds: ["total_amount"],
    });
    const compiled = compileEvidence({
      groundingConfidence: "high",
      sourceRefs: [{ id: "doc-a", title: "Source A" }],
      evidence: evidence({
        usableFacts: ["doc-a: Toplam tutar 120 olarak geçiyor."],
        sourceIds: ["doc-a"],
        structuredFacts: [
          {
            id: "sf-total",
            kind: "numeric_value",
            sourceId: "doc-a",
            field: "total_amount",
            value: "120",
            confidence: "high",
            provenance: {
              quote: "Toplam tutar 120 olarak geçiyor.",
              extractor: "test",
            },
          },
        ],
        evidenceBundle: bundle,
      }),
    });

    expect(compiled.items.length).toBeGreaterThan(0);
    expect(compiled.sourceMap.byEvidenceItemId[compiled.items[0]?.id ?? ""]?.title).toBe("Source A");
    expect(compiled.sourceMap.byStructuredFactId["sf-total"]?.title).toBe("Source A");
    expect(compiled.evidenceConfidence).toMatchObject({
      level: "high",
      reasons: expect.arrayContaining(["grounding_high", "coverage_complete"]),
    });
    expect(compiled.answerReadiness).toMatchObject({
      usableForAnswer: true,
      mode: "answer",
      requiredEvidenceTypeMatched: true,
    });
    expect(compiled.legacyText).toMatchObject({
      facts: ["doc-a: Toplam tutar 120 olarak geçiyor."],
      risks: [],
      unknowns: [],
      contradictions: [],
    });
  });
});
