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

function typoTolerantTerms(tokens: string[]): string[] {
  const terms: string[] = [];
  for (const token of tokens) {
    if (/^agri\w*$/.test(token) || /^agr[yi]\w*$/.test(token)) {
      terms.push("agri", "agriyor", "agri agrisi");
    }
    if (/^kasik\w*$/.test(token) || /^kasig\w*$/.test(token)) {
      terms.push("kasik", "kasik agrisi", "pelvik agri", "alt karin");
    }
    if (/^bas\w*$/.test(token) || token === "migren") {
      terms.push("bas", "bas agrisi", "migren");
    }
    if (/^karin\w*$/.test(token) || /^karn\w*$/.test(token) || token === "mide" || token === "gobek") {
      terms.push("karin", "karin agrisi", "mide", "gobek");
    }
  }
  return terms;
}

export function normalizeTurkishQuery(query: string, routePlan?: DomainRoutePlan | null): TurkishQueryNormalization {
  const normalized = normalizeConceptText(query);
  const tokens = tokenizeTurkishQuery(query);
  const routeTerms = routePlanTerms(routePlan);
  const surfaceTerms = expandSurfaceConceptTerms([query, ...routeTerms], 96);
  const expandedTokens = unique(
    [
      ...tokens,
      ...surfaceTerms,
      ...typoTolerantTerms(tokens),
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

export function buildExpandedQueryTokens(query: string, routePlan?: DomainRoutePlan | null, limit = 24): string[] {
  return normalizeTurkishQuery(query, routePlan).expandedTokens
    .filter((token) => token.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
}

export function buildExpandedQueryText(query: string, routePlan?: DomainRoutePlan | null, maxWords = 64): string {
  const normalized = normalizeTurkishQuery(query, routePlan);
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
