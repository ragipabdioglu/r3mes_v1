import type { ChatSourceCitation } from "@r3mes/shared-types";

import type { AnswerSpec } from "./answerSpec.js";
import type { AnswerPlan, AnswerPlanCoverage } from "./answerPlan.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { countUsableEvidenceItems } from "./evidenceBundle.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

export interface SafetyEvidenceSignals {
  legacyUsableFactCount: number;
  usableEvidenceBundleItemCount: number;
  selectedStructuredFactCount: number;
  requestedFieldCount: number;
  coveredRequestedFieldCount: number;
  answerPlanCoverage: AnswerPlanCoverage;
  sourceCount: number;
  retrievalWasUsed: boolean;
}

export interface BuildSafetyEvidenceSignalsInput {
  answerSpec?: AnswerSpec;
  answerPlan?: AnswerPlan | null;
  evidenceBundle?: EvidenceBundle | null;
  evidence?: EvidenceExtractorOutput | null;
  sources?: ChatSourceCitation[];
  retrievalWasUsed: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function selectedStructuredFactCount(input: BuildSafetyEvidenceSignalsInput): number {
  return input.answerPlan?.selectedFacts.length ??
    input.answerSpec?.structuredFacts?.length ??
    0;
}

function requestedFieldCount(input: BuildSafetyEvidenceSignalsInput): number {
  return input.answerPlan?.diagnostics.requestedFieldCount ??
    input.answerPlan?.requestedFields.length ??
    input.evidenceBundle?.requestedFieldIds.length ??
    0;
}

function coveredRequestedFieldCount(input: BuildSafetyEvidenceSignalsInput, requestedCount: number): number {
  if (requestedCount === 0) return 0;
  const missingCount = input.answerPlan?.diagnostics.missingFieldIds.length;
  if (typeof missingCount === "number") {
    return clamp(requestedCount - missingCount, 0, requestedCount);
  }
  return clamp(selectedStructuredFactCount(input), 0, requestedCount);
}

function answerPlanCoverage(
  input: BuildSafetyEvidenceSignalsInput,
  requestedCount: number,
  coveredCount: number,
): AnswerPlanCoverage {
  if (input.answerPlan?.coverage) return input.answerPlan.coverage;
  if (requestedCount === 0) return selectedStructuredFactCount(input) > 0 ? "partial" : "none";
  if (coveredCount === 0) return "none";
  return coveredCount >= requestedCount ? "complete" : "partial";
}

export function buildSafetyEvidenceSignals(input: BuildSafetyEvidenceSignalsInput): SafetyEvidenceSignals {
  const requestedCount = requestedFieldCount(input);
  const coveredCount = coveredRequestedFieldCount(input, requestedCount);

  return {
    legacyUsableFactCount: input.evidence?.usableFacts.length ?? input.answerSpec?.facts.length ?? 0,
    usableEvidenceBundleItemCount: countUsableEvidenceItems(input.evidenceBundle),
    selectedStructuredFactCount: selectedStructuredFactCount(input),
    requestedFieldCount: requestedCount,
    coveredRequestedFieldCount: coveredCount,
    answerPlanCoverage: answerPlanCoverage(input, requestedCount, coveredCount),
    sourceCount: input.sources?.length ?? 0,
    retrievalWasUsed: input.retrievalWasUsed,
  };
}
