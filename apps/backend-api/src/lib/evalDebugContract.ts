import type { RuntimeLineage } from "@r3mes/shared-types";
import type { AnswerPlan } from "./answerPlan.js";
import type { AnswerQualityFinding } from "./answerQualityValidator.js";
import type { CompiledEvidence } from "./compiledEvidence.js";
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
    plannedComposerUsed: boolean | null;
    fallbackTemplateUsed: boolean | null;
    lowLanguageQualityDetected: boolean | null;
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
        plannedComposerUsed: input.composerDiagnostics?.plannedComposerUsed ?? null,
        fallbackTemplateUsed: input.composerDiagnostics?.fallbackTemplateUsed ?? null,
        lowLanguageQualityDetected: input.composerDiagnostics?.lowLanguageQualityDetected ?? null,
      },
      sourceCount: input.sourceCount ?? null,
    },
    sourceSelection: input.sourceSelection,
    retrievalDebug: input.retrievalDebug,
    runtimeLineage: input.runtimeLineage,
  };
}
