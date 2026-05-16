import type { AnswerPlan } from "./answerPlan.js";
import type { AnswerQualityFinding } from "./answerQualityValidator.js";
import type { EvidenceBundleDiagnostics } from "./evidenceBundle.js";
import type { SafetyGateResult } from "./safetyGate.js";

export const EVAL_DEBUG_CONTRACT_VERSION = "2026-05-section-04" as const;

export interface EvalDebugContract {
  version: typeof EVAL_DEBUG_CONTRACT_VERSION;
  safetyGate?: SafetyGateResult;
  answerQuality?: {
    findings: AnswerQualityFinding[];
    passed: boolean;
  };
  answerPlan?: AnswerPlan;
  evidenceSignals?: unknown;
  evidenceBundleDiagnostics?: EvidenceBundleDiagnostics | null;
  sourceSelection?: unknown;
  retrievalDebug?: unknown;
}

export function buildEvalDebugContract(input: {
  safetyGate?: SafetyGateResult;
  answerQualityFindings?: AnswerQualityFinding[];
  answerPlan?: AnswerPlan;
  evidenceSignals?: unknown;
  evidenceBundleDiagnostics?: EvidenceBundleDiagnostics | null;
  sourceSelection?: unknown;
  retrievalDebug?: unknown;
}): EvalDebugContract {
  const findings = input.answerQualityFindings ?? [];
  return {
    version: EVAL_DEBUG_CONTRACT_VERSION,
    safetyGate: input.safetyGate,
    answerQuality: {
      findings,
      passed: findings.every((finding) => finding.severity !== "fail"),
    },
    answerPlan: input.answerPlan,
    evidenceSignals: input.evidenceSignals,
    evidenceBundleDiagnostics: input.evidenceBundleDiagnostics ?? null,
    sourceSelection: input.sourceSelection,
    retrievalDebug: input.retrievalDebug,
  };
}
