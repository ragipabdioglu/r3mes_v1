import { createHash } from "node:crypto";

import { tokenizeKnowledgeText } from "./knowledgeEmbedding.js";

const AI_ENGINE_DEFAULT = "http://127.0.0.1:8000";
const DEFAULT_QDRANT_VECTOR_SIZE = 1024;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 15_000;

interface EmbeddingsResponse {
  model?: string;
  data?: Array<{ index?: number; embedding?: number[] }>;
}

type QdrantEmbeddingProvider = "deterministic" | "ai-engine" | "bge-m3";

export interface QdrantEmbeddingDiagnostics {
  requestedProvider: string;
  actualProvider: QdrantEmbeddingProvider;
  fallbackUsed: boolean;
  dimension: number;
  model?: string;
  error?: string;
}

export interface QdrantEmbeddingResult {
  vectors: number[][];
  diagnostics: QdrantEmbeddingDiagnostics;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAiEngineBase(): string {
  return (process.env.R3MES_AI_ENGINE_URL ?? process.env.AI_ENGINE_URL ?? AI_ENGINE_DEFAULT).replace(/\/$/, "");
}

export function getQdrantVectorSize(): number {
  return parsePositiveInt(process.env.R3MES_QDRANT_VECTOR_SIZE, DEFAULT_QDRANT_VECTOR_SIZE);
}

function hashToIndex(token: string, dimensions: number): number {
  const digest = createHash("sha256").update(token).digest();
  return digest.readUInt32BE(0) % dimensions;
}

function normalizeVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? values : values.map((value) => value / norm);
}

export function embedTextDeterministicForQdrant(text: string, dimensions = getQdrantVectorSize()): number[] {
  const values = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenizeKnowledgeText(text);
  for (const token of tokens) {
    values[hashToIndex(token, dimensions)] += 1;
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    values[hashToIndex(`${tokens[i]}_${tokens[i + 1]}`, dimensions)] += 0.5;
  }
  return normalizeVector(values);
}

async function embedWithAiEngine(texts: string[]): Promise<{ vectors: number[][]; model?: string }> {
  const controller = new AbortController();
  const batchScaledTimeoutMs = DEFAULT_EMBEDDING_TIMEOUT_MS * Math.max(1, texts.length);
  const timeoutMs = Math.max(
    parsePositiveInt(process.env.R3MES_EMBEDDING_TIMEOUT_MS, batchScaledTimeoutMs),
    batchScaledTimeoutMs,
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getAiEngineBase()}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ input: texts }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ai-engine embeddings failed with status ${response.status}`);
    }
    const parsed = (await response.json()) as EmbeddingsResponse;
    const vectors = [...(parsed.data ?? [])]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding);
    if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || vector.length === 0)) {
      throw new Error("ai-engine embeddings response missing vectors");
    }
    return {
      vectors: vectors.map((vector) => normalizeVector(vector!.map(Number))),
      model: typeof parsed.model === "string" ? parsed.model : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function embedTextsForQdrantWithDiagnostics(texts: string[]): Promise<QdrantEmbeddingResult> {
  const provider = (process.env.R3MES_EMBEDDING_PROVIDER ?? "deterministic").trim().toLowerCase();
  if (provider === "ai-engine" || provider === "bge-m3") {
    try {
      const { vectors, model } = await embedWithAiEngine(texts);
      const dimension = getQdrantVectorSize();
      if (vectors.every((vector) => vector.length === dimension)) {
        return {
          vectors,
          diagnostics: {
            requestedProvider: provider,
            actualProvider: provider,
            fallbackUsed: false,
            dimension,
            model,
          },
        };
      }
      console.warn("[qdrant-embedding] vector size mismatch, deterministic fallback");
      const fallbackVectors = texts.map((text) => embedTextDeterministicForQdrant(text));
      return {
        vectors: fallbackVectors,
        diagnostics: {
          requestedProvider: provider,
          actualProvider: "deterministic",
          fallbackUsed: true,
          dimension: fallbackVectors[0]?.length ?? dimension,
          model,
          error: "vector size mismatch",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[qdrant-embedding] ai-engine fallback: ${message}`);
      const fallbackVectors = texts.map((text) => embedTextDeterministicForQdrant(text));
      return {
        vectors: fallbackVectors,
        diagnostics: {
          requestedProvider: provider,
          actualProvider: "deterministic",
          fallbackUsed: true,
          dimension: fallbackVectors[0]?.length ?? getQdrantVectorSize(),
          error: message,
        },
      };
    }
  }
  const vectors = texts.map((text) => embedTextDeterministicForQdrant(text));
  return {
    vectors,
    diagnostics: {
      requestedProvider: provider,
      actualProvider: "deterministic",
      fallbackUsed: false,
      dimension: vectors[0]?.length ?? getQdrantVectorSize(),
    },
  };
}

export async function embedTextsForQdrant(texts: string[]): Promise<number[][]> {
  return (await embedTextsForQdrantWithDiagnostics(texts)).vectors;
}

export async function embedTextForQdrantWithDiagnostics(text: string): Promise<{
  vector: number[];
  diagnostics: QdrantEmbeddingDiagnostics;
}> {
  const result = await embedTextsForQdrantWithDiagnostics([text]);
  return {
    vector: result.vectors[0] ?? embedTextDeterministicForQdrant(text),
    diagnostics: result.diagnostics,
  };
}

export async function embedTextForQdrant(text: string): Promise<number[]> {
  return (await embedTextsForQdrant([text]))[0] ?? embedTextDeterministicForQdrant(text);
}
