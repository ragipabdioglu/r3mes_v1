import { describe, expect, it } from "vitest";

import { buildAnswerPlan } from "./answerPlan.js";
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
});
