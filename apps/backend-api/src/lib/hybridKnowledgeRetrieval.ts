import type { ChatSourceCitation } from "@r3mes/shared-types";

import { getAlignmentConfig } from "./alignmentConfig.js";
import type { GroundingConfidence } from "./answerSchema.js";
import { buildEvidenceGroundedBrief, buildGroundedBrief } from "./groundedBrief.js";
import { rankHybridCandidates } from "./hybridRetrieval.js";
import { parseKnowledgeCard, type KnowledgeCard } from "./knowledgeCard.js";
import { normalizeConceptText } from "./conceptNormalizer.js";
import { rerankKnowledgeCardsWithDiagnostics, type RerankDiagnostics } from "./modelRerank.js";
import { prisma } from "./prisma.js";
import {
  buildSourceConceptText,
  scoreQuerySourceAlignment,
  type AlignmentDiagnostics,
  type AlignmentScore,
} from "./querySourceAlignment.js";
import { embedTextForQdrant } from "./qdrantEmbedding.js";
import { searchQdrantKnowledge, type QdrantKnowledgePayload } from "./qdrantStore.js";
import type { DomainRoutePlan } from "./queryRouter.js";
import { getEvidenceExtractorBudget, runEvidenceExtractorSkill, type EvidenceExtractorOutput } from "./skillPipeline.js";
import { buildExpandedQueryText, buildExpandedQueryTokens } from "./turkishQueryNormalizer.js";
import type { RetrievalBudgetMode } from "./retrievalBudget.js";

export interface HybridKnowledgeChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  autoMetadata?: unknown;
  document: {
    title: string;
    collectionId: string;
    autoMetadata?: unknown;
  };
  embedding?: { values: number[] } | null;
}

export interface HybridKnowledgeCandidate {
  chunk: HybridKnowledgeChunk;
  card: KnowledgeCard;
  sources: Array<"qdrant" | "prisma">;
  vectorScore?: number;
  lexicalScore?: number;
  preRankScore: number;
  alignment?: AlignmentScore;
}

interface AlignableKnowledgeCandidate {
  chunk: HybridKnowledgeChunk;
  card: KnowledgeCard;
  alignment?: AlignmentScore;
  vectorScore?: number;
  embeddingScore?: number;
  preRankScore?: number;
}

export interface EvidencePruningDiagnostics {
  mode: "raw" | "pruned";
  rawChars: number;
  prunedChars: number;
  candidateSentenceCount: number;
  selectedSentenceCount: number;
  droppedSentenceCount: number;
}

