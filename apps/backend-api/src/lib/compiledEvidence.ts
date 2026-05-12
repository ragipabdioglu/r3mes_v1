import type { GroundingConfidence } from "./answerSchema.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

export type CompiledEvidenceConfidence = "low" | "medium" | "high";

export interface CompiledEvidence {
  facts: string[];
  risks: string[];
  unknowns: string[];
  contradictions: string[];
  sourceIds: string[];
  confidence: CompiledEvidenceConfidence;
  usableFactCount: number;
  riskFactCount: number;
  unknownCount: number;
  contradictionCount: number;
}

export interface CompileEvidenceOptions {
  evidence: EvidenceExtractorOutput | null;
  sourceRefs?: Array<{ id: string; title?: string }>;
  groundingConfidence?: GroundingConfidence;
}

const CONTRADICTION_PATTERN = /(çeliş|celis|contradict|conflict|tutarsız|tutarsiz|uyuşmuyor|uyusmuyor)/i;

function uniqueText(values: Array<string | null | undefined>): string[] {
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

function clampConfidence(value: GroundingConfidence | undefined): CompiledEvidenceConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

function deriveConfidence(opts: {
  groundingConfidence?: GroundingConfidence;
  factCount: number;
  contradictionCount: number;
}): CompiledEvidenceConfidence {
  if (opts.contradictionCount > 0) return "low";
  if (opts.factCount === 0) return "low";
  return clampConfidence(opts.groundingConfidence);
}

export function compileEvidence(opts: CompileEvidenceOptions): CompiledEvidence {
  const evidence = opts.evidence;
  const facts = uniqueText([
    ...(evidence?.directAnswerFacts ?? []),
    ...(evidence?.usableFacts ?? []),
    ...(evidence?.supportingContext ?? []),
  ]);
  const risks = uniqueText([...(evidence?.riskFacts ?? []), ...(evidence?.redFlags ?? [])]);
  const unknowns = uniqueText([
    ...(evidence?.missingInfo ?? []),
    ...(evidence?.notSupported ?? []),
    ...(evidence?.uncertainOrUnusable ?? []),
  ]);
  const contradictions = uniqueText(
    [...facts, ...risks, ...unknowns].filter((text) => CONTRADICTION_PATTERN.test(text)),
  );
  const sourceIds = uniqueText([
    ...(evidence?.sourceIds ?? []),
    ...(opts.sourceRefs ?? []).map((source) => source.id),
  ]);

  return {
    facts,
    risks,
    unknowns,
    contradictions,
    sourceIds,
    confidence: deriveConfidence({
      groundingConfidence: opts.groundingConfidence,
      factCount: facts.length,
      contradictionCount: contradictions.length,
    }),
    usableFactCount: facts.length,
    riskFactCount: risks.length,
    unknownCount: unknowns.length,
    contradictionCount: contradictions.length,
  };
}
