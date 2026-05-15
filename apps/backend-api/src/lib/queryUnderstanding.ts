import { expandSurfaceConceptTerms, inferCanonicalConcepts, normalizeConceptText } from "./conceptNormalizer.js";
import { detectConversationalIntent, type ConversationalIntentDecision } from "./conversationalIntent.js";
import { extractQuerySignals, type QuerySignals } from "./queryRouter.js";
import {
  normalizeTurkishQuery,
  type TurkishQueryNormalization,
} from "./turkishQueryNormalizer.js";
import { detectAnswerTask, type AnswerTaskDetection } from "./answerTaskDetector.js";
import type { RequestedFieldDetection } from "./requestedFieldDetector.js";

export type QueryUnderstandingMode = "conversation" | "knowledge";
export type QueryRetrievalIntent = "conversation" | "knowledge_lookup" | "source_selection" | "unclear";

export interface QueryUnderstandingProfileInput {
  answerableConcepts?: string[];
  topicPhrases?: string[];
  entities?: string[];
  sampleQueries?: string[];
  tableConcepts?: string[];
}

export interface QueryUnderstandingOptions {
  profileTerms?: string[];
  profiles?: QueryUnderstandingProfileInput[];
}

export type QueryShape = "empty" | "short" | "normal" | "noisy";

export interface QueryQualitySignals {
  shape: QueryShape;
  clarityScore: number;
  tokenCount: number;
  expandedTokenCount: number;
  profileConceptCount: number;
  conceptCount: number;
  weakSignalCount: number;
}

export interface QueryUnderstanding {
  original: string;
  normalized: TurkishQueryNormalization;
  signals: QuerySignals;
  concepts: string[];
  profileConcepts: string[];
  quality: QueryQualitySignals;
  mode: QueryUnderstandingMode;
  retrievalIntent: QueryRetrievalIntent;
  conversationalIntent: ConversationalIntentDecision | null;
  answerTask: AnswerTaskDetection;
  requestedFieldDetection: RequestedFieldDetection;
  confidence: "low" | "medium" | "high";
  warnings: string[];
}

export type QueryUnderstandingV3 = QueryUnderstanding;

const MIN_KNOWLEDGE_TOKEN_COUNT = 2;

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map(normalizeConceptText).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function uniqueConceptIds(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function optionProfileTerms(opts?: QueryUnderstandingOptions): string[] {
  return unique(
    [
      ...(opts?.profileTerms ?? []),
      ...(opts?.profiles ?? []).flatMap((profile) => [
        ...(profile.answerableConcepts ?? []),
        ...(profile.topicPhrases ?? []),
        ...(profile.entities ?? []),
        ...(profile.sampleQueries ?? []),
        ...(profile.tableConcepts ?? []),
      ]),
    ],
    96,
  );
}

function profileTermsMatchingQuery(base: TurkishQueryNormalization, terms: string[]): string[] {
  const queryText = normalizeConceptText([
    base.normalized,
    ...base.tokens,
    ...base.expandedTokens,
  ].join(" "));
  const queryTerms = unique([
    ...base.tokens,
    ...base.expandedTokens,
    ...expandSurfaceConceptTerms(base.normalized, 96),
  ], 128);
  const matches: string[] = [];
  for (const term of terms) {
    const expanded = expandSurfaceConceptTerms(term, 24);
    if (expanded.some((part) =>
      part.length >= 3 &&
      (
        queryText.includes(part) ||
        part.includes(queryText) ||
        fuzzyTermOverlap(queryTerms, expandSurfaceConceptTerms(part, 24)) >= 0.64
      )
    )) {
      matches.push(term, ...expanded);
    }
  }
  return unique(matches, 32);
}

function fuzzyTermOverlap(leftTerms: string[], rightTerms: string[]): number {
  const left = unique(leftTerms, 64).filter((term) => term.length >= 4);
  const right = unique(rightTerms, 64).filter((term) => term.length >= 4);
  if (left.length === 0 || right.length === 0) return 0;
  let matched = 0;
  for (const rightTerm of right) {
    if (left.some((leftTerm) => tokenSimilarity(leftTerm, rightTerm) >= 0.72)) {
      matched += 1;
    }
  }
  return matched / Math.max(1, Math.min(right.length, 4));
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    return shorter / Math.max(1, longer);
  }
  return trigramDice(left, right);
}

function trigrams(value: string): string[] {
  const padded = `  ${value}  `;
  const grams: string[] = [];
  for (let index = 0; index <= padded.length - 3; index += 1) {
    grams.push(padded.slice(index, index + 3));
  }
  return grams;
}

