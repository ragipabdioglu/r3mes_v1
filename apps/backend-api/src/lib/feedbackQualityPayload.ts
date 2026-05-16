import type { AnswerQualityBucket } from "./answerQualityValidator.js";

export type FeedbackExpectedOutputFormat = "short" | "bullets" | "table" | "freeform";

export interface FeedbackBadAnswerPayload {
  qualityBucket: AnswerQualityBucket;
  safeQuery?: string;
  expectedAnswerTerms?: string[];
  forbiddenAnswerTerms?: string[];
  requestedFields?: string[];
  expectedOutputFormat?: FeedbackExpectedOutputFormat;
  maxLength?: number;
  badAnswerExcerptHash?: string;
}

const QUALITY_BUCKETS = new Set<AnswerQualityBucket>([
  "incomplete_answer",
  "template_answer",
  "unnecessary_warning",
  "table_field_mismatch",
  "raw_table_dump",
  "ignored_user_constraint",
  "source_found_but_bad_answer",
  "over_aggressive_no_source",
  "answer_too_long",
  "wrong_output_format",
]);

const OUTPUT_FORMATS = new Set<FeedbackExpectedOutputFormat>(["short", "bullets", "table", "freeform"]);
const HASH_RE = /^[a-f0-9]{8,128}$/i;
const STRING_LIMIT = 500;
const ARRAY_LIMIT = 25;
const MAX_LENGTH_LIMIT = 2000;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeString(value: unknown, limit = STRING_LIMIT): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, limit).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of source.slice(0, ARRAY_LIMIT)) {
    const normalized = normalizeString(item);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out.length > 0 ? out : undefined;
}

function normalizeBucket(value: unknown): AnswerQualityBucket | null {
  const normalized = normalizeString(value, 80);
  if (!normalized || !QUALITY_BUCKETS.has(normalized as AnswerQualityBucket)) return null;
  return normalized as AnswerQualityBucket;
}

function normalizeFormat(value: unknown): FeedbackExpectedOutputFormat | null {
  const normalized = normalizeString(value, 40);
  if (!normalized || !OUTPUT_FORMATS.has(normalized as FeedbackExpectedOutputFormat)) return null;
  return normalized as FeedbackExpectedOutputFormat;
}

function payloadSource(value: unknown): Record<string, unknown> | null {
  const metadata = asObject(value);
  if (!metadata) return null;
  return asObject(metadata.feedbackBadAnswerPayload)
    ?? asObject(metadata.badAnswerQualityPayload)
    ?? asObject(metadata.qualityPayload)
    ?? metadata;
}

export function normalizeFeedbackBadAnswerPayload(value: unknown): FeedbackBadAnswerPayload | null {
  const source = payloadSource(value);
  if (!source) return null;

  const qualityBucket = normalizeBucket(source.qualityBucket);
  if (!qualityBucket) return null;

  const expectedOutputFormatValue = source.expectedOutputFormat;
  const expectedOutputFormat =
    expectedOutputFormatValue === undefined ? null : normalizeFormat(expectedOutputFormatValue);
  if (expectedOutputFormatValue !== undefined && !expectedOutputFormat) return null;

  const payload: FeedbackBadAnswerPayload = { qualityBucket };
  const safeQuery = normalizeString(source.safeQuery ?? source.evalQuery ?? source.redactedQuery);
  const expectedAnswerTerms = normalizeStringArray(source.expectedAnswerTerms ?? source.requiredAnswerTerms);
  const forbiddenAnswerTerms = normalizeStringArray(source.forbiddenAnswerTerms);
  const requestedFields = normalizeStringArray(source.requestedFields ?? source.requiredFields);
  const badAnswerExcerptHash = normalizeString(source.badAnswerExcerptHash, 128);
  const maxLength = Number(source.maxLength ?? source.maxWords ?? source.maxAnswerWords);

  if (safeQuery) payload.safeQuery = safeQuery;
  if (expectedAnswerTerms) payload.expectedAnswerTerms = expectedAnswerTerms;
  if (forbiddenAnswerTerms) payload.forbiddenAnswerTerms = forbiddenAnswerTerms;
  if (requestedFields) payload.requestedFields = requestedFields;
  if (expectedOutputFormat) payload.expectedOutputFormat = expectedOutputFormat;
  if (Number.isFinite(maxLength) && maxLength > 0) {
    payload.maxLength = Math.min(MAX_LENGTH_LIMIT, Math.floor(maxLength));
  }
  if (badAnswerExcerptHash && HASH_RE.test(badAnswerExcerptHash)) {
    payload.badAnswerExcerptHash = badAnswerExcerptHash.toLowerCase();
  }

  return payload;
}
