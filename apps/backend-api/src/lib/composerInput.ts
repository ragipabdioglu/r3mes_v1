import type { AnswerPlan } from "./answerPlan.js";
import type { AnswerSpec } from "./answerSpec.js";
import type { CompiledEvidence } from "./compiledEvidence.js";
import type { EvidenceBundle } from "./evidenceBundle.js";

export interface ComposerInputConstraints {
  forbidCaution: boolean;
  noRawTableDump: boolean;
  maxWords?: number;
  sourceGroundedOnly: boolean;
}

export interface ComposerInput {
  answerSpec: AnswerSpec;
  answerPlan: AnswerPlan;
  compiledEvidence?: CompiledEvidence | null;
  evidenceBundle?: EvidenceBundle;
  constraints: ComposerInputConstraints;
}

export interface ComposePlannedAnswerOptions {
  enableFinanceTableStringFallback?: boolean;
}
