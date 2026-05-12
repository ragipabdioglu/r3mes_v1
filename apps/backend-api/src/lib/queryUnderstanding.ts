import { expandSurfaceConceptTerms, inferCanonicalConcepts, normalizeConceptText } from "./conceptNormalizer.js";
import { detectConversationalIntent, type ConversationalIntentDecision } from "./conversationalIntent.js";
import { extractQuerySignals, type QuerySignals } from "./queryRouter.js";
import {
  normalizeTurkishQuery,
  type TurkishQueryNormalization,
} from "./turkishQueryNormalizer.js";

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

export interface QueryUnderstanding {
  original: string;
  normalized: TurkishQueryNormalization;
  signals: QuerySignals;
  concepts: string[];
  profileConcepts: string[];
  mode: QueryUnderstandingMode;
  retrievalIntent: QueryRetrievalIntent;
  conversationalIntent: ConversationalIntentDecision | null;
  confidence: "low" | "medium" | "high";
  warnings: string[];
}

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
  const matches: string[] = [];
  for (const term of terms) {
    const expanded = expandSurfaceConceptTerms(term, 24);
    if (expanded.some((part) => part.length >= 3 && (queryText.includes(part) || part.includes(queryText)))) {
      matches.push(term, ...expanded);
    }
  }
  return unique(matches, 32);
}

function inferConfidence(opts: {
  conversationalIntent: ConversationalIntentDecision | null;
  conceptCount: number;
  tokenCount: number;
  routeConfidence: QuerySignals["routeHints"]["confidence"];
}): QueryUnderstanding["confidence"] {
  if (opts.conversationalIntent?.confidence === "high") return "high";
  if (opts.conceptCount > 0 && opts.routeConfidence !== "low") return "high";
  if (opts.conceptCount > 0 || opts.tokenCount >= MIN_KNOWLEDGE_TOKEN_COUNT || opts.routeConfidence !== "low") {
    return "medium";
  }
  return "low";
}

function buildWarnings(opts: {
  mode: QueryUnderstandingMode;
  profileConceptCount: number;
  tokenCount: number;
  conceptCount: number;
  routeConfidence: QuerySignals["routeHints"]["confidence"];
}): string[] {
  const warnings: string[] = [];
  if (opts.mode === "knowledge" && opts.tokenCount < MIN_KNOWLEDGE_TOKEN_COUNT) {
    warnings.push("short_knowledge_query");
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
  const mode: QueryUnderstandingMode = conversationalIntent ? "conversation" : "knowledge";
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
    routeConfidence: signals.routeHints.confidence,
  });
  const warnings = buildWarnings({
    mode,
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
    mode,
    retrievalIntent,
    conversationalIntent,
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
    conceptCount: understanding.concepts.length,
    profileConceptCount: understanding.profileConcepts.length,
    concepts: understanding.concepts.slice(0, 8),
    profileConcepts: understanding.profileConcepts.slice(0, 8),
    retrievalIntent: understanding.retrievalIntent,
    language: understanding.signals.language,
    intent: understanding.signals.intent,
    routeDomain: understanding.signals.routeHints.domain,
    routeConfidence: understanding.signals.routeHints.confidence,
    warnings: understanding.warnings,
    conversationalIntent: understanding.conversationalIntent?.kind ?? null,
  };
}
