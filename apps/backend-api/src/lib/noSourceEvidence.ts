import type { AnswerTaskType } from "./answerTaskDetector.js";
import { buildEvidenceBundle } from "./evidenceBundle.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

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
  return evidence.directAnswerFacts.length > 0 ||
    evidence.supportingContext.length > 0 ||
    evidence.usableFacts.length > 0 ||
    (evidence.structuredFacts?.length ?? 0) > 0;
}

export function ensureNoSourceEvidence(input: EnsureNoSourceEvidenceInput): EvidenceExtractorOutput {
  if (hasUsableEvidence(input.evidence) || input.evidence.notSupported.length > 0) {
    return input.evidence;
  }

  const attemptedSourceIds = unique([
    ...input.evidence.sourceIds,
    ...(input.attemptedSourceIds ?? []),
  ]);
  const notSupported = unique([
    ...input.evidence.notSupported,
    "Kaynaklarda bu soru için doğrudan yeterli destek bulunamadı.",
  ]);
  const next: EvidenceExtractorOutput = {
    ...input.evidence,
    notSupported,
    missingInfo: unique([
      ...input.evidence.missingInfo,
      "Kaynak desteği sınırlı veya yetersiz.",
    ]),
    sourceIds: attemptedSourceIds,
  };

  return {
    ...next,
    evidenceBundle: buildEvidenceBundle({
      userQuery: input.userQuery,
      textFacts: next.usableFacts,
      riskFacts: next.riskFacts,
      notSupported: next.notSupported,
      structuredFacts: next.structuredFacts,
      sourceIds: attemptedSourceIds,
      requestedFieldIds: input.evidence.evidenceBundle?.requestedFieldIds,
      extractor: "no-source-evidence-v1",
      taskType: input.taskType,
    }),
  };
}
