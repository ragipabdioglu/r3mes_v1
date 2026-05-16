import type { AnswerPlan } from "./answerPlan.js";
import type { ComposerInputConstraints } from "./composerInput.js";

export type SafetyPresentationAction =
  | "allow_caution"
  | "suppress_generic_caution"
  | "allow_blocking_safety_fallback";

export interface SafetyPresentationPolicy {
  action: SafetyPresentationAction;
  allowGenericCaution: boolean;
  allowRiskProse: boolean;
  allowedFallbackType: "none" | "missing_field" | "source_limited" | "blocking_safety";
  reason: string;
}

export function buildSafetyPresentationPolicy(opts: {
  answerPlan: AnswerPlan;
  constraints?: Partial<ComposerInputConstraints>;
  blockingRail?: boolean;
}): SafetyPresentationPolicy {
  if (opts.blockingRail === true) {
    return {
      action: "allow_blocking_safety_fallback",
      allowGenericCaution: true,
      allowRiskProse: true,
      allowedFallbackType: "blocking_safety",
      reason: "blocking_safety_rail",
    };
  }

  const forbidCaution = opts.constraints?.forbidCaution ?? opts.answerPlan.constraints.forbidCaution;
  const completeFieldCoverage =
    opts.answerPlan.taskType === "field_extraction" && opts.answerPlan.coverage === "complete";

  if (forbidCaution && completeFieldCoverage) {
    return {
      action: "suppress_generic_caution",
      allowGenericCaution: false,
      allowRiskProse: false,
      allowedFallbackType: "none",
      reason: "complete_field_coverage_forbids_caution",
    };
  }

  if (forbidCaution) {
    return {
      action: "suppress_generic_caution",
      allowGenericCaution: false,
      allowRiskProse: false,
      allowedFallbackType: opts.answerPlan.coverage === "none" ? "source_limited" : "missing_field",
      reason: "answer_constraints_forbid_caution",
    };
  }

  return {
    action: "allow_caution",
    allowGenericCaution: true,
    allowRiskProse: true,
    allowedFallbackType: opts.answerPlan.coverage === "none" ? "source_limited" : "missing_field",
    reason: "caution_allowed",
  };
}

export function shouldSuppressGenericCaution(policy: SafetyPresentationPolicy): boolean {
  return !policy.allowGenericCaution;
}
