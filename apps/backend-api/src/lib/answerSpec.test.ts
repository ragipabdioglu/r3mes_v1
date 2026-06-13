import { describe, expect, it } from "vitest";

import { buildAnswerSpec } from "./answerSpec.js";
import { compileEvidence } from "./compiledEvidence.js";
import { buildEvidenceBundle, buildEvidenceBundleFromItems, createEvidenceItem } from "./evidenceBundle.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";
import type { StructuredFact } from "./structuredFact.js";

function evidence(overrides: Partial<EvidenceExtractorOutput> = {}): EvidenceExtractorOutput {
  return {
    answerIntent: "explain",
    intentResolution: {
      intent: "explain",
      primarySignal: "typed_evidence",
      confidence: "high",
      scores: {},
      weakIntent: "explain",
      reasons: [],
    },
    sourceIds: [],
    missingInfo: [],
    structuredFacts: [],
    evidenceBundle: buildEvidenceBundle({ userQuery: "Soru" }),
    ...overrides,
  };
}

function structuredFact(overrides: Partial<StructuredFact> = {}): StructuredFact {
  return {
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
    ...overrides,
  };
}

describe("buildAnswerSpec", () => {
  it("uses typed evidence as the answer planning substrate", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Sistemin temel bileşenleri nelerdir?",
      taskType: "list_items",
      textFacts: [
        "Algılama: Ortamdan veri toplar.",
        "Bağlantı: Veriyi merkeze iletir.",
      ],
      sourceIds: ["doc-list"],
    });
    const spec = buildAnswerSpec({
      answerDomain: "general",
      groundingConfidence: "high",
      userQuery: "Sistemin temel bileşenleri nelerdir?",
      evidence: evidence({
        answerIntent: "steps",
        sourceIds: ["doc-list"],
        evidenceBundle: bundle,
      }),
    });

    expect(spec.answerIntent).toBe("steps");
    expect(spec.tone).toBe("direct");
    expect(spec.sections).toEqual(["action", "assessment", "caution", "summary"]);
    expect(spec.assessment).toBe("Algılama: Ortamdan veri toplar.");
    expect(spec.action).toBe("Bağlantı: Veriyi merkeze iletir.");
    expect(spec.sourceIds).toEqual(["doc-list"]);
    expect(spec.facts).toEqual([
      "Algılama: Ortamdan veri toplar.",
      "Bağlantı: Veriyi merkeze iletir.",
    ]);
  });

  it("uses compiled evidence readiness and structured facts", () => {
    const fact = structuredFact();
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        sourceIds: ["doc-a"],
        structuredFacts: [fact],
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Toplam tutar nedir?",
          requestedFieldIds: ["total_amount"],
          structuredFacts: [fact],
          sourceIds: ["doc-a"],
        }),
      }),
    });
    const spec = buildAnswerSpec({
      answerDomain: "finance",
      groundingConfidence: "medium",
      userQuery: "Toplam tutar nedir?",
      evidence: null,
      compiledEvidence: compiled,
    });

    expect(spec.groundingConfidence).toBe("high");
    expect(spec.structuredFacts).toHaveLength(1);
    expect(spec.assessment).toContain("Toplam tutar 120");
    expect(spec.sourceIds).toEqual(["doc-a"]);
  });

  it("keeps no-source as planning state instead of fabricating fallback content", () => {
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
    const spec = buildAnswerSpec({
      answerDomain: "legal",
      groundingConfidence: "low",
      userQuery: "Kaynakta olmayan bilgi nedir?",
      evidence: null,
      compiledEvidence: compiled,
    });

    expect(spec.tone).toBe("cautious");
    expect(spec.assessment).toContain("yeterli kanıt bulunamadı");
    expect(spec.action).toContain("Kaynak dışı bilgi eklenmemeli");
    expect(spec.unknowns.join(" ")).toContain("missing_field");
    expect(spec.facts).toEqual([]);
  });

  it("marks contradiction as cautious planning input", () => {
    const compiled = compileEvidence({
      groundingConfidence: "high",
      evidence: evidence({
        evidenceBundle: buildEvidenceBundle({
          userQuery: "Kaynaklar aynı mı?",
          textFacts: ["Kaynak A değer 120 diyor."],
          notSupported: ["Kaynak B bu değerle çelişiyor."],
          sourceIds: ["doc-a", "doc-b"],
        }),
      }),
    });
    const spec = buildAnswerSpec({
      answerDomain: "general",
      groundingConfidence: "high",
      userQuery: "Kaynaklar aynı mı?",
      evidence: null,
      compiledEvidence: compiled,
    });

    expect(spec.groundingConfidence).toBe("low");
    expect(spec.tone).toBe("cautious");
    expect(spec.caution.join(" ")).toContain("çelişki");
    expect(spec.sourceIds).toEqual(["doc-a", "doc-b"]);
  });

  it("does not depend on data-specific literals or domain scoring to select allowed facts", () => {
    const bundle = buildEvidenceBundleFromItems({
      userQuery: "Bu özel alan ne diyor?",
      items: [
        createEvidenceItem({
          id: "ev-a",
          kind: "text_fact",
          role: "direct_answer",
          sourceId: "doc-x",
          quote: "Custom Field Alpha değeri 42 olarak geçiyor.",
          normalizedClaim: "custom field alpha 42",
          confidence: "high",
          provenance: { extractor: "test" },
        }),
      ],
    });
    const spec = buildAnswerSpec({
      answerDomain: "general",
      groundingConfidence: "high",
      userQuery: "Bu özel alan ne diyor?",
      evidence: evidence({
        evidenceBundle: bundle,
        sourceIds: ["doc-x"],
      }),
    });

    expect(spec.assessment).toBe("Custom Field Alpha değeri 42 olarak geçiyor.");
    expect(spec.facts).toEqual(["Custom Field Alpha değeri 42 olarak geçiyor."]);
  });
});
