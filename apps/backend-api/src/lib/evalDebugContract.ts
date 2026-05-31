import type { ComposerPathName, RuntimeLineage } from "@r3mes/shared-types";
import type { AnswerPlan } from "./answerPlan.js";
import type { AnswerQualityFinding } from "./answerQualityValidator.js";
import type {
  CompiledEvidence,
  EvidenceCoverage,
  EvidenceSufficiencyDecision,
} from "./compiledEvidence.js";
import { countUsableEvidenceItems, type EvidenceBundle, type EvidenceBundleDiagnostics } from "./evidenceBundle.js";
import type { SafetyGateResult } from "./safetyGate.js";

export const EVAL_DEBUG_CONTRACT_VERSION = "2026-05-section-04" as const;

export interface EvalAnswerBaselineDiagnostics {
  evidenceBundle: {
    itemCount: number;
    usableItemCount: number;
    kindCounts: EvidenceBundleDiagnostics["kindCounts"] | null;
    requestedFieldIds: string[];
  };
  compiledEvidence: {
    confidence: CompiledEvidence["confidence"] | null;
    confidenceReason: string | null;
    usableFactCount: number;
    structuredFactCount: number;
    riskFactCount: number;
    unknownCount: number;
    contradictionCount: number;
    coverage: EvidenceCoverage | null;
    sufficiency: EvidenceSufficiencyDecision | null;
  };
  answerPlan: {
    taskType: AnswerPlan["taskType"] | null;
    outputFormat: AnswerPlan["outputFormat"] | null;
    coverage: AnswerPlan["coverage"] | null;
    requiresModelSynthesis: boolean | null;
    requestedFieldCount: number;
    selectedFactCount: number;
    missingFieldIds: string[];
  };
  composer: {
    path: ComposerPathName | null;
    plannedComposerUsed: boolean | null;
    fallbackTemplateUsed: boolean | null;
    lowLanguageQualityDetected: boolean | null;
  };
  evidenceToAnswerPath: {
    sufficiencyStatus: EvidenceSufficiencyDecision["status"] | null;
    shouldAnswer: boolean | null;
    answerPlanCoverage: AnswerPlan["coverage"] | null;
    requiresModelSynthesis: boolean | null;
    composerPath: ComposerPathName | null;
    plannedComposerUsed: boolean | null;
    fallbackTemplateUsed: boolean | null;
    safetyPass: boolean | null;
    safetySeverity: SafetyGateResult["severity"] | null;
    diagnosis:
      | "no_compiled_evidence"
      | "evidence_sufficient_planned_answer"
      | "evidence_sufficient_fallback"
      | "evidence_partial_fallback_or_synthesis"
      | "evidence_contradictory_safety"
      | "evidence_insufficient_boundary"
      | "evidence_path_unclassified";
  };
  sourceCount: number | null;
}

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
  answerBaseline?: EvalAnswerBaselineDiagnostics;
  sourceSelection?: unknown;
  retrievalDebug?: unknown;
  runtimeLineage?: RuntimeLineage;
}

