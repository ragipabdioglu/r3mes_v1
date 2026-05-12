import type { ChatSourceCitation } from "@r3mes/shared-types";

import type { GroundedMedicalAnswer } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { hasLowLanguageQuality } from "./answerQuality.js";
import { composeAnswerSpec } from "./domainEvidenceComposer.js";
import { getDomainSafetyPolicy, getRiskyCertaintyPatterns } from "./domainSafetyPolicy.js";
import {
  getSafetyRailDefinition,
  type SafetyFallbackMode,
  type SafetyRailCategory,
  type SafetyRailId,
  type SafetyRailStatus,
  type SafetySeverity,
} from "./safetyRailRegistry.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

interface SafetyRailCheck {
  id: SafetyRailId;
  category: SafetyRailCategory;
  status: SafetyRailStatus;
  publicReason: string;
}

interface SafetyRouteDecision {
  mode?: "strict" | "broad" | "suggest" | "no_source";
  confidence?: "low" | "medium" | "high";
  selectedCollectionIds?: string[];
  usedCollectionIds?: string[];
  suggestedCollectionIds?: string[];
  rejectedCollectionIds?: string[];
}

interface SafetySourceSelection {
  accessibleCollectionIds?: string[];
  usedCollectionIds?: string[];
  routeDecision?: SafetyRouteDecision;
}

export interface SafetyInput {
  answerText: string;
  answer: GroundedMedicalAnswer;
  answerSpec?: AnswerSpec;
  sources: ChatSourceCitation[];
  retrievalWasUsed: boolean;
  evidence?: EvidenceExtractorOutput | null;
  retrievalDiagnostics?: Record<string, unknown> | null;
  sourceSelection?: SafetySourceSelection | null;
}

export interface SafetyGateResult {
  pass: boolean;
  severity: SafetySeverity;
  blockedReasons: string[];
  warnings: string[];
  railChecks: SafetyRailCheck[];
  requiredRewrite: boolean;
  fallbackMode?: SafetyFallbackMode;
  safeFallback?: string;
  metrics: {
    sourceCount: number;
    usableFactCount: number;
    redFlagCount: number;
    finalCandidateCount: number | null;
    answerLength: number;
  };
}

const LOW_GROUNDING_OVERCONFIDENCE_PATTERNS = [
  /\bkesin(?:likle)?\b(?![^.!?\n]{0,80}(?:değil|degil|doğru olmaz|dogru olmaz|söylenemez|soylenemez|göstermez|gostermez|anlamına gelmez|anlamina gelmez))/iu,
  /\bmutlaka\b(?![^.!?\n]{0,80}(?:değil|degil|gerekmez))/iu,
  /\bnet\s+olarak\b(?![^.!?\n]{0,80}(?:söylenemez|soylenemez|belirtilemez))/iu,
  /\bhiç\s+gerek\s+yok\b/iu,
  /\btek\s+yapman(?:ız)?\s+gereken\b/iu,
];

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

function includesAny(text: string, terms: string[]): boolean {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(normalize(term)));
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function readNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readFinalCandidateCount(diagnostics: Record<string, unknown> | null | undefined): number | null {
  return readNumber(diagnostics?.finalCandidateCount);
}

function readAlignmentDiagnostics(diagnostics: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const alignment = diagnostics?.alignment;
  return alignment && typeof alignment === "object" ? alignment as Record<string, unknown> : null;
}

function hasSourceMetadataMismatch(answer: GroundedMedicalAnswer, sources: ChatSourceCitation[]): boolean {
  if (answer.used_source_ids.length === 0 || sources.length === 0) return false;
  const available = new Set(
    sources.flatMap((source) => [
      source.documentId,
      source.title,
      `${source.documentId}`,
      `${source.title}`,
    ].filter(Boolean)),
  );
  return answer.used_source_ids.some((id) => !available.has(id));
}

function fallbackSections(intent: AnswerSpec["answerIntent"]): AnswerSpec["sections"] {
  if (intent === "triage") return ["caution", "assessment", "action", "summary"];
  if (intent === "steps") return ["action", "assessment", "caution", "summary"];
  return ["assessment", "action", "caution", "summary"];
}

