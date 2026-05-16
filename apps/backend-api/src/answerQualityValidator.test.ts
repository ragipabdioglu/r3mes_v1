import { describe, expect, it } from "vitest";
import { validateAnswerQuality } from "./lib/answerQualityValidator.js";

describe("validateAnswerQuality", () => {
  it("flags required field values that are absent or unmapped", () => {
    const findings = validateAnswerQuality({
      answer: "511.801.109",
      sourceCount: 1,
      evidenceFactCount: 1,
      expectations: {
        requiredFieldValues: [{ fieldId: "net_donem_kari", label: "Net Dönem Kârı", value: "511.801.109" }],
      },
    });

    expect(findings.map((finding) => finding.bucket)).toContain("table_field_mismatch");
  });

  it("flags sourced answers that omit required values", () => {
    const findings = validateAnswerQuality({
      answer: "Kaynakta dönem kârı var.",
      sourceCount: 1,
      evidenceFactCount: 2,
      expectations: {
        requiredFieldValues: [{ fieldId: "net_donem_kari", value: "511.801.109" }],
      },
    });

    expect(findings.some((finding) => finding.bucket === "source_found_but_bad_answer" && finding.severity === "fail")).toBe(true);
  });

  it("flags over-aggressive no-source responses when evidence exists", () => {
    const findings = validateAnswerQuality({
      answer: "Kaynak bulunamad.",
      sourceCount: 1,
      evidenceBundleItemCount: 1,
      expectations: {},
    });

    expect(findings.map((finding) => finding.bucket)).toContain("over_aggressive_no_source");
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
