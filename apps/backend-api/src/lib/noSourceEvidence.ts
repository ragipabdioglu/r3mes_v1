import type { AnswerTaskType } from "./answerTaskDetector.js";
import {
  createEmptyEvidenceOutput,
  evidenceOutputLimitText,
  evidenceOutputStructuredFacts,
  evidenceOutputUsableTextFacts,
  type EvidenceExtractorOutput,
} from "./skillPipeline.js";

export interface EnsureNoSourceEvidenceInput {
  userQuery: string;
  evidence: EvidenceExtractorOutput;
  attemptedSourceIds?: string[];
  taskType?: AnswerTaskType | "grounded_summary";
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function hasUsableEvidence(evidence: EvidenceExtractorOutput): boolean {
  return evidenceOutputUsableTextFacts(evidence).length > 0 ||
    evidenceOutputStructuredFacts(evidence).length > 0;
}

export function ensureNoSourceEvidence(input: EnsureNoSourceEvidenceInput): EvidenceExtractorOutput {
  if (hasUsableEvidence(input.evidence) || evidenceOutputLimitText(input.evidence).length > 0) {
    return input.evidence;
  }

  const attemptedSourceIds = unique([
    ...input.evidence.sourceIds,
    ...(input.attemptedSourceIds ?? []),
  ]);
  return createEmptyEvidenceOutput({
    userQuery: input.userQuery,
    sourceIds: attemptedSourceIds,
    missingInfo: unique([
      ...input.evidence.missingInfo,
      "Kaynaklarda bu soru için doğrudan yeterli destek bulunamadı.",
      "Kaynak desteği sınırlı veya yetersiz.",
    ]),
    reason: input.taskType ? `no_source_${input.taskType}` : "no_source",
  });
}
