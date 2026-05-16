import type { AnswerQualityBucket, AnswerQualityFinding } from "./answerQualityValidator.js";
import type { SafetyRailId } from "./safetyRailRegistry.js";

const FAIL_BUCKET_RAILS: Partial<Record<AnswerQualityBucket, SafetyRailId>> = {
  incomplete_answer: "ANSWER_QUALITY_INCOMPLETE",
  template_answer: "ANSWER_QUALITY_TEMPLATE",
  unnecessary_warning: "ANSWER_QUALITY_UNNECESSARY_WARNING",
  table_field_mismatch: "ANSWER_QUALITY_TABLE_FIELD_MISMATCH",
  raw_table_dump: "ANSWER_QUALITY_RAW_TABLE_DUMP",
  ignored_user_constraint: "ANSWER_QUALITY_IGNORED_CONSTRAINT",
  source_found_but_bad_answer: "ANSWER_QUALITY_SOURCE_FOUND_BAD_ANSWER",
  answer_too_long: "ANSWER_QUALITY_TOO_LONG",
  wrong_output_format: "ANSWER_QUALITY_WRONG_FORMAT",
};

export function safetyRailsFromAnswerQuality(findings: AnswerQualityFinding[] | null | undefined): SafetyRailId[] {
  const rails: SafetyRailId[] = [];
  const seen = new Set<SafetyRailId>();
  for (const finding of findings ?? []) {
    if (finding.severity !== "fail") continue;
    const railId = FAIL_BUCKET_RAILS[finding.bucket];
    if (!railId || seen.has(railId)) continue;
    seen.add(railId);
    rails.push(railId);
  }
  return rails;
}
