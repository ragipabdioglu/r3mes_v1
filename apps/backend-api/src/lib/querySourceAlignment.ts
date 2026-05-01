import type { KnowledgeCard } from "./knowledgeCard.js";
import type { DomainRoutePlan } from "./queryRouter.js";

export type AlignmentMode = "aligned" | "weak" | "mismatch";

export interface AlignmentScore {
  mode: AlignmentMode;
  score: number;
  matchedTerms: string[];
  queryTerms: string[];
  sourceTerms: string[];
  genericMatchedTerms: string[];
  reason: string;
}

export interface AlignmentDiagnostics {
  enabled: boolean;
  minScore: number;
  weakScore: number;
  inputCandidateCount: number;
  alignedCandidateCount: number;
  weakCandidateCount: number;
  mismatchCandidateCount: number;
  droppedCandidateCount: number;
  fastFailed: boolean;
}

const TURKISH_FOLD: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  İ: "i",
  ö: "o",
  ş: "s",
  ü: "u",
};

const STOPWORDS = new Set([
  "acaba",
  "ama",
  "bana",
  "beni",
  "benim",
  "bile",
  "bir",
  "bunu",
  "icin",
  "ile",
  "kisa",
  "mi",
  "mu",
  "mı",
  "ne",
  "neden",
  "nasil",
  "nasıl",
  "olarak",
  "once",
  "önce",
  "sonra",
  "var",
  "ve",
  "veya",
  "ya",
]);

const GENERIC_TERMS = new Set([
  "agri",
  "agrim",
  "agriyor",
  "belirti",
  "belirtiler",
  "bilgi",
  "durum",
  "genel",
  "hakkinda",
  "kaynak",
  "kontrol",
  "problem",
  "risk",
  "sikayet",
  "sorun",
  "takip",
  "uzman",
]);

function foldTurkish(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[çğıİöşü]/g, (char) => TURKISH_FOLD[char] ?? char)
    .toLocaleLowerCase("tr-TR");
}

export function normalizeAlignmentText(value: string): string {
  return foldTurkish(value)
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenKey(value: string): string {
  return normalizeAlignmentText(value);
}

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map(tokenKey).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

export function alignmentTokens(value: string, limit = 40): string[] {
  return unique(
    normalizeAlignmentText(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !STOPWORDS.has(token)),
    limit,
  );
}

function firstWords(value: string, maxWords: number): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function metadataText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const profile = record.profile && typeof record.profile === "object" ? record.profile as Record<string, unknown> : null;
  const readArray = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  return [
    record.domain,
    ...(readArray(record.domains)),
    ...(readArray(record.subtopics)),
    ...(readArray(record.keywords)),
    ...(readArray(record.tags)),
    ...(readArray(record.entities)),
    record.summary,
    profile?.summary,
    profile?.profileText,
    ...(profile ? readArray(profile.domains) : []),
    ...(profile ? readArray(profile.subtopics) : []),
    ...(profile ? readArray(profile.keywords) : []),
    ...(profile ? readArray(profile.entities) : []),
    ...(profile ? readArray(profile.sampleQuestions) : []),
  ].filter((item): item is string => typeof item === "string").join(" ");
}

function trigrams(value: string): Set<string> {
  const normalized = tokenKey(value);
  if (normalized.length <= 3) return new Set([normalized]);
  const grams = new Set<string>();
  for (let index = 0; index <= normalized.length - 3; index += 1) grams.add(normalized.slice(index, index + 3));
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function fuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter >= 4 || (shorter >= 3 && longer - shorter <= 2);
  }
  if (a.length < 4 || b.length < 4) return false;
  return jaccard(trigrams(a), trigrams(b)) >= 0.58;
}

function phraseTerms(value: string): string[] {
  const tokens = alignmentTokens(value, 24).filter((token) => !GENERIC_TERMS.has(token));
  const phrases: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return unique(phrases, 12);
}

export function buildQueryConceptTerms(query: string, routePlan?: DomainRoutePlan | null): string[] {
  void routePlan;
  return unique(
    [
      ...alignmentTokens(query, 32),
    ],
    48,
  );
}

