import { describe, expect, it } from "vitest";

import { buildAnswerPlan } from "./answerPlan.js";
import type { AnswerSpec } from "./answerSpec.js";

function baseSpec(overrides: Partial<AnswerSpec> = {}): AnswerSpec {
  return {
    answerDomain: "finance",
    answerIntent: "explain",
    groundingConfidence: "high",
    userQuery:
      "EREGL kar payında dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler nedir? Sadece rakamları kısa maddelerle yaz, risk yorumu ekleme.",
    tone: "direct",
    sections: ["assessment", "action", "summary"],
    assessment: "Kaynakta ilgili KAP tablo satırları var.",
    action: "Sadece sorulan tablo değerleri yazılmalıdır.",
    caution: [],
    summary: "Sorulan alanlar KAP tablosundan alınmalıdır.",
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
    ...overrides,
  };
}

describe("buildAnswerPlan", () => {
  it("plans requested field extraction with coverage diagnostics", () => {
    const plan = buildAnswerPlan(baseSpec());

    expect(plan.taskType).toBe("field_extraction");
    expect(plan.outputFormat).toBe("bullets");
    expect(plan.constraints.forbidCaution).toBe(true);
    expect(plan.constraints.noRawTableDump).toBe(true);
    expect(plan.coverage).toBe("partial");
    expect(plan.selectedFacts).toHaveLength(1);
    expect(plan.diagnostics.missingFieldIds).toContain("olaganustu_yedekler");
    expect(plan.requiresModelSynthesis).toBe(true);
  });

  it("allows deterministic composition when all requested fields are covered", () => {
    const plan = buildAnswerPlan(
      baseSpec({
        structuredFacts: [
          ...(baseSpec().structuredFacts ?? []),
          {
            id: "sf-2",
            kind: "table_row",
            sourceId: "kap-doc",
            field: "Olağanüstü Yedekler",
            value: "3.352.908.083 / 3.850.000.000",
            confidence: "high",
            provenance: {
              quote: "Olağanüstü Yedekler 3.352.908.083 3.850.000.000",
              extractor: "table-numeric-v1",
            },
          },
        ],
      }),
    );

    expect(plan.coverage).toBe("complete");
    expect(plan.requiresModelSynthesis).toBe(false);
  });
});