function trigramDice(left: string, right: string): number {
  if (left.length < 4 || right.length < 4) return 0;
  const leftGrams = trigrams(left);
  const rightCounts = new Map<string, number>();
  for (const gram of trigrams(right)) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }
  let intersection = 0;
  for (const gram of leftGrams) {
    const count = rightCounts.get(gram) ?? 0;
    if (count <= 0) continue;
    intersection += 1;
    rightCounts.set(gram, count - 1);
  }
  return (2 * intersection) / Math.max(1, leftGrams.length + [...rightCounts.values()].reduce((sum, count) => sum + count, 0) + intersection);
}

function inferConfidence(opts: {
  conversationalIntent: ConversationalIntentDecision | null;
  conceptCount: number;
  tokenCount: number;
  clarityScore: number;
  routeConfidence: QuerySignals["routeHints"]["confidence"];
}): QueryUnderstanding["confidence"] {
  if (opts.conversationalIntent?.confidence === "high") return "high";
  if (opts.conceptCount > 0 && opts.routeConfidence !== "low" && opts.clarityScore >= 55) return "high";
  if (opts.conceptCount > 0 || opts.tokenCount >= MIN_KNOWLEDGE_TOKEN_COUNT || opts.routeConfidence !== "low" || opts.clarityScore >= 45) {
    return "medium";
  }
  return "low";
}

function inferQueryQuality(opts: {
  normalized: TurkishQueryNormalization;
  conceptCount: number;
  profileConceptCount: number;
  routeConfidence: QuerySignals["routeHints"]["confidence"];
}): QueryQualitySignals {
  const tokenCount = opts.normalized.tokens.length;
  const expandedTokenCount = opts.normalized.expandedTokens.length;
  const weakSignalCount =
    (opts.conceptCount > 0 ? 1 : 0) +
    (opts.profileConceptCount > 0 ? 1 : 0) +
    (opts.routeConfidence !== "low" ? 1 : 0) +
    (tokenCount >= MIN_KNOWLEDGE_TOKEN_COUNT ? 1 : 0);
  const expansionRatio = tokenCount === 0 ? 1 : expandedTokenCount / tokenCount;
  const noisyExpansionPenalty = expansionRatio > 10 ? 18 : expansionRatio > 6 ? 10 : 0;
  const shortPenalty = tokenCount === 0 ? 45 : tokenCount === 1 ? 20 : 0;
  const signalBonus = Math.min(40, weakSignalCount * 10);
  const conceptBonus = Math.min(30, (opts.conceptCount + opts.profileConceptCount) * 12);
  const tokenBonus = Math.min(20, tokenCount * 5);
  const clarityScore = Math.max(0, Math.min(100, 35 + signalBonus + conceptBonus + tokenBonus - shortPenalty - noisyExpansionPenalty));
  const shape: QueryShape =
    tokenCount === 0 ? "empty" :
      tokenCount < MIN_KNOWLEDGE_TOKEN_COUNT ? "short" :
        clarityScore < 45 || noisyExpansionPenalty >= 18 ? "noisy" :
          "normal";

  return {
    shape,
    clarityScore: Number(clarityScore.toFixed(3)),
    tokenCount,
    expandedTokenCount,
    profileConceptCount: opts.profileConceptCount,
    conceptCount: opts.conceptCount,
    weakSignalCount,
  };
}

function buildWarnings(opts: {
  mode: QueryUnderstandingMode;
  queryShape: QueryShape;
  clarityScore: number;
  profileConceptCount: number;
  tokenCount: number;
  conceptCount: number;
  routeConfidence: QuerySignals["routeHints"]["confidence"];
}): string[] {
  const warnings: string[] = [];
  if (opts.mode === "knowledge" && opts.tokenCount < MIN_KNOWLEDGE_TOKEN_COUNT) {
    warnings.push("short_knowledge_query");
  }
  if (opts.mode === "knowledge" && opts.queryShape === "noisy") {
    warnings.push("noisy_or_partial_query");
  }
  if (opts.mode === "knowledge" && opts.clarityScore < 45) {
    warnings.push("low_query_clarity");
  }
  if (opts.mode === "knowledge" && opts.conceptCount === 0 && opts.routeConfidence === "low") {
    warnings.push("weak_query_understanding");
  }
  if (opts.mode === "knowledge" && opts.profileConceptCount > 0) {
    warnings.push("profile_concept_expansion_used");
  }
  return warnings;
}

