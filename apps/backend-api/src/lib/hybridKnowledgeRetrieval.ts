import type { ChatSourceCitation } from "@r3mes/shared-types";

import { getAlignmentConfig } from "./alignmentConfig.js";
import type { GroundingConfidence } from "./answerSchema.js";
import { compileEvidence, hasCompiledUsableGrounding, type CompiledEvidence } from "./compiledEvidence.js";
import { getDecisionConfig } from "./decisionConfig.js";
import { buildCompiledEvidenceBrief, buildEvidenceGroundedBrief, buildGroundedBrief } from "./groundedBrief.js";
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
import { embedTextForQdrantWithDiagnostics, type QdrantEmbeddingDiagnostics } from "./qdrantEmbedding.js";
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
  compiledEvidence?: CompiledEvidence | null;
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
      evidenceContextMode: "none" | "raw" | "pruned";
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
    qdrantEmbedding: QdrantEmbeddingDiagnostics | null;
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
  const reranker = getDecisionConfig().reranker;
  if (budgetMode === "fast_grounded") {
    return reranker.fastCandidateLimit;
  }
  if (budgetMode === "deep_rag") {
    return reranker.deepCandidateLimit;
  }
  return reranker.normalCandidateLimit;
}

function rerankerCandidateLimitForRoute(opts: {
  budgetMode: RetrievalBudgetMode;
  routePlan?: DomainRoutePlan | null;
  query: string;
}): number {
  const { budgetMode, routePlan, query } = opts;
  const baseLimit = rerankerCandidateLimitForBudget(budgetMode);
  const needsBroadEvidencePool =
    disclosureIndexes(query).length > 0 ||
    primaryQuerySymbol(query) ||
    asksForMultilingualDisclosure(query) ||
    criticalEvidenceTermGroups(query).length > 0;
  if (routePlan?.confidence === "low" && !needsBroadEvidencePool) {
    return Math.min(baseLimit, getDecisionConfig().reranker.lowConfidenceCandidateLimit);
  }
  return baseLimit;
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

function evidenceHasUsableGrounding(evidence: EvidenceExtractorOutput): boolean {
  return evidence.usableFacts.length > 0 || evidence.directAnswerFacts.length > 0 || evidence.supportingContext.length > 0;
}

function filterSourcesByEvidence(sources: ChatSourceCitation[], evidence: EvidenceExtractorOutput): ChatSourceCitation[] {
  if (!evidenceHasUsableGrounding(evidence)) return [];
  const usedSourceIds = new Set(evidence.sourceIds);
  if (usedSourceIds.size === 0) return [];
  return sources.filter((source) => usedSourceIds.has(source.documentId));
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

function emptyQdrantEmbeddingDiagnostics(): QdrantEmbeddingDiagnostics {
  return {
    requestedProvider: process.env.R3MES_EMBEDDING_PROVIDER ?? "deterministic",
    actualProvider: "deterministic",
    fallbackUsed: false,
    dimension: 0,
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
    evidenceContextMode:
      evidenceInputChars <= 0
        ? "none"
        : evidencePrunedInputChars > 0 && evidencePrunedInputChars < evidenceInputChars
          ? "pruned"
          : "raw",
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

function targetDisclosureIndexes(query: string): string[] {
  const allIndexes = disclosureIndexes(query);
  if (allIndexes.length <= 1) return allIndexes;
  const indexedSymbol = query.match(/\b[A-Za-zÇĞİÖŞÜçğıöşü]{3,6}\s+(\d{6,})\b/u)?.[1];
  return [indexedSymbol ?? allIndexes[0]].filter(Boolean);
}

function hasExplicitIdentifierScope(query: string): boolean {
  return targetDisclosureIndexes(query).length > 0 || Boolean(primaryQuerySymbol(query));
}

const NON_PRIMARY_UPPERCASE_TOKENS = new Set([
  "SPK",
  "CMB",
  "KAP",
  "TL",
  "TRY",
  "PDF",
  "YK",
  "VUK",
]);

function explicitUppercaseSymbols(value: string): string[] {
  return [...new Set(value.match(/\b[A-ZÇĞİÖŞÜ]{3,6}\b/gu) ?? [])]
    .filter((token) => !NON_PRIMARY_UPPERCASE_TOKENS.has(token));
}

function primaryQuerySymbol(query: string): string | null {
  const indexedSymbol = query.match(/\b([A-Za-zÇĞİÖŞÜçğıöşü]{3,6})\s+\d{6,}\b/u)?.[1];
  if (indexedSymbol && !NON_PRIMARY_UPPERCASE_TOKENS.has(indexedSymbol.toLocaleUpperCase("tr-TR"))) {
    return indexedSymbol.toLocaleUpperCase("tr-TR");
  }
  return explicitUppercaseSymbols(query)[0] ?? null;
}

function candidateTitleSymbol(title: string): string | null {
  const indexedSymbol = title.match(/\b([A-Za-zÇĞİÖŞÜçğıöşü]{3,6})\s+\d{6,}\b/u)?.[1];
  if (indexedSymbol && !NON_PRIMARY_UPPERCASE_TOKENS.has(indexedSymbol.toLocaleUpperCase("tr-TR"))) {
    return indexedSymbol.toLocaleUpperCase("tr-TR");
  }
  return explicitUppercaseSymbols(title)[0] ?? null;
}

function candidateMatchesExplicitIdentifierScope(query: string, candidate: { chunk: HybridKnowledgeChunk }): boolean {
  const targetIndexes = targetDisclosureIndexes(query);
  if (targetIndexes.length > 0) {
    const titleIndexes = disclosureIndexes(candidate.chunk.document.title);
    const contentIndexes = disclosureIndexes(candidate.chunk.content.slice(0, 1200));
    const candidateIndexes = new Set([...titleIndexes, ...contentIndexes]);
    if (candidateIndexes.size > 0 && !targetIndexes.some((index) => candidateIndexes.has(index))) {
      return false;
    }
  }

  const primarySymbol = primaryQuerySymbol(query);
  if (primarySymbol) {
    const titleSymbol = candidateTitleSymbol(candidate.chunk.document.title);
    if (titleSymbol && titleSymbol !== primarySymbol) return false;
  }

  return true;
}

function candidateHasExplicitIdentifierSignal(candidate: { chunk: HybridKnowledgeChunk }): boolean {
  return (
    disclosureIndexes(candidate.chunk.document.title).length > 0 ||
    disclosureIndexes(candidate.chunk.content.slice(0, 1200)).length > 0 ||
    Boolean(candidateTitleSymbol(candidate.chunk.document.title))
  );
}

async function explicitIdentifierPreflight(
  query: string,
  accessibleCollectionIds: string[],
): Promise<"no_scope" | "matched" | "missing" | "unknown"> {
  if (!hasExplicitIdentifierScope(query)) return "no_scope";
  const targetIndexes = targetDisclosureIndexes(query);
  const primarySymbol = primaryQuerySymbol(query);
  const documents = await prisma.knowledgeDocument.findMany({
    where: { collectionId: { in: accessibleCollectionIds } },
    select: { title: true },
    take: 500,
  });
  let hasIdentifierDocuments = false;
  for (const document of documents) {
    const titleIndexes = disclosureIndexes(document.title);
    const titleSymbol = candidateTitleSymbol(document.title);
    if (titleIndexes.length === 0 && !titleSymbol) continue;
    hasIdentifierDocuments = true;
    const indexMatches =
      targetIndexes.length === 0 ||
      titleIndexes.length === 0 ||
      targetIndexes.some((index) => titleIndexes.includes(index));
    const symbolMatches = !primarySymbol || !titleSymbol || titleSymbol === primarySymbol;
    if (indexMatches && symbolMatches) return "matched";
  }
  return hasIdentifierDocuments ? "missing" : "unknown";
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

function asksForContradictionReview(query: string): boolean {
  const normalized = normalize(query);
  return (
    normalized.includes("celis") ||
    normalized.includes("tutarsiz") ||
    normalized.includes("uyumlu mu") ||
    normalized.includes("birbiriyle uyumlu") ||
    normalized.includes("tek dogru") ||
    normalized.includes("kesin konusmadan") ||
    normalized.includes("net ve kesin")
  );
}

function diversifyMultilingualDisclosureCandidates<T extends { chunk: HybridKnowledgeChunk }>(
  query: string,
  accepted: T[],
  candidates: T[],
  limit: number,
): T[] {
  if (!asksForMultilingualDisclosure(query)) return accepted.slice(0, limit);
  const targetIndexes = targetDisclosureIndexes(query);
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

function diversifyContradictionReviewCandidates<T extends { chunk: HybridKnowledgeChunk }>(
  query: string,
  accepted: T[],
  candidates: T[],
  limit: number,
): T[] {
  if (!asksForContradictionReview(query) || limit < 2) return accepted.slice(0, limit);

  const byDocument = new Map<string, T>();
  const add = (candidate: T) => {
    if (byDocument.size >= limit) return;
    if (byDocument.has(candidate.chunk.documentId)) return;
    byDocument.set(candidate.chunk.documentId, candidate);
  };

  for (const candidate of accepted) add(candidate);
  if (byDocument.size >= 2) return [...byDocument.values()].slice(0, limit);

  for (const candidate of candidates) {
    add(candidate);
    if (byDocument.size >= 2) break;
  }

  return [...byDocument.values()].slice(0, limit);
}

function diversifyQueryCoverageCandidates<T extends { chunk: HybridKnowledgeChunk }>(
  query: string,
  accepted: T[],
  candidates: T[],
  limit: number,
  routePlan?: DomainRoutePlan | null,
): T[] {
  if (limit < 2 || candidates.length === 0) return accepted.slice(0, limit);
  const selected = [...accepted];
  const selectedKeys = () => new Set(selected.map((candidate) => candidate.chunk.documentId));
  const selectedText = () => normalize(selected.map((candidate) => [
    candidate.chunk.document.title,
    candidate.chunk.content,
  ].join(" ")).join(" "));
  const importantTerms = uniqueTokens([
    ...buildExpandedQueryTokens(query, routePlan, 32),
    ...(routePlan?.mustIncludeTerms ?? []),
  ])
    .filter((term) => term.length >= 4)
    .filter((term) => !["kaynak", "kaynaklar", "hangi", "kisa", "kısa", "acikla", "açıkla", "gerekiyor", "hazirlamaliyim"].includes(term))
    .slice(0, 12);

  for (const term of importantTerms) {
    if (selected.length >= limit) break;
    if (selectedText().includes(term)) continue;
    const match = candidates.find((candidate) => {
      if (selectedKeys().has(candidate.chunk.documentId)) return false;
      const haystack = normalize([
        candidate.chunk.document.title,
        candidate.chunk.content,
      ].join(" "));
      return haystack.includes(term);
    });
    if (match) selected.push(match);
  }

  return selected.slice(0, limit);
}

function criticalEvidenceTermGroups(query: string): string[][] {
  const normalized = normalize(query);
  const groups: string[][] = [];
  if (normalized.includes("stopaj") || normalized.includes("withholding")) {
    groups.push(["stopaj", "withholding tax", "withholding"]);
  }
  if (normalized.includes("spk") || normalized.includes("cmb")) {
    groups.push(["spk", "cmb", "capital markets board"]);
  }
  if (normalized.includes("net donem") || normalized.includes("net profit")) {
    groups.push(["net donem", "net profit"]);
  }
  if (
    normalized.includes("dagitilmasi ongorulen diger kaynak") ||
    normalized.includes("other sources") ||
    normalized.includes("olaganustu yedek")
  ) {
    groups.push(["dagitilmasi ongorulen diger kaynak", "other sources", "olaganustu yedek", "extraordinary reserves"]);
  }
  if (
    (normalized.includes("grup") || normalized.includes("grub") || normalized.includes("group")) &&
    (
      normalized.includes("nakit") ||
      normalized.includes("cash") ||
      normalized.includes("bedelsiz") ||
      normalized.includes("bonus") ||
      normalized.includes("oran") ||
      normalized.includes("rate")
    )
  ) {
    groups.push(["__share_group_table__"]);
  }
  return groups;
}

function candidateMatchesTermGroup(candidate: { chunk: HybridKnowledgeChunk }, terms: string[]): boolean {
  const haystack = normalize([
    candidate.chunk.document.title,
    candidate.chunk.content,
  ].join(" "));
  if (terms.includes("__share_group_table__")) {
    const hasShareGroupRows =
      /(?:^|\s)a\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(haystack) &&
      /(?:^|\s)b\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(haystack);
    return (
      (haystack.includes("grubu") || haystack.includes("group") || hasShareGroupRows) &&
      (haystack.includes("nakit") || haystack.includes("nak it") || haystack.includes("cash")) &&
      (haystack.includes("toplam") || haystack.includes("total")) &&
      (haystack.includes("oran") || haystack.includes("rate") || haystack.includes("bonus") || haystack.includes("bedelsiz"))
    );
  }
  return terms.some((term) => haystack.includes(normalize(term)));
}

function criticalEvidenceCoverageScore(candidate: { chunk: HybridKnowledgeChunk }, terms: string[]): number {
  const haystack = normalize([
    candidate.chunk.document.title,
    candidate.chunk.content,
  ].join(" "));
  if (terms.includes("__share_group_table__")) {
    let score = 0;
    if (haystack.includes("grubu") || haystack.includes("group")) score += 2;
    if (haystack.includes("nakit") || haystack.includes("nak it") || haystack.includes("cash")) score += 2;
    if (haystack.includes("toplam") || haystack.includes("total")) score += 2;
    if (haystack.includes("oran") || haystack.includes("rate") || haystack.includes("bonus") || haystack.includes("bedelsiz")) score += 2;
    if (/\ba\s+grubu\b|\ba\s+[\d.,]{3,}/u.test(haystack)) score += 3;
    if (/\bb\s+grubu\b|\bb\s+[\d.,]{3,}/u.test(haystack)) score += 3;
    if (/\bc\s+grubu\b|\bc\s+[\d.,]{3,}/u.test(haystack)) score += 3;
    if (/(?:^|\s)a\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(haystack)) score += 4;
    if (/(?:^|\s)b\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(haystack)) score += 4;
    if ((haystack.match(/\d[\d.]{2,}(?:,\d+)?/gu) ?? []).length >= 5) score += 3;
    return score;
  }
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(normalize(term))) score += 2;
  }
  if ((terms.includes("stopaj") || terms.includes("withholding")) && /(?:%?\s*0|0\s*%|0,00)/u.test(haystack) && /(?:%?\s*5|5\s*%|5,00)/u.test(haystack)) {
    score += 5;
  }
  return score;
}

function diversifyCriticalEvidenceCandidates<T extends { chunk: HybridKnowledgeChunk }>(
  query: string,
  accepted: T[],
  candidates: T[],
  limit: number,
): T[] {
  const groups = criticalEvidenceTermGroups(query);
  if (groups.length === 0) return accepted.slice(0, limit);

  const key = (candidate: T) => candidate.chunk.id || `${candidate.chunk.documentId}:${candidate.chunk.chunkIndex}`;
  const selected = accepted.slice(0, limit);
  const selectedKeys = () => new Set(selected.map(key));

  for (const group of groups) {
    const hasGroup = selected.some((candidate) => candidateMatchesTermGroup(candidate, group));
    if (hasGroup) continue;
    const match = candidates
      .filter((candidate) =>
        candidateMatchesExplicitIdentifierScope(query, candidate) &&
        candidateMatchesTermGroup(candidate, group) &&
        !selectedKeys().has(key(candidate))
      )
      .sort((a, b) => criticalEvidenceCoverageScore(b, group) - criticalEvidenceCoverageScore(a, group))[0];
    if (!match) continue;
    if (selected.length < limit) {
      selected.push(match);
      continue;
    }
    let replaceIndex = -1;
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      const alreadyCoversCriticalGroup = groups.some((candidateGroup) =>
        candidateMatchesTermGroup(selected[index], candidateGroup),
      );
      if (!alreadyCoversCriticalGroup) {
        replaceIndex = index;
        break;
      }
    }
    selected[replaceIndex >= 0 ? replaceIndex : selected.length - 1] = match;
  }

  const deduped = new Map<string, T>();
  for (const candidate of selected) deduped.set(key(candidate), candidate);
  return [...deduped.values()].slice(0, limit);
}

function prioritizeCriticalEvidenceCandidates<T extends { chunk: HybridKnowledgeChunk }>(
  query: string,
  candidates: T[],
): T[] {
  const groups = criticalEvidenceTermGroups(query);
  if (groups.length === 0) return candidates;
  const selected = new Map<string, T>();
  const key = (candidate: T) => candidate.chunk.id || `${candidate.chunk.documentId}:${candidate.chunk.chunkIndex}`;
  for (const group of groups) {
    const match = candidates
      .filter((candidate) =>
        candidateMatchesExplicitIdentifierScope(query, candidate) &&
        candidateMatchesTermGroup(candidate, group) &&
        !selected.has(key(candidate))
      )
      .sort((a, b) => criticalEvidenceCoverageScore(b, group) - criticalEvidenceCoverageScore(a, group))[0];
    if (match) selected.set(key(match), match);
  }
  for (const candidate of candidates) {
    selected.set(key(candidate), candidate);
  }
  return [...selected.values()];
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
      ingestionQuality: {
        version: 1,
        tableRisk: payload.tableRisk ?? "none",
        ocrRisk: payload.ocrRisk ?? "none",
        thinSource: payload.thinSource === true,
        strictRouteEligible: payload.strictRouteEligible !== false,
        warnings: [],
      },
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

function strictRouteEligibleFromMetadata(value: unknown): boolean | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.sourceQuality === "thin") return false;
  const ingestionQuality =
    record.ingestionQuality && typeof record.ingestionQuality === "object"
      ? record.ingestionQuality as Record<string, unknown>
      : null;
  if (!ingestionQuality) return null;
  if (ingestionQuality.strictRouteEligible === false) return false;
  if (ingestionQuality.thinSource === true) return false;
  if (ingestionQuality.ocrRisk === "high") return false;
  return true;
}

function candidateStrictRouteEligible(chunk: HybridKnowledgeChunk): boolean {
  const chunkEligible = strictRouteEligibleFromMetadata(chunk.autoMetadata);
  const documentEligible = strictRouteEligibleFromMetadata(chunk.document.autoMetadata);
  if (chunkEligible === false || documentEligible === false) return false;
  return true;
}

export function candidateMatchesRouteScope(card: KnowledgeCard, chunk: HybridKnowledgeChunk, routePlan?: DomainRoutePlan | null): boolean {
  if (!routePlan || routePlan.confidence === "low") return true;
  if (!candidateStrictRouteEligible(chunk)) return false;
  const metadataHaystack = normalize([
    metadataText(chunk.autoMetadata),
    metadataText(chunk.document.autoMetadata),
  ].join(" "));
  if (metadataHaystack.includes("kap") && metadataHaystack.includes("finance")) {
    return true;
  }
  const cardDomains = explicitCardDomains(card);
  if (
    cardDomains.length > 0 &&
    !cardDomains.includes(normalize(routePlan.domain)) &&
    routePlan.domain !== "general"
  ) {
    return false;
  }
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
}): Promise<{ candidates: HybridKnowledgeCandidate[]; embedding: QdrantEmbeddingDiagnostics }> {
  const retrievalQuery = buildExpandedQueryText(opts.query, opts.routePlan);
  const embeddingRun = await embedTextForQdrantWithDiagnostics(retrievalQuery);
  const points = await searchQdrantKnowledge({
    vector: embeddingRun.vector,
    accessibleCollectionIds: opts.accessibleCollectionIds,
    limit: qdrantLimit(),
  });
  const candidates = points
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
  return {
    candidates,
    embedding: embeddingRun.diagnostics,
  };
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

async function collectCriticalEvidenceCandidates(opts: {
  query: string;
  accessibleCollectionIds: string[];
  routePlan?: DomainRoutePlan | null;
}): Promise<HybridKnowledgeCandidate[]> {
  const groups = criticalEvidenceTermGroups(opts.query);
  const targetIndexes = targetDisclosureIndexes(opts.query);
  const primarySymbol = primaryQuerySymbol(opts.query);
  if (groups.length === 0 || (targetIndexes.length === 0 && !primarySymbol)) return [];

  const titleScopes = [
    ...targetIndexes.map((index) => ({ document: { title: { contains: index, mode: "insensitive" as const } } })),
    ...(primarySymbol ? [{ document: { title: { contains: primarySymbol, mode: "insensitive" as const } } }] : []),
  ];
  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      document: {
        collectionId: { in: opts.accessibleCollectionIds },
        parseStatus: "READY",
      },
      ...(titleScopes.length > 0 ? { AND: titleScopes } : {}),
    },
    include: {
      document: true,
      embedding: true,
    },
    orderBy: [{ createdAt: "desc" }, { chunkIndex: "asc" }],
    take: 120,
  });

  return chunks
    .map((candidate) => {
      const chunk: HybridKnowledgeChunk = {
        id: candidate.id,
        documentId: candidate.documentId,
        chunkIndex: candidate.chunkIndex,
        content: candidate.content,
        autoMetadata: candidate.autoMetadata,
        document: {
          title: candidate.document.title,
          collectionId: candidate.document.collectionId,
          autoMetadata: candidate.document.autoMetadata,
        },
        embedding: candidate.embedding,
      };
      const coverage = Math.max(0, ...groups.map((group) => criticalEvidenceCoverageScore({ chunk }, group)));
      return {
        chunk,
        card: parseKnowledgeCard(chunk.content),
        sources: ["prisma" as const],
        lexicalScore: coverage,
        preRankScore: coverage + 20,
      };
    })
    .filter((candidate) =>
      candidateMatchesRouteScope(candidate.card, candidate.chunk, opts.routePlan) &&
      groups.some((group) => candidateMatchesTermGroup(candidate, group)),
    )
    .sort((a, b) => b.preRankScore - a.preRankScore)
    .slice(0, Math.max(8, prismaLimit()));
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
  const targetIndexes = targetDisclosureIndexes(query);
  const primarySymbol = primaryQuerySymbol(query);
  const title = candidate.chunk.document.title;
  const text = normalize([
    title,
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
  const criticalEvidenceBonus = Math.min(
    36,
    Math.max(0, ...criticalEvidenceTermGroups(query).map((group) => criticalEvidenceCoverageScore(candidate, group) * 3)),
  );
  const identifierBonus = targetIndexes.some((index) => title.includes(index) || candidate.chunk.content.includes(index))
    ? 10
    : 0;
  const symbolBonus = primarySymbol && candidateTitleSymbol(title) === primarySymbol ? 8 : 0;
  const lengthPenalty = candidate.chunk.content.trim().length < 80 ? 1 : 0;
  return overlap + phraseBonus + routeBonus + sourceBonus + semanticBonus + criticalEvidenceBonus + identifierBonus + symbolBonus - lengthPenalty;
}

export function preRankHybridKnowledgeCandidates(opts: {
  query: string;
  candidates: HybridKnowledgeCandidate[];
  routePlan?: DomainRoutePlan | null;
  limit?: number;
}): HybridKnowledgeCandidate[] {
  const scopedCandidates = opts.candidates.filter((candidate) =>
    candidateMatchesExplicitIdentifierScope(opts.query, candidate),
  );
  const shouldEnforceIdentifierScope =
    hasExplicitIdentifierScope(opts.query) &&
    opts.candidates.some((candidate) => candidateHasExplicitIdentifierSignal(candidate));
  const rankingPool = scopedCandidates.length > 0 || shouldEnforceIdentifierScope ? scopedCandidates : opts.candidates;
  return rankingPool
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

function promoteGroundingFromCompiledEvidence(opts: {
  base: GroundingConfidence;
  compiledEvidence: CompiledEvidence;
}): GroundingConfidence {
  if (opts.compiledEvidence.contradictionCount > 0) return "low";
  if (opts.base !== "low") return opts.base;
  if (opts.compiledEvidence.usableFactCount >= 2 && opts.compiledEvidence.sourceIds.length > 0) return "medium";
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
  const pruning = getDecisionConfig().evidencePruning;
  if (budgetMode === "fast_grounded") return pruning.fastMaxChars;
  if (budgetMode === "deep_rag") return pruning.deepMaxChars;
  return pruning.normalMaxChars;
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
  const asksForShareGroupTable =
    (normalizedQuery.includes("grubu") || normalizedQuery.includes("group")) &&
    (normalizedQuery.includes("nakit") ||
      normalizedQuery.includes("cash") ||
      normalizedQuery.includes("bedelsiz") ||
      normalizedQuery.includes("bonus") ||
      normalizedQuery.includes("oran") ||
      normalizedQuery.includes("rate"));
  const hasShareGroupTableRows =
    /(?:^|\s)a\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalizedSentence) &&
    /(?:^|\s)b\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalizedSentence);
  if (
    asksForShareGroupTable &&
    hasShareGroupTableRows &&
    (normalizedSentence.includes("cash") ||
      normalizedSentence.includes("nakit") ||
      normalizedSentence.includes("bonus") ||
      normalizedSentence.includes("bedelsiz") ||
      normalizedSentence.includes("rate") ||
      normalizedSentence.includes("oran"))
  ) {
    score += 36;
  }
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

function evidenceMaxFactSentences(): number {
  return getDecisionConfig().evidencePruning.maxFactSentences;
}

function isStructuredEvidenceSentence(sentence: string): boolean {
  return /^(?:Topic|Tags|Source Summary|Key Takeaway|Patient Summary|Clinical Takeaway|Safe Guidance|Red Flags|Do Not Infer|Başlık|Etiketler|Temel Bilgi|Triage|Uyarı Bulguları|Çıkarım Yapma)\s*:/iu.test(sentence);
}

function isRiskEvidenceSentence(sentence: string): boolean {
  return /\b(?:risk|dikkat|acil|şiddetli|siddetli|uyarı|uyari|kesin|çıkarım|cikarim|do not infer)\b/iu.test(sentence);
}

function pickRelevantSentences(query: string, text: string, maxChars: number, maxSentences = evidenceMaxFactSentences()): {
  text: string;
  candidateSentenceCount: number;
  selectedSentenceCount: number;
  droppedSentenceCount: number;
} {
  const queryTokens = new Set(buildExpandedQueryTokens(query, null, 48));
  const parts = sentenceParts(text);
  const scored = parts
    .map((sentence, index) => {
      const sentenceTokens = Array.from(new Set([
        ...tokenize(sentence),
        ...buildExpandedQueryTokens(sentence, null, 64),
      ]));
      const overlap = sentenceTokens.filter((token) => queryTokens.has(token)).length;
      const structureBonus = isStructuredEvidenceSentence(sentence) ? 2 : 0;
      const riskBonus = isRiskEvidenceSentence(sentence) ? 1 : 0;
      const financeScore = financeLineItemScore(query, sentence);
      const isEarlyMetadata = structureBonus > 0 && index <= 2;
      const keep =
        overlap > 0 ||
        financeScore > 0 ||
        isEarlyMetadata ||
        (riskBonus > 0 && overlap > 0);
      return {
        sentence,
        index,
        overlap,
        score: keep ? overlap * 4 + structureBonus + riskBonus + financeScore : 0,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = scored.slice(0, Math.max(1, maxSentences)).sort((a, b) => a.index - b.index).map((item) => item.sentence);
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
  maxChars?: number;
  maxSentences?: number;
}): { text: string; diagnostics: EvidencePruningDiagnostics } {
  const maxChars = opts.maxChars ?? evidenceInputMaxChars(opts.budgetMode);
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
  const picked = pickRelevantSentences(opts.query, sourceText, maxChars, opts.maxSentences);
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
  maxChars?: number;
  maxSentences?: number;
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
        qdrantEmbedding: null,
        retrievalMode: "true_hybrid",
      },
    };
  }

  const identifierPreflight = await explicitIdentifierPreflight(evidenceQuery, accessibleCollectionIds);
  if (identifierPreflight === "missing") {
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
        alignment: emptyAlignmentDiagnostics({
          fastFailed: true,
        }),
        reranker: emptyRerankDiagnostics(),
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
        }),
        qdrantEmbedding: null,
        retrievalMode: "true_hybrid",
      },
    };
  }

  const strictRouteScope = isStrictRouteScope(routePlan);
  const [qdrantResult, prismaResult, criticalEvidenceResult] = await Promise.allSettled([
    collectQdrantCandidates({ query, accessibleCollectionIds, routePlan }),
    collectPrismaCandidates({ query, accessibleCollectionIds, routePlan }),
    collectCriticalEvidenceCandidates({ query: evidenceQuery, accessibleCollectionIds, routePlan }),
  ]);
  const qdrantCandidates = qdrantResult.status === "fulfilled" ? qdrantResult.value.candidates : [];
  const qdrantEmbeddingDiagnostics =
    qdrantResult.status === "fulfilled" ? qdrantResult.value.embedding : emptyQdrantEmbeddingDiagnostics();
  const prismaCandidates = prismaResult.status === "fulfilled" ? prismaResult.value : [];
  const criticalEvidenceCandidates = criticalEvidenceResult.status === "fulfilled" ? criticalEvidenceResult.value : [];
  if (qdrantResult.status === "rejected") {
    console.warn(`[hybrid-retrieval] qdrant candidate collection failed: ${qdrantResult.reason}`);
  }
  if (prismaResult.status === "rejected") {
    console.warn(`[hybrid-retrieval] prisma candidate collection failed: ${prismaResult.reason}`);
  }
  if (criticalEvidenceResult.status === "rejected") {
    console.warn(`[hybrid-retrieval] critical evidence candidate collection failed: ${criticalEvidenceResult.reason}`);
  }

  const deduped = dedupeHybridKnowledgeCandidates([...criticalEvidenceCandidates, ...qdrantCandidates, ...prismaCandidates]);
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
        qdrantEmbedding: qdrantEmbeddingDiagnostics,
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
  const candidatesForRerank = prioritizeCriticalEvidenceCandidates(evidenceQuery, alignedPreRanked.candidates);
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
        qdrantEmbedding: qdrantEmbeddingDiagnostics,
        retrievalMode: "true_hybrid",
      },
    };
  }
  const identifierScopedNoMatch =
    hasExplicitIdentifierScope(evidenceQuery) &&
    deduped.some((candidate) => candidateHasExplicitIdentifierSignal(candidate)) &&
    preRanked.length === 0;
  if (identifierScopedNoMatch) {
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
        alignment: {
          ...alignedPreRanked.diagnostics,
          fastFailed: true,
        },
        reranker: emptyRerankDiagnostics({
          inputCandidateCount: 0,
        }),
        budget: buildBudgetDiagnostics({
          budgetMode,
          requestedSourceLimit,
          finalSourceLimit: limit,
          finalSourceCount: 0,
        }),
        qdrantEmbedding: qdrantEmbeddingDiagnostics,
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
        qdrantEmbedding: qdrantEmbeddingDiagnostics,
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
  const rerankerCandidateLimit = rerankerCandidateLimitForRoute({ budgetMode, routePlan, query: evidenceQuery });
  const scopedRerankerCandidateLimit =
    disclosureIndexes(evidenceQuery).length > 0 || primaryQuerySymbol(evidenceQuery)
      ? Math.min(rerankerCandidateLimit, getDecisionConfig().reranker.scopedCandidateLimit)
      : rerankerCandidateLimit;
  const rerankReturnLimit =
    asksForMultilingualDisclosure(evidenceQuery) ||
    asksForContradictionReview(evidenceQuery) ||
    criticalEvidenceTermGroups(evidenceQuery).length > 0
    ? Math.max(limit, scopedRerankerCandidateLimit)
    : Math.max(limit, 3);
  const rerankRun = await rerankKnowledgeCardsWithDiagnostics(query, rerankInput, rerankReturnLimit, {
    candidateLimit: scopedRerankerCandidateLimit,
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
  const criticalRerankPool = [
    ...reranked,
    ...candidatesForRerank.map((candidate) => ({
      ...candidate,
      rerankScore: Math.max(minRerankScore(), candidate.preRankScore ?? 0),
    })),
  ];
  const accepted = diversifyCriticalEvidenceCandidates(
    evidenceQuery,
    diversifyQueryCoverageCandidates(
      evidenceQuery,
      diversifyContradictionReviewCandidates(
        evidenceQuery,
        diversifyMultilingualDisclosureCandidates(evidenceQuery, scoreAccepted, reranked, limit),
        reranked,
        limit,
      ),
      reranked,
      limit,
      routePlan,
    ),
    criticalRerankPool,
    limit,
  );
  const alignedAccepted = alignHybridKnowledgeCandidates({
    query: evidenceQuery,
    candidates: accepted,
    routePlan,
    allowSemanticReview: criticalEvidenceTermGroups(evidenceQuery).length > 0,
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
        qdrantEmbedding: qdrantEmbeddingDiagnostics,
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
  const totalEvidenceMaxChars = evidenceInputMaxChars(budgetMode);
  const totalEvidenceMaxSentences = evidenceMaxFactSentences();
  const perCandidateMaxChars = Math.max(240, Math.ceil(totalEvidenceMaxChars / Math.max(1, finalCandidates.length)));
  const perCandidateMaxSentences = Math.max(1, Math.ceil(totalEvidenceMaxSentences / Math.max(1, finalCandidates.length)));
  const prunedEvidenceInputs = finalCandidates.map((candidate) => ({
    candidate,
    ...buildPrunedEvidenceInputWithDiagnostics({
      query: evidenceQuery,
      candidate,
      budgetMode,
      maxChars: perCandidateMaxChars,
      maxSentences: perCandidateMaxSentences,
    }),
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
  const filteredSources = filterSourcesByEvidence(sources, evidenceRun.output);
  const sourceRefs = filteredSources.map((source) => ({ id: source.documentId, title: source.title }));
  const compiledEvidence = compileEvidence({
    evidence: evidenceRun.output,
    sourceRefs,
    groundingConfidence,
  });
  const responseGroundingConfidence = promoteGroundingFromCompiledEvidence({
    base: groundingConfidence,
    compiledEvidence,
  });
  const responseCompiledEvidence =
    responseGroundingConfidence === compiledEvidence.confidence
      ? compiledEvidence
      : { ...compiledEvidence, confidence: responseGroundingConfidence };
  if (evidenceHasOnlyScopeExclusion(evidenceRun.output) || !hasCompiledUsableGrounding(responseCompiledEvidence)) {
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
      compiledEvidence: responseCompiledEvidence,
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
        qdrantEmbedding: qdrantEmbeddingDiagnostics,
        retrievalMode: "true_hybrid",
      },
    };
  }
  const responseLowGroundingConfidence = responseGroundingConfidence === "low";
  const brief =
    getRagContextMode() === "detailed"
      ? renderDetailedEvidenceBrief(evidenceRun.output, {
          groundingConfidence: responseGroundingConfidence,
          lowGroundingConfidence: responseLowGroundingConfidence,
        })
      : responseCompiledEvidence.usableFactCount > 0 || responseCompiledEvidence.unknownCount > 0
        ? buildCompiledEvidenceBrief(responseCompiledEvidence, {
            groundingConfidence: responseCompiledEvidence.confidence,
            lowGroundingConfidence: responseLowGroundingConfidence,
            answerIntent: evidenceRun.output.answerIntent,
            sourceRefs,
          })
        : evidenceRun.output.usableFacts.length > 0 || evidenceRun.output.notSupported.length > 0
        ? buildEvidenceGroundedBrief(evidenceRun.output, {
            groundingConfidence,
            lowGroundingConfidence,
            answerIntent: evidenceRun.output.answerIntent,
            sourceRefs,
          })
        : buildGroundedBrief(
            finalCandidates.map(({ card }) => card),
            {
              groundingConfidence,
              lowGroundingConfidence,
              answerIntent: evidenceRun.output.answerIntent,
              sourceRefs,
            },
          );

  const contextText = filteredSources.length > 0 ? brief : "";
  return {
    contextText,
    sources: filteredSources,
    lowGroundingConfidence: responseLowGroundingConfidence,
    groundingConfidence: responseGroundingConfidence,
    evidence: evidenceRun.output,
    compiledEvidence: responseCompiledEvidence,
    diagnostics: {
      qdrantCandidateCount: qdrantCandidates.length,
      prismaCandidateCount: prismaCandidates.length,
      dedupedCandidateCount: deduped.length,
      preRankedCandidateCount: preRanked.length,
      rerankedCandidateCount: reranked.length,
      finalCandidateCount: filteredSources.length,
      alignment: finalAlignmentDiagnostics,
      reranker: rerankRun.diagnostics,
      budget: buildBudgetDiagnostics({
        budgetMode,
        requestedSourceLimit,
        finalSourceLimit: limit,
        finalSourceCount: filteredSources.length,
        contextText,
        evidenceInputChars,
        evidencePrunedInputChars,
        evidenceFactCandidateCount,
        evidenceFactSelectedCount,
        evidenceFactDroppedCount,
        evidence: evidenceRun.output,
      }),
      qdrantEmbedding: qdrantEmbeddingDiagnostics,
      retrievalMode: "true_hybrid",
    },
  };
}
