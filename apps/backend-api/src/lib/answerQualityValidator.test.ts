import { describe, expect, it } from "vitest";

import { validateAnswerQuality, type AnswerQualityPlanTrace } from "./answerQualityValidator.js";

function partialPlan(overrides: Partial<AnswerQualityPlanTrace> = {}): AnswerQualityPlanTrace {
  return {
    taskType: "field_extraction",
    coverage: "partial",
    diagnostics: {
      missingFieldIds: ["second_metric"],
      selectedFactCount: 0,
    },
    requestedFields: [
      { id: "required_metric", label: "Required Metric" },
      { id: "second_metric", label: "Second Metric" },
    ],
    selectedFacts: [{ fieldId: "required_metric", value: "Available value" }],
    ...overrides,
  };
}

function failBuckets(answer: string, opts: {
  plan?: AnswerQualityPlanTrace;
  requiredAnswerTerms?: string[];
  requiredFieldValues?: Array<{ fieldId?: string; label?: string; value: string }>;
  evidenceFactCount?: number;
} = {}): string[] {
  return validateAnswerQuality({
    answer,
    expectations: {
      requiredFields: ["required_metric", "second_metric"],
      requiredAnswerTerms: opts.requiredAnswerTerms,
      requiredFieldValues: opts.requiredFieldValues,
    },
    answerPlan: opts.plan ?? partialPlan(),
    evidenceFactCount: opts.evidenceFactCount ?? 1,
    sourceCount: 1,
  })
    .filter((finding) => finding.severity === "fail")
    .map((finding) => finding.bucket);
}

describe("validateAnswerQuality partial missing field disclosure", () => {
  it("does not fail table_field_mismatch when partial evidence answer discloses missing fields", () => {
    const buckets = failBuckets("Required Metric kaynakta doğrulanmış değer olarak geçiyor. Bulunamayan alanlar: Second Metric.");

    expect(buckets).not.toContain("table_field_mismatch");
  });

  it("keeps table_field_mismatch when partial answer does not disclose missing fields", () => {
    const buckets = failBuckets("Required Metric kaynakta doğrulanmış değer olarak geçiyor.");

    expect(buckets).toContain("table_field_mismatch");
  });

  it("keeps incomplete_answer when required answer terms are missing even with disclosure", () => {
    const buckets = failBuckets(
      "Required Metric kaynakta doğrulanmış değer olarak geçiyor. Bulunamayan alanlar: Second Metric.",
      { requiredAnswerTerms: ["Required Metric", "Required Term"] },
    );

    expect(buckets).toContain("incomplete_answer");
  });

  it("keeps required field value failures even with missing-field disclosure", () => {
    const buckets = failBuckets(
      "Required Metric kaynakta doğrulanmış değer olarak geçiyor. Bulunamayan alanlar: Second Metric.",
      {
        requiredFieldValues: [
          {
            fieldId: "required_metric",
            label: "Required Metric",
            value: "Expected Value",
          },
        ],
      },
    );

    expect(buckets).toContain("source_found_but_bad_answer");
  });
});