export interface HybridRetrievedKnowledgeContext {
  contextText: string;
  sources: ChatSourceCitation[];
  lowGroundingConfidence: boolean;
  groundingConfidence: GroundingConfidence;
  evidence: EvidenceExtractorOutput | null;
  diagnostics: {
    qdrantCandidateCount: number;
    prismaCandidateCount: number;
    dedupedCandidateCount: number;
    preRankedCandidateCount: number;
    rerankedCandidateCount: number;
    finalCandidateCount: number;
    alignment: AlignmentDiagnostics;
    reranker: RerankDiagnostics;
    budget: {
      contextMode: "compact" | "detailed";
      budgetMode: RetrievalBudgetMode;
      requestedSourceLimit: number;
      finalSourceLimit: number;
      finalSourceCount: number;
      evidenceContextMode: "raw" | "pruned";
      contextTextChars: number;
      evidenceInputChars: number;
      evidencePrunedInputChars: number;
      evidenceFactCandidateCount: number;
      evidenceFactSelectedCount: number;
      evidenceFactDroppedCount: number;
      evidenceContradictionSignalCount: number;
      evidenceDirectFactLimit: number;
      evidenceSupportingFactLimit: number;
      evidenceRiskFactLimit: number;
      evidenceUsableFactLimit: number;
      evidenceDirectFactCount: number;
      evidenceSupportingFactCount: number;
      evidenceRiskFactCount: number;
      evidenceUsableFactCount: number;
    };
    retrievalMode: "true_hybrid";
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function qdrantLimit(): number {
  return parsePositiveInt(process.env.R3MES_HYBRID_QDRANT_LIMIT, 15);
}

function prismaLimit(): number {
  return parsePositiveInt(process.env.R3MES_HYBRID_PRISMA_LIMIT, 15);
}

function preRankLimit(): number {
  return parsePositiveInt(process.env.R3MES_HYBRID_PRERANK_LIMIT, 8);
}

function finalSourceLimit(fallback: number): number {
  return parsePositiveInt(process.env.R3MES_RAG_FINAL_SOURCE_LIMIT, fallback);
}

function rerankerCandidateLimitForBudget(budgetMode: RetrievalBudgetMode): number {
  if (budgetMode === "fast_grounded") {
    return parsePositiveInt(process.env.R3MES_RERANKER_FAST_CANDIDATE_LIMIT, 3);
  }
  if (budgetMode === "deep_rag") {
    return parsePositiveInt(process.env.R3MES_RERANKER_DEEP_CANDIDATE_LIMIT, 8);
  }
  return parsePositiveInt(process.env.R3MES_RERANKER_NORMAL_CANDIDATE_LIMIT, 5);
}

function minRerankScore(): number {
  return parseNonNegativeFloat(process.env.R3MES_RAG_MIN_RERANK_SCORE, 0.9);
}

function relativeScoreFloor(): number {
  return parseNonNegativeFloat(process.env.R3MES_RAG_RELATIVE_SCORE_FLOOR, 0.45);
}

function evidenceHasOnlyScopeExclusion(evidence: EvidenceExtractorOutput): boolean {
  if (evidence.usableFacts.length > 0 || evidence.directAnswerFacts.length > 0 || evidence.supportingContext.length > 0) {
    return false;
  }
  const notSupported = normalizeConceptText([
    ...evidence.notSupported,
    ...evidence.uncertainOrUnusable,
    ...evidence.missingInfo,
  ].join(" "));
  return [
    "dogrudan dayanak olmadigini belirtiyor",
    "kaynak degildir",
    "dogrudan kaynak degildir",
    "icin kaynak degildir",
  ].some((term) => notSupported.includes(normalizeConceptText(term)));
}

function emptyAlignmentDiagnostics(overrides: Partial<AlignmentDiagnostics> = {}): AlignmentDiagnostics {
  const config = getAlignmentConfig();
  return {
    enabled: config.enabled,
    minScore: config.minScore,
    weakScore: config.weakScore,
    inputCandidateCount: 0,
    alignedCandidateCount: 0,
    weakCandidateCount: 0,
    mismatchCandidateCount: 0,
    droppedCandidateCount: 0,
    fastFailed: false,
    ...overrides,
  };
}

function emptyRerankDiagnostics(overrides: Partial<RerankDiagnostics> = {}): RerankDiagnostics {
  return {
    mode: "deterministic",
    modelEnabled: false,
    fallbackUsed: false,
    inputCandidateCount: 0,
    deterministicCandidateCount: 0,
    modelCandidateCount: 0,
    returnedCandidateCount: 0,
    candidateLimit: 0,
    modelWeight: 0,
    timeoutMs: 0,
    topCandidates: [],
    ...overrides,
  };
}

function isStrictRouteScope(routePlan?: DomainRoutePlan | null): boolean {
  return Boolean(routePlan && routePlan.confidence !== "low" && routePlan.subtopics.length > 0);
}

function getRagContextMode(): "compact" | "detailed" {
  const raw = (process.env.R3MES_RAG_CONTEXT_MODE ?? "compact").trim().toLowerCase();
  return raw === "detailed" ? "detailed" : "compact";
}

function buildBudgetDiagnostics(opts: {
  budgetMode?: RetrievalBudgetMode;
  requestedSourceLimit: number;
  finalSourceLimit: number;
  finalSourceCount: number;
  contextText?: string;
  evidenceInputChars?: number;
  evidencePrunedInputChars?: number;
  evidenceFactCandidateCount?: number;
  evidenceFactSelectedCount?: number;
  evidenceFactDroppedCount?: number;
  evidence?: EvidenceExtractorOutput | null;
}): HybridRetrievedKnowledgeContext["diagnostics"]["budget"] {
  const evidenceBudget = getEvidenceExtractorBudget();
  const evidenceInputChars = opts.evidenceInputChars ?? 0;
  const evidencePrunedInputChars = opts.evidencePrunedInputChars ?? evidenceInputChars;
  return {
    contextMode: getRagContextMode(),
    budgetMode: opts.budgetMode ?? "normal_rag",
    requestedSourceLimit: opts.requestedSourceLimit,
    finalSourceLimit: opts.finalSourceLimit,
    finalSourceCount: opts.finalSourceCount,
    evidenceContextMode: evidencePrunedInputChars > 0 && evidencePrunedInputChars < evidenceInputChars ? "pruned" : "raw",
    contextTextChars: opts.contextText?.length ?? 0,
    evidenceInputChars,
    evidencePrunedInputChars,
    evidenceFactCandidateCount: opts.evidenceFactCandidateCount ?? 0,
    evidenceFactSelectedCount: opts.evidenceFactSelectedCount ?? 0,
    evidenceFactDroppedCount: opts.evidenceFactDroppedCount ?? 0,
    evidenceContradictionSignalCount: countContradictionSignals(opts.evidence),
    evidenceDirectFactLimit: evidenceBudget.directFactLimit,
    evidenceSupportingFactLimit: evidenceBudget.supportingFactLimit,
    evidenceRiskFactLimit: evidenceBudget.riskFactLimit,
    evidenceUsableFactLimit: evidenceBudget.usableFactLimit,
    evidenceDirectFactCount: opts.evidence?.directAnswerFacts.length ?? 0,
    evidenceSupportingFactCount: opts.evidence?.supportingContext.length ?? 0,
    evidenceRiskFactCount: opts.evidence?.riskFacts.length ?? 0,
    evidenceUsableFactCount: opts.evidence?.usableFacts.length ?? 0,
  };
}

function countContradictionSignals(evidence: EvidenceExtractorOutput | null | undefined): number {
  if (!evidence) return 0;
  const values = [
    ...evidence.notSupported,
    ...evidence.uncertainOrUnusable,
    ...evidence.missingInfo,
  ];
  return values.filter((value) => /çeliş|celis|contradict/iu.test(normalizeConceptText(value))).length;
}

function buildRerankCandidateText(candidate: AlignableKnowledgeCandidate, maxWords: number): string {
  return buildSourceConceptText({
    title: candidate.chunk.document.title,
    content: candidate.chunk.content,
    card: candidate.card,
    chunkMetadata: candidate.chunk.autoMetadata,
    documentMetadata: candidate.chunk.document.autoMetadata,
    maxWords,
  });
}

function normalize(text: string): string {
  return normalizeConceptText(text);
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function uniqueTokens(values: string[]): string[] {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

const ROUTE_DOMAIN_TAGS = new Set(["medical", "legal", "finance", "technical", "education", "general"]);

function explicitCardDomains(card: KnowledgeCard): string[] {
  return uniqueTokens([card.topic, ...card.tags]).filter((token) => ROUTE_DOMAIN_TAGS.has(token));
}

function candidateKey(chunk: HybridKnowledgeChunk): string {
  return chunk.id || `${chunk.documentId}:${chunk.chunkIndex}`;
}

function contentHashKey(content: string): string {
  return normalize(content).replace(/\s+/g, " ").slice(0, 500);
}

function disclosureIndexes(value: string): string[] {
  return [...new Set(value.match(/\b\d{6,}\b/g) ?? [])];
}

function sourceLanguageKey(title: string): "tr" | "en" | "unknown" {
  const normalized = normalize(title);
  if (/(profit distribution|dividend distribution|withholding|board|table)/u.test(normalized)) return "en";
  if (/(kar payi|kâr payi|dagitim|dağıtım|islemlerine|işlemlerine|bildirim)/u.test(normalized)) return "tr";
  return "unknown";
}

function asksForMultilingualDisclosure(query: string): boolean {
  const normalized = normalize(query);
  return (
    normalized.includes("turkce") && normalized.includes("ingilizce") ||
    normalized.includes("same disclosure") ||
    normalized.includes("ayni bildirim")
  );
}

function diversifyMultilingualDisclosureCandidates<T extends { chunk: HybridKnowledgeChunk }>(
  query: string,
  accepted: T[],
  candidates: T[],
  limit: number,
): T[] {
  if (!asksForMultilingualDisclosure(query)) return accepted.slice(0, limit);
  const targetIndexes = disclosureIndexes(query);
  if (targetIndexes.length === 0) return accepted.slice(0, limit);

  const byDocument = new Map<string, T>();
  const add = (candidate: T) => {
    if (byDocument.size >= limit) return;
    if (byDocument.has(candidate.chunk.documentId)) return;
    byDocument.set(candidate.chunk.documentId, candidate);
  };
  for (const candidate of accepted) add(candidate);

  for (const index of targetIndexes) {
    const presentLanguages = new Set(
      [...byDocument.values()]
        .filter((candidate) => candidate.chunk.document.title.includes(index))
        .map((candidate) => sourceLanguageKey(candidate.chunk.document.title)),
    );
    for (const language of ["tr", "en"] as const) {
      if (presentLanguages.has(language) || byDocument.size >= limit) continue;
      const match = candidates.find((candidate) =>
        candidate.chunk.document.title.includes(index) &&
        sourceLanguageKey(candidate.chunk.document.title) === language &&
        !byDocument.has(candidate.chunk.documentId)
      );
      if (match) {
        add(match);
        presentLanguages.add(language);
      }
    }
  }

  return [...byDocument.values()].slice(0, limit);
}

function payloadToChunk(payload: QdrantKnowledgePayload): HybridKnowledgeChunk {
  return {
    id: payload.chunkId,
    documentId: payload.documentId,
    chunkIndex: payload.chunkIndex,
    content: payload.content,
    autoMetadata: {
      domain: payload.domain,
      subtopics: [...(payload.profileSubtopics ?? []), ...(payload.subtopics ?? [])],
      keywords: [...(payload.keywords ?? []), ...(payload.tags ?? [])],
      entities: payload.entities ?? [],
      topicPhrases: payload.topicPhrases ?? [],
      answerableConcepts: payload.answerableConcepts ?? [],
      negativeHints: payload.negativeHints ?? [],
      sourceQuality: payload.sourceQuality,
      profile: {
        domains: payload.domains ?? [payload.domain],
        subtopics: payload.profileSubtopics ?? payload.subtopics,
        keywords: payload.keywords ?? payload.tags,
        entities: payload.entities ?? [],
        topicPhrases: payload.topicPhrases ?? [],
        answerableConcepts: payload.answerableConcepts ?? [],
        negativeHints: payload.negativeHints ?? [],
        summary: payload.profileSummary,
        profileText: payload.collectionProfileText,
        profileVersion: payload.collectionProfileVersion,
        lastProfiledAt: payload.collectionLastProfiledAt,
        confidence: payload.metadataConfidence,
        sourceQuality: payload.sourceQuality,
      },
    },
    document: {
      title: payload.title,
      collectionId: payload.collectionId,
    },
    embedding: null,
  };
}

function metadataText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const profile = record.profile && typeof record.profile === "object" ? record.profile as Record<string, unknown> : null;
  const parts = [
    record.domain,
    ...(Array.isArray(record.domains) ? record.domains : []),
    ...(Array.isArray(record.subtopics) ? record.subtopics : []),
    ...(Array.isArray(record.keywords) ? record.keywords : []),
    ...(Array.isArray(record.tags) ? record.tags : []),
    ...(profile && Array.isArray(profile.domains) ? profile.domains : []),
    ...(profile && Array.isArray(profile.subtopics) ? profile.subtopics : []),
    ...(profile && Array.isArray(profile.keywords) ? profile.keywords : []),
    record.summary,
    profile?.summary,
  ];
  return parts.filter((item): item is string => typeof item === "string").join(" ");
}

export function candidateMatchesRouteScope(card: KnowledgeCard, chunk: HybridKnowledgeChunk, routePlan?: DomainRoutePlan | null): boolean {
  if (!routePlan || routePlan.confidence === "low") return true;
  const cardDomains = explicitCardDomains(card);
  if (
    cardDomains.length > 0 &&
    !cardDomains.includes(normalize(routePlan.domain)) &&
    routePlan.domain !== "general"
  ) {
    return false;
  }
  const metadataHaystack = normalize([
    metadataText(chunk.autoMetadata),
    metadataText(chunk.document.autoMetadata),
  ].join(" "));
  if (metadataHaystack) {
    const domainMatches = metadataHaystack.includes(normalize(routePlan.domain));
    if (!domainMatches) return false;
    if (routePlan.subtopics.length === 0) return true;
    const specificTerms = uniqueTokens([
      ...routePlan.subtopics,
      ...routePlan.mustIncludeTerms,
      ...routePlan.retrievalHints,
    ]);
    return specificTerms.some((term) => metadataHaystack.includes(term.replace(/_/g, " ")));
  }

  const haystack = normalize([
    card.topic,
    card.tags.join(" "),
    chunk.content.slice(0, 1000),
  ].join(" "));
  const routeTerms = uniqueTokens([
    routePlan.domain,
    ...routePlan.subtopics,
    ...routePlan.mustIncludeTerms,
    ...routePlan.retrievalHints,
  ]);
  return routeTerms.some((term) => haystack.includes(term));
}

function buildPrismaQueryTokens(query: string, routePlan?: DomainRoutePlan | null): string[] {
  return uniqueTokens([
    ...buildExpandedQueryTokens(query, routePlan, 24),
    ...(routePlan?.mustIncludeTerms ?? []),
    ...(routePlan?.retrievalHints ?? []),
    ...(routePlan?.subtopics ?? []),
  ])
    .filter((token) => token.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 16);
}

async function collectQdrantCandidates(opts: {
  query: string;
  accessibleCollectionIds: string[];
  routePlan?: DomainRoutePlan | null;
}): Promise<HybridKnowledgeCandidate[]> {
  const retrievalQuery = buildExpandedQueryText(opts.query, opts.routePlan);
  const vector = await embedTextForQdrant(retrievalQuery);
  const points = await searchQdrantKnowledge({
    vector,
    accessibleCollectionIds: opts.accessibleCollectionIds,
    limit: qdrantLimit(),
  });
  return points
    .map((point) => {
      const chunk = payloadToChunk(point.payload);
      const card = parseKnowledgeCard(chunk.content);
      return {
        chunk,
        card,
        sources: ["qdrant" as const],
        vectorScore: point.score,
        preRankScore: 0,
      };
    })
    .filter((candidate) => candidateMatchesRouteScope(candidate.card, candidate.chunk, opts.routePlan));
}

async function collectPrismaCandidates(opts: {
  query: string;
  accessibleCollectionIds: string[];
  routePlan?: DomainRoutePlan | null;
}): Promise<HybridKnowledgeCandidate[]> {
  const queryTokens = buildPrismaQueryTokens(opts.query, opts.routePlan);
  const baseWhere = {
    document: {
      collectionId: { in: opts.accessibleCollectionIds },
      parseStatus: "READY" as const,
    },
  };
  const include = {
    document: true,
    embedding: true,
  };
  const chunks = await prisma.knowledgeChunk.findMany({
    where:
      queryTokens.length > 0
        ? {
            ...baseWhere,
            OR: queryTokens.map((token) => ({
              content: { contains: token, mode: "insensitive" as const },
            })),
          }
        : baseWhere,
    include,
    orderBy: [{ createdAt: "desc" }, { chunkIndex: "asc" }],
    take: Math.max(prismaLimit() * 4, 60),
  });
  const ranked = rankHybridCandidates(buildExpandedQueryText(opts.query, opts.routePlan), chunks)
    .slice(0, prismaLimit())
    .map((candidate) => {
      const chunk: HybridKnowledgeChunk = {
        id: candidate.chunk.id,
        documentId: candidate.chunk.documentId,
        chunkIndex: candidate.chunk.chunkIndex,
        content: candidate.chunk.content,
        autoMetadata: candidate.chunk.autoMetadata,
        document: {
          title: candidate.chunk.document.title,
          collectionId: candidate.chunk.document.collectionId,
          autoMetadata: candidate.chunk.document.autoMetadata,
        },
        embedding: candidate.chunk.embedding,
      };
      return {
        chunk,
        card: parseKnowledgeCard(chunk.content),
        sources: ["prisma" as const],
        lexicalScore: candidate.lexicalScore,
        preRankScore: candidate.fusedScore,
      };
    });
  return ranked.filter((candidate) => candidateMatchesRouteScope(candidate.card, candidate.chunk, opts.routePlan));
}

export function dedupeHybridKnowledgeCandidates(candidates: HybridKnowledgeCandidate[]): HybridKnowledgeCandidate[] {
  const byKey = new Map<string, HybridKnowledgeCandidate>();
  const contentSeen = new Map<string, string>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate.chunk);
    const contentKey = contentHashKey(candidate.chunk.content);
    const existingKey = contentSeen.get(contentKey);
    const targetKey = existingKey ?? key;
    const existing = byKey.get(targetKey);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
      existing.vectorScore = Math.max(existing.vectorScore ?? Number.NEGATIVE_INFINITY, candidate.vectorScore ?? Number.NEGATIVE_INFINITY);
      if (existing.vectorScore === Number.NEGATIVE_INFINITY) delete existing.vectorScore;
      existing.lexicalScore = Math.max(existing.lexicalScore ?? Number.NEGATIVE_INFINITY, candidate.lexicalScore ?? Number.NEGATIVE_INFINITY);
      if (existing.lexicalScore === Number.NEGATIVE_INFINITY) delete existing.lexicalScore;
      existing.preRankScore = Math.max(existing.preRankScore, candidate.preRankScore);
      continue;
    }
    contentSeen.set(contentKey, key);
    byKey.set(key, { ...candidate, sources: [...candidate.sources] });
  }
  return [...byKey.values()];
}

