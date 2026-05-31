import { normalizeConceptText } from "./conceptNormalizer.js";
import type { RequestedField } from "./requestedFieldDetector.js";
import type { StructuredFact } from "./structuredFact.js";

const GENERIC_FIELD_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "bu",
  "de",
  "field",
  "gore",
  "hangi",
  "icin",
  "ile",
  "in",
  "is",
  "kaynak",
  "mi",
  "mu",
  "ne",
  "nedir",
  "of",
  "olan",
  "the",
  "ve",
]);

function normalize(value: string | null | undefined): string {
  return normalizeConceptText(value ?? "");
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !GENERIC_FIELD_STOPWORDS.has(token));
}

function significantTokens(value: string): string[] {
  return tokens(value).filter((token) => token.length >= 3 || /\d/u.test(token));
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map(normalize).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function structuredFactSearchText(fact: StructuredFact): string {
  return unique([
    fact.field ?? "",
    fact.subject ?? "",
    fact.table?.title ?? "",
    fact.table?.rowLabel ?? "",
    fact.table?.columnLabel ?? "",
    ...(fact.table?.headers ?? []),
    fact.table?.rawRow ?? "",
    fact.provenance.quote,
  ]).join(" ");
}

export function fieldTextMatchesFact(fieldText: string, fact: StructuredFact): boolean {
  const requested = normalize(fieldText);
  const factText = normalize(structuredFactSearchText(fact));
  if (!requested || !factText) return false;
  if (requested === factText || factText.includes(requested)) return true;

  const requestedTokens = significantTokens(requested);
  if (requestedTokens.length === 0) return false;
  const factTokens = new Set(tokens(factText));
  const matched = requestedTokens.filter((token) => factTokens.has(token));

  if (requestedTokens.length <= 2) return matched.length === requestedTokens.length;
  return matched.length >= Math.ceil(requestedTokens.length * 0.75);
}

export function requestedFieldMatchesFact(field: RequestedField, fact: StructuredFact): boolean {
  return unique([field.id, field.label, ...field.aliases]).some((candidate) => fieldTextMatchesFact(candidate, fact));
}

