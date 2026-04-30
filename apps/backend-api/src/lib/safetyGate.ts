import type { ChatSourceCitation } from "@r3mes/shared-types";

import type { GroundedMedicalAnswer } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { hasLowLanguageQuality } from "./answerQuality.js";
import { getDomainSafetyPolicy, getRiskyCertaintyPatterns } from "./domainSafetyPolicy.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

type SafetySeverity = "pass" | "warn" | "rewrite" | "block";

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
  requiredRewrite: boolean;
  fallbackMode?: "low_grounding" | "domain_safe" | "source_suggestion" | "privacy_safe";
  safeFallback?: string;
  metrics: {
    sourceCount: number;
    usableFactCount: number;
    redFlagCount: number;
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

function buildFallback(answer: GroundedMedicalAnswer, sources: ChatSourceCitation[]): string {
  const policy = getDomainSafetyPolicy(answer.answer_domain);
  const sourceNote =
    sources.length > 0
      ? "Eldeki kaynaklar bu soruya sınırlı dayanak sağlıyor."
      : "Bu soru için yeterli güvenilir kaynak bulunamadı.";
  const queryNote = answer.user_query
    ? `Sorunuz: ${answer.user_query}`
    : "Sorunuzdaki bilgi sınırlı.";

  if (answer.answer_domain === "legal") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      `2. Ne yapılabilir: ${policy.fallbackGuidance.action}`,
      `3. Nelere dikkat edilmeli: ${policy.fallbackGuidance.caution}`,
      `4. Kısa özet: ${queryNote} ${policy.fallbackGuidance.summary}`,
    ].join("\n");
  }

  if (answer.answer_domain === "finance") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      `2. Ne yapılabilir: ${policy.fallbackGuidance.action}`,
      `3. Riskler: ${policy.fallbackGuidance.caution}`,
      `4. Kısa özet: ${queryNote} ${policy.fallbackGuidance.summary}`,
    ].join("\n");
  }

  if (answer.answer_domain === "technical") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      `2. Ne yapılabilir: ${policy.fallbackGuidance.action}`,
      `3. Dikkat edilmesi gerekenler: ${policy.fallbackGuidance.caution}`,
      `4. Kısa özet: ${queryNote} ${policy.fallbackGuidance.summary}`,
    ].join("\n");
  }

  if (answer.answer_domain === "education") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      `2. Ne yapılabilir: ${policy.fallbackGuidance.action}`,
      `3. Dikkat edilmesi gerekenler: ${policy.fallbackGuidance.caution}`,
      `4. Kısa özet: ${queryNote} ${policy.fallbackGuidance.summary}`,
    ].join("\n");
  }

  return [
    `1. Genel değerlendirme: ${sourceNote}`,
    `2. Ne yapmalı: ${policy.fallbackGuidance.action}`,
    `3. Ne zaman doktora başvurmalı: ${policy.fallbackGuidance.caution}`,
    `4. Kısa özet: ${queryNote} ${policy.fallbackGuidance.summary}`,
  ].join("\n");
}

export function evaluateSafetyGate(opts: SafetyInput): SafetyGateResult {
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const answerText = opts.answerText.trim();
  const query = opts.answer.user_query;
  const combined = [answerText, opts.answer.answer, opts.answer.condition_context, opts.answer.safe_action].join(" ");
  const evidence = opts.evidence ?? null;
  const routeDecision = opts.sourceSelection?.routeDecision;
  const hasEvidenceSignals = Boolean(evidence || opts.answerSpec);
  const usableFactCount = evidence?.usableFacts.length ?? opts.answerSpec?.facts.length ?? 0;
  const redFlagCount = evidence?.redFlags.length ?? opts.answerSpec?.caution.length ?? 0;
  const sourceCollectionIds = new Set(opts.sources.map((source) => source.collectionId).filter(Boolean));
  const accessibleCollectionIds = new Set(opts.sourceSelection?.accessibleCollectionIds ?? []);

  if (!answerText) {
    blockedReasons.push("EMPTY_ANSWER");
  }

  if (opts.retrievalWasUsed && opts.sources.length === 0) {
    blockedReasons.push("MISSING_SOURCES");
  }

  if (routeDecision?.mode === "suggest" && opts.sources.length === 0) {
    warnings.push("SUGGEST_MODE_NO_GROUNDED_SOURCES");
  }

  if (opts.retrievalWasUsed && hasEvidenceSignals && usableFactCount === 0) {
    blockedReasons.push("NO_USABLE_FACTS");
  }

  const policy = getDomainSafetyPolicy(opts.answer.answer_domain);

  if (getRiskyCertaintyPatterns(opts.answer.answer_domain).some((pattern) => pattern.test(combined))) {
    blockedReasons.push("RISKY_CERTAINTY_OR_TREATMENT");
  }

  if (hasLowLanguageQuality(answerText)) {
    blockedReasons.push("LOW_LANGUAGE_QUALITY");
  }

  if (
    opts.retrievalWasUsed &&
    opts.answer.grounding_confidence === "low" &&
    LOW_GROUNDING_OVERCONFIDENCE_PATTERNS.some((pattern) => pattern.test(answerText))
  ) {
    blockedReasons.push("LOW_GROUNDING_OVERCONFIDENCE");
  }

  if (opts.retrievalWasUsed && hasSourceMetadataMismatch(opts.answer, opts.sources)) {
    blockedReasons.push("SOURCE_METADATA_MISMATCH");
  }

  if (
    accessibleCollectionIds.size > 0 &&
    [...sourceCollectionIds].some((collectionId) => !accessibleCollectionIds.has(collectionId))
  ) {
    blockedReasons.push("PRIVATE_SOURCE_SCOPE_MISMATCH");
  }

  if (
    includesAny(query, policy.redFlagTerms) &&
    !includesAny(answerText, policy.requiredGuidanceTerms)
  ) {
    blockedReasons.push("RED_FLAG_WITHOUT_URGENT_GUIDANCE");
  }

  if (answerText.length < 40 && opts.retrievalWasUsed) {
    blockedReasons.push("ANSWER_TOO_THIN");
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
  const severity: SafetySeverity = pass ? (warnings.length > 0 ? "warn" : "pass") : "rewrite";
  return {
    pass,
    severity,
    blockedReasons,
    warnings,
    requiredRewrite: !pass,
    fallbackMode,
    safeFallback: pass ? undefined : buildFallback(opts.answer, opts.sources),
    metrics: {
      sourceCount: opts.sources.length,
      usableFactCount,
      redFlagCount,
      answerLength: answerText.length,
    },
  };
}
