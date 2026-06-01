import { describe, expect, it } from "vitest";
import type { QueryContract } from "@r3mes/shared-types";

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

  it("aligns with an explicit QueryContract without changing legacy callers", () => {
    const queryContract: QueryContract = {
      operation: "extract_fields",
      requiredEvidenceType: "source_and_structured_fields",
      outputFormat: "table",
      outputConstraints: {
        maxWords: 48,
        maxSentencesPerBullet: 1,
        forbidCaution: true,
        noRawTableDump: true,
        format: "table",
        sourceGroundedOnly: true,
      },
      sourceOnly: true,
      requestedFields: [
        {
          id: "primary_measure",
          label: "Primary Measure",
          required: true,
          outputHint: "number",
          confidence: "high",
        },
        {
          id: "secondary_measure",
          label: "Secondary Measure",
          required: true,
          outputHint: "number",
          confidence: "medium",
        },
      ],
      forbiddenAdditions: ["source_external_inference", "raw_table_dump"],
      queryQuality: {
        shape: "normal",
        clarityScore: 80,
        tokenCount: 6,
        expandedTokenCount: 6,
        conceptCount: 0,
        profileConceptCount: 0,
        weakSignalCount: 2,
      },
    };

    const plan = buildAnswerPlan(
      baseSpec({
        userQuery: "Kaynağa göre sadece istenen alanları tablo olarak yanıtla.",
        structuredFacts: [
          {
            id: "sf-generic-1",
            kind: "table_row",
            sourceId: "source-generic",
            field: "Primary Measure",
            value: "42",
            confidence: "high",
            provenance: {
              quote: "Primary Measure 42",
              extractor: "table-numeric-v1",
            },
          },
        ],
      }),
      { queryContract },
    );

    expect(plan.taskType).toBe("field_extraction");
    expect(plan.outputFormat).toBe(queryContract.outputFormat);
    expect(plan.constraints).toEqual(queryContract.outputConstraints);
    expect(plan.requestedFields.map((field) => field.id)).toEqual(["primary_measure", "secondary_measure"]);
    expect(plan.forbiddenAdditions).toEqual(queryContract.forbiddenAdditions);
    expect(plan.selectedFacts.map((fact) => fact.id)).toEqual(["sf-generic-1"]);
    expect(plan.coverage).toBe("partial");
    expect(plan.diagnostics).toMatchObject({
      requestedFieldCount: 2,
      selectedFactCount: 1,
      missingFieldIds: ["secondary_measure"],
    });
    expect(plan.requiresModelSynthesis).toBe(true);
  });

  it("uses existing table structured facts for table-shaped field requests without literal field matches", () => {
    const queryContract: QueryContract = {
      operation: "extract_fields",
      requiredEvidenceType: "source_and_structured_fields",
      outputFormat: "bullets",
      outputConstraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
        format: "bullets",
      },
      sourceOnly: true,
      requestedFields: [
        {
          id: "amounts",
          label: "amounts",
          required: true,
          outputHint: "table",
          confidence: "medium",
        },
        {
          id: "rates",
          label: "rates",
          required: true,
          outputHint: "table",
          confidence: "medium",
        },
      ],
      forbiddenAdditions: ["raw_table_dump"],
      queryQuality: {
        shape: "normal",
        clarityScore: 75,
        tokenCount: 5,
        expandedTokenCount: 5,
        conceptCount: 0,
        profileConceptCount: 0,
        weakSignalCount: 1,
      },
    };

    const plan = buildAnswerPlan(
      baseSpec({
        userQuery: "Kaynağa göre tutar ve oran satırlarını maddelerle ver.",
        structuredFacts: [
          {
            id: "sf-table-a",
            kind: "table_row",
            sourceId: "source-generic",
            field: "First Grouped Numeric Values",
            value: "100 / 10,00",
            confidence: "high",
            table: {
              rowLabel: "First Group",
              rawRow: "First Group 100 10,00",
            },
            provenance: {
              quote: "First Group 100 10,00",
              extractor: "generic-table-row-v1",
            },
          },
          {
            id: "sf-table-b",
            kind: "table_row",
            sourceId: "source-generic",
            field: "Second Grouped Numeric Values",
            value: "200 / 20,00",
            confidence: "medium",
            table: {
              rowLabel: "Second Group",
              rawRow: "Second Group 200 20,00",
            },
            provenance: {
              quote: "Second Group 200 20,00",
              extractor: "generic-table-row-v1",
            },
          },
        ],
      }),
      { queryContract },
    );

    expect(plan.selectedFacts.map((fact) => fact.id)).toEqual(["sf-table-a", "sf-table-b"]);
    expect(plan.diagnostics.missingFieldIds).toEqual([]);
    expect(plan.coverage).toBe("complete");
    expect(plan.requiresModelSynthesis).toBe(false);
  });
});
