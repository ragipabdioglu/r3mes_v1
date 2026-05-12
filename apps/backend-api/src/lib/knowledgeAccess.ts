import { prisma } from "./prisma.js";
import type { AnswerDomain } from "./answerSchema.js";
import { cosineSimilarity, embedKnowledgeText, getKnowledgeEmbeddingDimensions } from "./knowledgeEmbedding.js";
import { parseKnowledgeCard } from "./knowledgeCard.js";
import { extractQuerySignals, routeQuery, type DomainRoutePlan } from "./queryRouter.js";
import { explainWeightedRouterScore, getRouterWeights, type RouterScoreBreakdown } from "./routerConfig.js";
import { expandSurfaceConceptTerms, normalizeConceptText } from "./conceptNormalizer.js";
import { buildExpandedQueryText, buildExpandedQueryTokens } from "./turkishQueryNormalizer.js";
import { buildQueryUnderstanding } from "./queryUnderstanding.js";

interface KnowledgeMetadataProfile {
  domain: string;
  domains: string[];
  subtopics: string[];
  keywords: string[];
  entities: string[];
  topicPhrases: string[];
  answerableConcepts: string[];
  negativeHints: string[];
  tableConcepts: string[];
  summary: string;
  profileText?: string;
  profileEmbedding?: number[];
  summaryEmbedding?: number[];
  sampleQuestionsEmbedding?: number[];
  keywordsEmbedding?: number[];
  entityEmbedding?: number[];
  profileVersion?: number;
  lastProfiledAt?: string;
  questionsAnswered: string[];
  confidence?: "low" | "medium" | "high";
  sourceQuality?: "structured" | "inferred" | "thin";
  ingestionQuality?: {
    tableRisk?: "none" | "low" | "medium" | "high";
    ocrRisk?: "none" | "low" | "medium" | "high";
    thinSource?: boolean;
    strictRouteEligible?: boolean;
  };
}

export interface KnowledgeCollectionAccessItem {
  id: string;
  name: string;
  visibility: "PRIVATE" | "PUBLIC";
  updatedAt?: Date | string;
  autoMetadata?: unknown;
  documents?: Array<{
    title: string;
    updatedAt?: Date | string;
    autoMetadata?: unknown;
    chunks: Array<{ content: string }>;
  }>;
}

export interface KnowledgeMetadataRouteCandidate {
  id: string;
  name: string;
  score: number;
  scoreBreakdown?: RouterScoreBreakdown & {
    scoringMode: "route_profile" | "query_profile";
    adaptiveBonus?: number;
  };
  domain: string | null;
  subtopics: string[];
  matchedTerms: string[];
  reason: string;
  sourceQuality: "structured" | "inferred" | "thin" | null;
}

export interface KnowledgeRouteDecision {
  mode: "strict" | "broad" | "suggest" | "no_source";
  primaryDomain: DomainRoutePlan["domain"] | null;
  confidence: "low" | "medium" | "high";
  selectedCollectionIds: string[];
  usedCollectionIds: string[];
  suggestedCollectionIds: string[];
  rejectedCollectionIds: string[];
  reasons: string[];
}

function readMetadataProfile(
  value: unknown,
  opts: { includeFallbackEmbedding?: boolean } = {},
): KnowledgeMetadataProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const stringArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  const ingestionQuality = readIngestionQuality(record.ingestionQuality);
  const profile = record.profile && typeof record.profile === "object" ? record.profile as Record<string, unknown> : null;
  if (profile) {
    const domains = stringArray(profile.domains);
    if (domains.length > 0) {
      const profileText = typeof profile.profileText === "string" ? profile.profileText : undefined;
      const includeFallbackEmbedding = opts.includeFallbackEmbedding !== false;
      return {
        domain: domains[0],
        domains,
        subtopics: stringArray(profile.subtopics),
        keywords: stringArray(profile.keywords),
        entities: stringArray(profile.entities),
        topicPhrases: stringArray(profile.topicPhrases),
        answerableConcepts: stringArray(profile.answerableConcepts),
        negativeHints: stringArray(profile.negativeHints),
        tableConcepts: stringArray(profile.tableConcepts),
        summary: typeof profile.summary === "string" ? profile.summary : "",
        profileText,
        profileEmbedding: numberArray(profile.profileEmbedding) ?? (
          includeFallbackEmbedding && profileText ? embedKnowledgeText(profileText) : undefined
        ),
        summaryEmbedding: numberArray(profile.summaryEmbedding),
        sampleQuestionsEmbedding: numberArray(profile.sampleQuestionsEmbedding),
        keywordsEmbedding: numberArray(profile.keywordsEmbedding),
        entityEmbedding: numberArray(profile.entityEmbedding),
        profileVersion: typeof profile.profileVersion === "number" ? profile.profileVersion : undefined,
        lastProfiledAt: typeof profile.lastProfiledAt === "string" ? profile.lastProfiledAt : undefined,
        questionsAnswered: stringArray(profile.sampleQuestions),
        confidence: profile.confidence === "high" || profile.confidence === "medium" || profile.confidence === "low" ? profile.confidence : undefined,
        sourceQuality: profile.sourceQuality === "structured" || profile.sourceQuality === "inferred" || profile.sourceQuality === "thin" ? profile.sourceQuality : undefined,
        ingestionQuality,
      };
    }
  }
  if (typeof record.domain !== "string") return null;
  return {
    domain: record.domain,
    domains: [record.domain],
    subtopics: stringArray(record.subtopics),
    keywords: stringArray(record.keywords),
    entities: stringArray(record.entities),
    topicPhrases: [],
    answerableConcepts: [],
    negativeHints: [],
    tableConcepts: [],
    summary: typeof record.summary === "string" ? record.summary : "",
    questionsAnswered: stringArray(record.questionsAnswered),
    ingestionQuality,
  };
}

function readProfileVersionMetadata(value: unknown): Pick<
  KnowledgeMetadataProfile,
  "profileVersion" | "lastProfiledAt" | "sourceQuality" | "confidence" | "tableConcepts" | "ingestionQuality"
> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const profile = record.profile && typeof record.profile === "object"
    ? record.profile as Record<string, unknown>
    : record;
  const stringArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  return {
    profileVersion: typeof profile.profileVersion === "number" ? profile.profileVersion : undefined,
    lastProfiledAt: typeof profile.lastProfiledAt === "string" ? profile.lastProfiledAt : undefined,
    sourceQuality: profile.sourceQuality === "structured" || profile.sourceQuality === "inferred" || profile.sourceQuality === "thin"
      ? profile.sourceQuality
      : undefined,
    confidence: profile.confidence === "high" || profile.confidence === "medium" || profile.confidence === "low"
      ? profile.confidence
      : undefined,
    tableConcepts: stringArray(profile.tableConcepts),
    ingestionQuality: readIngestionQuality(record.ingestionQuality),
  };
}

function readIngestionQuality(value: unknown): KnowledgeMetadataProfile["ingestionQuality"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const validRisk = (input: unknown): "none" | "low" | "medium" | "high" | undefined =>
    input === "none" || input === "low" || input === "medium" || input === "high" ? input : undefined;
  return {
    tableRisk: validRisk(record.tableRisk),
    ocrRisk: validRisk(record.ocrRisk),
    thinSource: typeof record.thinSource === "boolean" ? record.thinSource : undefined,
    strictRouteEligible: typeof record.strictRouteEligible === "boolean" ? record.strictRouteEligible : undefined,
  };
}

