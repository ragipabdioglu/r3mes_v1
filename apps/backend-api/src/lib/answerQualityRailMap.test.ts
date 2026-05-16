import { describe, expect, it } from "vitest";

import { safetyRailsFromAnswerQuality } from "./answerQualityRailMap.js";

describe("answer quality rail map", () => {
  it("maps fail-level raw table dumps to safety rails", () => {
    expect(safetyRailsFromAnswerQuality([
      { bucket: "raw_table_dump", severity: "fail", message: "raw table" },
    ])).toEqual(["ANSWER_QUALITY_RAW_TABLE_DUMP"]);
  });

  it("maps fail-level table field mismatches to safety rails", () => {
    expect(safetyRailsFromAnswerQuality([
      { bucket: "table_field_mismatch", severity: "fail", message: "wrong field" },
    ])).toEqual(["ANSWER_QUALITY_TABLE_FIELD_MISMATCH"]);
  });

  it("does not map warn-level findings", () => {
    expect(safetyRailsFromAnswerQuality([
      { bucket: "template_answer", severity: "warn", message: "template phrase" },
    ])).toEqual([]);
  });
});