function buildFallback(
  answer: GroundedMedicalAnswer,
  sources: ChatSourceCitation[],
  answerSpec: AnswerSpec | undefined,
  fallbackMode: SafetyGateResult["fallbackMode"],
): string {
  const policy = getDomainSafetyPolicy(answer.answer_domain);
  const sourceNote =
    sources.length > 0
      ? "Eldeki kaynaklar bu soruya sınırlı dayanak sağlıyor."
      : "Bu soru için yeterli güvenilir kaynak bulunamadı.";
  const queryNote = answer.user_query
    ? `Sorunuz: ${answer.user_query}`
    : "Sorunuzdaki bilgi sınırlı.";
  const assessment =
    fallbackMode === "privacy_safe"
      ? "Bu yanıtta kullanılmak istenen kaynak kapsamı erişim sınırlarıyla uyuşmadığı için kaynaklı cevap verilmedi."
      : sourceNote;
  const spec: AnswerSpec = {
    answerDomain: answerSpec?.answerDomain ?? answer.answer_domain,
    answerIntent: answerSpec?.answerIntent ?? answer.answer_intent,
    groundingConfidence: "low",
    userQuery: answerSpec?.userQuery || answer.user_query,
    tone: "cautious",
    sections: fallbackSections(answerSpec?.answerIntent ?? answer.answer_intent),
    assessment,
    action: policy.fallbackGuidance.action,
    caution: [policy.fallbackGuidance.caution],
    summary: `${queryNote} ${policy.fallbackGuidance.summary}`,
    unknowns: answerSpec?.unknowns ?? [],
    sourceIds: fallbackMode === "privacy_safe" ? [] : (answerSpec?.sourceIds ?? answer.used_source_ids),
    facts: fallbackMode === "privacy_safe" ? [] : (answerSpec?.facts ?? []),
  };

  return composeAnswerSpec(spec);
}

