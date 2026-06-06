import { EvalContractFailure } from "./errors.mjs";

export const EVAL_MODE_KEYS = Object.freeze([
  "answer",
  "evidence",
  "safety",
  "debug",
  "runtime",
]);

const DEFAULT_EVAL_MODES = Object.freeze({
  answer: true,
  evidence: true,
  safety: true,
  debug: true,
  runtime: true,
});

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function optionalBoolean(value, path) {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  throw new EvalContractFailure(`${path} must be a boolean`, {
    code: "eval_contract_invalid_boolean",
    path,
    details: { value },
  });
}

function optionalNonNegativeNumber(value, path) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  throw new EvalContractFailure(`${path} must be a non-negative number`, {
    code: "eval_contract_invalid_number",
    path,
    details: { value },
  });
}

function optionalString(value, path) {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new EvalContractFailure(`${path} must be a string`, {
      code: "eval_contract_invalid_string",
      path,
      details: { value },
    });
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalStringList(value, path) {
  if (value == null) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((item) => optionalString(item, path))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function assignIfPresent(target, key, value) {
  if (value !== undefined) target[key] = value;
}

export function normalizeEvalModes(input) {
  if (input == null) return { ...DEFAULT_EVAL_MODES };

  if (typeof input === "string") {
    const mode = input.trim().toLowerCase();
    if (mode === "all") return { ...DEFAULT_EVAL_MODES };
    if (mode === "none") {
      return Object.fromEntries(EVAL_MODE_KEYS.map((key) => [key, false]));
    }
    if (EVAL_MODE_KEYS.includes(mode)) {
      return { ...Object.fromEntries(EVAL_MODE_KEYS.map((key) => [key, false])), [mode]: true };
    }
    throw new EvalContractFailure(`Unknown eval mode: ${input}`, {
      code: "eval_contract_unknown_mode",
      path: "evalModes",
      details: { allowed: ["all", "none", ...EVAL_MODE_KEYS] },
    });
  }

  if (Array.isArray(input)) {
    const modes = Object.fromEntries(EVAL_MODE_KEYS.map((key) => [key, false]));
    for (const item of input) {
      const mode = optionalString(item, "evalModes")?.toLowerCase();
      if (!EVAL_MODE_KEYS.includes(mode)) {
        throw new EvalContractFailure(`Unknown eval mode: ${item}`, {
          code: "eval_contract_unknown_mode",
          path: "evalModes",
          details: { allowed: EVAL_MODE_KEYS },
        });
      }
      modes[mode] = true;
    }
    return modes;
  }

  if (!isPlainObject(input)) {
    throw new EvalContractFailure("evalModes must be a string, array, or object", {
      code: "eval_contract_invalid_modes",
      path: "evalModes",
      details: { value: input },
    });
  }

  const modes = { ...DEFAULT_EVAL_MODES };
  for (const [key, value] of Object.entries(input)) {
    if (!EVAL_MODE_KEYS.includes(key)) {
      throw new EvalContractFailure(`Unknown eval mode: ${key}`, {
        code: "eval_contract_unknown_mode",
        path: `evalModes.${key}`,
        details: { allowed: EVAL_MODE_KEYS },
      });
    }
    if (value != null) {
      modes[key] = optionalBoolean(value, `evalModes.${key}`);
    }
  }
  return modes;
}

export function normalizeEvidenceExpectations(input = {}) {
  if (!isPlainObject(input)) {
    throw new EvalContractFailure("evidenceExpectations must be an object", {
      code: "eval_contract_invalid_evidence_expectations",
      path: "evidenceExpectations",
      details: { value: input },
    });
  }

  const output = {};
  assignIfPresent(output, "mustHaveSources", optionalBoolean(input.mustHaveSources, "evidenceExpectations.mustHaveSources"));
  assignIfPresent(output, "minSources", optionalNonNegativeNumber(input.minSources, "evidenceExpectations.minSources"));
  assignIfPresent(output, "maxSources", optionalNonNegativeNumber(input.maxSources, "evidenceExpectations.maxSources"));
  assignIfPresent(output, "minEvidenceFacts", optionalNonNegativeNumber(input.minEvidenceFacts, "evidenceExpectations.minEvidenceFacts"));
  assignIfPresent(
    output,
    "minEvidenceBundleItemCount",
    optionalNonNegativeNumber(input.minEvidenceBundleItemCount, "evidenceExpectations.minEvidenceBundleItemCount"),
  );
  assignIfPresent(
    output,
    "expectedConfidence",
    optionalStringList(input.expectedConfidence ?? input.confidence, "evidenceExpectations.expectedConfidence"),
  );
  assignIfPresent(
    output,
    "expectedSourceTerms",
    optionalStringList(input.expectedSourceTerms, "evidenceExpectations.expectedSourceTerms"),
  );
  assignIfPresent(
    output,
    "requiredSourceTerms",
    optionalStringList(input.requiredSourceTerms, "evidenceExpectations.requiredSourceTerms"),
  );
  assignIfPresent(
    output,
    "expectedTitleTerms",
    optionalStringList(input.expectedTitleTerms, "evidenceExpectations.expectedTitleTerms"),
  );
  assignIfPresent(
    output,
    "requiredTitleTerms",
    optionalStringList(input.requiredTitleTerms, "evidenceExpectations.requiredTitleTerms"),
  );
  assignIfPresent(
    output,
    "requiredContextTerms",
    optionalStringList(input.requiredContextTerms, "evidenceExpectations.requiredContextTerms"),
  );
  assignIfPresent(
    output,
    "forbiddenContextTerms",
    optionalStringList(input.forbiddenContextTerms, "evidenceExpectations.forbiddenContextTerms"),
  );
  assignIfPresent(
    output,
    "requiredEvidenceTerms",
    optionalStringList(input.requiredEvidenceTerms ?? input.requiredTerms, "evidenceExpectations.requiredEvidenceTerms"),
  );
  assignIfPresent(
    output,
    "forbiddenEvidenceTerms",
    optionalStringList(input.forbiddenEvidenceTerms ?? input.forbiddenTerms, "evidenceExpectations.forbiddenEvidenceTerms"),
  );
  assignIfPresent(
    output,
    "requiredNotSupportedTerms",
    optionalStringList(input.requiredNotSupportedTerms, "evidenceExpectations.requiredNotSupportedTerms"),
  );
  assignIfPresent(
    output,
    "expectedEvidenceType",
    optionalString(input.expectedEvidenceType, "evidenceExpectations.expectedEvidenceType"),
  );
  assignIfPresent(
    output,
    "requiredEvidenceType",
    optionalString(input.requiredEvidenceType, "evidenceExpectations.requiredEvidenceType"),
  );
  assignIfPresent(
    output,
    "allowedEvidenceTypes",
    optionalStringList(input.allowedEvidenceTypes, "evidenceExpectations.allowedEvidenceTypes"),
  );
  assignIfPresent(
    output,
    "expectedCompiledEvidenceConfidence",
    optionalString(input.expectedCompiledEvidenceConfidence, "evidenceExpectations.expectedCompiledEvidenceConfidence"),
  );
  assignIfPresent(
    output,
    "minCompiledEvidenceContradictionCount",
    optionalNonNegativeNumber(
      input.minCompiledEvidenceContradictionCount,
      "evidenceExpectations.minCompiledEvidenceContradictionCount",
    ),
  );
  return output;
}

export function normalizeAnswerExpectations(input = {}) {
  if (!isPlainObject(input)) {
    throw new EvalContractFailure("answerExpectations must be an object", {
      code: "eval_contract_invalid_answer_expectations",
      path: "answerExpectations",
      details: { value: input },
    });
  }

  const output = {};
  assignIfPresent(
    output,
    "requiredConcepts",
    optionalStringList(input.requiredConcepts, "answerExpectations.requiredConcepts"),
  );
  assignIfPresent(
    output,
    "requiredAnswerTerms",
    optionalStringList(input.requiredAnswerTerms ?? input.requiredTerms, "answerExpectations.requiredAnswerTerms"),
  );
  assignIfPresent(
    output,
    "forbiddenAnswerTerms",
    optionalStringList(input.forbiddenAnswerTerms, "answerExpectations.forbiddenAnswerTerms"),
  );
  assignIfPresent(
    output,
    "forbiddenTerms",
    optionalStringList(input.forbiddenTerms, "answerExpectations.forbiddenTerms"),
  );
  assignIfPresent(output, "maxAnswerWords", optionalNonNegativeNumber(input.maxWords ?? input.maxAnswerWords, "answerExpectations.maxWords"));
  assignIfPresent(output, "maxAnswerChars", optionalNonNegativeNumber(input.maxChars ?? input.maxAnswerChars, "answerExpectations.maxChars"));
  assignIfPresent(
    output,
    "mustNotHaveLowLanguageQuality",
    optionalBoolean(input.mustNotHaveLowLanguageQuality, "answerExpectations.mustNotHaveLowLanguageQuality"),
  );
  assignIfPresent(
    output,
    "mustNotUseGenericCaution",
    optionalBoolean(input.mustNotUseGenericCaution, "answerExpectations.mustNotUseGenericCaution"),
  );
  return output;
}