function routeSubtopicTerms(routePlan?: DomainRoutePlan | null): string[] {
  if (!routePlan || routePlan.confidence !== "high") return [];
  return unique(
    routePlan.subtopics
      .flatMap((subtopic) => alignmentTokens(subtopic.replace(/_/g, " "), 8))
      .filter((term) => term.length >= 4)
      .filter((term) => !GENERIC_TERMS.has(term))
      .filter((term) => !["general", "genel"].includes(term)),
    12,
  );
}

export function buildSourceConceptText(opts: {
  title: string;
  content: string;
  card: KnowledgeCard;
  chunkMetadata?: unknown;
  documentMetadata?: unknown;
  maxWords: number;
}): string {
  return [
    opts.title,
    opts.card.topic,
    opts.card.tags.join(" "),
    metadataText(opts.chunkMetadata),
    metadataText(opts.documentMetadata),
    opts.card.patientSummary,
    opts.card.clinicalTakeaway,
    opts.card.safeGuidance,
    firstWords(opts.content, opts.maxWords),
  ].filter(Boolean).join("\n");
}

export function scoreQuerySourceAlignment(opts: {
  query: string;
  sourceText: string;
  routePlan?: DomainRoutePlan | null;
  minScore: number;
  weakScore: number;
  genericPenalty: number;
}): AlignmentScore {
  const queryTerms = buildQueryConceptTerms(opts.query, opts.routePlan);
  const sourceTerms = alignmentTokens(opts.sourceText, 80);
  const sourceText = normalizeAlignmentText(opts.sourceText);
  const importantQueryTerms = queryTerms.filter((term) => !GENERIC_TERMS.has(term));
  const genericQueryTerms = queryTerms.filter((term) => GENERIC_TERMS.has(term));
  const matchedTerms = importantQueryTerms.filter((queryTerm) =>
    sourceTerms.some((sourceTerm) => fuzzyMatch(queryTerm, sourceTerm)) || sourceText.includes(queryTerm),
  );
  const genericMatchedTerms = genericQueryTerms.filter((queryTerm) =>
    sourceTerms.some((sourceTerm) => fuzzyMatch(queryTerm, sourceTerm)) || sourceText.includes(queryTerm),
  );
  const phraseMatches = phraseTerms(opts.query).filter((phrase) => sourceText.includes(phrase));
  const denominator = Math.max(1, importantQueryTerms.length);
  const overlapScore = matchedTerms.length / denominator;
  const phraseBonus = phraseMatches.length > 0 ? 0.28 : 0;
  const routeDomainBonus =
    opts.routePlan?.domain && opts.routePlan.domain !== "general" && sourceTerms.includes(tokenKey(opts.routePlan.domain))
      ? 0.08
      : 0;
  const genericOnlyPenalty = matchedTerms.length === 0 && genericMatchedTerms.length > 0 ? opts.genericPenalty : 0;
  const routeSpecificTerms = routeSubtopicTerms(opts.routePlan);
  const hasRouteSpecificMatch =
    routeSpecificTerms.length === 0 ||
    routeSpecificTerms.some((term) => sourceTerms.some((sourceTerm) => fuzzyMatch(term, sourceTerm)) || sourceText.includes(term));
  const rawScore = Math.max(0, Math.min(1, overlapScore + phraseBonus + routeDomainBonus - genericOnlyPenalty));
  const score = hasRouteSpecificMatch ? rawScore : Math.min(rawScore, Math.max(0, opts.minScore - 0.001));
  const mode: AlignmentMode = score >= opts.weakScore ? "aligned" : score >= opts.minScore ? "weak" : "mismatch";
  const reason =
    mode === "mismatch"
      ? !hasRouteSpecificMatch
        ? "Source does not match the high-confidence route subtopic."
        : genericMatchedTerms.length > 0 && matchedTerms.length === 0
        ? "Only generic query terms matched the source."
        : "Query concepts did not match source concepts."
      : mode === "weak"
        ? "Source has partial concept overlap with the query."
        : "Source concepts align with the query.";
  return {
    mode,
    score: Number(score.toFixed(3)),
    matchedTerms: unique([...matchedTerms, ...phraseMatches], 12),
    queryTerms: unique(queryTerms, 20),
    sourceTerms: unique(sourceTerms, 24),
    genericMatchedTerms: unique(genericMatchedTerms, 8),
    reason,
  };
}
