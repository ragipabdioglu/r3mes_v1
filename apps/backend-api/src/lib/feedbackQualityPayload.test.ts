import { describe, expect, it } from "vitest";

import { normalizeFeedbackBadAnswerPayload } from "./feedbackQualityPayload.js";

describe("normalizeFeedbackBadAnswerPayload", () => {
  it("normalizes strict BAD_ANSWER quality payload fields", () => {
    expect(normalizeFeedbackBadAnswerPayload({
      qualityBucket: "raw_table_dump",
      safeQuery: "  EREGL net kar?  ",
      expectedAnswerTerms: ["511.801.109", "511.801.109", "SPK"],
      forbiddenAnswerTerms: ["Dikkat edilmesi gereken nokta"],
      requestedFields: ["net_donem_kari"],
      expectedOutputFormat: "short",
      maxLength: 24.9,
      badAnswerExcerptHash: "ABCDEF123456",
      answerText: "this is ignored by the normalizer",
    })).toEqual({
      qualityBucket: "raw_table_dump",
      safeQuery: "EREGL net kar?",
      expectedAnswerTerms: ["511.801.109", "SPK"],
      forbiddenAnswerTerms: ["Dikkat edilmesi gereken nokta"],
      requestedFields: ["net_donem_kari"],
      expectedOutputFormat: "short",
      maxLength: 24,
      badAnswerExcerptHash: "abcdef123456",
    });
  });

  it("accepts nested feedbackBadAnswerPayload metadata", () => {
    expect(normalizeFeedbackBadAnswerPayload({
      feedbackBadAnswerPayload: {
        qualityBucket: "table_field_mismatch",
        requiredFields: ["donem_kari"],
        requiredAnswerTerms: ["87.713.503.000"],
      },
    })).toEqual({
      qualityBucket: "table_field_mismatch",
      expectedAnswerTerms: ["87.713.503.000"],
      requestedFields: ["donem_kari"],
    });
  });

  it("rejects unknown quality buckets", () => {
    expect(normalizeFeedbackBadAnswerPayload({
      qualityBucket: "router_wrong_source",
      expectedAnswerTerms: ["SPK"],
    })).toBeNull();
  });

  it("rejects unknown output formats", () => {
    expect(normalizeFeedbackBadAnswerPayload({
      qualityBucket: "wrong_output_format",
      expectedOutputFormat: "markdown",
    })).toBeNull();
  });
});