function inferRetrievalIntent(opts: {
  mode: QueryUnderstandingMode;
  tokenCount: number;
  conceptCount: number;
  profileConceptCount: number;
}): QueryRetrievalIntent {
  if (opts.mode === "conversation") return "conversation";
  if (opts.conceptCount > 0 || opts.profileConceptCount > 0 || opts.tokenCount >= MIN_KNOWLEDGE_TOKEN_COUNT) {
    return "knowledge_lookup";
  }
  return "unclear";
}

export function buildQueryUnderstanding(query: string, opts?: QueryUnderstandingOptions): QueryUnderstanding {
  const baseNormalized = normalizeTurkishQuery(query);
  const profileConcepts = profileTermsMatchingQuery(baseNormalized, optionProfileTerms(opts));
  const normalized = profileConcepts.length > 0 ? normalizeTurkishQuery(query, null, profileConcepts) : baseNormalized;
  const signals = extractQuerySignals(query);
  const concepts = uniqueConceptIds(
    [
      ...inferCanonicalConcepts(query),
      ...inferCanonicalConcepts(normalized.expandedTokens.join(" ")),
    ],
    16,
  );
  const conversationalIntent = detectConversationalIntent(query);
  const answerTask = detectAnswerTask(query);
  const requestedFieldDetection = answerTask.requestedFieldDetection;
  const mode: QueryUnderstandingMode = conversationalIntent ? "conversation" : "knowledge";
  const quality = inferQueryQuality({
    normalized,
    conceptCount: concepts.length,
    profileConceptCount: profileConcepts.length,
    routeConfidence: signals.routeHints.confidence,
  });
  const retrievalIntent = inferRetrievalIntent({
    mode,
    tokenCount: normalized.tokens.length,
    conceptCount: concepts.length,
    profileConceptCount: profileConcepts.length,
  });
  const confidence = inferConfidence({
    conversationalIntent,
    conceptCount: concepts.length + profileConcepts.length,
    tokenCount: normalized.tokens.length,
    clarityScore: quality.clarityScore,
    routeConfidence: signals.routeHints.confidence,
  });
  const warnings = buildWarnings({
    mode,
    queryShape: quality.shape,
    clarityScore: quality.clarityScore,
    profileConceptCount: profileConcepts.length,
    tokenCount: normalized.tokens.length,
    conceptCount: concepts.length + profileConcepts.length,
    routeConfidence: signals.routeHints.confidence,
  });

  return {
    original: query,
    normalized,
    signals,
    concepts,
    profileConcepts,
    quality,
    mode,
    retrievalIntent,
    conversationalIntent,
    answerTask,
    requestedFieldDetection,
    confidence,
    warnings,
  };
}

export function summarizeQueryUnderstandingForTrace(
  understanding: QueryUnderstanding,
): Record<string, unknown> {
  return {
    mode: understanding.mode,
    confidence: understanding.confidence,
    normalized: understanding.normalized.normalized,
    tokenCount: understanding.normalized.tokens.length,
    expandedTokenCount: understanding.normalized.expandedTokens.length,
    queryShape: understanding.quality.shape,
    clarityScore: understanding.quality.clarityScore,
    weakSignalCount: understanding.quality.weakSignalCount,
    conceptCount: understanding.concepts.length,
    profileConceptCount: understanding.profileConcepts.length,
    concepts: understanding.concepts.slice(0, 8),
    profileConcepts: understanding.profileConcepts.slice(0, 8),
    retrievalIntent: understanding.retrievalIntent,
    answerTask: {
      taskType: understanding.answerTask.taskType,
      answerIntent: understanding.answerTask.answerIntent,
      confidence: understanding.answerTask.confidence,
      targetDocumentHints: understanding.answerTask.targetDocumentHints,
      forbiddenAdditions: understanding.answerTask.forbiddenAdditions,
      taskReasons: understanding.answerTask.diagnostics.taskReasons,
    },
    requestedFieldCount: understanding.requestedFieldDetection.requestedFields.length,
    requestedFields: understanding.requestedFieldDetection.requestedFields.slice(0, 8).map((field) => ({
      id: field.id,
      label: field.label,
      outputHint: field.outputHint,
      confidence: field.confidence,
    })),
    outputConstraints: understanding.answerTask.outputConstraints,
    language: understanding.signals.language,
    intent: understanding.signals.intent,
    routeDomain: understanding.signals.routeHints.domain,
    routeConfidence: understanding.signals.routeHints.confidence,
    warnings: understanding.warnings,
    conversationalIntent: understanding.conversationalIntent?.kind ?? null,
  };
}