export function evaluateSafetyGate(opts: SafetyInput): SafetyGateResult {
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const railChecks: SafetyRailCheck[] = [];
  const answerText = opts.answerText.trim();
  const query = opts.answer.user_query;
  const combined = [answerText, opts.answer.answer, opts.answer.condition_context, opts.answer.safe_action].join(" ");
  const evidence = opts.evidence ?? null;
  const routeDecision = opts.sourceSelection?.routeDecision;
  const hasEvidenceSignals = Boolean(evidence || opts.answerSpec);
  const usableFactCount = evidence?.usableFacts.length ?? opts.answerSpec?.facts.length ?? 0;
  const evidenceRedFlagCount = evidence?.redFlags.length ?? 0;
  const redFlagCount = evidenceRedFlagCount || opts.answerSpec?.caution.length || 0;
  const finalCandidateCount = readFinalCandidateCount(opts.retrievalDiagnostics);
  const alignmentDiagnostics = readAlignmentDiagnostics(opts.retrievalDiagnostics);
  const alignmentFastFailed = alignmentDiagnostics?.fastFailed === true;
  const alignmentDroppedCandidateCount = readNumber(alignmentDiagnostics?.droppedCandidateCount) ?? 0;
  const sourceCollectionIds = new Set(opts.sources.map((source) => source.collectionId).filter(Boolean));
  const accessibleCollectionIds = new Set(opts.sourceSelection?.accessibleCollectionIds ?? []);
  const sourceSuggestionWithoutGrounding = routeDecision?.mode === "suggest" && opts.sources.length === 0;
  const addRail = (id: SafetyRailId, status?: SafetyRailStatus) => {
    const definition = getSafetyRailDefinition(id);
    const resolvedStatus = status ?? definition.defaultStatus;
    railChecks.push({
      id,
      category: definition.category,
      status: resolvedStatus,
      publicReason: definition.publicReason,
    });
    if (resolvedStatus === "warn") addUnique(warnings, id);
    if (resolvedStatus === "rewrite" || resolvedStatus === "block") addUnique(blockedReasons, id);
  };

  if (!answerText) {
    addRail("EMPTY_ANSWER");
  }

  if (opts.retrievalWasUsed && opts.sources.length === 0) {
    addRail("MISSING_SOURCES");
  }

  if (sourceSuggestionWithoutGrounding) {
    addRail("SUGGEST_MODE_NO_GROUNDED_SOURCES");
  }

  if (routeDecision?.mode === "no_source" && opts.sources.length > 0) {
    addRail("NO_SOURCE_MODE_WITH_SOURCES");
  }

  if (typeof finalCandidateCount === "number" && finalCandidateCount > 4) {
    addRail("TOO_MANY_CONTEXT_CHUNKS_FOR_3B");
  }

  if (alignmentFastFailed) {
    addRail("QUERY_SOURCE_MISMATCH");
  } else if (alignmentDroppedCandidateCount > 0) {
    addRail("QUERY_SOURCE_MISMATCH", "warn");
  }

  if (opts.retrievalWasUsed && hasEvidenceSignals && usableFactCount === 0) {
    addRail("NO_USABLE_FACTS");
  }

  const policy = getDomainSafetyPolicy(opts.answer.answer_domain);

  // Judge risky certainty from the final user-visible answer. Intermediate
  // draft fields can contain rejected model text and should not force a safe
  // rendered answer into a fallback path.
  const visibleRiskText = answerText || combined;
  if (getRiskyCertaintyPatterns(opts.answer.answer_domain).some((pattern) => pattern.test(visibleRiskText))) {
    addRail("RISKY_CERTAINTY_OR_TREATMENT");
  }

  if (hasLowLanguageQuality(answerText)) {
    addRail("LOW_LANGUAGE_QUALITY");
  }

  if (
    opts.retrievalWasUsed &&
    opts.answer.grounding_confidence === "low" &&
    LOW_GROUNDING_OVERCONFIDENCE_PATTERNS.some((pattern) => pattern.test(answerText))
  ) {
    addRail("LOW_GROUNDING_OVERCONFIDENCE");
  }

  if (opts.retrievalWasUsed && hasSourceMetadataMismatch(opts.answer, opts.sources)) {
    addRail("SOURCE_METADATA_MISMATCH");
  }

  if (
    accessibleCollectionIds.size > 0 &&
    [...sourceCollectionIds].some((collectionId) => !accessibleCollectionIds.has(collectionId))
  ) {
    addRail("PRIVATE_SOURCE_SCOPE_MISMATCH");
  }

  if (
    !sourceSuggestionWithoutGrounding &&
    (includesAny(query, policy.redFlagTerms) || (evidenceRedFlagCount > 0 && evidence?.answerIntent === "triage")) &&
    !includesAny(answerText, policy.requiredGuidanceTerms)
  ) {
    addRail("RED_FLAG_WITHOUT_URGENT_GUIDANCE");
  }

  if (answerText.length < 40 && opts.retrievalWasUsed) {
    addRail("ANSWER_TOO_THIN");
  }

  const pass = blockedReasons.length === 0;
  const fallbackMode = blockedReasons.includes("PRIVATE_SOURCE_SCOPE_MISMATCH")
    ? "privacy_safe"
    : blockedReasons.includes("RISKY_CERTAINTY_OR_TREATMENT")
      ? "domain_safe"
      : routeDecision?.mode === "suggest"
        ? "source_suggestion"
        : opts.answer.grounding_confidence === "low" || blockedReasons.includes("NO_USABLE_FACTS")
          ? "low_grounding"
          : pass
            ? undefined
            : "domain_safe";
  const severity: SafetySeverity = pass
    ? (warnings.length > 0 ? "warn" : "pass")
    : railChecks.some((check) => check.status === "block")
      ? "block"
      : "rewrite";
  return {
    pass,
    severity,
    blockedReasons,
    warnings,
    railChecks,
    requiredRewrite: !pass,
    fallbackMode,
    safeFallback: pass ? undefined : buildFallback(opts.answer, opts.sources, opts.answerSpec, fallbackMode),
    metrics: {
      sourceCount: opts.sources.length,
      usableFactCount,
      redFlagCount,
      finalCandidateCount,
      answerLength: answerText.length,
    },
  };
}
