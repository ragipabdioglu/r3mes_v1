import { describe, expect, it } from "vitest";

import { compileEvidence, hasCompiledUsableGrounding } from "./compiledEvidence.js";
import { buildEvidenceBundle, buildEvidenceBundleFromItems, createEvidenceItem } from "./evidenceBundle.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";
import type { StructuredFact } from "./structuredFact.js";

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
    sourceIds: [],
    missingInfo: [],
    structuredFacts: [],
    evidenceBundle: buildEvidenceBundle({ userQuery: "Soru" }),
    ...partial,
  };
}

function structuredFact(partial: Partial<StructuredFact> = {}): StructuredFact {
  return {
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
    ...partial,
  };
}

describe("compileEvidence", () => {
  it("compiles typed text evidence without legacy bucket input", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Açıklama tarihi nedir?",
      textFacts: ["Açıklama tarihi 2024 olarak verilmiş."],
      sourceIds: ["doc-2"],
      requestedFieldIds: ["aciklama_tarihi"],
    });
    const compiled = compileEvidence({
      groundingConfidence: "high",
      sourceRefs: [{ id: "doc-2", title: "Disclosure" }],
      evidence: evidence({
        sourceIds: ["doc-2"],
        evidenceBundle: bundle,
      }),
    });

    expect(compiled.items).toHaveLength(1);
    expect(compiled.facts).toEqual(["doc-2: Açıklama tarihi 2024 olarak verilmiş."]);
    expect(compiled.sourceIds).toEqual(["doc-2"]);
    expect(compiled.sourceMap.byEvidenceItemId[compiled.items[0]?.id ?? ""]?.title).toBe("Disclosure");
    expect(compiled.answerReadiness.mode).toBe("partial_answer");
  });

  it("lowers confidence when typed contradiction evidence is present", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Kaynaklar aynı mı?",
      textFacts: ["Source A says value is 120."],
      notSupported: ["doc-b: Source B contradicts that value."],
      sourceIds: ["doc-a", "doc-b"],
    });
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-a", "doc-b"],
        evidenceBundle: bundle,
      }),
    });

    expect(compiled.contradictionCount).toBe(1);
    expect(compiled.confidence).toBe("low");
    expect(compiled.sufficiency.status).toBe("contradictory");
    expect(compiled.factLevelDiagnostics?.contradictionSources).toEqual(["doc-b"]);
  });

  it("uses low confidence when no usable evidence exists", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Kaynakta olmayan bilgi nedir?",
          notSupported: ["Kaynakta istenen bilgi yok."],
          requestedFieldIds: ["missing_field"],
        }),
      }),
    });

    expect(compiled.usableFactCount).toBe(0);
    expect(compiled.coverage.status).toBe("none");
    expect(compiled.answerReadiness.mode).toBe("no_source");
    expect(hasCompiledUsableGrounding(compiled)).toBe(false);
  });

  it("applies evidence limits to typed text items", () => {
    const previousLimit = process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT;
    process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT = "2";
    try {
      const bundle = buildEvidenceBundle({
        userQuery: "Fact listesi nedir?",
        textFacts: ["Fact A.", "Fact B.", "Fact C."],
        sourceIds: ["doc-1"],
      });
      const compiled = compileEvidence({
        groundingConfidence: "high",
        evidence: evidence({
          sourceIds: ["doc-1"],
          evidenceBundle: bundle,
        }),
      });

      expect(compiled.facts).toEqual(["doc-1: Fact A.", "doc-1: Fact B."]);
      expect(compiled.usableFactCount).toBe(3);
      expect(compiled.diagnostics?.limits.facts).toBe(2);
      expect(compiled.diagnostics?.rawCounts.facts).toBe(3);
    } finally {
      if (previousLimit == null) {
        delete process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT;
      } else {
        process.env.R3MES_EVIDENCE_USABLE_FACT_LIMIT = previousLimit;
      }
    }
  });

  it("carries structured facts as first-class grounding", () => {
    const fact = structuredFact();
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-structured"],
        structuredFacts: [fact],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Toplam nedir?",
          structuredFacts: [fact],
          sourceIds: ["doc-structured"],
        }),
      }),
    });

    expect(compiled.structuredFactCount).toBe(1);
    expect(compiled.structuredFacts?.[0]?.field).toBe("total_amount");
    expect(compiled.facts).toEqual(["doc-structured: Total amount 120"]);
    expect(compiled.usableFactCount).toBe(1);
    expect(hasCompiledUsableGrounding(compiled)).toBe(true);
  });

  it("exposes complete coverage and sufficiency diagnostics", () => {
    const fact = structuredFact();
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-structured"],
        structuredFacts: [fact],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Toplam tutar nedir?",
          requestedFieldIds: ["total_amount"],
          structuredFacts: [fact],
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
      selectedTextFactCount: 1,
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

  it("marks requested field coverage as partial without losing grounding", () => {
    const fact = structuredFact();
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-partial"],
        structuredFacts: [{ ...fact, sourceId: "doc-partial" }],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Toplam ve net tutar nedir?",
          requestedFieldIds: ["total_amount", "net_amount"],
          structuredFacts: [{ ...fact, sourceId: "doc-partial" }],
          sourceIds: ["doc-partial"],
        }),
      }),
    });

    expect(compiled.coverage.status).toBe("partial");
    expect(compiled.coverage.coveredFieldIds).toEqual(["total_amount"]);
    expect(compiled.coverage.missingFieldIds).toEqual(["net_amount"]);
    expect(compiled.sufficiency.status).toBe("partial");
    expect(hasCompiledUsableGrounding(compiled)).toBe(true);
  });

  it("builds source map, confidence contract and readiness without legacy adapter", () => {
    const fact = structuredFact({ id: "sf-total", sourceId: "doc-a", provenance: { quote: "Toplam tutar 120 olarak geçiyor.", extractor: "test" } });
    const bundle = buildEvidenceBundleFromItems({
      userQuery: "Toplam tutar nedir?",
      requestedFieldIds: ["total_amount"],
      items: [
        createEvidenceItem({
          id: "ev-total",
          kind: "numeric_fact",
          role: "direct_answer",
          sourceId: "doc-a",
          quote: "Toplam tutar 120 olarak geçiyor.",
          normalizedClaim: "total_amount 120",
          field: "total_amount",
          value: "120",
          structuredFactId: "sf-total",
          confidence: "high",
          provenance: { extractor: "test" },
        }),
      ],
    });
    const compiled = compileEvidence({
      groundingConfidence: "high",
      sourceRefs: [{ id: "doc-a", title: "Source A" }],
      evidence: evidence({
        sourceIds: ["doc-a"],
        structuredFacts: [fact],
        evidenceBundle: bundle,
      }),
    });

    expect(compiled.items).toHaveLength(1);
    expect(compiled.sourceMap.byEvidenceItemId["ev-total"]?.title).toBe("Source A");
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
    expect("legacyText" in compiled).toBe(false);
  });
});
