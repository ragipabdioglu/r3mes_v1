import type { KnowledgeCard } from "./knowledgeCard.js";
import type { DomainRoutePlan } from "./queryRouter.js";
import { expandConceptTerms, inferCanonicalConcepts, normalizeConceptText } from "./conceptNormalizer.js";

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
  "lazim",
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
  "sakin",
  "sonra",
  "var",
  "ve",
  "veya",
  "yapabilirim",
  "yapabiliriz",
  "yapmali",
  "yapmaliyim",
  "yapmalıyım",
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

export function normalizeAlignmentText(value: string): string {
  return normalizeConceptText(value);
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
  const readArray = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  return [
    record.domain,
    ...(readArray(record.domains)),
    ...(readArray(record.subtopics)),
    ...(readArray(record.keywords)),
    ...(readArray(record.tags)),
    ...(readArray(record.entities)),
    ...(readArray(record.topicPhrases)),
    ...(readArray(record.answerableConcepts)),
    record.summary,
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

const TURKISH_SUFFIXES = [
  "larimizdan",
  "lerimizden",
  "larindan",
  "lerinden",
  "larimiz",
  "lerimiz",
  "lariniz",
  "leriniz",
  "larina",
  "lerine",
  "lardan",
  "lerden",
  "larin",
  "lerin",
  "lari",
  "leri",
  "imiz",
  "iniz",
  "indan",
  "inden",
  "undan",
  "unden",
  "im",
  "in",
  "um",
  "un",
  "si",
  "su",
  "dan",
  "den",
  "da",
  "de",
  "ya",
  "ye",
  "a",
  "e",
  "i",
  "u",
];

function softenFinalConsonant(value: string): string[] {
  if (value.length < 4) return [value];
  const last = value.at(-1);
  if (last === "g") return [value, `${value.slice(0, -1)}k`];
  if (last === "b") return [value, `${value.slice(0, -1)}p`];
  if (last === "d") return [value, `${value.slice(0, -1)}t`];
  return [value];
}

function tokenVariants(value: string): string[] {
  const normalized = tokenKey(value);
  const variants = new Set<string>(softenFinalConsonant(normalized));
  for (const suffix of TURKISH_SUFFIXES) {
    if (!normalized.endsWith(suffix)) continue;
    const stem = normalized.slice(0, -suffix.length);
    if (stem.length < 3) continue;
    for (const variant of softenFinalConsonant(stem)) variants.add(variant);
  }
  return [...variants];
}

function fuzzyMatch(a: string, b: string): boolean {
  for (const left of tokenVariants(a)) {
    for (const right of tokenVariants(b)) {
      if (left === right) return true;
      if (Math.min(left.length, right.length) <= 5) continue;
      if (left.startsWith(right) || right.startsWith(left)) {
        const shorter = Math.min(left.length, right.length);
        const longer = Math.max(left.length, right.length);
        if (shorter >= 4 || (shorter >= 3 && longer - shorter <= 2)) return true;
      }
      // Keep fuzzy trigram matching away from short body-part/entity terms like
      // "basim"; short Turkish words otherwise collide with unrelated verbs.
      if (left.length >= 6 && right.length >= 6 && jaccard(trigrams(left), trigrams(right)) >= 0.58) {
        return true;
      }
    }
  }
  return false;
}

function phraseTerms(value: string): string[] {
  const tokens = alignmentTokens(value, 24).filter((token) => !GENERIC_TERMS.has(token));
  const phrases: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return unique(phrases, 12);
}

function strictEntityTerms(value: string): string[] {
  const terms = new Set<string>();
  const broadAcronyms = new Set(["bist", "cmb", "ifrs", "kap", "pdf", "spk", "tsrs", "yk"]);
  const pattern = /\b(?:[A-ZÇĞİÖŞÜ]{3,8}|\d{6,12})\b/gu;
  for (const match of value.matchAll(pattern)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    const context = normalizeConceptText(value.slice(Math.max(0, start - 42), Math.min(value.length, start + raw.length + 42)));
    if (/(kullanma|karistirma|karistirmadan|degil|haric|olmasin|exclude|without|not)/u.test(context)) continue;
    const normalized = tokenKey(raw);
    if (!normalized || broadAcronyms.has(normalized) || ["json", "html"].includes(normalized)) continue;
    terms.add(normalized);
  }
  return [...terms].slice(0, 8);
}

export function buildQueryConceptTerms(query: string, routePlan?: DomainRoutePlan | null): string[] {
  void routePlan;
  return unique(
    [
      ...inferCanonicalConcepts(query),
      ...expandConceptTerms(query),
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
  const sourceTerms = unique(
    [
      ...inferCanonicalConcepts(opts.sourceText),
      ...expandConceptTerms(opts.sourceText),
      ...alignmentTokens(opts.sourceText, 80),
    ],
    96,
  );
  const sourceText = normalizeAlignmentText(opts.sourceText);
  const queryStrictEntities = strictEntityTerms(opts.query);
  const sourceStrictEntities = strictEntityTerms(opts.sourceText);
  const missingStrictEntities = queryStrictEntities.filter((term) => !sourceStrictEntities.includes(term));
  if (queryStrictEntities.length > 0 && missingStrictEntities.length > 0) {
    return {
      mode: "mismatch",
      score: 0,
      matchedTerms: [],
      queryTerms: unique([...queryTerms, ...queryStrictEntities], 20),
      sourceTerms: unique([...sourceTerms, ...sourceStrictEntities], 24),
      genericMatchedTerms: [],
      reason: `Strict query entities did not match the source: ${missingStrictEntities.join(", ")}.`,
    };
  }
  const importantQueryTerms = queryTerms.filter((term) => !GENERIC_TERMS.has(term));
  const genericQueryTerms = queryTerms.filter((term) => GENERIC_TERMS.has(term));
  const matchedTerms = importantQueryTerms.filter((queryTerm) =>
    sourceTerms.some((sourceTerm) => fuzzyMatch(queryTerm, sourceTerm)),
  );
  const genericMatchedTerms = genericQueryTerms.filter((queryTerm) =>
    sourceTerms.some((sourceTerm) => fuzzyMatch(queryTerm, sourceTerm)),
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
