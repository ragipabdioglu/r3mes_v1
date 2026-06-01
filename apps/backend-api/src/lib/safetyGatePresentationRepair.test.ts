import { describe, expect, it } from "vitest";

import type { AnswerQualityFinding } from "./answerQualityValidator.js";
import { reconcileSafetyGateAfterPresentationRepair } from "./safetyGatePresentationRepair.js";
import type { SafetyGateResult } from "./safetyGate.js";

function safetyGate(overrides: Partial<SafetyGateResult> = {}): SafetyGateResult {
  return {
    pass: false,
    severity: "rewrite",
    blockedReasons: ["ANSWER_QUALITY_TABLE_FIELD_MISMATCH"],
    warnings: [],
    railChecks: [
      {
        id: "ANSWER_QUALITY_TABLE_FIELD_MISMATCH",
        category: "output",
        status: "rewrite",
        fallbackMode: "domain_safe",
        publicReason: "Answer quality field mismatch.",
      },
    ],
    requiredRewrite: true,
    fallbackMode: "domain_safe",
    safeFallback: "Fallback.",
    metrics: {
      sourceCount: 1,
      usableFactCount: 1,
      redFlagCount: 0,
      finalCandidateCount: null,
      answerLength: 12,
    },
    ...overrides,
  };
}

describe("reconcileSafetyGateAfterPresentationRepair", () => {
  it("passes when only answer-quality rails remain and repaired answer has no fail findings", () => {
    const result = reconcileSafetyGateAfterPresentationRepair({
      safetyGate: safetyGate(),
      repairedFindings: [],
    });

    expect(result.applied).toBe(true);
    expect(result.reason).toBe("repaired_answer_quality_only");
    expect(result.safetyGate.pass).toBe(true);
    expect(result.safetyGate.blockedReasons).toEqual([]);
    expect(result.safetyGate.requiredRewrite).toBe(false);
    expect(result.safetyGate.safeFallback).toBeUndefined();
  });

  it("does not pass mixed real safety rails with answer-quality rails", () => {
    const result = reconcileSafetyGateAfterPresentationRepair({
      safetyGate: safetyGate({
        blockedReasons: ["ANSWER_QUALITY_TABLE_FIELD_MISMATCH", "SOURCE_METADATA_MISMATCH"],
        railChecks: [
          {
            id: "ANSWER_QUALITY_TABLE_FIELD_MISMATCH",
            category: "output",
            status: "rewrite",
            fallbackMode: "domain_safe",
            publicReason: "Answer quality field mismatch.",
          },
          {
            id: "SOURCE_METADATA_MISMATCH",
            category: "privacy",
            status: "rewrite",
            fallbackMode: "privacy_safe",
            publicReason: "Source metadata mismatch.",
          },
        ],
      }),
      repairedFindings: [],
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("mixed_safety_rails");
    expect(result.safetyGate.pass).toBe(false);
    expect(result.safetyGate.blockedReasons).toContain("SOURCE_METADATA_MISMATCH");
  });

  it("does not pass when repaired answer still has fail findings", () => {
    const repairedFindings: AnswerQualityFinding[] = [
      {
        bucket: "raw_table_dump",
        severity: "fail",
        message: "answer still looks like a raw table dump",
      },
    ];
    const result = reconcileSafetyGateAfterPresentationRepair({
      safetyGate: safetyGate(),
      repairedFindings,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("repaired_answer_still_fails");
    expect(result.safetyGate.pass).toBe(false);
    expect(result.safetyGate.blockedReasons).toEqual(["ANSWER_QUALITY_TABLE_FIELD_MISMATCH"]);
  });
});
