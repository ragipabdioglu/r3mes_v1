import { describe, expect, it } from "vitest";
import { validateAnswerQuality } from "./lib/answerQualityValidator.js";

describe("validateAnswerQuality", () => {
  it("flags required field values that appear without their expected labels", () => {
    const findings = validateAnswerQuality({
      answer: "42 units",
      sourceCount: 1,
      evidenceFactCount: 1,
      expectations: {
        requiredFieldValues: [{ fieldId: "item_count", label: "Item count", value: "42 units" }],
      },
    });

    expect(findings.map((finding) => finding.bucket)).toContain("table_field_mismatch");
  });

  it("flags source_found_but_bad_answer when sourced answers omit required values", () => {
    const findings = validateAnswerQuality({
      answer: "The source describes the requested metric but does not include the final value.",
      sourceCount: 1,
      evidenceFactCount: 2,
      expectations: {
        requiredFieldValues: [{ fieldId: "requested_metric", value: "42 units" }],
      },
    });

    expect(findings.some((finding) => finding.bucket === "source_found_but_bad_answer" && finding.severity === "fail")).toBe(true);
  });

  it("matches required answer terms with accent-insensitive normalization", () => {
    const findings = validateAnswerQuality({
      answer: "Kaynağa göre buna Yapay Zeka denir.",
      sourceCount: 1,
      evidenceFactCount: 1,
      expectations: {
        requiredAnswerTerms: ["Yapay Zekâ"],
      },
    });

    expect(findings.map((finding) => finding.bucket)).not.toContain("incomplete_answer");
  });

  it("flags over_aggressive_no_source when an answer denies available evidence", () => {
    const findings = validateAnswerQuality({
      answer: "No source was found for this request.",
      sourceCount: 1,
      evidenceBundleItemCount: 1,
      expectations: {},
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        bucket: "over_aggressive_no_source",
        severity: "fail",
      }),
    );
  });

  it("flags template_answer and unnecessary_warning for generic caution boilerplate", () => {
    const findings = validateAnswerQuality({
      answer: "This answer is for general informational purposes only. Please verify with a current authoritative source.",
      expectations: {
        forbidCaution: true,
        forbiddenAnswerTerms: ["general informational purposes only"],
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: "template_answer", severity: "fail" }),
        expect.objectContaining({ bucket: "unnecessary_warning", severity: "fail" }),
      ]),
    );
  });

  it("flags raw_table_dump for unprocessed table-like rows", () => {
    const findings = validateAnswerQuality({
      answer: "Metric A\t10\t20\t30\t40",
      expectations: {
        noRawTableDump: true,
      },
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        bucket: "raw_table_dump",
        severity: "fail",
      }),
    );
  });

  it("flags wrong_output_format when bullets are required but prose is returned", () => {
    const findings = validateAnswerQuality({
      answer: "The answer is written as a single prose sentence instead of a list.",
      expectations: {
        format: "bullets",
      },
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        bucket: "wrong_output_format",
        severity: "fail",
      }),
    );
  });

  it("keeps legacy presentation checks deterministic", () => {
    const findings = validateAnswerQuality({
      answer: "Dikkat edilmesi gereken nokta: 1 2 3 4 5 6 7 8 9 10",
      expectations: {
        forbidCaution: true,
        noRawTableDump: true,
        maxWords: 5,
        forbiddenBuckets: ["template_answer"],
      },
    });

    expect(findings.map((finding) => finding.bucket)).toEqual(
      expect.arrayContaining(["answer_too_long", "template_answer", "unnecessary_warning", "raw_table_dump"]),
    );
    expect(findings.find((finding) => finding.bucket === "template_answer")?.severity).toBe("fail");
  });
});
