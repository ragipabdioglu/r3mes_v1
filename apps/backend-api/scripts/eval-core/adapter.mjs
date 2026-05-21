import {
  normalizeAnswerExpectations,
  normalizeEvalModes,
  normalizeEvidenceExpectations,
} from "./normalizers.mjs";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasV2Fields(testCase) {
  return (
    Object.hasOwn(testCase, "evalModes") ||
    Object.hasOwn(testCase, "evidenceExpectations") ||
    Object.hasOwn(testCase, "answerExpectations")
  );
}

function mergeWithoutOverwriting(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined) target[key] = value;
  }
  return target;
}

export function normalizeEvalContractV2(testCase) {
  if (!isPlainObject(testCase)) {
    throw new TypeError("Eval case must be an object");
  }
  return {
    evalModes: normalizeEvalModes(testCase.evalModes),
    evidenceExpectations: normalizeEvidenceExpectations(testCase.evidenceExpectations ?? {}),
    answerExpectations: normalizeAnswerExpectations(testCase.answerExpectations ?? {}),
  };
}

export function adaptEvalCaseForRunner(testCase) {
  if (!isPlainObject(testCase) || !hasV2Fields(testCase)) return testCase;

  const normalized = normalizeEvalContractV2(testCase);
  const adapted = { ...testCase };

  if (normalized.evalModes.evidence) {
    mergeWithoutOverwriting(adapted, normalized.evidenceExpectations);
  }
  if (normalized.evalModes.answer) {
    mergeWithoutOverwriting(adapted, normalized.answerExpectations);
  }

  adapted._evalContractV2 = normalized;
  return adapted;
}

export function adaptEvalCasesForRunner(testCases) {
  if (!Array.isArray(testCases)) {
    throw new TypeError("Eval cases must be an array");
  }
  return testCases.map((testCase) => adaptEvalCaseForRunner(testCase));
}
