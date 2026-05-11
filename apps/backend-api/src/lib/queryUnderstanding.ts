import { inferCanonicalConcepts, normalizeConceptText } from "./conceptNormalizer.js";
import { detectConversationalIntent, type ConversationalIntentDecision } from "./conversationalIntent.js";
import { extractQuerySignals, type QuerySignals } from "./queryRouter.js";
import {
  normalizeTurkishQuery,
  type TurkishQueryNormalization,
} from "./turkishQueryNormalizer.js";

export type QueryUnderstandingMode = "conversation" | "knowledge";

export interface QueryUnderstanding {
  original: string;
  normalized: TurkishQueryNormalization;
  signals: QuerySignals;
  concepts: string[];
  mode: QueryUnderstandingMode;
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
  return warnings;
}

export function buildQueryUnderstanding(query: string): QueryUnderstanding {
  const normalized = normalizeTurkishQuery(query);
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
  const confidence = inferConfidence({
    conversationalIntent,
    conceptCount: concepts.length,
    tokenCount: normalized.tokens.length,
    routeConfidence: signals.routeHints.confidence,
  });
  const warnings = buildWarnings({
    mode,
    tokenCount: normalized.tokens.length,
    conceptCount: concepts.length,
    routeConfidence: signals.routeHints.confidence,
  });

  return {
    original: query,
    normalized,
    signals,
    concepts,
    mode,
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
    concepts: understanding.concepts.slice(0, 8),
    language: understanding.signals.language,
    intent: understanding.signals.intent,
    routeDomain: understanding.signals.routeHints.domain,
    routeConfidence: understanding.signals.routeHints.confidence,
    warnings: understanding.warnings,
    conversationalIntent: understanding.conversationalIntent?.kind ?? null,
  };
}
