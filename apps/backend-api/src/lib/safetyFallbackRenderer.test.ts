import { describe, expect, it } from "vitest";

import { buildAnswerPlan, type AnswerPlan } from "./answerPlan.js";
import type { AnswerSpec } from "./answerSpec.js";
import { renderSafetyFallback } from "./safetyFallbackRenderer.js";

const source = {
  collectionId: "kc_1",
  documentId: "doc_1",
  title: "kap-doc",
  chunkIndex: 0,
};

function financeFieldSpec(): AnswerSpec {
  return {
    answerDomain: "finance",
    answerIntent: "explain",
    groundingConfidence: "high",
    userQuery:
      "EREGL kar payında dağıtılması öngörülen diğer kaynaklar nedir? Sadece rakamı yaz, risk yorumu ekleme.",
    tone: "direct",
    sections: ["assessment", "action", "summary"],
    assessment: "Kaynakta ilgili KAP tablo satırı var.",
    action: "Sadece sorulan tablo değeri yazılmalıdır.",
    caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
    summary: "Sorulan alan KAP tablosundan alınmalıdır.",
    unknowns: [],
    sourceIds: ["kap-doc"],
    facts: [],
    structuredFacts: [
      {
        id: "sf-1",
        kind: "table_row",
        sourceId: "kap-doc",
        field: "Dağıtılması Öngörülen Diğer Kaynaklar",
        value: "3.352.908.083 / 3.850.000.000",
        confidence: "high",
        provenance: {
          quote: "Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083 3.850.000.000",
          extractor: "table-numeric-v1",
        },
      },
    ],
  };
}

function genericFieldSpec(overrides: Partial<AnswerSpec> = {}): AnswerSpec {
  return {
    answerDomain: "general",
    answerIntent: "explain",
    groundingConfidence: "high",
    userQuery: "Required Metric ve Second Metric alanlarını kısa yaz, uyarı ekleme.",
    tone: "direct",
    sections: ["assessment", "action", "summary"],
    assessment: "Kaynakta istenen alanların bir kısmı bulunuyor.",
    action: "Sadece kaynakta doğrulanan alanlar yazılmalıdır.",
    caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
    summary: "Sorulan alanlar kaynakla sınırlıdır.",
    unknowns: [],
    sourceIds: ["generic-source"],
    facts: ["Required Metric kaynakta doğrulanmış bir metin değeri olarak geçiyor."],
    structuredFacts: [],
    ...overrides,
  };
}

function genericFieldPlan(overrides: Partial<AnswerPlan> = {}): AnswerPlan {
  const requestedFields = [
    {
      id: "required_metric",
      label: "Required Metric",
      aliases: ["required metric"],
      required: true,
      outputHint: "text" as const,
      confidence: "high" as const,
      matchedAliases: ["required metric"],
    },
    {
      id: "second_metric",
      label: "Second Metric",
      aliases: ["second metric"],
      required: true,
      outputHint: "text" as const,
      confidence: "high" as const,
      matchedAliases: ["second metric"],
    },
  ];
  return {
    domain: "general",
    intent: "explain",
    taskType: "field_extraction",
    outputFormat: "short",
    requestedFields,
    selectedFacts: [],
    constraints: {
      forbidCaution: true,
      noRawTableDump: true,
      sourceGroundedOnly: true,
      format: "short",
    },
    coverage: "partial",
    forbiddenAdditions: ["optional_caution"],
    requiresModelSynthesis: true,
    diagnostics: {
      requestedFieldCount: requestedFields.length,
      selectedFactCount: 0,
      missingFieldIds: ["second_metric"],
    },
    ...overrides,
  };
}

describe("renderSafetyFallback", () => {
  it("keeps source suggestions deterministic", () => {
    expect(
      renderSafetyFallback({
        answerSpec: financeFieldSpec(),
        sources: [],
        fallbackMode: "source_suggestion",
      }),
    ).toBe(
      "Seçili kaynaklarda bu soruya doğrudan yeterli bilgi bulamadım. Doğru collection'ı seçip tekrar deneyin veya ilgili belgeyi yükleyin.",
    );
  });

  it("keeps privacy fallbacks source-id safe", () => {
    const rendered = renderSafetyFallback({
      answerSpec: financeFieldSpec(),
      sources: [{ ...source, documentId: "private-doc-9" }],
      fallbackMode: "privacy_safe",
    });

    expect(rendered).toContain("erişim sınırlarıyla uyuşmadığı");
    expect(rendered).not.toContain("private-doc-9");
    expect(rendered).not.toContain("kap-doc");
  });

  it("uses planned field extraction without generic caution for short low-grounding fallbacks", () => {
    const answerSpec = financeFieldSpec();
    const answerPlan = buildAnswerPlan(answerSpec);
    const rendered = renderSafetyFallback({
      answerSpec,
      answerPlan,
      sources: [source],
      fallbackMode: "low_grounding",
    });

    expect(rendered).toContain("Dağıtılması Öngörülen Diğer Kaynaklar");
    expect(rendered).toContain("3.352.908.083");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered).not.toContain("risk koşulu");
  });

  it("bridges low-grounding partial field extraction to usable text facts before concise missing fallback", () => {
    const rendered = renderSafetyFallback({
      answerSpec: genericFieldSpec(),
      answerPlan: genericFieldPlan(),
      sources: [source],
      fallbackMode: "low_grounding",
    });

    expect(rendered).toContain("Required Metric kaynakta doğrulanmış");
    expect(rendered).toContain("Bulunamayan alanlar: Second Metric");
    expect(rendered).not.toContain("Kaynakta sorulan alanlar için tam değer bulunamadı");
  });

  it("suppresses generic caution on the low-grounding partial evidence bridge", () => {
    const rendered = renderSafetyFallback({
      answerSpec: genericFieldSpec({
        facts: ["Required Metric için kaynakta doğrulanmış kısa açıklama vardır."],
      }),
      answerPlan: genericFieldPlan({
        outputFormat: "bullets",
        constraints: {
          forbidCaution: true,
          noRawTableDump: true,
          sourceGroundedOnly: true,
          format: "bullets",
        },
      }),
      sources: [source],
      fallbackMode: "low_grounding",
    });

    expect(rendered).toContain("- Required Metric için kaynakta doğrulanmış kısa açıklama vardır.");
    expect(rendered).toContain("- Bulunamayan alanlar: Second Metric.");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered).not.toContain("risk koşulu");
  });

  it("keeps concise missing fallback when low-grounding field extraction has no usable facts", () => {
    const rendered = renderSafetyFallback({
      answerSpec: genericFieldSpec({
        facts: [],
      }),
      answerPlan: genericFieldPlan(),
      sources: [source],
      fallbackMode: "low_grounding",
    });

    expect(rendered).toBe("Kaynakta sorulan alanlar için tam değer bulunamadı: second_metric.");
  });

  it("keeps domain-safe field extraction on the cautious blocking fallback path", () => {
    const rendered = renderSafetyFallback({
      answerSpec: genericFieldSpec(),
      answerPlan: genericFieldPlan(),
      sources: [source],
      fallbackMode: "domain_safe",
    });

    expect(rendered).toContain("Required Metric kaynakta doğrulanmış");
    expect(rendered).toContain("Bulunamayan alanlar: Second Metric");
    expect(rendered).not.toContain("Ne zaman doktora");
  });
});
