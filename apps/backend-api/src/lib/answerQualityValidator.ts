export type AnswerQualityBucket =
  | "incomplete_answer"
  | "template_answer"
  | "unnecessary_warning"
  | "table_field_mismatch"
  | "raw_table_dump"
  | "ignored_user_constraint"
  | "source_found_but_bad_answer"
  | "over_aggressive_no_source"
  | "answer_too_long"
  | "wrong_output_format";

export interface AnswerQualityFinding {
  bucket: AnswerQualityBucket;
  severity: "warn" | "fail";
  message: string;
}

export interface RequiredFieldValueExpectation {
  fieldId?: string;
  label?: string;
  value: string;
}

export interface AnswerQualityExpectations {
  maxWords?: number;
  requiredAnswerTerms?: string[];
  forbiddenAnswerTerms?: string[];
  requiredFields?: string[];
  requiredFieldValues?: RequiredFieldValueExpectation[];
  forbiddenBuckets?: AnswerQualityBucket[];
  forbidCaution?: boolean;
  noRawTableDump?: boolean;
  format?: "bullets" | "short" | "table" | "freeform";
  maxSentences?: number;
}

export interface AnswerQualityPlanTrace {
  taskType?: string;
  coverage?: string;
  diagnostics?: {
    missingFieldIds?: string[];
    selectedFactCount?: number;
  };
  requestedFields?: Array<{ id?: string; fieldId?: string; label?: string }>;
  selectedFacts?: Array<{ field?: string; fieldId?: string; value?: string }>;
}

export interface ValidateAnswerQualityInput {
  answer: string;
  query?: string;
  expectations?: AnswerQualityExpectations;
  answerPlan?: AnswerQualityPlanTrace | null;
  sourceCount?: number;
  evidenceFactCount?: number;
  evidenceBundleItemCount?: number;
  noSourceExpected?: boolean;
}

function normalize(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}-]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function wordCount(value: string): number {
  return tokenize(value).length;
}

function includesTerm(text: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return true;
  if (normalizedTerm.length <= 3 && !normalizedTerm.includes(" ")) {
    return new Set(tokenize(text)).has(normalizedTerm);
  }
  return normalize(text).includes(normalizedTerm);
}

function missingTerms(text: string, terms: string[] | undefined): string[] {
  return (terms ?? []).filter((term) => !includesTerm(text, term));
}

function presentTerms(text: string, terms: string[] | undefined): string[] {
  return (terms ?? []).filter((term) => includesTerm(text, term));
}

function answerLooksLikeNoSource(answer: string): boolean {
  const normalized = normalize(answer);
  return (
    normalized.includes("kaynak yok") ||
    normalized.includes("kaynak bulunamad") ||
    normalized.includes("kaynaklarda bulunamad") ||
    normalized.includes("ilgili kaynak bulunamad") ||
    normalized.includes("no source") ||
    normalized.includes("not found in the source")
  );
}

function answerLooksTemplated(answer: string): boolean {
  return presentTerms(answer, [
    "Dikkat edilmesi gereken nokta",
    "Kaynakta özel alarm",
    "Kaynakta açık dayanak yoksa",
    "Bu yanıt genel bilgilendirme amaçlıdır",
    "Karar vermeden önce güncel ve yetkili kaynakla doğrulama yapın",
  ]).length > 0;
}

function answerLooksLikeRawTableDump(answer: string): boolean {
  return [
    /\|[^|\n]{1,80}\|[^|\n]{1,80}\|/u,
    /(?:\d[\d.,-]*\s+){5,}/u,
    /\b(?:SPK'?ya Göre|Yasal Kayıtlara Göre).{80,}/iu,
    /(?:\t[^\n]{1,80}){3,}/u,
  ].some((pattern) => pattern.test(answer));
}

function selectedFieldIds(answerPlan: AnswerQualityPlanTrace | null | undefined): string[] {
  const selected = answerPlan?.selectedFacts ?? [];
  return selected
    .map((fact) => fact.fieldId ?? fact.field)
    .filter((field): field is string => Boolean(field))
    .map(normalize);
}

function planMissingFieldIds(answerPlan: AnswerQualityPlanTrace | null | undefined): string[] {
  const missing = answerPlan?.diagnostics?.missingFieldIds;
  return Array.isArray(missing) ? missing.map(normalize) : [];
}

function missingRequiredFields(
  requiredFields: string[] | undefined,
  answerPlan: AnswerQualityPlanTrace | null | undefined,
): string[] {
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) return [];
  if (!answerPlan) return requiredFields;
  const missingInPlan = new Set(planMissingFieldIds(answerPlan));
  const selected = new Set(selectedFieldIds(answerPlan));
  if (answerPlan.coverage === "complete" && missingInPlan.size === 0) return [];
  return requiredFields.filter((field) => {
    const normalizedField = normalize(field);
    if (missingInPlan.has(normalizedField)) return true;
    return selected.size > 0 ? !selected.has(normalizedField) : false;
  });
}

