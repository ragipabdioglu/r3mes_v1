import { prisma } from "./prisma.js";
import type { AnswerDomain } from "./answerSchema.js";
import { cosineSimilarity, embedKnowledgeText, getKnowledgeEmbeddingDimensions } from "./knowledgeEmbedding.js";
import { parseKnowledgeCard } from "./knowledgeCard.js";
import { extractQuerySignals, routeQuery, type DomainRoutePlan } from "./queryRouter.js";
import { explainWeightedRouterScore, getRouterWeights, type RouterScoreBreakdown } from "./routerConfig.js";
import { expandSurfaceConceptTerms, normalizeConceptText } from "./conceptNormalizer.js";
import { buildExpandedQueryText, buildExpandedQueryTokens } from "./turkishQueryNormalizer.js";

interface KnowledgeMetadataProfile {
  domain: string;
  domains: string[];
  subtopics: string[];
  keywords: string[];
  entities: string[];
  topicPhrases: string[];
  answerableConcepts: string[];
  negativeHints: string[];
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
}

export interface KnowledgeCollectionAccessItem {
  id: string;
  name: string;
  visibility: "PRIVATE" | "PUBLIC";
  autoMetadata?: unknown;
  documents?: Array<{
    title: string;
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

function readMetadataProfile(value: unknown): KnowledgeMetadataProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const stringArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  const profile = record.profile && typeof record.profile === "object" ? record.profile as Record<string, unknown> : null;
  if (profile) {
    const domains = stringArray(profile.domains);
    if (domains.length > 0) {
      const profileText = typeof profile.profileText === "string" ? profile.profileText : undefined;
      return {
        domain: domains[0],
        domains,
        subtopics: stringArray(profile.subtopics),
        keywords: stringArray(profile.keywords),
        entities: stringArray(profile.entities),
        topicPhrases: stringArray(profile.topicPhrases),
        answerableConcepts: stringArray(profile.answerableConcepts),
        negativeHints: stringArray(profile.negativeHints),
        summary: typeof profile.summary === "string" ? profile.summary : "",
        profileText,
        profileEmbedding: numberArray(profile.profileEmbedding) ?? (profileText ? embedKnowledgeText(profileText) : undefined),
        summaryEmbedding: numberArray(profile.summaryEmbedding),
        sampleQuestionsEmbedding: numberArray(profile.sampleQuestionsEmbedding),
        keywordsEmbedding: numberArray(profile.keywordsEmbedding),
        entityEmbedding: numberArray(profile.entityEmbedding),
        profileVersion: typeof profile.profileVersion === "number" ? profile.profileVersion : undefined,
        lastProfiledAt: typeof profile.lastProfiledAt === "string" ? profile.lastProfiledAt : undefined,
        questionsAnswered: stringArray(profile.sampleQuestions),
        confidence: profile.confidence === "high" || profile.confidence === "medium" || profile.confidence === "low" ? profile.confidence : undefined,
        sourceQuality: profile.sourceQuality === "structured" || profile.sourceQuality === "inferred" || profile.sourceQuality === "thin" ? profile.sourceQuality : undefined,
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
    summary: typeof record.summary === "string" ? record.summary : "",
    questionsAnswered: stringArray(record.questionsAnswered),
  };
}

function metadataText(value: unknown): string {
  const profile = readMetadataProfile(value);
  if (!profile) return "";
  const parts = [
    ...profile.domains,
    ...profile.subtopics,
    ...profile.keywords,
    ...profile.entities,
    ...profile.topicPhrases,
    ...profile.answerableConcepts,
    profile.summary,
    profile.profileText ?? "",
    ...profile.questionsAnswered,
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

function collectionMetadataProfiles(collection: KnowledgeCollectionAccessItem): KnowledgeMetadataProfile[] {
  return [
    readMetadataProfile(collection.autoMetadata),
    ...(collection.documents ?? []).map((document) => readMetadataProfile(document.autoMetadata)),
  ].filter((item): item is KnowledgeMetadataProfile => Boolean(item));
}

function normalize(text: string): string {
  return normalizeConceptText(text);
}

export function readKnowledgeCollectionSourceQuality(
  collection: KnowledgeCollectionAccessItem,
): "structured" | "inferred" | "thin" | null {
  return readMetadataProfile(collection.autoMetadata)?.sourceQuality ?? null;
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

function queryProfileSignals(query: string): string[] {
  const signals = extractQuerySignals(query);
  return unique([
    ...signals.phraseHints,
    ...signals.significantTerms,
    ...signals.namedEntities,
  ]).filter((token) => !GENERIC_QUERY_TERMS.has(normalize(token))).slice(0, 32);
}

function queryProfileSignalText(query: string): string {
  return unique([buildExpandedQueryText(query, null, 48), ...queryProfileSignals(query)]).join(" ");
}

function queryAdaptiveTerms(query: string): string[] {
  return unique([
    ...queryProfileSignals(query),
    ...queryConceptTerms(query),
  ]).filter((token) => !GENERIC_QUERY_TERMS.has(normalize(token))).slice(0, 48);
}

function profileAnswerableTerms(profile: KnowledgeMetadataProfile): string[] {
  return expandSurfaceConceptTerms([
    ...profile.topicPhrases,
    ...profile.answerableConcepts,
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

function routeHintScoreWeight(): number {
  const parsed = Number.parseFloat(process.env.R3MES_ROUTE_HINT_SCORE_WEIGHT ?? "0.35");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.35;
}

function sourceQualityScore(profile: KnowledgeMetadataProfile): number {
  if (profile.sourceQuality === "structured") return 100;
  if (profile.sourceQuality === "inferred") return 65;
  if (profile.sourceQuality === "thin") return 20;
  return profile.confidence === "high" ? 75 : profile.confidence === "medium" ? 55 : 35;
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
  const concepts = queryAdaptiveTerms(query);
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

  const queryProfileScore = bestQueryProfileScore(collection, query);
  const routeProfileScore = bestRouteProfileScore(collection, routePlan, query);
  if (Math.max(queryProfileScore, routeProfileScore) >= 70 && readKnowledgeCollectionSourceQuality(collection) !== "thin") {
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
}): KnowledgeMetadataRouteCandidate[] {
  const excludedIds = opts.excludedIds ?? new Set<string>();
  return opts.collections
    .filter((collection) => !excludedIds.has(collection.id))
    .map((collection) =>
      adaptiveMetadataCandidate(collection, opts.routePlan, opts.query),
    )
    .filter((candidate): candidate is KnowledgeMetadataRouteCandidate => Boolean(candidate))
    .filter((candidate) => candidate.score >= 20)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr-TR"))
    .slice(0, opts.limit ?? 5);
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
  autoMetadata: true,
  owner: { select: { walletAddress: true } },
  documents: {
    select: {
      title: true,
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