export function buildEvalDebugContract(input: {
  safetyGate?: SafetyGateResult;
  answerQualityFindings?: AnswerQualityFinding[];
  answerPlan?: AnswerPlan;
  evidenceSignals?: unknown;
  evidenceBundle?: EvidenceBundle | null;
  evidenceBundleDiagnostics?: EvidenceBundleDiagnostics | null;
  compiledEvidence?: CompiledEvidence | null;
  composerDiagnostics?: {
    path?: ComposerPathName;
    plannedComposerUsed?: boolean;
    fallbackTemplateUsed?: boolean;
    lowLanguageQualityDetected?: boolean;
  };
  sourceCount?: number | null;
  sourceSelection?: unknown;
  retrievalDebug?: unknown;
  runtimeLineage?: RuntimeLineage;
}): EvalDebugContract {
  const findings = input.answerQualityFindings ?? [];
  const evidenceBundle = input.evidenceBundle ?? null;
  const compiledEvidence = input.compiledEvidence ?? null;
  const answerPlan = input.answerPlan ?? null;
  const composerPath = input.composerDiagnostics?.path ?? input.runtimeLineage?.composer?.path ?? null;
  const plannedComposerUsed = input.composerDiagnostics?.plannedComposerUsed ?? null;
  const fallbackTemplateUsed = input.composerDiagnostics?.fallbackTemplateUsed ?? null;
  const sufficiency = compiledEvidence?.sufficiency ?? null;
  const evidenceToAnswerPathDiagnosis = (() => {
    if (!compiledEvidence) return "no_compiled_evidence" as const;
    if (sufficiency?.status === "contradictory") return "evidence_contradictory_safety" as const;
    if (sufficiency?.status === "insufficient") return "evidence_insufficient_boundary" as const;
    if (
      sufficiency?.status === "sufficient" &&
      plannedComposerUsed === true &&
      fallbackTemplateUsed !== true &&
      composerPath !== "safety_fallback"
    ) {
      return "evidence_sufficient_planned_answer" as const;
    }
    if (
      sufficiency?.status === "sufficient" &&
      (fallbackTemplateUsed === true || composerPath === "safety_fallback" || composerPath === "planned_fallback_template")
    ) {
      return "evidence_sufficient_fallback" as const;
    }
    if (sufficiency?.status === "partial") return "evidence_partial_fallback_or_synthesis" as const;
    return "evidence_path_unclassified" as const;
  })();
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
    answerBaseline: {
      evidenceBundle: {
        itemCount: evidenceBundle?.items.length ?? 0,
        usableItemCount: countUsableEvidenceItems(evidenceBundle),
        kindCounts: evidenceBundle?.diagnostics.kindCounts ?? null,
        requestedFieldIds: evidenceBundle?.requestedFieldIds ?? [],
      },
      compiledEvidence: {
        confidence: compiledEvidence?.confidence ?? null,
        confidenceReason: compiledEvidence?.diagnostics?.confidenceReason ?? null,
        usableFactCount: compiledEvidence?.usableFactCount ?? 0,
        structuredFactCount: compiledEvidence?.structuredFactCount ?? 0,
        riskFactCount: compiledEvidence?.riskFactCount ?? 0,
        unknownCount: compiledEvidence?.unknownCount ?? 0,
        contradictionCount: compiledEvidence?.contradictionCount ?? 0,
        coverage: compiledEvidence?.coverage ?? null,
        sufficiency: compiledEvidence?.sufficiency ?? null,
      },
      answerPlan: {
        taskType: answerPlan?.taskType ?? null,
        outputFormat: answerPlan?.outputFormat ?? null,
        coverage: answerPlan?.coverage ?? null,
        requiresModelSynthesis: answerPlan?.requiresModelSynthesis ?? null,
        requestedFieldCount: answerPlan?.diagnostics.requestedFieldCount ?? 0,
        selectedFactCount: answerPlan?.diagnostics.selectedFactCount ?? 0,
        missingFieldIds: answerPlan?.diagnostics.missingFieldIds ?? [],
      },
      composer: {
        path: composerPath,
        plannedComposerUsed,
        fallbackTemplateUsed,
        lowLanguageQualityDetected: input.composerDiagnostics?.lowLanguageQualityDetected ?? null,
      },
      evidenceToAnswerPath: {
        sufficiencyStatus: sufficiency?.status ?? null,
        shouldAnswer: sufficiency?.shouldAnswer ?? null,
        answerPlanCoverage: answerPlan?.coverage ?? null,
        requiresModelSynthesis: answerPlan?.requiresModelSynthesis ?? null,
        composerPath,
        plannedComposerUsed,
        fallbackTemplateUsed,
        safetyPass: input.safetyGate?.pass ?? null,
        safetySeverity: input.safetyGate?.severity ?? null,
        diagnosis: evidenceToAnswerPathDiagnosis,
      },
      sourceCount: input.sourceCount ?? null,
    },
    sourceSelection: input.sourceSelection,
    retrievalDebug: input.retrievalDebug,
    runtimeLineage: input.runtimeLineage,
  };
}