function metadataText(value: unknown): string {
  const profile = readMetadataProfile(value, { includeFallbackEmbedding: false });
  if (!profile) return "";
  return metadataTextFromProfile(profile);
}

function metadataTextFromProfile(profile: KnowledgeMetadataProfile): string {
  const compact = (input: string, limit: number) => input.slice(0, limit);
  const parts = [
    ...profile.domains.slice(0, 8),
    ...profile.subtopics.slice(0, 16),
    ...profile.keywords.slice(0, 32),
    ...profile.entities.slice(0, 24),
    ...profile.topicPhrases.slice(0, 24),
    ...profile.answerableConcepts.slice(0, 32),
    ...profile.tableConcepts.slice(0, 18),
    compact(profile.summary, 900),
    compact(profile.profileText ?? "", 1_200),
    ...profile.questionsAnswered.slice(0, 12),
  ];
  return parts.join(" ");
}

function collectionMetadataText(collection: KnowledgeCollectionAccessItem): string {
  const docs = collection.documents ?? [];
  const parts = [collection.name, metadataText(collection.autoMetadata)];
  for (const doc of docs.slice(0, 5)) {
    const content = doc.chunks[0]?.content ?? "";
    const card = content ? parseKnowledgeCard(content) : null;
    parts.push(doc.title, metadataText(doc.autoMetadata), card?.topic ?? "", ...(card?.tags ?? []));
  }
  return parts.join(" ");
}

function collectionProfileText(collection: KnowledgeCollectionAccessItem): string {
  return readCollectionProfileCache(collection).profileText;
}

function collectionMetadataProfiles(collection: KnowledgeCollectionAccessItem): KnowledgeMetadataProfile[] {
  return readCollectionProfileCache(collection).profiles;
}

function normalize(text: string): string {
  return normalizeConceptText(text);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const METADATA_ROUTE_CACHE_TTL_MS = parsePositiveInt(process.env.R3MES_METADATA_ROUTE_CACHE_TTL_MS, 60_000);
const METADATA_ROUTE_CACHE_MAX_ENTRIES = parsePositiveInt(process.env.R3MES_METADATA_ROUTE_CACHE_MAX_ENTRIES, 200);
const METADATA_ROUTE_SCORING_POOL_LIMIT = parsePositiveInt(
  process.env.R3MES_METADATA_ROUTE_SCORING_POOL_LIMIT,
  16,
);

const metadataRouteCandidateCache = new Map<
  string,
  { expiresAt: number; candidates: KnowledgeMetadataRouteCandidate[] }
>();
const collectionProfileCache = new Map<
  string,
  { expiresAt: number; profiles: KnowledgeMetadataProfile[]; profileText: string }
>();

function collectionProfileVersion(value: unknown): string {
  const profile = readProfileVersionMetadata(value);
  return [
    profile?.profileVersion ?? "0",
    profile?.lastProfiledAt ?? "",
    profile?.sourceQuality ?? "",
    profile?.confidence ?? "",
    profile?.ingestionQuality?.strictRouteEligible === false ? "strict:false" : "",
    profile?.ingestionQuality?.thinSource === true ? "thin:true" : "",
    profile?.ingestionQuality?.ocrRisk ?? "",
    profile?.ingestionQuality?.tableRisk ?? "",
    profile?.tableConcepts.slice(0, 8).join("|") ?? "",
  ].join(":");
}

function collectionCacheKey(collection: KnowledgeCollectionAccessItem): string {
  return [
    collection.id,
    timestampKey(collection.updatedAt),
    collectionProfileVersion(collection.autoMetadata),
    ...(collection.documents ?? []).slice(0, 6).map((document) => [
      document.title,
      timestampKey(document.updatedAt),
      collectionProfileVersion(document.autoMetadata),
    ].join("~")),
  ].join("::");
}

function readCollectionProfileCache(collection: KnowledgeCollectionAccessItem): {
  profiles: KnowledgeMetadataProfile[];
  profileText: string;
} {
  const key = collectionCacheKey(collection);
  const cached = collectionProfileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      profiles: cached.profiles,
      profileText: cached.profileText,
    };
  }
  if (cached) collectionProfileCache.delete(key);
  if (collectionProfileCache.size >= METADATA_ROUTE_CACHE_MAX_ENTRIES) {
    const oldestKey = collectionProfileCache.keys().next().value;
    if (oldestKey) collectionProfileCache.delete(oldestKey);
  }
  const docs = collection.documents ?? [];
  const profiles = [
    readMetadataProfile(collection.autoMetadata, { includeFallbackEmbedding: false }),
    ...docs.map((document) => readMetadataProfile(document.autoMetadata, { includeFallbackEmbedding: false })),
  ].filter((item): item is KnowledgeMetadataProfile => Boolean(item)).slice(0, 6);
  const profileText = [
    collection.name,
    profiles[0] ? metadataTextFromProfile(profiles[0]) : "",
    ...docs.slice(0, 5).flatMap((doc, index) => [
      doc.title,
      profiles[index + 1] ? metadataTextFromProfile(profiles[index + 1]) : "",
    ]),
  ].join(" ");
  collectionProfileCache.set(key, {
    expiresAt: Date.now() + METADATA_ROUTE_CACHE_TTL_MS,
    profiles,
    profileText,
  });
  return { profiles, profileText };
}

function timestampKey(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : "";
}

function metadataRouteCacheKey(opts: {
  collections: KnowledgeCollectionAccessItem[];
  routePlan: DomainRoutePlan | null;
  query?: string;
  excludedIds: Set<string>;
  limit: number;
  fast?: boolean;
}): string {
  const route = opts.routePlan
    ? [
        opts.routePlan.domain,
        opts.routePlan.confidence,
        ...opts.routePlan.subtopics,
        ...opts.routePlan.mustIncludeTerms,
        ...opts.routePlan.retrievalHints,
      ].join("|")
    : "no-route";
  const collectionSignature = opts.collections
    .map((collection) => [
      collection.id,
      timestampKey(collection.updatedAt),
      collectionProfileVersion(collection.autoMetadata),
      ...(collection.documents ?? []).slice(0, 6).map((document) => [
        document.title,
        timestampKey(document.updatedAt),
        collectionProfileVersion(document.autoMetadata),
      ].join("~")),
    ].join("~"))
    .sort()
    .join(";");
  const excluded = [...opts.excludedIds].sort().join(",");
  return [
    normalize(opts.query ?? ""),
    route,
    excluded,
    opts.limit,
    opts.fast === true ? "fast" : "full",
    collectionSignature,
  ].join("||");
}

function readMetadataRouteCandidateCache(key: string): KnowledgeMetadataRouteCandidate[] | null {
  const cached = metadataRouteCandidateCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    metadataRouteCandidateCache.delete(key);
    return null;
  }
  return cached.candidates.map((candidate) => ({ ...candidate }));
}

