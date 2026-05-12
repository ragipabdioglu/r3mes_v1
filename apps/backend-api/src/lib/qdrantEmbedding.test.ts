import { afterEach, describe, expect, it, vi } from "vitest";

import { embedTextsForQdrantWithDiagnostics } from "./qdrantEmbedding.js";

function vector(size: number, value: number): number[] {
  return Array.from({ length: size }, () => value);
}

describe("embedTextsForQdrantWithDiagnostics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports deterministic embeddings without calling ai-engine", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "deterministic");
    vi.stubEnv("R3MES_QDRANT_VECTOR_SIZE", "16");

    const result = await embedTextsForQdrantWithDiagnostics(["trafik cezası itiraz"]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.vectors).toHaveLength(1);
    expect(result.vectors[0]).toHaveLength(16);
    expect(result.diagnostics).toMatchObject({
      requestedProvider: "deterministic",
      actualProvider: "deterministic",
      fallbackUsed: false,
      dimension: 16,
    });
  });

  it("reports real ai-engine provider when vector dimensions match", async () => {
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "bge-m3");
    vi.stubEnv("R3MES_QDRANT_VECTOR_SIZE", "4");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "C:/r3mes-hf-model-cache/bge-m3",
          data: [
            { index: 0, embedding: vector(4, 1) },
            { index: 1, embedding: vector(4, 2) },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedTextsForQdrantWithDiagnostics(["soru", "cevap"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toHaveLength(4);
    expect(result.diagnostics).toMatchObject({
      requestedProvider: "bge-m3",
      actualProvider: "bge-m3",
      fallbackUsed: false,
      dimension: 4,
      model: "C:/r3mes-hf-model-cache/bge-m3",
    });
  });

  it("falls back and reports diagnostics when ai-engine returns the wrong dimension", async () => {
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "bge-m3");
    vi.stubEnv("R3MES_QDRANT_VECTOR_SIZE", "4");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "bad-dim-model", data: [{ index: 0, embedding: vector(3, 1) }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedTextsForQdrantWithDiagnostics(["baş ağrısı"]);

    expect(result.vectors).toHaveLength(1);
    expect(result.vectors[0]).toHaveLength(4);
    expect(result.diagnostics).toMatchObject({
      requestedProvider: "bge-m3",
      actualProvider: "deterministic",
      fallbackUsed: true,
      dimension: 4,
      model: "bad-dim-model",
      error: "vector size mismatch",
    });
  });

  it("falls back and reports diagnostics when ai-engine request fails", async () => {
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "ai-engine");
    vi.stubEnv("R3MES_QDRANT_VECTOR_SIZE", "8");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const result = await embedTextsForQdrantWithDiagnostics(["migration rollback"]);

    expect(result.vectors[0]).toHaveLength(8);
    expect(result.diagnostics).toMatchObject({
      requestedProvider: "ai-engine",
      actualProvider: "deterministic",
      fallbackUsed: true,
      dimension: 8,
      error: "connection refused",
    });
  });

  it("fails fast when real embeddings are required but deterministic provider is selected", async () => {
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "deterministic");
    vi.stubEnv("R3MES_REQUIRE_REAL_EMBEDDINGS", "1");

    await expect(embedTextsForQdrantWithDiagnostics(["migration rollback"])).rejects.toThrow(
      "real embeddings required",
    );
  });

  it("fails fast instead of falling back when real ai-engine embeddings are required", async () => {
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "bge-m3");
    vi.stubEnv("R3MES_REQUIRE_REAL_EMBEDDINGS", "1");
    vi.stubEnv("R3MES_QDRANT_VECTOR_SIZE", "8");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    await expect(embedTextsForQdrantWithDiagnostics(["baş ağrısı"])).rejects.toThrow(
      "real embeddings required but provider bge-m3 failed",
    );
  });

  it("scales ai-engine timeout with embedding batch size", async () => {
    vi.useFakeTimers();
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "ai-engine");
    vi.stubEnv("R3MES_QDRANT_VECTOR_SIZE", "4");
    vi.stubEnv("R3MES_EMBEDDING_TIMEOUT_MS", "1");
    const fetchMock = vi.fn().mockImplementation((_, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = embedTextsForQdrantWithDiagnostics(["a", "b"]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.diagnostics).toMatchObject({
      requestedProvider: "ai-engine",
      actualProvider: "deterministic",
      fallbackUsed: true,
    });
    vi.useRealTimers();
  });
});
