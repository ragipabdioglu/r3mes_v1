import type { GroundingConfidence } from "./answerSchema.js";
import { getDecisionConfig, getDecisionConfigVersion } from "./decisionConfig.js";
import { countUsableEvidenceItems, type EvidenceBundle, type EvidenceBundleDiagnostics } from "./evidenceBundle.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";
import type { StructuredFact } from "./structuredFact.js";

export type CompiledEvidenceConfidence = "low" | "medium" | "high";

export interface CompiledEvidence {
  facts: string[];
  structuredFacts?: StructuredFact[];
  risks: string[];
  unknowns: string[];
  contradictions: string[];
  sourceIds: string[];
  evidenceBundle?: EvidenceBundle;
  confidence: CompiledEvidenceConfidence;
  usableFactCount: number;
  structuredFactCount?: number;
  riskFactCount: number;
  unknownCount: number;
  contradictionCount: number;
  diagnostics?: {
    decisionConfigVersion: string;
    confidenceReason: string;
    limits: {
      facts: number;
      structuredFacts: number;
      risks: number;
      unknowns: number;
      sources: number;
    };
    rawCounts: {
      facts: number;
      structuredFacts: number;
      risks: number;
      unknowns: number;
      sources: number;
      contradictions: number;
    };
    evidenceBundle?: EvidenceBundleDiagnostics & {
      itemCount: number;
      usableItemCount: number;
    };
  };
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

function uniqueStructuredFacts(values: Array<StructuredFact | null | undefined>): StructuredFact[] {
  const seen = new Set<string>();
  const out: StructuredFact[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = [
      value.id,
      value.sourceId,
      value.field ?? "",
      value.value ?? "",
      value.provenance.quote,
    ]
      .join("|")
      .toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function clampConfidence(value: GroundingConfidence | undefined): CompiledEvidenceConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

function deriveConfidence(opts: {
  groundingConfidence?: GroundingConfidence;
  usableGroundingCount: number;
  sourceCount: number;
  contradictionCount: number;
}): { confidence: CompiledEvidenceConfidence; reason: string } {
  const config = getDecisionConfig().evidenceCompiler;
  if (config.contradictionDowngradesToLow && opts.contradictionCount > 0) {
    return { confidence: "low", reason: "contradiction" };
  }
  if (opts.usableGroundingCount === 0) return { confidence: "low", reason: "no_usable_facts" };

  const requested = clampConfidence(opts.groundingConfidence);
  const hasMediumFacts = opts.usableGroundingCount >= config.minUsableFactsForMedium;
  const hasHighFacts = opts.usableGroundingCount >= config.minUsableFactsForHigh;
  const hasMediumSource = !config.requireSourceForMedium || opts.sourceCount > 0;
  const hasHighSource = !config.requireSourceForHigh || opts.sourceCount > 0;

  if (requested === "high") {
    if (hasHighFacts && hasHighSource) return { confidence: "high", reason: "grounding_high" };
    if (hasMediumFacts && hasMediumSource) return { confidence: "medium", reason: "high_requirements_not_met" };
    return { confidence: "low", reason: "medium_requirements_not_met" };
  }
  if (requested === "medium") {
    if (hasMediumFacts && hasMediumSource) return { confidence: "medium", reason: "grounding_medium" };
    return { confidence: "low", reason: "medium_requirements_not_met" };
  }
  return { confidence: "low", reason: "grounding_low" };
}

export function compileEvidence(opts: CompileEvidenceOptions): CompiledEvidence {
  const evidence = opts.evidence;
  const decisionConfig = getDecisionConfig();
  const budget = decisionConfig.evidenceBudget;
  const evidenceBundle = evidence?.evidenceBundle;
  const rawFacts = uniqueText([
    ...(evidence?.directAnswerFacts ?? []),
    ...(evidence?.usableFacts ?? []),
    ...(evidence?.supportingContext ?? []),
  ]);
  const rawRisks = uniqueText([...(evidence?.riskFacts ?? []), ...(evidence?.redFlags ?? [])]);
  const rawUnknowns = uniqueText([
    ...(evidence?.missingInfo ?? []),
    ...(evidence?.notSupported ?? []),
    ...(evidence?.uncertainOrUnusable ?? []),
  ]);
  const facts = rawFacts.slice(0, budget.usableFactLimit);
  const structuredFacts = uniqueStructuredFacts(evidence?.structuredFacts ?? []).slice(0, budget.usableFactLimit);
  const risks = rawRisks.slice(0, budget.riskFactLimit);
  const unknowns = rawUnknowns.slice(0, budget.notSupportedLimit);
  const contradictions = uniqueText(
    [...rawFacts, ...rawRisks, ...rawUnknowns].filter((text) => CONTRADICTION_PATTERN.test(text)),
  );
  const rawSourceIds = uniqueText([
    ...(evidence?.sourceIds ?? []),
    ...(evidenceBundle?.sourceIds ?? []),
    ...(opts.sourceRefs ?? []).map((source) => source.id),
  ]);
  const sourceIds = rawSourceIds.slice(0, budget.sourceIdLimit);
  const usableEvidenceItemCount = countUsableEvidenceItems(evidenceBundle);
  const usableGroundingCount = Math.max(facts.length, structuredFacts.length, usableEvidenceItemCount);
  const confidence = deriveConfidence({
    groundingConfidence: opts.groundingConfidence,
    usableGroundingCount,
    sourceCount: sourceIds.length,
    contradictionCount: contradictions.length,
  });

  return {
    facts,
    structuredFacts,
    risks,
    unknowns,
    contradictions,
    sourceIds,
    evidenceBundle,
    confidence: confidence.confidence,
    usableFactCount: usableGroundingCount,
    structuredFactCount: structuredFacts.length,
    riskFactCount: risks.length,
    unknownCount: unknowns.length,
    contradictionCount: contradictions.length,
    diagnostics: {
      decisionConfigVersion: getDecisionConfigVersion(),
      confidenceReason: confidence.reason,
      limits: {
        facts: budget.usableFactLimit,
        structuredFacts: budget.usableFactLimit,
        risks: budget.riskFactLimit,
        unknowns: budget.notSupportedLimit,
        sources: budget.sourceIdLimit,
      },
      rawCounts: {
        facts: rawFacts.length,
        structuredFacts: evidence?.structuredFacts?.length ?? 0,
        risks: rawRisks.length,
        unknowns: rawUnknowns.length,
        sources: rawSourceIds.length,
        contradictions: contradictions.length,
      },
      evidenceBundle: evidenceBundle
        ? {
            ...evidenceBundle.diagnostics,
            itemCount: evidenceBundle.items.length,
            usableItemCount: usableEvidenceItemCount,
          }
        : undefined,
    },
  };
}

export function hasCompiledUsableGrounding(evidence: CompiledEvidence | null | undefined): boolean {
  return Boolean(
    evidence &&
      (
        evidence.usableFactCount > 0 ||
        (evidence.structuredFactCount ?? 0) > 0 ||
        countUsableEvidenceItems(evidence.evidenceBundle) > 0
      ),
  );
}
