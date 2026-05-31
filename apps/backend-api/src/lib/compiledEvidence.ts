import type { GroundingConfidence } from "./answerSchema.js";
import { getDecisionConfig, getDecisionConfigVersion } from "./decisionConfig.js";
import {
  countUsableEvidenceItems,
  EVIDENCE_ITEM_KINDS,
  type EvidenceBundle,
  type EvidenceBundleDiagnostics,
  type EvidenceItemKind,
} from "./evidenceBundle.js";
import { fieldTextMatchesFact } from "./fieldCoverageResolver.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";
import type { StructuredFact } from "./structuredFact.js";

export type CompiledEvidenceConfidence = "low" | "medium" | "high";
export type EvidenceCoverageStatus = "complete" | "partial" | "none";
export type EvidenceSufficiencyStatus = "sufficient" | "partial" | "insufficient" | "contradictory";

export interface EvidenceCoverage {
  status: EvidenceCoverageStatus;
  requestedFieldIds: string[];
  coveredFieldIds: string[];
  missingFieldIds: string[];
  usableEvidenceItemCount: number;
  structuredFactCount: number;
  textFactCount: number;
  contradictionCount: number;
}

export interface EvidenceSufficiencyDecision {
  status: EvidenceSufficiencyStatus;
  shouldAnswer: boolean;
  reason:
    | "sufficient_evidence"
    | "partial_requested_field_coverage"
    | "no_usable_evidence"
    | "contradiction_present";
  coverage: EvidenceCoverageStatus;
  confidence: CompiledEvidenceConfidence;
}

export interface EvidenceFactLevelDiagnostics {
  usableEvidenceItemCount: number;
  selectedTextFactCount: number;
  selectedStructuredFactCount: number;
  selectedRiskFactCount: number;
  selectedUnknownCount: number;
  selectedContradictionCount: number;
  selectedSourceCount: number;
  bundleKindCounts: Record<EvidenceItemKind, number>;
  structuredFactKinds: Record<StructuredFact["kind"], number>;
  structuredFactConfidenceCounts: Record<StructuredFact["confidence"], number>;
  sourceDistribution: Array<{ sourceId: string; count: number }>;
  contradictionSources: string[];
  diagnosticsMode: "observed_only";
}

