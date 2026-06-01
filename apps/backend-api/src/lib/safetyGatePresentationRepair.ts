import type { AnswerQualityFinding } from "./answerQualityValidator.js";
import type { SafetyGateResult } from "./safetyGate.js";

export interface SafetyGatePresentationRepairResult {
  safetyGate: SafetyGateResult;
  applied: boolean;
  reason:
    | "repaired_answer_quality_only"
    | "no_blocked_reasons"
    | "mixed_safety_rails"
    | "repaired_answer_still_fails";
}

function isAnswerQualityRail(reason: string): boolean {
  return reason.startsWith("ANSWER_QUALITY_");
}

function hasFailFinding(findings: AnswerQualityFinding[]): boolean {
  return findings.some((finding) => finding.severity === "fail");
}

export function reconcileSafetyGateAfterPresentationRepair(input: {
  safetyGate: SafetyGateResult;
  repairedFindings: AnswerQualityFinding[];
}): SafetyGatePresentationRepairResult {
  const blockedReasons = input.safetyGate.blockedReasons;
  if (blockedReasons.length === 0) {
    return { safetyGate: input.safetyGate, applied: false, reason: "no_blocked_reasons" };
  }

  if (!blockedReasons.every(isAnswerQualityRail)) {
    return { safetyGate: input.safetyGate, applied: false, reason: "mixed_safety_rails" };
  }

  if (hasFailFinding(input.repairedFindings)) {
    return { safetyGate: input.safetyGate, applied: false, reason: "repaired_answer_still_fails" };
  }

  const railChecks = input.safetyGate.railChecks.filter((check) => !isAnswerQualityRail(check.id));
  const warnings = input.safetyGate.warnings.filter((warning) => !isAnswerQualityRail(warning));
  return {
    safetyGate: {
      ...input.safetyGate,
      pass: true,
      severity: warnings.length > 0 ? "warn" : "pass",
      blockedReasons: [],
      warnings,
      railChecks,
      requiredRewrite: false,
      fallbackMode: undefined,
      safeFallback: undefined,
    },
    applied: true,
    reason: "repaired_answer_quality_only",
  };
}