function pushFinding(
  findings: AnswerQualityFinding[],
  bucket: AnswerQualityBucket,
  severity: AnswerQualityFinding["severity"],
  message: string,
): void {
  findings.push({ bucket, severity, message });
}

export function validateAnswerQuality(input: ValidateAnswerQualityInput): AnswerQualityFinding[] {
  const expectations = input.expectations ?? {};
  const findings: AnswerQualityFinding[] = [];
  const answer = input.answer ?? "";
  const words = wordCount(answer);

  if (Number.isFinite(Number(expectations.maxWords)) && words > Number(expectations.maxWords)) {
    pushFinding(findings, "answer_too_long", "fail", `answer has ${words} words, max ${Number(expectations.maxWords)}`);
  }

  const missingAnswerTerms = missingTerms(answer, expectations.requiredAnswerTerms);
  if (missingAnswerTerms.length > 0) {
    pushFinding(findings, "incomplete_answer", "fail", `missing answer terms: ${missingAnswerTerms.join(",")}`);
  }

  const forbiddenAnswerTerms = presentTerms(answer, expectations.forbiddenAnswerTerms);
  if (forbiddenAnswerTerms.length > 0) {
    pushFinding(findings, "template_answer", "fail", `forbidden answer terms: ${forbiddenAnswerTerms.join(",")}`);
  }

  if (answerLooksTemplated(answer)) {
    pushFinding(findings, "template_answer", "warn", "answer contains a generic/template safety phrase");
  }

  if (expectations.forbidCaution === true) {
    const cautionTerms = presentTerms(answer, [
      "Dikkat edilmesi gereken",
      "Dikkat:",
      "Riskler:",
      "Kaynakta özel alarm",
      "yatırım tavsiyesi",
      "risk koşulu",
    ]);
    if (cautionTerms.length > 0) {
      pushFinding(findings, "unnecessary_warning", "fail", `unnecessary caution terms: ${cautionTerms.join(",")}`);
    }
  }

  if (expectations.noRawTableDump === true && answerLooksLikeRawTableDump(answer)) {
    pushFinding(findings, "raw_table_dump", "fail", "answer looks like a raw table row dump");
  }

  if (expectations.format === "bullets") {
    const bulletLines = answer.split(/\r?\n/).filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/u.test(line));
    if (bulletLines.length === 0) {
      pushFinding(findings, "wrong_output_format", "fail", "expected bullet/list formatted answer");
    }
  }

  if (expectations.format === "short" && Number.isFinite(Number(expectations.maxSentences))) {
    const sentenceCount = answer.split(/[.!?]+/u).map((part) => part.trim()).filter(Boolean).length;
    if (sentenceCount > Number(expectations.maxSentences)) {
      pushFinding(findings, "wrong_output_format", "fail", `answer has ${sentenceCount} sentences`);
    }
  }

  const missingFields = missingRequiredFields(expectations.requiredFields, input.answerPlan);
  if (missingFields.length > 0) {
    pushFinding(findings, "table_field_mismatch", "fail", `missing required fields in answer plan: ${missingFields.join(",")}`);
  }

  for (const expected of expectations.requiredFieldValues ?? []) {
    if (!includesTerm(answer, expected.value)) {
      pushFinding(
        findings,
        "source_found_but_bad_answer",
        "fail",
        `missing required field value${expected.fieldId ? ` for ${expected.fieldId}` : ""}: ${expected.value}`,
      );
      continue;
    }
    if (expected.label && !includesTerm(answer, expected.label)) {
      pushFinding(
        findings,
        "table_field_mismatch",
        "fail",
        `value ${expected.value} appears without expected field label: ${expected.label}`,
      );
    }
  }

  if ((input.sourceCount ?? 0) > 0 && ((input.evidenceFactCount ?? 0) > 0 || (input.evidenceBundleItemCount ?? 0) > 0)) {
    if (answerLooksLikeNoSource(answer)) {
      pushFinding(findings, "over_aggressive_no_source", "fail", "answer says no source despite available source/evidence");
    }
    if (missingAnswerTerms.length > 0 || (expectations.requiredFieldValues ?? []).some((expected) => !includesTerm(answer, expected.value))) {
      pushFinding(findings, "source_found_but_bad_answer", "fail", "source/evidence exists but required answer content is missing");
    }
  }

  if (input.noSourceExpected === true && !answerLooksLikeNoSource(answer) && (input.sourceCount ?? 0) === 0) {
    pushFinding(findings, "ignored_user_constraint", "warn", "no-source response was expected but answer did not clearly say source is unavailable");
  }

  const forbiddenBuckets = new Set(expectations.forbiddenBuckets ?? []);
  return findings.map((finding) => forbiddenBuckets.has(finding.bucket) ? { ...finding, severity: "fail" } : finding);
}
