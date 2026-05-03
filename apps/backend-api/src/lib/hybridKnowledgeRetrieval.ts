import type { ChatSourceCitation } from "@r3mes/shared-types";

import { getAlignmentConfig } from "./alignmentConfig.js";
import type { GroundingConfidence } from "./answerSchema.js";
import { buildEvidenceGroundedBrief, buildGroundedBrief } from "./groundedBrief.js";
import { rankHybridCandidates } from "./hybridRetrieval.js";
import { parseKnowledgeCard, type KnowledgeCard } from "./knowledgeCard.js";
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
import { runEvidenceExtractorSkill, type EvidenceExtractorOutput } from "./skillPipeline.js";

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

function minRerankScore(): number {
  return parseNonNegativeFloat(process.env.R3MES_RAG_MIN_RERANK_SCORE, 0.9);
}

function relativeScoreFloor(): number {
  return parseNonNegativeFloat(process.env.R3MES_RAG_RELATIVE_SCORE_FLOOR, 0.45);
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
  return text.toLocaleLowerCase("tr-TR");
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

function candidateKey(chunk: HybridKnowledgeChunk): string {
  return chunk.id || `${chunk.documentId}:${chunk.chunkIndex}`;
}

function contentHashKey(content: string): string {
  return normalize(content).replace(/\s+/g, " ").slice(0, 500);
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
    ...tokenize(query),
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
  const vector = await embedTextForQdrant(opts.query);
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
  const ranked = rankHybridCandidates(opts.query, chunks)
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
  const queryTokens = new Set(tokenize(query));
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
  const section = (title: string, items: string[]): string => {
    const clean = items.map((item) => item.trim()).filter(Boolean);
    return clean.length > 0 ? [title, ...clean.map((item) => `- ${item}`)].join("\n") : "";
  };
  return [
    `GROUNDING DURUMU: ${opts.groundingConfidence}${opts.lowGroundingConfidence ? " (düşük güven; kesin konuşma)" : ""}`,
    `CEVAP NIYETI: ${evidence.answerIntent}`,
    section("DOGRUDAN CEVAP KANITLARI:", evidence.directAnswerFacts.slice(0, 4)),
    section("DESTEKLEYICI BAGLAM:", evidence.supportingContext.slice(0, 3)),
    section("BELIRSIZ / KULLANILAMAYAN:", evidence.notSupported.slice(0, 4)),
    section("RED FLAGS:", evidence.riskFacts.slice(0, 3)),
    section("KAYNAK KIMLIKLARI:", evidence.sourceIds.slice(0, 4)),
  ].filter(Boolean).join("\n\n");
}

export async function retrieveKnowledgeContextTrueHybrid(opts: {
  query: string;
  evidenceQuery?: string;
  accessibleCollectionIds: string[];
  limit?: number;
  routePlan?: DomainRoutePlan | null;
}): Promise<HybridRetrievedKnowledgeContext> {
  const { query, evidenceQuery = query, accessibleCollectionIds, routePlan = null } = opts;
  const limit = finalSourceLimit(opts.limit ?? 3);
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
  const rerankRun = await rerankKnowledgeCardsWithDiagnostics(query, rerankInput, Math.max(limit, 3));
  const reranked = rerankRun.candidates;
  const topScore = reranked[0]?.rerankScore ?? 0;
  const accepted = reranked
    .filter((candidate, index) => {
      if (candidate.rerankScore < minRerankScore()) return false;
      if (index > 0 && topScore > 0 && candidate.rerankScore < topScore * relativeScoreFloor()) return false;
      return true;
    })
    .slice(0, limit);
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
        retrievalMode: "true_hybrid",
      },
    };
  }
  const groundingConfidence = deriveGroundingConfidence(finalCandidates.map((candidate) => candidate.rerankScore));
  const lowGroundingConfidence = groundingConfidence === "low" || finalCandidates.length === 0;

  const sources: ChatSourceCitation[] = finalCandidates.map(({ chunk }) => ({
    collectionId: chunk.document.collectionId,
    documentId: chunk.documentId,
    title: chunk.document.title,
    chunkIndex: chunk.chunkIndex,
    excerpt: chunk.content.slice(0, 220),
  }));
  const evidenceRun = await runEvidenceExtractorSkill({
    userQuery: evidenceQuery,
    cards: finalCandidates.map(({ chunk, card }) => ({
      sourceId: chunk.documentId,
      title: chunk.document.title,
      topic: card.topic,
      rawContent: chunk.content,
      patientSummary: card.patientSummary,
      clinicalTakeaway: card.clinicalTakeaway,
      safeGuidance: card.safeGuidance,
      redFlags: card.redFlags,
      doNotInfer: card.doNotInfer,
    })),
  });
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

  return {
    contextText: finalCandidates.length > 0 ? brief : "",
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
      retrievalMode: "true_hybrid",
    },
  };
}