function writeMetadataRouteCandidateCache(key: string, candidates: KnowledgeMetadataRouteCandidate[]): void {
  if (METADATA_ROUTE_CACHE_TTL_MS <= 0) return;
  if (metadataRouteCandidateCache.size >= METADATA_ROUTE_CACHE_MAX_ENTRIES) {
    const oldestKey = metadataRouteCandidateCache.keys().next().value;
    if (oldestKey) metadataRouteCandidateCache.delete(oldestKey);
  }
  metadataRouteCandidateCache.set(key, {
    expiresAt: Date.now() + METADATA_ROUTE_CACHE_TTL_MS,
    candidates: candidates.map((candidate) => ({ ...candidate })),
  });
}

export function readKnowledgeCollectionSourceQuality(
  collection: KnowledgeCollectionAccessItem,
): "structured" | "inferred" | "thin" | null {
  return readProfileVersionMetadata(collection.autoMetadata)?.sourceQuality ?? null;
}

export function readKnowledgeCollectionStrictRouteEligible(
  collection: KnowledgeCollectionAccessItem,
): boolean {
  const metadata = readProfileVersionMetadata(collection.autoMetadata);
  if (metadata?.sourceQuality === "thin") return false;
  const ingestionQuality = metadata?.ingestionQuality;
  if (ingestionQuality?.strictRouteEligible === false) return false;
  if (ingestionQuality?.thinSource === true) return false;
  if (ingestionQuality?.ocrRisk === "high") return false;
  return true;
}

function normalizeProfileDomain(value: string): AnswerDomain | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (["medical", "health", "saglik", "saglık", "sağlik", "sağlık"].includes(normalized)) return "medical";
  if (["legal", "law", "hukuk", "adalet"].includes(normalized)) return "legal";
  if (["technical", "tech", "teknik", "devops", "software", "yazilim", "yazılım"].includes(normalized)) return "technical";
  if (["education", "egitim", "eğitim", "okul", "meb", "school"].includes(normalized)) return "education";
  if (["finance", "financial", "finans", "ekonomi"].includes(normalized)) return "finance";
  if (["general", "genel"].includes(normalized)) return "general";
  return null;
}

export function inferKnowledgeCollectionAnswerDomain(opts: {
  collections: KnowledgeCollectionAccessItem[];
  usedCollectionIds?: string[];
}): AnswerDomain | null {
  const usedIds = new Set((opts.usedCollectionIds ?? []).filter(Boolean));
  const scopedCollections = usedIds.size > 0
    ? opts.collections.filter((collection) => usedIds.has(collection.id))
    : opts.collections;
  const collectionCounts = new Map<AnswerDomain, number>();
  const fallbackCounts = new Map<AnswerDomain, number>();

  for (const collection of scopedCollections) {
    const collectionProfile = readMetadataProfile(collection.autoMetadata);
    const collectionDomains = unique([
      collectionProfile?.domain ?? "",
      ...(collectionProfile?.domains ?? []),
    ])
      .map(normalizeProfileDomain)
      .filter((domain): domain is AnswerDomain => Boolean(domain) && domain !== "general");
    for (const domain of collectionDomains) {
      collectionCounts.set(domain, (collectionCounts.get(domain) ?? 0) + 1);
    }

    const documentDomains = unique(
      (collection.documents ?? []).flatMap((document) => {
        const profile = readMetadataProfile(document.autoMetadata);
        return [profile?.domain ?? "", ...(profile?.domains ?? [])];
      }),
    )
      .map(normalizeProfileDomain)
      .filter((domain): domain is AnswerDomain => Boolean(domain) && domain !== "general");

    for (const domain of documentDomains) {
      fallbackCounts.set(domain, (fallbackCounts.get(domain) ?? 0) + 1);
    }
  }

  const counts = collectionCounts.size > 0 ? collectionCounts : fallbackCounts;
  if (counts.size === 0) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [bestDomain, bestCount] = ranked[0];
  const secondCount = ranked[1]?.[1] ?? 0;
  return bestCount > secondCount ? bestDomain : null;
}

function numberArray(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input.map(Number).filter((item) => Number.isFinite(item));
  return values.length === getKnowledgeEmbeddingDimensions() ? values : undefined;
}