function scoreLightweightCandidate(query: string, candidate: HybridKnowledgeCandidate, routePlan?: DomainRoutePlan | null): number {
  const queryTokens = new Set(buildExpandedQueryTokens(query, routePlan, 32));
  const text = normalize([
    candidate.card.topic,
    candidate.card.tags.join(" "),
    candidate.card.patientSummary,
    candidate.card.clinicalTakeaway,
    candidate.card.safeGuidance,
  ].join(" "));
  const candidateTokens = tokenize(text);
  const overlap = candidateTokens.filter((token) => queryTokens.has(token)).length;
  const phraseBonus = normalize(query)
    .split(/[?.!,;:\n]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 10)
    .some((part) => text.includes(part))
    ? 2
    : 0;
  const routeTerms = uniqueTokens([
    ...(routePlan?.subtopics ?? []),
    ...(routePlan?.mustIncludeTerms ?? []),
    ...(routePlan?.retrievalHints ?? []),
  ]);
  const routeBonus = routeTerms.filter((term) => text.includes(term)).length * 0.35;
  const sourceBonus = candidate.sources.length > 1 ? 0.75 : 0;
  const semanticBonus =
    (candidate.vectorScore ?? 0) >= getAlignmentConfig().semanticKeepScore
      ? (candidate.vectorScore ?? 0) * 3
      : 0;
  const lengthPenalty = candidate.chunk.content.trim().length < 80 ? 1 : 0;
  return overlap + phraseBonus + routeBonus + sourceBonus + semanticBonus - lengthPenalty;
}