export interface CompiledEvidence {
  version?: 2;
  facts: string[];
  structuredFacts?: StructuredFact[];
  risks: string[];
  unknowns: string[];
  contradictions: string[];
  sourceIds: string[];
  evidenceBundle?: EvidenceBundle;
  coverage?: EvidenceCoverage;
  sufficiency?: EvidenceSufficiencyDecision;
  factLevelDiagnostics?: EvidenceFactLevelDiagnostics;
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

export interface CompiledEvidenceV2 extends CompiledEvidence {
  version: 2;
  coverage: EvidenceCoverage;
  sufficiency: EvidenceSufficiencyDecision;
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

function deriveCoverage(opts: {
  evidenceBundle?: EvidenceBundle;
  facts: string[];
  structuredFacts: StructuredFact[];
  usableEvidenceItemCount: number;
  contradictionCount: number;
}): EvidenceCoverage {
  const requestedFieldIds = uniqueText(opts.evidenceBundle?.requestedFieldIds ?? []);
  const coveredFieldIds = requestedFieldIds.length === 0
    ? uniqueText(opts.structuredFacts.map((fact) => fact.field).filter((field): field is string => Boolean(field?.trim())))
    : requestedFieldIds.filter((fieldId) => opts.structuredFacts.some((fact) => fieldTextMatchesFact(fieldId, fact)));
  const coveredFieldKeys = new Set(coveredFieldIds.map((field) => field.toLocaleLowerCase("tr-TR")));
  const missingFieldIds = requestedFieldIds.filter((field) => !coveredFieldKeys.has(field.toLocaleLowerCase("tr-TR")));
  const hasUsableEvidence = opts.facts.length > 0 || opts.structuredFacts.length > 0 || opts.usableEvidenceItemCount > 0;
  const status: EvidenceCoverageStatus =
    requestedFieldIds.length === 0
      ? hasUsableEvidence
        ? "complete"
        : "none"
      : missingFieldIds.length === 0
        ? "complete"
        : coveredFieldIds.length > 0 || hasUsableEvidence
          ? "partial"
          : "none";

  return {
    status,
    requestedFieldIds,
    coveredFieldIds,
    missingFieldIds,
    usableEvidenceItemCount: opts.usableEvidenceItemCount,
    structuredFactCount: opts.structuredFacts.length,
    textFactCount: opts.facts.length,
    contradictionCount: opts.contradictionCount,
  };
}

function deriveSufficiency(opts: {
  coverage: EvidenceCoverage;
  confidence: CompiledEvidenceConfidence;
  usableGroundingCount: number;
  contradictionCount: number;
}): EvidenceSufficiencyDecision {
  if (opts.contradictionCount > 0) {
    return {
      status: "contradictory",
      shouldAnswer: opts.usableGroundingCount > 0,
      reason: "contradiction_present",
      coverage: opts.coverage.status,
      confidence: opts.confidence,
    };
  }
  if (opts.usableGroundingCount === 0) {
    return {
      status: "insufficient",
      shouldAnswer: false,
      reason: "no_usable_evidence",
      coverage: opts.coverage.status,
      confidence: opts.confidence,
    };
  }
  if (opts.coverage.status === "partial") {
    return {
      status: "partial",
      shouldAnswer: true,
      reason: "partial_requested_field_coverage",
      coverage: opts.coverage.status,
      confidence: opts.confidence,
    };
  }
  return {
    status: "sufficient",
    shouldAnswer: true,
    reason: "sufficient_evidence",
    coverage: opts.coverage.status,
    confidence: opts.confidence,
  };
}

function emptyBundleKindCounts(): Record<EvidenceItemKind, number> {
  return Object.fromEntries(EVIDENCE_ITEM_KINDS.map((kind) => [kind, 0])) as Record<EvidenceItemKind, number>;
}

function deriveFactLevelDiagnostics(opts: {
  evidenceBundle?: EvidenceBundle;
  facts: string[];
  structuredFacts: StructuredFact[];
  risks: string[];
  unknowns: string[];
  contradictions: string[];
  sourceIds: string[];
  usableEvidenceItemCount: number;
}): EvidenceFactLevelDiagnostics {
  const sourceCounts = new Map<string, number>();
  for (const item of opts.evidenceBundle?.items ?? []) {
    sourceCounts.set(item.sourceId, (sourceCounts.get(item.sourceId) ?? 0) + 1);
  }
  for (const fact of opts.structuredFacts) {
    sourceCounts.set(fact.sourceId, (sourceCounts.get(fact.sourceId) ?? 0) + 1);
  }
  for (const sourceId of opts.sourceIds) {
    if (!sourceCounts.has(sourceId)) sourceCounts.set(sourceId, 0);
  }

  const structuredFactKinds = {
    table_cell: 0,
    table_row: 0,
    numeric_value: 0,
    text_claim: 0,
  } satisfies Record<StructuredFact["kind"], number>;
  const structuredFactConfidenceCounts = {
    low: 0,
    medium: 0,
    high: 0,
  } satisfies Record<StructuredFact["confidence"], number>;
  for (const fact of opts.structuredFacts) {
    structuredFactKinds[fact.kind] += 1;
    structuredFactConfidenceCounts[fact.confidence] += 1;
  }

  const contradictionSources = uniqueText(
    (opts.evidenceBundle?.items ?? [])
      .filter((item) => item.kind === "contradiction" || CONTRADICTION_PATTERN.test(item.quote))
      .map((item) => item.sourceId),
  );

  return {
    usableEvidenceItemCount: opts.usableEvidenceItemCount,
    selectedTextFactCount: opts.facts.length,
    selectedStructuredFactCount: opts.structuredFacts.length,
    selectedRiskFactCount: opts.risks.length,
    selectedUnknownCount: opts.unknowns.length,
    selectedContradictionCount: opts.contradictions.length,
    selectedSourceCount: opts.sourceIds.length,
    bundleKindCounts: opts.evidenceBundle?.diagnostics.kindCounts ?? emptyBundleKindCounts(),
    structuredFactKinds,
    structuredFactConfidenceCounts,
    sourceDistribution: [...sourceCounts.entries()]
      .map(([sourceId, count]) => ({ sourceId, count }))
      .sort((a, b) => b.count - a.count || a.sourceId.localeCompare(b.sourceId)),
    contradictionSources,
    diagnosticsMode: "observed_only",
  };
}

export function compileEvidence(opts: CompileEvidenceOptions): CompiledEvidenceV2 {
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
  const coverage = deriveCoverage({
    evidenceBundle,
    facts,
    structuredFacts,
    usableEvidenceItemCount,
    contradictionCount: contradictions.length,
  });
  const sufficiency = deriveSufficiency({
    coverage,
    confidence: confidence.confidence,
    usableGroundingCount,
    contradictionCount: contradictions.length,
  });
  const factLevelDiagnostics = deriveFactLevelDiagnostics({
    evidenceBundle,
    facts,
    structuredFacts,
    risks,
    unknowns,
    contradictions,
    sourceIds,
    usableEvidenceItemCount,
  });

  return {
    version: 2,
    facts,
    structuredFacts,
    risks,
    unknowns,
    contradictions,
    sourceIds,
    evidenceBundle,
    coverage,
    sufficiency,
    factLevelDiagnostics,
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