function routeSignalText(routePlan: DomainRoutePlan | null, query?: string): string {
  return [
    query ?? "",
    routePlan?.domain ?? "",
    ...(routePlan?.subtopics ?? []),
    ...(routePlan?.mustIncludeTerms ?? []),
    ...(routePlan?.retrievalHints ?? []),
  ].join(" ");
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function containsTerm(text: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;
  return normalize(text).includes(normalizedTerm);
}

function containsTermInNormalizedText(normalizedText: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;
  return normalizedText.includes(normalizedTerm);
}

const QUERY_STOPWORDS = new Set([
  "acaba",
  "ama",
  "bana",
  "benim",
  "bunu",
  "icin",
  "için",
  "ile",
  "kisa",
  "kısa",
  "mi",
  "mı",
  "mu",
  "ne",
  "neden",
  "nasil",
  "nasıl",
  "olur",
  "var",
  "ve",
  "veya",
]);

const GENERIC_QUERY_TERMS = new Set([
  "agri",
  "ağrı",
  "agrim",
  "ağrım",
  "agriyor",
  "ağrıyor",
  "belirti",
  "bilgi",
  "durum",
  "genel",
  "hakkinda",
  "hakkında",
  "kaynak",
  "kontrol",
  "problem",
  "risk",
  "sikayet",
  "şikayet",
  "sorun",
  "takip",
]);

function queryTokens(query: string): string[] {
  return unique(
    buildExpandedQueryTokens(query, null, 64)
      .filter((token) => token.length >= 3)
      .filter((token) => !token.includes(" "))
      .filter((token) => !QUERY_STOPWORDS.has(normalize(token))),
  ).slice(0, 24);
}

function queryConceptTerms(query: string): string[] {
  return unique([
    ...queryTokens(query),
    ...expandSurfaceConceptTerms(query, 32),
  ]).filter((token) => !GENERIC_QUERY_TERMS.has(token)).slice(0, 32);
}

function queryUnderstandingProfileInput(profile?: KnowledgeMetadataProfile): Parameters<typeof buildQueryUnderstanding>[1] {
  if (!profile) return undefined;
  return {
    profiles: [
      {
        answerableConcepts: profile.answerableConcepts,
        topicPhrases: profile.topicPhrases,
        entities: profile.entities,
        sampleQueries: profile.questionsAnswered,
        tableConcepts: profile.tableConcepts,
      },
    ],
  };
}

function queryProfileSignals(query: string, profile?: KnowledgeMetadataProfile): string[] {
  const understanding = buildQueryUnderstanding(query, queryUnderstandingProfileInput(profile));
  const signals = extractQuerySignals(query);
  return unique([
    ...understanding.concepts,
    ...understanding.profileConcepts,
    ...signals.phraseHints,
    ...signals.namedEntities,
    ...signals.significantTerms,
    ...understanding.normalized.expandedTokens.slice(0, 32),
  ]).filter((token) => !GENERIC_QUERY_TERMS.has(normalize(token))).slice(0, 32);
}

function queryProfileSignalText(query: string): string {
  const understanding = buildQueryUnderstanding(query);
  return unique([
    buildExpandedQueryText(query, null, 48),
    understanding.normalized.normalized,
    ...understanding.normalized.expandedTokens.slice(0, 48),
    ...understanding.concepts,
    ...queryProfileSignals(query),
  ]).join(" ");
}

function queryAdaptiveTerms(query: string, profile?: KnowledgeMetadataProfile): string[] {
  return unique([
    ...queryProfileSignals(query, profile),
    ...queryConceptTerms(query),
  ]).filter((token) => !GENERIC_QUERY_TERMS.has(normalize(token))).slice(0, 48);
}

function profileAnswerableTerms(profile: KnowledgeMetadataProfile): string[] {
  return expandSurfaceConceptTerms([
    ...profile.topicPhrases,
    ...profile.answerableConcepts,
    ...profile.tableConcepts,
    ...profile.entities,
    ...profile.subtopics.map((subtopic) => subtopic.replace(/_/g, " ")),
  ], 96);
}

function metadataProfileMatchesDomain(profile: KnowledgeMetadataProfile, domain: string): boolean {
  const normalizedDomain = normalize(domain);
  return profile.domains.map(normalize).includes(normalizedDomain) || normalize(metadataText(profile)).includes(normalizedDomain);
}

function percentScore(matches: number, possible: number): number {
  if (possible <= 0) return 0;
  return Math.min(100, (matches / possible) * 100);
}

function cheapMetadataCandidateScore(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): number {
  const text = collectionProfileText(collection);
  const primaryProfile = collectionMetadataProfiles(collection)[0];
  return cheapMetadataCandidateScoreFromProfileText(collection, text, primaryProfile, routePlan, query);
}

function cheapMetadataCandidateScoreFromProfileText(
  collection: KnowledgeCollectionAccessItem,
  text: string,
  primaryProfile: KnowledgeMetadataProfile | undefined,
  routePlan: DomainRoutePlan | null,
  query?: string,
): number {
  const queryTerms = query?.trim() ? queryAdaptiveTerms(query) : [];
  const routeTerms =
    routePlan && routePlan.domain !== "general"
      ? [
          routePlan.domain,
          ...routePlan.subtopics.map((subtopic) => subtopic.replace(/_/g, " ")),
          ...routePlan.mustIncludeTerms,
          ...routePlan.retrievalHints,
        ]
      : [];
  const terms = unique([...queryTerms, ...routeTerms]).slice(0, 48);
  return cheapMetadataCandidateScoreFromTerms(collection, normalize(text), primaryProfile, routePlan, terms);
}

function cheapMetadataCandidateScoreFromTerms(
  collection: KnowledgeCollectionAccessItem,
  normalizedText: string,
  primaryProfile: KnowledgeMetadataProfile | undefined,
  routePlan: DomainRoutePlan | null,
  terms: string[],
): number {
  const lexicalMatches = terms.filter((term) => containsTermInNormalizedText(normalizedText, term)).length;
  const profileQuality = primaryProfile ? sourceQualityScore(primaryProfile) : 0;
  const domainBonus =
    routePlan && routePlan.domain !== "general" && profileHasDirectDomainSupport(primaryProfile, routePlan.domain)
      ? 35
      : 0;
  return Math.min(120, lexicalMatches * 12 + domainBonus + profileQuality * 0.08 + Math.min(collection.documents?.length ?? 0, 5));
}

function trimMetadataScoringPool(
  collections: KnowledgeCollectionAccessItem[],
  routePlan: DomainRoutePlan | null,
  query: string | undefined,
  limit: number,
): KnowledgeCollectionAccessItem[] {
  const poolLimit = Math.max(limit * 2, METADATA_ROUTE_SCORING_POOL_LIMIT);
  if (collections.length <= poolLimit) return collections;
  return collections
    .map((collection, index) => ({
      collection,
      index,
      score: cheapMetadataCandidateScore(collection, routePlan, query),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, poolLimit)
    .map(({ collection }) => collection);
}

function routeHintScoreWeight(): number {
  const parsed = Number.parseFloat(process.env.R3MES_ROUTE_HINT_SCORE_WEIGHT ?? "0.35");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.35;
}

function sourceQualityScore(profile: KnowledgeMetadataProfile): number {
  const base =
    profile.sourceQuality === "structured"
      ? 100
      : profile.sourceQuality === "inferred"
        ? 65
        : profile.sourceQuality === "thin"
          ? 20
          : profile.confidence === "high"
            ? 75
            : profile.confidence === "medium"
              ? 55
              : 35;
  const ingestionQuality = profile.ingestionQuality;
  if (!ingestionQuality) return base;
  if (ingestionQuality.strictRouteEligible === false || ingestionQuality.thinSource === true) return Math.min(base, 28);
  if (ingestionQuality.ocrRisk === "high") return Math.min(base, 30);
  if (ingestionQuality.ocrRisk === "medium") return Math.min(base, 55);
  if (ingestionQuality.tableRisk === "high") return Math.max(0, base - 4);
  return base;
}

function profileEmbeddingScore(profile: KnowledgeMetadataProfile, routePlan: DomainRoutePlan, query?: string): number | null {
  const queryVector = embedKnowledgeText(routeSignalText(routePlan, query));
  const signals = [
    { vector: profile.profileEmbedding, weight: 0.5 },
    { vector: profile.summaryEmbedding, weight: 0.2 },
    { vector: profile.sampleQuestionsEmbedding, weight: 0.15 },
    { vector: profile.keywordsEmbedding, weight: 0.1 },
    { vector: profile.entityEmbedding, weight: 0.05 },
  ].filter((signal): signal is { vector: number[]; weight: number } => Array.isArray(signal.vector));
  if (signals.length === 0) return null;
  const weightSum = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const score = signals.reduce(
    (sum, signal) => sum + Math.max(0, cosineSimilarity(queryVector, signal.vector)) * signal.weight,
    0,
  ) / Math.max(weightSum, 0.0001);
  return score * 100;
}

function profileQueryEmbeddingScore(profile: KnowledgeMetadataProfile, query: string): number | null {
  const queryVector = embedKnowledgeText(queryProfileSignalText(query));
  const signals = [
    { vector: profile.profileEmbedding, weight: 0.4 },
    { vector: profile.summaryEmbedding, weight: 0.22 },
    { vector: profile.sampleQuestionsEmbedding, weight: 0.2 },
    { vector: profile.keywordsEmbedding, weight: 0.12 },
    { vector: profile.entityEmbedding, weight: 0.06 },
  ].filter((signal): signal is { vector: number[]; weight: number } => Array.isArray(signal.vector));
  if (signals.length === 0) return null;
  const weightSum = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const score = signals.reduce(
    (sum, signal) => sum + Math.max(0, cosineSimilarity(queryVector, signal.vector)) * signal.weight,
    0,
  ) / Math.max(weightSum, 0.0001);
  return score * 100;
}

function scoreMetadataProfileForQuery(profile: KnowledgeMetadataProfile, query: string): number {
  return explainMetadataProfileForQuery(profile, query).finalScore;
}

function explainMetadataProfileForQuery(profile: KnowledgeMetadataProfile, query: string): RouterScoreBreakdown {
  const concepts = queryAdaptiveTerms(query, profile);
  const allTerms = queryTokens(query);
  const text = normalize(metadataText(profile));
  const answerableText = normalize(profileAnswerableTerms(profile).join(" "));
  const lexicalMatches = concepts.filter((term) => containsTerm(text, term)).length;
  const answerableMatches = concepts.filter((term) => containsTerm(answerableText, term)).length;
  const genericMatches = allTerms
    .filter((term) => GENERIC_QUERY_TERMS.has(term))
    .filter((term) => containsTerm(text, term)).length;
  const lexicalKeyword = percentScore(
    lexicalMatches + answerableMatches * 0.8 + Math.min(genericMatches, concepts.length > 0 ? 1 : 0) * 0.15,
    Math.min(Math.max(concepts.length, 1), 10),
  );
  const sampleText = normalize(profile.questionsAnswered.join(" "));
  const sampleMatches = concepts.filter((term) => containsTerm(sampleText, term)).length;
  const topicPhraseMatches = concepts.filter((term) => containsTerm(answerableText, term)).length;
  const sampleQuestion = percentScore(
    sampleMatches + topicPhraseMatches * 0.75,
    Math.min(Math.max(concepts.length, 1), 8),
  );
  const domainHint = profile.domains.some((domain) => containsTerm(query, domain)) ? 40 : 0;

  return explainWeightedRouterScore(
    {
      profileEmbedding: profileQueryEmbeddingScore(profile, query),
      lexicalKeyword,
      sampleQuestion,
      domainHint,
      sourceQuality: sourceQualityScore(profile),
    },
    getRouterWeights(),
  );
}

function scoreMetadataProfile(profile: KnowledgeMetadataProfile, routePlan: DomainRoutePlan, query?: string): number {
  return explainMetadataProfile(profile, routePlan, query).finalScore;
}

function explainMetadataProfile(
  profile: KnowledgeMetadataProfile,
  routePlan: DomainRoutePlan,
  query?: string,
): RouterScoreBreakdown {
  const text = normalize(metadataText(profile));
  const profileSubtopics = profile.subtopics.map(normalize);
  const answerableText = normalize(profileAnswerableTerms(profile).join(" "));
  const exactDomain = profile.domains.map(normalize).includes(normalize(routePlan.domain));
  const subtopicMatches = routePlan.subtopics.filter((subtopic) => {
    const normalizedSubtopic = normalize(subtopic);
    return profileSubtopics.includes(normalizedSubtopic) || text.includes(normalizedSubtopic.replace(/_/g, " "));
  }).length;
  const domainHint = Math.min(
    100,
    (exactDomain ? 60 : metadataProfileMatchesDomain(profile, routePlan.domain) ? 45 : 0) +
      percentScore(subtopicMatches, Math.max(1, routePlan.subtopics.length)) * 0.4,
  );
  const lexicalTerms = unique([
    ...routePlan.mustIncludeTerms,
    ...routePlan.retrievalHints,
    ...expandSurfaceConceptTerms([...routePlan.mustIncludeTerms, ...routePlan.retrievalHints], 32),
  ]);
  const lexicalMatches = lexicalTerms.filter((term) => containsTerm(text, term)).length;
  const answerableMatches = lexicalTerms.filter((term) => containsTerm(answerableText, term)).length;
  const lexicalKeyword = percentScore(
    lexicalMatches + answerableMatches * 0.8,
    Math.min(Math.max(lexicalTerms.length, 1), 10),
  );
  const sampleText = normalize(profile.questionsAnswered.join(" "));
  const sampleMatches = lexicalTerms.filter((term) => containsTerm(sampleText, term)).length;
  const topicPhraseMatches = lexicalTerms.filter((term) => containsTerm(answerableText, term)).length;
  const sampleQuestion = percentScore(
    sampleMatches + topicPhraseMatches * 0.75,
    Math.min(Math.max(lexicalTerms.length, 1), 8),
  );

  return explainWeightedRouterScore(
    {
      profileEmbedding: profileEmbeddingScore(profile, routePlan, query),
      lexicalKeyword,
      sampleQuestion,
      domainHint,
      sourceQuality: sourceQualityScore(profile),
    },
    getRouterWeights(),
  );
}

function metadataCandidateForRoute(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): KnowledgeMetadataRouteCandidate | null {
  if (!routePlan || routePlan.domain === "general") return null;
  const profiles = collectionMetadataProfiles(collection);
  if (profiles.length === 0) return null;
  const scored = profiles
    .map((profile) => {
      const text = normalize(metadataText(profile));
      const scoreBreakdown = explainMetadataProfile(profile, routePlan, query);
      const matchedTerms = [
        ...routePlan.subtopics.filter((subtopic) => profile.subtopics.map(normalize).includes(normalize(subtopic))),
        ...routePlan.subtopics
          .map((subtopic) => subtopic.replace(/_/g, " "))
          .filter((subtopic) => containsTerm(profile.topicPhrases.join(" "), subtopic)),
        ...routePlan.mustIncludeTerms.filter((term) => containsTerm(text, term)),
        ...routePlan.retrievalHints.filter((hint) => containsTerm(text, hint)),
      ];
      return {
        profile,
        score: scoreBreakdown.finalScore,
        scoreBreakdown,
        matchedTerms: [...new Set(matchedTerms)].slice(0, 8),
      };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  return {
    id: collection.id,
    name: collection.name,
    score: best.score,
    scoreBreakdown: { ...best.scoreBreakdown, scoringMode: "route_profile" },
    domain: best.profile.domain,
    subtopics: best.profile.subtopics.slice(0, 6),
    matchedTerms: best.matchedTerms,
    sourceQuality: best.profile.sourceQuality ?? null,
    reason:
      best.matchedTerms.length > 0
        ? `Metadata eşleşmesi: ${best.matchedTerms.slice(0, 4).join(", ")}`
        : `Metadata domain '${best.profile.domain}' ile eşleşti.`,
  };
}

function metadataCandidateForQuery(
  collection: KnowledgeCollectionAccessItem,
  query?: string,
): KnowledgeMetadataRouteCandidate | null {
  if (!query?.trim()) return null;
  const profiles = collectionMetadataProfiles(collection);
  if (profiles.length === 0) return null;
  const concepts = queryAdaptiveTerms(query);
  const scored = profiles
    .map((profile) => {
      const text = normalize(metadataText(profile));
      const scoreBreakdown = explainMetadataProfileForQuery(profile, query);
      const matchedTerms = concepts.filter((term) => containsTerm(text, term));
      return {
        profile,
        score: scoreBreakdown.finalScore,
        scoreBreakdown,
        matchedTerms: [...new Set(matchedTerms)].slice(0, 8),
      };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  return {
    id: collection.id,
    name: collection.name,
    score: best.score,
    scoreBreakdown: { ...best.scoreBreakdown, scoringMode: "query_profile" },
    domain: best.profile.domain,
    subtopics: best.profile.subtopics.slice(0, 6),
    matchedTerms: best.matchedTerms,
    sourceQuality: best.profile.sourceQuality ?? null,
    reason:
      best.matchedTerms.length > 0
        ? `Query-profile eşleşmesi: ${best.matchedTerms.slice(0, 4).join(", ")}`
        : `Semantik profile skoru ${Math.round(best.score)}; route belirsizken aday önerildi.`,
  };
}

function adaptiveMetadataCandidate(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): KnowledgeMetadataRouteCandidate | null {
  const routeCandidate =
    routePlan && routePlan.domain !== "general"
      ? metadataCandidateForRoute(collection, routePlan, query)
      : null;
  const queryCandidate = metadataCandidateForQuery(collection, query);

  if (!queryCandidate) return routeCandidate;
  if (!routeCandidate) return queryCandidate;

  const querySpecificMatchBonus = Math.min(queryCandidate.matchedTerms.length, 6) * 7;
  const queryQualityBonus =
    queryCandidate.sourceQuality === "structured"
      ? 12
      : queryCandidate.sourceQuality === "inferred"
        ? 6
        : 0;
  const routeThinPenalty = routeCandidate.sourceQuality === "thin" ? 10 : 0;
  const boostedQueryCandidate = {
    ...queryCandidate,
    score: queryCandidate.score + querySpecificMatchBonus + queryQualityBonus,
    scoreBreakdown: queryCandidate.scoreBreakdown
      ? {
          ...queryCandidate.scoreBreakdown,
          adaptiveBonus: querySpecificMatchBonus + queryQualityBonus,
          finalScore: queryCandidate.score + querySpecificMatchBonus + queryQualityBonus,
        }
      : undefined,
  };
  const queryBeatsRoute = boostedQueryCandidate.score >= routeCandidate.score + 18 - routeThinPenalty;

  return queryBeatsRoute ? boostedQueryCandidate : routeCandidate;
}

function bestQueryProfileScore(collection: KnowledgeCollectionAccessItem, query?: string): number {
  if (!query?.trim()) return 0;
  return Math.max(
    0,
    ...collectionMetadataProfiles(collection).map((profile) => scoreMetadataProfileForQuery(profile, query)),
  );
}

function bestRouteProfileScore(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): number {
  if (!routePlan || routePlan.domain === "general") return 0;
  return Math.max(
    0,
    ...collectionMetadataProfiles(collection).map((profile) => scoreMetadataProfile(profile, routePlan, query)),
  );
}

function adaptiveProfileRoutingScore(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): number {
  const routeScore = bestRouteProfileScore(collection, routePlan, query);
  const queryCandidate = metadataCandidateForQuery(collection, query);
  if (!queryCandidate) return routeScore;
  const specificMatchBonus = Math.min(queryCandidate.matchedTerms.length, 6) * 7;
  const qualityBonus =
    queryCandidate.sourceQuality === "structured"
      ? 10
      : queryCandidate.sourceQuality === "inferred"
        ? 5
        : 0;
  return Math.max(routeScore, queryCandidate.score + specificMatchBonus + qualityBonus);
}

function collectionHasMetadataDomainSupport(
  collection: KnowledgeCollectionAccessItem,
  domain: string,
): boolean {
  return collectionMetadataProfiles(collection).some((profile) => metadataProfileMatchesDomain(profile, domain));
}

function profileHasDirectDomainSupport(profile: KnowledgeMetadataProfile | undefined, domain: string): boolean {
  if (!profile) return false;
  const normalizedDomain = normalize(domain);
  return profile.domains.map(normalize).includes(normalizedDomain) || normalize(profile.domain) === normalizedDomain;
}

function collectionHasMetadataSubtopicSupport(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan,
): boolean {
  if (routePlan.subtopics.length === 0) return collectionHasMetadataDomainSupport(collection, routePlan.domain);
  const routeSubtopics = routePlan.subtopics.map(normalize);
  return collectionMetadataProfiles(collection).some((profile) => {
    if (!metadataProfileMatchesDomain(profile, routePlan.domain)) return false;
    const profileSubtopics = profile.subtopics.map(normalize);
    if (routeSubtopics.some((subtopic) => profileSubtopics.includes(subtopic))) return true;
    const text = normalize(metadataText(profile));
    return routePlan.retrievalHints.some((hint) => containsTerm(text, hint)) ||
      routePlan.mustIncludeTerms.filter((term) => containsTerm(text, term)).length >= 2;
  });
}

export function collectionMatchesRoute(
  collection: KnowledgeCollectionAccessItem,
  domain: string | null | undefined,
): boolean {
  if (!domain || domain === "general") return true;
  const text = collectionMetadataText(collection);
  const route = routeQuery(text);
  const haystack = `${text} ${route.domain} ${route.subtopics.join(" ")}`.toLocaleLowerCase("tr-TR");
  return collectionHasMetadataDomainSupport(collection, domain) || haystack.includes(domain.toLocaleLowerCase("tr-TR"));
}

export function scoreCollectionForRoute(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): number {
  const text = collectionMetadataText(collection);
  const inferred = routeQuery(text);
  let score = collection.visibility === "PRIVATE" ? 8 : 4;

  if (!routePlan || routePlan.domain === "general") {
    const queryScore = bestQueryProfileScore(collection, query);
    const fallbackLexicalScore = query?.trim()
      ? percentScore(
          queryConceptTerms(query).filter((term) => containsTerm(text, term)).length,
          Math.min(Math.max(queryConceptTerms(query).length, 1), 10),
        ) * 0.5
      : 0;
    return score + Math.max(queryScore, fallbackLexicalScore) + Math.min(collection.documents?.length ?? 0, 5);
  }

  const metadataScore = bestRouteProfileScore(collection, routePlan, query);
  const adaptiveScore = adaptiveProfileRoutingScore(collection, routePlan, query);
  score += adaptiveScore;

  let routeHintScore = 0;
  if (metadataScore === 0 && inferred.domain === routePlan.domain) routeHintScore += 40;
  if (collectionMatchesRoute(collection, routePlan.domain)) routeHintScore += 20;

  for (const subtopic of routePlan.subtopics) {
    if (inferred.subtopics.includes(subtopic)) routeHintScore += 14;
    if (containsTerm(text, subtopic.replace(/_/g, " "))) routeHintScore += 8;
  }

  for (const hint of routePlan.retrievalHints) {
    if (containsTerm(text, hint)) routeHintScore += 4;
  }

  for (const term of routePlan.mustIncludeTerms) {
    if (containsTerm(text, term)) routeHintScore += 3;
  }

  score += routeHintScore * routeHintScoreWeight();

  return score;
}

export function collectionHasSpecificRouteSupport(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): boolean {
  if (!routePlan || routePlan.domain === "general") return true;
  if (!readKnowledgeCollectionStrictRouteEligible(collection)) return false;

  const queryProfileScore = bestQueryProfileScore(collection, query);
  const routeProfileScore = bestRouteProfileScore(collection, routePlan, query);
  if (Math.max(queryProfileScore, routeProfileScore) >= 70 && readKnowledgeCollectionStrictRouteEligible(collection)) {
    return true;
  }

  const text = collectionMetadataText(collection);
  const inferred = routeQuery(text);
  const hasDomainSupport =
    collectionHasMetadataDomainSupport(collection, routePlan.domain) ||
    inferred.domain === routePlan.domain ||
    collectionMatchesRoute(collection, routePlan.domain);

  if (!hasDomainSupport) return false;
  if (routePlan.subtopics.length === 0) return true;
  if (collectionHasMetadataSubtopicSupport(collection, routePlan)) return true;

  const hasExactSubtopic = routePlan.subtopics.some(
    (subtopic) =>
      inferred.subtopics.includes(subtopic) ||
      containsTerm(text, subtopic.replace(/_/g, " ")),
  );
  if (hasExactSubtopic) return true;

  const hasHintSupport = routePlan.retrievalHints.some((hint) => containsTerm(text, hint));
  const includeMatches = routePlan.mustIncludeTerms.filter((term) => containsTerm(text, term)).length;
  return hasHintSupport || includeMatches >= 2;
}

export function explainCollectionRouteSuggestion(
  collection: KnowledgeCollectionAccessItem,
  routePlan: DomainRoutePlan | null,
  query?: string,
): string {
  if (!routePlan || routePlan.domain === "general") {
    const queryCandidate = metadataCandidateForQuery(collection, query);
    if (queryCandidate) {
      const quality =
        queryCandidate.sourceQuality === "structured"
          ? "structured profile"
          : queryCandidate.sourceQuality === "inferred"
            ? "inferred profile"
            : queryCandidate.sourceQuality === "thin"
              ? "thin profile, temkinli öneri"
              : "metadata profile";
      return `${queryCandidate.reason} (${quality}, skor ${Math.round(queryCandidate.score)}).`;
    }
    return collection.visibility === "PRIVATE"
      ? "Private kaynak olduğu için önce denenebilir."
      : "Erişilebilir public alternatif knowledge kaynağı.";
  }

  const metadataCandidate = metadataCandidateForRoute(collection, routePlan, query);
  if (metadataCandidate) {
    const quality =
      metadataCandidate.sourceQuality === "structured"
        ? "structured profile"
        : metadataCandidate.sourceQuality === "inferred"
          ? "inferred profile"
          : metadataCandidate.sourceQuality === "thin"
            ? "thin profile, temkinli öneri"
            : "metadata profile";
    const score = Math.round(metadataCandidate.score);
    if (metadataCandidate.matchedTerms.length > 0) {
      return `Profile eşleşmesi (${quality}, skor ${score}): ${metadataCandidate.matchedTerms.slice(0, 4).join(", ")}.`;
    }
    return `Semantik profile eşleşmesi (${quality}, skor ${score}) route domain '${routePlan.domain}' ile uyumlu.`;
  }

  const text = collectionMetadataText(collection);
  const inferred = routeQuery(text);
  const matchedSubtopic = routePlan.subtopics.find(
    (subtopic) =>
      inferred.subtopics.includes(subtopic) ||
      containsTerm(text, subtopic.replace(/_/g, " ")),
  );

  if (matchedSubtopic) {
    return `Route domain '${routePlan.domain}' ve alt konu '${matchedSubtopic}' ile uyumlu.`;
  }
  return `Route domain '${routePlan.domain}' ile daha uyumlu görünüyor.`;
}

export function rankSuggestedKnowledgeCollections(opts: {
  collections: KnowledgeCollectionAccessItem[];
  routePlan: DomainRoutePlan | null;
  query?: string;
  excludedIds?: Set<string>;
  limit?: number;
}): KnowledgeCollectionAccessItem[] {
  const excludedIds = opts.excludedIds ?? new Set<string>();
  const routePlan = opts.routePlan;
  return opts.collections
    .filter((collection) => !excludedIds.has(collection.id))
    .map((collection) => ({
      collection,
      score: scoreCollectionForRoute(collection, routePlan, opts.query),
    }))
    .filter(({ score, collection }) => {
      if (!routePlan || routePlan.domain === "general") {
        if (!opts.query?.trim()) return true;
        const hasProfiles = collectionMetadataProfiles(collection).length > 0;
        return score >= (hasProfiles ? 24 : 14);
      }
      if (routePlan.subtopics.length > 0 && collectionMetadataProfiles(collection).length > 0) {
        return collectionHasMetadataSubtopicSupport(collection, routePlan) || score >= 64;
      }
      return score >= 24 || collectionMatchesRoute(collection, routePlan.domain);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.collection.visibility !== b.collection.visibility) {
        return a.collection.visibility === "PRIVATE" ? -1 : 1;
      }
      return a.collection.name.localeCompare(b.collection.name, "tr-TR");
    })
    .slice(0, opts.limit ?? 3)
    .map(({ collection }) => collection);
}

export function rankMetadataRouteCandidates(opts: {
  collections: KnowledgeCollectionAccessItem[];
  routePlan: DomainRoutePlan | null;
  query?: string;
  excludedIds?: Set<string>;
  limit?: number;
  fast?: boolean;
}): KnowledgeMetadataRouteCandidate[] {
  const excludedIds = opts.excludedIds ?? new Set<string>();
  const limit = opts.limit ?? 5;
  const cacheKey = metadataRouteCacheKey({
    collections: opts.collections,
    routePlan: opts.routePlan,
    query: opts.query,
    excludedIds,
    limit,
    fast: opts.fast,
  });
  const cached = readMetadataRouteCandidateCache(cacheKey);
  if (cached) return cached;
  const candidatePool = opts.collections.filter((collection) => !excludedIds.has(collection.id));
  if (opts.fast === true) {
    const fastQueryTerms = opts.query?.trim() ? queryAdaptiveTerms(opts.query) : [];
    const fastRouteTerms =
      opts.routePlan && opts.routePlan.domain !== "general"
        ? [
            opts.routePlan.domain,
            ...opts.routePlan.subtopics.map((subtopic) => subtopic.replace(/_/g, " ")),
            ...opts.routePlan.mustIncludeTerms,
            ...opts.routePlan.retrievalHints,
          ]
        : [];
    const fastTerms = unique([...fastQueryTerms, ...fastRouteTerms]).slice(0, 48);
    const fastCandidates: KnowledgeMetadataRouteCandidate[] = [];
    for (const collection of candidatePool) {
      const profiles = collectionMetadataProfiles(collection);
      const profile = profiles[0];
      const profileText = collectionProfileText(collection);
      const normalizedProfileText = normalize(profileText);
      const score = cheapMetadataCandidateScoreFromTerms(
        collection,
        normalizedProfileText,
        profile,
        opts.routePlan,
        fastTerms,
      );
      if (!profile || score < 20) continue;
      const matchedTerms = unique(
        fastTerms.filter((term) => containsTermInNormalizedText(normalizedProfileText, term)),
      ).slice(0, 8);
      fastCandidates.push({
        id: collection.id,
        name: collection.name,
        score,
        scoreBreakdown: {
          finalScore: score,
          weights: getRouterWeights(),
          signals: {
            lexicalKeyword: Math.min(100, matchedTerms.length * 18),
            domainHint: opts.routePlan && profileHasDirectDomainSupport(profile, opts.routePlan.domain) ? 80 : 0,
            sourceQuality: sourceQualityScore(profile),
          },
          contributions: {},
          missingSignals: ["profileEmbedding", "sampleQuestion"],
          scoringMode: "query_profile" as const,
        },
        domain: profile.domain,
        subtopics: profile.subtopics.slice(0, 6),
        matchedTerms,
        sourceQuality: profile.sourceQuality ?? null,
        reason:
          matchedTerms.length > 0
            ? `Fast metadata eşleşmesi: ${matchedTerms.slice(0, 4).join(", ")}`
            : `Fast metadata skoru ${Math.round(score)}; kaynak önerisi için aday.`,
      });
    }
    fastCandidates
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr-TR"))
      .splice(limit);
    writeMetadataRouteCandidateCache(cacheKey, fastCandidates);
    return fastCandidates;
  }
  const domainScopedPool =
    opts.routePlan && opts.routePlan.domain !== "general" && opts.routePlan.confidence !== "low"
      ? candidatePool.filter((collection) => collectionHasMetadataDomainSupport(collection, opts.routePlan!.domain))
      : [];
  const scoringPool = trimMetadataScoringPool(
    domainScopedPool.length >= Math.min(limit, 3) ? domainScopedPool : candidatePool,
    opts.routePlan,
    opts.query,
    limit,
  );
  const candidates = scoringPool
    .map((collection) =>
      adaptiveMetadataCandidate(collection, opts.routePlan, opts.query),
    )
    .filter((candidate): candidate is KnowledgeMetadataRouteCandidate => Boolean(candidate))
    .filter((candidate) => candidate.score >= 20)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr-TR"))
    .slice(0, limit);
  writeMetadataRouteCandidateCache(cacheKey, candidates);
  return candidates;
}

export function buildKnowledgeRouteDecision(opts: {
  routePlan: DomainRoutePlan | null;
  requestedCollectionIds: string[];
  accessibleCollectionIds: string[];
  usedCollectionIds: string[];
  unusedSelectedCollectionIds: string[];
  suggestedCollections: Array<{ id: string; name: string; reason: string }>;
  metadataRouteCandidates: KnowledgeMetadataRouteCandidate[];
  thinProfileCollectionIds?: string[];
  hasSources: boolean;
}): KnowledgeRouteDecision {
  const primaryDomain = opts.routePlan?.domain ?? null;
  const suggestedCollectionIds = [
    ...new Set([
      ...opts.suggestedCollections.map((collection) => collection.id),
      ...opts.metadataRouteCandidates.map((collection) => collection.id),
    ]),
  ];
  const rejectedCollectionIds =
    opts.requestedCollectionIds.length > 0
      ? opts.unusedSelectedCollectionIds
      : [];
  const thinProfileCollectionIds = new Set(opts.thinProfileCollectionIds ?? []);
  const usedOnlyThinProfiles =
    opts.usedCollectionIds.length > 0 &&
    opts.usedCollectionIds.every((id) => thinProfileCollectionIds.has(id));
  const reasons: string[] = [];

  if (!opts.routePlan || opts.routePlan.domain === "general" || opts.routePlan.confidence === "low") {
    reasons.push("Route confidence düşük veya genel; geniş/temkinli retrieval uygun.");
    return {
      mode: opts.hasSources
        ? "broad"
        : suggestedCollectionIds.length > 0 || rejectedCollectionIds.length > 0
          ? "suggest"
          : "no_source",
      primaryDomain,
      confidence: "low",
      selectedCollectionIds: opts.accessibleCollectionIds,
      usedCollectionIds: opts.usedCollectionIds,
      suggestedCollectionIds,
      rejectedCollectionIds,
      reasons,
    };
  }

  if (opts.hasSources && opts.unusedSelectedCollectionIds.length === 0 && !usedOnlyThinProfiles) {
    reasons.push("Seçilen kaynaklar route ile uyumlu kanıt döndürdü.");
    return {
      mode: "strict",
      primaryDomain,
      confidence: opts.routePlan.confidence,
      selectedCollectionIds: opts.accessibleCollectionIds,
      usedCollectionIds: opts.usedCollectionIds,
      suggestedCollectionIds,
      rejectedCollectionIds,
      reasons,
    };
  }

  if (opts.hasSources) {
    reasons.push(
      usedOnlyThinProfiles
        ? "Kullanılan kaynak yalnız thin profile dayanağı taşıyor; strict yerine broad/temkinli retrieval uygun."
        : "Bazı seçili kaynaklar kullanılmadı; kullanılan kaynaklarla cevap verildi.",
    );
    return {
      mode: "broad",
      primaryDomain,
      confidence: "medium",
      selectedCollectionIds: opts.accessibleCollectionIds,
      usedCollectionIds: opts.usedCollectionIds,
      suggestedCollectionIds,
      rejectedCollectionIds,
      reasons,
    };
  }

  if (suggestedCollectionIds.length > 0) {
    reasons.push("Seçili/erişilebilir kaynaklardan kanıt bulunamadı; daha uyumlu kaynak önerildi.");
    return {
      mode: "suggest",
      primaryDomain,
      confidence: "medium",
      selectedCollectionIds: opts.accessibleCollectionIds,
      usedCollectionIds: opts.usedCollectionIds,
      suggestedCollectionIds,
      rejectedCollectionIds,
      reasons,
    };
  }

  if (rejectedCollectionIds.length > 0) {
    reasons.push("Seçili kaynak soru ile uyumlu kanıt vermedi; kaynak seçimini değiştirmek gerekebilir.");
    return {
      mode: "suggest",
      primaryDomain,
      confidence: "low",
      selectedCollectionIds: opts.accessibleCollectionIds,
      usedCollectionIds: opts.usedCollectionIds,
      suggestedCollectionIds,
      rejectedCollectionIds,
      reasons,
    };
  }

  reasons.push("Bu soru için erişilebilir ve route ile uyumlu kaynak bulunamadı.");
  return {
    mode: "no_source",
    primaryDomain,
    confidence: "low",
    selectedCollectionIds: opts.accessibleCollectionIds,
    usedCollectionIds: opts.usedCollectionIds,
    suggestedCollectionIds,
    rejectedCollectionIds,
    reasons,
  };
}

const collectionMetadataSelect = {
  id: true,
  name: true,
  visibility: true,
  updatedAt: true,
  autoMetadata: true,
  owner: { select: { walletAddress: true } },
  documents: {
    select: {
      title: true,
      updatedAt: true,
      autoMetadata: true,
      chunks: {
        select: { content: true },
        orderBy: { chunkIndex: "asc" as const },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" as const },
    take: 5,
  },
};

export async function resolveAccessibleKnowledgeCollections(opts: {
  walletAddress: string;
  requestedCollectionIds?: string[];
  includePublic?: boolean;
}) {
  const { walletAddress, requestedCollectionIds = [], includePublic = false } = opts;

  const accessible = await prisma.knowledgeCollection.findMany({
    where: {
      OR: [
        { owner: { walletAddress } },
        ...(includePublic ? [{ visibility: "PUBLIC" as const }] : []),
      ],
      ...(requestedCollectionIds.length > 0 ? { id: { in: requestedCollectionIds } } : {}),
    },
    select: collectionMetadataSelect,
  });

  return accessible;
}

export async function resolveSuggestibleKnowledgeCollections(opts: {
  walletAddress: string;
  includePublic?: boolean;
  limit?: number;
}) {
  return prisma.knowledgeCollection.findMany({
    where: {
      OR: [
        { owner: { walletAddress: opts.walletAddress } },
        ...(opts.includePublic !== false ? [{ visibility: "PUBLIC" as const }] : []),
      ],
    },
    select: collectionMetadataSelect,
    orderBy: { updatedAt: "desc" },
    take: opts.limit ?? 50,
  });
}