export function preRankHybridKnowledgeCandidates(opts: {
  query: string;
  candidates: HybridKnowledgeCandidate[];
  routePlan?: DomainRoutePlan | null;
  limit?: number;
}): HybridKnowledgeCandidate[] {
  return opts.candidates
    .map((candidate) => ({
      ...candidate,
      preRankScore: scoreLightweightCandidate(opts.query, candidate, opts.routePlan),
    }))
    .filter((candidate) => candidate.preRankScore > 0 || candidate.sources.length > 1 || (candidate.vectorScore ?? 0) >= getAlignmentConfig().semanticKeepScore)
    .sort((a, b) => b.preRankScore - a.preRankScore)
    .slice(0, opts.limit ?? preRankLimit());
}

export function alignHybridKnowledgeCandidates<T extends AlignableKnowledgeCandidate>(opts: {
  query: string;
  candidates: T[];
  routePlan?: DomainRoutePlan | null;
  allowSemanticReview?: boolean;
}): { candidates: Array<T & { alignment: AlignmentScore }>; diagnostics: AlignmentDiagnostics } {
  const config = getAlignmentConfig();
  if (!config.enabled) {
    return {
      candidates: opts.candidates.map((candidate) => ({
        ...candidate,
        alignment: candidate.alignment ?? {
          mode: "aligned",
          score: 1,
          matchedTerms: [],
          queryTerms: [],
          sourceTerms: [],
          genericMatchedTerms: [],
          reason: "Alignment disabled.",
        },
      })),
      diagnostics: emptyAlignmentDiagnostics({
        enabled: false,
        inputCandidateCount: opts.candidates.length,
        alignedCandidateCount: opts.candidates.length,
      }),
    };
  }

  const scored = opts.candidates.map((candidate) => {
    const lexicalAlignment = scoreQuerySourceAlignment({
      query: opts.query,
      sourceText: buildRerankCandidateText(candidate, config.maxRerankWords),
      routePlan: opts.routePlan,
      minScore: config.minScore,
      weakScore: config.weakScore,
      genericPenalty: config.genericPenalty,
    });
    const semanticScore = Math.max(candidate.vectorScore ?? 0, candidate.embeddingScore ?? 0);
    const shouldKeepForSemanticReview =
      opts.allowSemanticReview === true &&
      lexicalAlignment.mode === "mismatch" &&
      semanticScore >= config.semanticKeepScore;
    const alignment: AlignmentScore = shouldKeepForSemanticReview
      ? {
          ...lexicalAlignment,
          mode: "weak",
          score: Math.max(lexicalAlignment.score, Number(config.minScore.toFixed(3))),
          reason: `Lexical alignment is weak, but semantic score ${semanticScore.toFixed(3)} is high enough for reranker review.`,
        }
      : lexicalAlignment;
    return { ...candidate, alignment };
  });
  const shouldDropWeak =
    opts.routePlan?.confidence === "high" &&
    opts.routePlan.subtopics.length > 0 &&
    opts.routePlan.subtopics.some((subtopic) => !["general", "genel"].includes(normalize(subtopic)));
  const kept = scored.filter((candidate) => {
    if (candidate.alignment.mode === "mismatch") return false;
    if (shouldDropWeak && candidate.alignment.mode === "weak") return false;
    return true;
  });
  return {
    candidates: kept,
    diagnostics: emptyAlignmentDiagnostics({
      inputCandidateCount: scored.length,
      alignedCandidateCount: scored.filter((candidate) => candidate.alignment.mode === "aligned").length,
      weakCandidateCount: scored.filter((candidate) => candidate.alignment.mode === "weak").length,
      mismatchCandidateCount: scored.filter((candidate) => candidate.alignment.mode === "mismatch").length,
      droppedCandidateCount: scored.length - kept.length,
      fastFailed: config.fastFailEnabled && scored.length > 0 && kept.length === 0,
    }),
  };
}

