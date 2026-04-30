import type { KnowledgeCard } from "./knowledgeCard.js";
import { rerankKnowledgeCards, type RerankCandidate } from "./rerank.js";
import type { HybridCandidate } from "./hybridRetrieval.js";
import { createHash } from "node:crypto";
import { getAlignmentConfig } from "./alignmentConfig.js";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MODEL_WEIGHT = 1.75;
const DEFAULT_CANDIDATE_LIMIT = 5;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;
const AI_ENGINE_DEFAULT = "http://127.0.0.1:8000";

interface ModelRerankResponse {
  scores?: number[];
}

interface RerankCacheEntry {
  scores: number[];
  expiresAt: number;
}

const rerankScoreCache = new Map<string, RerankCacheEntry>();

function rerankerMode(): string {
  return (process.env.R3MES_RERANKER_MODE ?? "deterministic").trim().toLowerCase();
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getTimeoutMs(): number {
  return parsePositiveInt(process.env.R3MES_RERANKER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

function getModelWeight(): number {
  return parsePositiveFloat(process.env.R3MES_RERANKER_MODEL_WEIGHT, DEFAULT_MODEL_WEIGHT);
}

function getCandidateLimit(): number {
  return parsePositiveInt(process.env.R3MES_RERANKER_CANDIDATE_LIMIT, DEFAULT_CANDIDATE_LIMIT);
}

function getCacheTtlMs(): number {
  return parsePositiveInt(process.env.R3MES_RERANKER_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
}

function getCacheMaxEntries(): number {
  return parsePositiveInt(process.env.R3MES_RERANKER_CACHE_MAX_ENTRIES, DEFAULT_CACHE_MAX_ENTRIES);
}

function getAiEngineBase(): string {
  return (process.env.R3MES_AI_ENGINE_URL ?? process.env.AI_ENGINE_URL ?? AI_ENGINE_DEFAULT).replace(/\/$/, "");
}

function readChunkContent(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const content = (chunk as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function readChunkTitle(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const record = chunk as { document?: unknown; title?: unknown };
  if (typeof record.title === "string") return record.title;
  if (record.document && typeof record.document === "object") {
    const title = (record.document as { title?: unknown }).title;
    return typeof title === "string" ? title : "";
  }
  return "";
}

function firstWords(value: string, maxWords: number): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

export function buildRerankerDocumentText(candidate: { card: KnowledgeCard; chunk?: unknown }, maxWords = getAlignmentConfig().maxRerankWords): string {
  const title = readChunkTitle(candidate.chunk);
  const rawContent = firstWords(readChunkContent(candidate.chunk), maxWords);
  return [
    title ? `Title: ${title}` : "",
    candidate.card.topic ? `Topic: ${candidate.card.topic}` : "",
    candidate.card.tags.length > 0 ? `Tags: ${candidate.card.tags.join(", ")}` : "",
    candidate.card.patientSummary ? `Patient Summary: ${candidate.card.patientSummary}` : "",
    candidate.card.clinicalTakeaway ? `Clinical Takeaway: ${candidate.card.clinicalTakeaway}` : "",
    candidate.card.safeGuidance ? `Safe Guidance: ${candidate.card.safeGuidance}` : "",
    candidate.card.redFlags ? `Red Flags: ${candidate.card.redFlags}` : "",
    candidate.card.doNotInfer ? `Do Not Infer: ${candidate.card.doNotInfer}` : "",
    rawContent ? `Chunk Start: ${rawContent}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) {
    return scores.map(() => 0.5);
  }
  return scores.map((score) => (score - min) / (max - min));
}

function buildCacheKey(query: string, documents: string[]): string {
  const hash = createHash("sha256");
  hash.update(query.trim().toLocaleLowerCase("tr-TR"));
  for (const document of documents) {
    hash.update("\0");
    hash.update(document.trim());
  }
  return hash.digest("hex");
}

function readCachedScores(cacheKey: string): number[] | null {
  const entry = rerankScoreCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    rerankScoreCache.delete(cacheKey);
    return null;
  }
  rerankScoreCache.delete(cacheKey);
  rerankScoreCache.set(cacheKey, entry);
  return [...entry.scores];
}

function writeCachedScores(cacheKey: string, scores: number[]): void {
  const maxEntries = getCacheMaxEntries();
  if (maxEntries <= 0) return;
  rerankScoreCache.set(cacheKey, { scores: [...scores], expiresAt: Date.now() + getCacheTtlMs() });
  while (rerankScoreCache.size > maxEntries) {
    const oldest = rerankScoreCache.keys().next().value;
    if (!oldest) break;
    rerankScoreCache.delete(oldest);
  }
}

async function scoreDocumentsWithModel(query: string, documents: string[]): Promise<number[]> {
  const cacheKey = buildCacheKey(query, documents);
  const cached = readCachedScores(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutMs = getTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getAiEngineBase()}/v1/rerank`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, documents }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ai-engine rerank failed with status ${response.status}`);
    }
    const parsed = (await response.json()) as ModelRerankResponse;
    if (!Array.isArray(parsed.scores)) {
      throw new Error("ai-engine rerank response missing scores");
    }
    writeCachedScores(cacheKey, parsed.scores);
    return parsed.scores;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Model reranker timed out after ${timeoutMs}ms`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeout);
  }
}

export function isModelRerankerEnabled(): boolean {
  return rerankerMode() === "model";
}

export async function rerankKnowledgeCardsWithFallback<TChunk>(
  query: string,
  candidates: Array<HybridCandidate<TChunk> & { card: KnowledgeCard }>,
  limit = 4,
): Promise<RerankCandidate<TChunk>[]> {
  const deterministic = rerankKnowledgeCards(query, candidates, candidates.length);
  if (!isModelRerankerEnabled() || deterministic.length === 0) {
    return deterministic.slice(0, limit);
  }

  const candidateLimit = Math.min(getCandidateLimit(), deterministic.length);
  const modelPool = deterministic.slice(0, candidateLimit);
  const documents = modelPool.map((candidate) => buildRerankerDocumentText(candidate));

  try {
    const rawScores = await scoreDocumentsWithModel(query, documents);
    if (rawScores.length !== modelPool.length) {
      throw new Error(`Expected ${modelPool.length} rerank scores, received ${rawScores.length}`);
    }

    const normalizedModelScores = normalizeScores(rawScores);
    const modelWeight = getModelWeight();
    const rescored = modelPool
      .map((candidate, index) => ({
        ...candidate,
        rerankScore: candidate.rerankScore + normalizedModelScores[index] * modelWeight,
      }))
      .sort((a, b) => b.rerankScore - a.rerankScore);

    return [...rescored, ...deterministic.slice(candidateLimit)].slice(0, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[backend-reranker] Falling back to deterministic reranker: ${message}`);
    return deterministic.slice(0, limit);
  }
}
