import { expandSurfaceConceptTerms, normalizeConceptText } from "./conceptNormalizer.js";
import type { DomainRoutePlan } from "./queryRouter.js";

export interface TurkishQueryNormalization {
  original: string;
  normalized: string;
  tokens: string[];
  expandedTokens: string[];
  variants: string[];
}

const QUERY_STOPWORDS = new Set([
  "acaba",
  "ama",
  "bana",
  "beni",
  "benim",
  "bir",
  "bunu",
  "icin",
  "ile",
  "kisa",
  "lazim",
  "mi",
  "mu",
  "mı",
  "ne",
  "neden",
  "nasil",
  "nasıl",
  "olarak",
  "sakin",
  "var",
  "ve",
  "veya",
  "yapabilirim",
  "yapmali",
  "yapmaliyim",
  "yapmalıyım",
]);

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

export function tokenizeTurkishQuery(value: string, limit = 48): string[] {
  return unique(
    normalizeConceptText(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !QUERY_STOPWORDS.has(token)),
    limit,
  );
}

function routePlanTerms(routePlan?: DomainRoutePlan | null): string[] {
  if (!routePlan) return [];
  return [
    routePlan.domain,
    ...routePlan.subtopics.map((subtopic) => subtopic.replace(/_/g, " ")),
    ...routePlan.mustIncludeTerms,
    ...routePlan.retrievalHints,
  ];
}

export function normalizeTurkishQuery(
  query: string,
  routePlan?: DomainRoutePlan | null,
  extraTerms: string[] = [],
): TurkishQueryNormalization {
  const normalized = normalizeConceptText(query);
  const tokens = tokenizeTurkishQuery(query);
  const routeTerms = routePlanTerms(routePlan);
  const surfaceTerms = expandSurfaceConceptTerms([query, ...routeTerms, ...extraTerms], 128);
  const expandedTokens = unique(
    [
      ...tokens,
      ...surfaceTerms,
    ],
    96,
  );
  const variants = unique(
    [normalized, tokens.join(" "), expandedTokens.join(" ")],
    4,
  );

  return {
    original: query,
    normalized,
    tokens,
    expandedTokens,
    variants: [query, ...variants].slice(0, 4),
  };
}

export function buildExpandedQueryTokens(
  query: string,
  routePlan?: DomainRoutePlan | null,
  limit = 24,
  extraTerms: string[] = [],
): string[] {
  return normalizeTurkishQuery(query, routePlan, extraTerms).expandedTokens
    .filter((token) => token.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
}

export function buildExpandedQueryText(
  query: string,
  routePlan?: DomainRoutePlan | null,
  maxWords = 64,
  extraTerms: string[] = [],
): string {
  const normalized = normalizeTurkishQuery(query, routePlan, extraTerms);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of [normalized.original, normalized.normalized, ...normalized.expandedTokens]) {
    const key = normalizeConceptText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
    if (values.length >= maxWords) break;
  }
  return values.join(" ");
}