function deriveGroundingConfidence(scores: number[]): GroundingConfidence {
  if (scores.length === 0) return "low";
  const top = scores[0] ?? 0;
  const third = scores[Math.min(2, scores.length - 1)] ?? top;
  if (top >= 2.4 && third >= 1.4) return "high";
  if (top >= 1.2 && third >= 0.6) return "medium";
  return "low";
}

function renderDetailedEvidenceBrief(
  evidence: EvidenceExtractorOutput,
  opts: { groundingConfidence: GroundingConfidence; lowGroundingConfidence: boolean },
): string {
  const budget = getEvidenceExtractorBudget();
  const section = (title: string, items: string[]): string => {
    const clean = items.map((item) => item.trim()).filter(Boolean);
    return clean.length > 0 ? [title, ...clean.map((item) => `- ${item}`)].join("\n") : "";
  };
  return [
    `GROUNDING DURUMU: ${opts.groundingConfidence}${opts.lowGroundingConfidence ? " (düşük güven; kesin konuşma)" : ""}`,
    `CEVAP NIYETI: ${evidence.answerIntent}`,
    section("DOGRUDAN CEVAP KANITLARI:", evidence.directAnswerFacts.slice(0, budget.directFactLimit)),
    section("DESTEKLEYICI BAGLAM:", evidence.supportingContext.slice(0, budget.supportingFactLimit)),
    section("BELIRSIZ / KULLANILAMAYAN:", evidence.notSupported.slice(0, budget.notSupportedLimit)),
    section("RED FLAGS:", evidence.riskFacts.slice(0, budget.riskFactLimit)),
    section("KAYNAK KIMLIKLARI:", evidence.sourceIds.slice(0, budget.sourceIdLimit)),
  ].filter(Boolean).join("\n\n");
}

function evidenceInputMaxChars(budgetMode: RetrievalBudgetMode): number {
  if (budgetMode === "fast_grounded") return parsePositiveInt(process.env.R3MES_EVIDENCE_FAST_MAX_CHARS, 1200);
  if (budgetMode === "deep_rag") return parsePositiveInt(process.env.R3MES_EVIDENCE_DEEP_MAX_CHARS, 2200);
  return parsePositiveInt(process.env.R3MES_EVIDENCE_NORMAL_MAX_CHARS, 1600);
}

