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
    });
  });

  it("falls back and reports diagnostics when ai-engine returns the wrong dimension", async () => {
    vi.stubEnv("R3MES_EMBEDDING_PROVIDER", "bge-m3");
    vi.stubEnv("R3MES_QDRANT_VECTOR_SIZE", "4");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(3, 1) }] }), {
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
});