function sentenceParts(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\s+(\d{1,2})\.\s*(?=[\p{L}A-ZÇĞİÖŞÜ])/gu, "\n$1. ")
    .split(/(?<!\b\d\.)(?<=[.!?])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasNumericValue(value: string): boolean {
  return /(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+\s*%|%\s*\d+|\(\s*\d)/u.test(value);
}

function financeLineItemScore(query: string, sentence: string): number {
  if (!hasNumericValue(sentence)) return 0;
  const normalizedQuery = normalize(query);
  const normalizedSentence = normalize(sentence);
  let score = 0;
  if (normalizedQuery.includes("net donem") && normalizedSentence.includes("net donem")) score += 8;
  if (normalizedQuery.includes("donem kari") && normalizedSentence.includes("donem kari")) score += 7;
  if (
    normalizedQuery.includes("donem kari") &&
    !normalizedQuery.includes("sadece net donem") &&
    /(?:^|\s)\d{1,2}\.\s*dönem\s+k[âa]rı/iu.test(sentence)
  ) {
    score += 9;
  }
  if (/(spk|yasal\s+kayit|yasal\s+kayıt|profit|dividend|withholding|stopaj|sermaye|capital)/iu.test(sentence)) {
    score += 3;
  }
  if (normalizedSentence.includes("dagitilabilir") && !normalizedQuery.includes("dagitilabilir")) score -= 30;
  return score;
}

function pickRelevantSentences(query: string, text: string, maxChars: number): {
  text: string;
  candidateSentenceCount: number;
  selectedSentenceCount: number;
  droppedSentenceCount: number;
} {
  const queryTokens = new Set(buildExpandedQueryTokens(query, null, 48));
  const parts = sentenceParts(text);
  const scored = parts
    .map((sentence, index) => {
      const sentenceTokens = tokenize(sentence);
      const overlap = sentenceTokens.filter((token) => queryTokens.has(token)).length;
      const structureBonus = /^(?:Topic|Tags|Source Summary|Key Takeaway|Patient Summary|Clinical Takeaway|Safe Guidance|Red Flags|Do Not Infer|Başlık|Etiketler|Temel Bilgi|Triage|Uyarı Bulguları|Çıkarım Yapma)\s*:/iu.test(sentence)
        ? 2
        : 0;
      const riskBonus = /\b(?:risk|dikkat|acil|şiddetli|siddetli|uyarı|uyari|kesin|çıkarım|cikarim|do not infer)\b/iu.test(sentence)
        ? 1
        : 0;
      return { sentence, index, score: overlap * 3 + structureBonus + riskBonus + financeLineItemScore(query, sentence) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = scored.slice(0, 8).sort((a, b) => a.index - b.index).map((item) => item.sentence);
  const fallback = parts.slice(0, 6);
  const lines = (selected.length > 0 ? selected : fallback);
  let out = "";
  for (const line of lines) {
    const candidate = out ? `${out}\n${line}` : line;
    if (candidate.length > maxChars && out) break;
    out = candidate.slice(0, maxChars);
  }
  const selectedSentenceCount = lines.filter((line) => out.includes(line.slice(0, Math.min(32, line.length)))).length;
  return {
    text: out.trim(),
    candidateSentenceCount: parts.length,
    selectedSentenceCount,
    droppedSentenceCount: Math.max(0, parts.length - selectedSentenceCount),
  };
}

export function buildPrunedEvidenceInputWithDiagnostics(opts: {
  query: string;
  candidate: { chunk: HybridKnowledgeChunk; card: KnowledgeCard };
  budgetMode: RetrievalBudgetMode;
}): { text: string; diagnostics: EvidencePruningDiagnostics } {
  const maxChars = evidenceInputMaxChars(opts.budgetMode);
  const rawContent = opts.candidate.chunk.content.trim();
  const structured = [
    opts.candidate.card.topic ? `Topic: ${opts.candidate.card.topic}` : "",
    opts.candidate.card.tags.length > 0 ? `Tags: ${opts.candidate.card.tags.join(", ")}` : "",
    opts.candidate.card.patientSummary ? `Source Summary: ${opts.candidate.card.patientSummary}` : "",
    opts.candidate.card.clinicalTakeaway ? `Key Takeaway: ${opts.candidate.card.clinicalTakeaway}` : "",
    opts.candidate.card.safeGuidance ? `Safe Guidance: ${opts.candidate.card.safeGuidance}` : "",
    opts.candidate.card.redFlags ? `Red Flags: ${opts.candidate.card.redFlags}` : "",
    opts.candidate.card.doNotInfer ? `Do Not Infer: ${opts.candidate.card.doNotInfer}` : "",
  ].filter(Boolean).join("\n");
  const sourceText = structured.trim() || rawContent;
  const picked = pickRelevantSentences(opts.query, sourceText, maxChars);
  const pruned = picked.text || sourceText.slice(0, maxChars).trim();
  const text = pruned.length > 0 && pruned.length < rawContent.length ? pruned : rawContent;
  return {
    text,
    diagnostics: {
      mode: text.length < rawContent.length ? "pruned" : "raw",
      rawChars: rawContent.length,
      prunedChars: text.length,
      candidateSentenceCount: picked.candidateSentenceCount,
      selectedSentenceCount: text.length < rawContent.length ? picked.selectedSentenceCount : picked.candidateSentenceCount,
      droppedSentenceCount: text.length < rawContent.length ? picked.droppedSentenceCount : 0,
    },
  };
}

export function buildPrunedEvidenceInput(opts: {
  query: string;
  candidate: { chunk: HybridKnowledgeChunk; card: KnowledgeCard };
  budgetMode: RetrievalBudgetMode;
}): string {
  return buildPrunedEvidenceInputWithDiagnostics(opts).text;
}

export async function retrieveKnowledgeContextTrueHybrid(opts: {
  query: string;
  evidenceQuery?: string;
  accessibleCollectionIds: string[];
  limit?: number;
  budgetMode?: RetrievalBudgetMode;
  routePlan?: DomainRoutePlan | null;
}): Promise<HybridRetrievedKnowledgeContext> {
  const { query, evidenceQuery = query, accessibleCollectionIds, routePlan = null } = opts;
  const requestedSourceLimit = opts.limit ?? 3;
  const limit = finalSourceLimit(requestedSourceLimit);
  const budgetMode = opts.budgetMode ?? "normal_rag";
  if (accessibleCollectionIds.length === 0) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
      diagnostics: {
        qdrantCandidateCount: 0,
        prismaCandidateCount: 0,
        dedupedCandidateCount: 0,
        preRankedCandidateCount: 0,
        rerankedCandidateCount: 0,
        finalCandidateCount: 0,
        alignment: emptyAlignmentDiagnostics(),
        reranker: emptyRerankDiagnostics(),
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
        }),
        retrievalMode: "true_hybrid",
      },
    };
  }

  const strictRouteScope = isStrictRouteScope(routePlan);
  const [qdrantResult, prismaResult] = await Promise.allSettled([
    collectQdrantCandidates({ query, accessibleCollectionIds, routePlan }),
    collectPrismaCandidates({ query, accessibleCollectionIds, routePlan }),
  ]);
  const qdrantCandidates = qdrantResult.status === "fulfilled" ? qdrantResult.value : [];
  const prismaCandidates = prismaResult.status === "fulfilled" ? prismaResult.value : [];
  if (qdrantResult.status === "rejected") {
    console.warn(`[hybrid-retrieval] qdrant candidate collection failed: ${qdrantResult.reason}`);
  }
  if (prismaResult.status === "rejected") {
    console.warn(`[hybrid-retrieval] prisma candidate collection failed: ${prismaResult.reason}`);
  }

  const deduped = dedupeHybridKnowledgeCandidates([...qdrantCandidates, ...prismaCandidates]);
  if (strictRouteScope && deduped.length === 0) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
      diagnostics: {
        qdrantCandidateCount: qdrantCandidates.length,
        prismaCandidateCount: prismaCandidates.length,
        dedupedCandidateCount: 0,
        preRankedCandidateCount: 0,
        rerankedCandidateCount: 0,
        finalCandidateCount: 0,
        alignment: emptyAlignmentDiagnostics(),
        reranker: emptyRerankDiagnostics(),
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
        }),
        retrievalMode: "true_hybrid",
      },
    };
  }
  const preRanked = preRankHybridKnowledgeCandidates({ query, candidates: deduped, routePlan });
  const alignedPreRanked = alignHybridKnowledgeCandidates({
    query: evidenceQuery,
    candidates: preRanked,
    routePlan,
    allowSemanticReview: true,
  });
  const candidatesForRerank = alignedPreRanked.candidates;
  if (alignedPreRanked.diagnostics.fastFailed) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
      diagnostics: {
        qdrantCandidateCount: qdrantCandidates.length,
        prismaCandidateCount: prismaCandidates.length,
        dedupedCandidateCount: deduped.length,
        preRankedCandidateCount: preRanked.length,
        rerankedCandidateCount: 0,
        finalCandidateCount: 0,
        alignment: alignedPreRanked.diagnostics,
        reranker: emptyRerankDiagnostics({
          inputCandidateCount: candidatesForRerank.length,
        }),
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
        }),
        retrievalMode: "true_hybrid",
      },
    };
  }
  if (strictRouteScope && preRanked.length === 0) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
      diagnostics: {
        qdrantCandidateCount: qdrantCandidates.length,
        prismaCandidateCount: prismaCandidates.length,
        dedupedCandidateCount: deduped.length,
        preRankedCandidateCount: 0,
        rerankedCandidateCount: 0,
        finalCandidateCount: 0,
        alignment: alignedPreRanked.diagnostics,
        reranker: emptyRerankDiagnostics(),
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
        }),
        retrievalMode: "true_hybrid",
      },
    };
  }
  const rerankInput = candidatesForRerank.map((candidate) => ({
    chunk: candidate.chunk,
    card: candidate.card,
    lexicalScore: candidate.lexicalScore ?? candidate.preRankScore,
    embeddingScore: candidate.vectorScore ?? 0,
    fusedScore: candidate.preRankScore,
  }));
  const rerankerCandidateLimit = rerankerCandidateLimitForBudget(budgetMode);
  const rerankReturnLimit = asksForMultilingualDisclosure(evidenceQuery)
    ? Math.max(limit, rerankerCandidateLimit)
    : Math.max(limit, 3);
  const rerankRun = await rerankKnowledgeCardsWithDiagnostics(query, rerankInput, rerankReturnLimit, {
    candidateLimit: rerankerCandidateLimit,
  });
  const reranked = rerankRun.candidates;
  const topScore = reranked[0]?.rerankScore ?? 0;
  const scoreAccepted = reranked
    .filter((candidate, index) => {
      if (candidate.rerankScore < minRerankScore()) return false;
      if (index > 0 && topScore > 0 && candidate.rerankScore < topScore * relativeScoreFloor()) return false;
      return true;
    })
    .slice(0, limit);
  const accepted = diversifyMultilingualDisclosureCandidates(evidenceQuery, scoreAccepted, reranked, limit);
  const alignedAccepted = alignHybridKnowledgeCandidates({
    query: evidenceQuery,
    candidates: accepted,
    routePlan,
  });
  const finalCandidates = alignedAccepted.candidates;
  const finalAlignmentDiagnostics: AlignmentDiagnostics = {
    ...alignedPreRanked.diagnostics,
    alignedCandidateCount: alignedAccepted.diagnostics.alignedCandidateCount,
    weakCandidateCount: alignedAccepted.diagnostics.weakCandidateCount,
    mismatchCandidateCount: alignedPreRanked.diagnostics.mismatchCandidateCount + alignedAccepted.diagnostics.mismatchCandidateCount,
    droppedCandidateCount: alignedPreRanked.diagnostics.droppedCandidateCount + alignedAccepted.diagnostics.droppedCandidateCount,
    fastFailed:
      alignedPreRanked.diagnostics.fastFailed ||
      (getAlignmentConfig().fastFailEnabled && accepted.length > 0 && finalCandidates.length === 0),
  };
  if (finalAlignmentDiagnostics.fastFailed && finalCandidates.length === 0) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
      diagnostics: {
        qdrantCandidateCount: qdrantCandidates.length,
        prismaCandidateCount: prismaCandidates.length,
        dedupedCandidateCount: deduped.length,
        preRankedCandidateCount: preRanked.length,
        rerankedCandidateCount: reranked.length,
        finalCandidateCount: 0,
        alignment: finalAlignmentDiagnostics,
        reranker: rerankRun.diagnostics,
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
        }),
        retrievalMode: "true_hybrid",
      },
    };
  }
  const groundingConfidence = deriveGroundingConfidence(finalCandidates.map((candidate) => candidate.rerankScore));
  const lowGroundingConfidence = groundingConfidence === "low" || finalCandidates.length === 0;

  const sources: ChatSourceCitation[] = [];
  const seenSourceDocuments = new Set<string>();
  for (const { chunk } of finalCandidates) {
    if (seenSourceDocuments.has(chunk.documentId)) continue;
    seenSourceDocuments.add(chunk.documentId);
    sources.push({
      collectionId: chunk.document.collectionId,
      documentId: chunk.documentId,
      title: chunk.document.title,
      chunkIndex: chunk.chunkIndex,
      excerpt: chunk.content.slice(0, 220),
    });
  }
  const prunedEvidenceInputs = finalCandidates.map((candidate) => ({
    candidate,
    ...buildPrunedEvidenceInputWithDiagnostics({ query: evidenceQuery, candidate, budgetMode }),
  }));
  const evidenceCards = prunedEvidenceInputs.map(({ candidate, text }) => ({
    sourceId: candidate.chunk.documentId,
    title: candidate.chunk.document.title,
    topic: candidate.card.topic,
    rawContent: text,
    patientSummary: candidate.card.patientSummary,
    clinicalTakeaway: candidate.card.clinicalTakeaway,
    safeGuidance: candidate.card.safeGuidance,
    redFlags: candidate.card.redFlags,
    doNotInfer: candidate.card.doNotInfer,
  }));
  const evidenceInputChars = finalCandidates.reduce((sum, candidate) => sum + candidate.chunk.content.length, 0);
  const evidencePrunedInputChars = evidenceCards.reduce((sum, card) => sum + card.rawContent.length, 0);
  const evidenceFactCandidateCount = prunedEvidenceInputs.reduce(
    (sum, input) => sum + input.diagnostics.candidateSentenceCount,
    0,
  );
  const evidenceFactSelectedCount = prunedEvidenceInputs.reduce(
    (sum, input) => sum + input.diagnostics.selectedSentenceCount,
    0,
  );
  const evidenceFactDroppedCount = prunedEvidenceInputs.reduce(
    (sum, input) => sum + input.diagnostics.droppedSentenceCount,
    0,
  );
  const evidenceRun = await runEvidenceExtractorSkill({
    userQuery: evidenceQuery,
    cards: evidenceCards,
  });
  if (evidenceHasOnlyScopeExclusion(evidenceRun.output)) {
    const scopedOutAlignmentDiagnostics = {
      ...finalAlignmentDiagnostics,
      droppedCandidateCount: finalAlignmentDiagnostics.droppedCandidateCount + finalCandidates.length,
      fastFailed: true,
    };
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: evidenceRun.output,
      diagnostics: {
        qdrantCandidateCount: qdrantCandidates.length,
        prismaCandidateCount: prismaCandidates.length,
        dedupedCandidateCount: deduped.length,
        preRankedCandidateCount: preRanked.length,
        rerankedCandidateCount: reranked.length,
        finalCandidateCount: 0,
        alignment: scopedOutAlignmentDiagnostics,
        reranker: rerankRun.diagnostics,
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
          evidenceInputChars,
          evidencePrunedInputChars,
          evidenceFactCandidateCount,
          evidenceFactSelectedCount,
          evidenceFactDroppedCount,
          evidence: evidenceRun.output,
        }),
        retrievalMode: "true_hybrid",
      },
    };
  }
  const brief =
    getRagContextMode() === "detailed"
      ? renderDetailedEvidenceBrief(evidenceRun.output, { groundingConfidence, lowGroundingConfidence })
      : evidenceRun.output.usableFacts.length > 0 || evidenceRun.output.notSupported.length > 0
        ? buildEvidenceGroundedBrief(evidenceRun.output, {
            groundingConfidence,
            lowGroundingConfidence,
            answerIntent: evidenceRun.output.answerIntent,
            sourceRefs: finalCandidates.map(({ chunk }) => ({ id: chunk.documentId, title: chunk.document.title })),
          })
        : buildGroundedBrief(
            finalCandidates.map(({ card }) => card),
            {
              groundingConfidence,
              lowGroundingConfidence,
              answerIntent: evidenceRun.output.answerIntent,
              sourceRefs: finalCandidates.map(({ chunk }) => ({ id: chunk.documentId, title: chunk.document.title })),
            },
          );

  const contextText = finalCandidates.length > 0 ? brief : "";
  return {
    contextText,
    sources,
    lowGroundingConfidence,
    groundingConfidence,
    evidence: evidenceRun.output,
    diagnostics: {
      qdrantCandidateCount: qdrantCandidates.length,
      prismaCandidateCount: prismaCandidates.length,
      dedupedCandidateCount: deduped.length,
      preRankedCandidateCount: preRanked.length,
      rerankedCandidateCount: reranked.length,
      finalCandidateCount: finalCandidates.length,
      alignment: finalAlignmentDiagnostics,
      reranker: rerankRun.diagnostics,
      budget: buildBudgetDiagnostics({
        budgetMode,
        requestedSourceLimit,
        finalSourceLimit: limit,
        finalSourceCount: finalCandidates.length,
        contextText,
        evidenceInputChars,
        evidencePrunedInputChars,
        evidenceFactCandidateCount,
        evidenceFactSelectedCount,
        evidenceFactDroppedCount,
        evidence: evidenceRun.output,
      }),
      retrievalMode: "true_hybrid",
    },
  };
}
