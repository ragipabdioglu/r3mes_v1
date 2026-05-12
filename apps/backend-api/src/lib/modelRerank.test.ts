import { describe, expect, it, vi } from "vitest";
import * as rerankModule from "./rerank.js";
import * as modelRerankModule from "./modelRerank.js";

describe("rerankKnowledgeCardsWithFallback", () => {
  it("builds bounded reranker documents from title, metadata, and chunk start", () => {
    const document = modelRerankModule.buildRerankerDocumentText(
      {
        chunk: {
          content: "bir iki üç dört beş altı",
          document: { title: "Uzun kaynak" },
        },
        card: {
          topic: "test konusu",
          tags: ["alpha", "beta"],
          patientSummary: "Özet alanı.",
          clinicalTakeaway: "",
          safeGuidance: "",
          redFlags: "",
          doNotInfer: "",
        },
      },
      3,
    );

    expect(document).toContain("Title: Uzun kaynak");
    expect(document).toContain("Topic: test konusu");
    expect(document).toContain("Tags: alpha, beta");
    expect(document).toContain("Chunk Start: bir iki üç");
    expect(document).not.toContain("dört");
  });

  it("falls back to deterministic ranking when model reranker is disabled", async () => {
    const candidates = [
      {
        fusedScore: 1,
        lexicalScore: 1,
        embeddingScore: 0,
        chunk: { id: "good" },
        card: {
          topic: "smear sonucu",
          tags: ["smear"],
          patientSummary: "Smear sonucu temiz.",
          clinicalTakeaway: "Temiz smear iyi bir bulgudur.",
          safeGuidance: "Şikayet sürerse muayene gerekir.",
          redFlags: "Şiddetli ağrı olursa değerlendirme gerekir.",
          doNotInfer: "",
        },
      },
    ];

    vi.stubEnv("R3MES_RERANKER_MODE", "deterministic");
    const ranked = await modelRerankModule.rerankKnowledgeCardsWithFallback(
      "Smear sonucum temiz çıktı ama kasık ağrım oluyor.",
      candidates,
      1,
    );

    expect(ranked).toEqual(
      rerankModule.rerankKnowledgeCards(
        "Smear sonucum temiz çıktı ama kasık ağrım oluyor.",
        candidates,
        1,
      ),
    );
    vi.unstubAllEnvs();
  });

  it("uses the model reranker by default unless deterministic mode is explicitly selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scores: [0.5], provider: "cross_encoder" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await modelRerankModule.rerankKnowledgeCardsWithDiagnostics(
      "hangi kaynak alakalı",
      [
        {
          fusedScore: 1,
          lexicalScore: 1,
          embeddingScore: 0,
          chunk: {
            id: "chunk-1",
            content: "ilgili kaynak",
            document: { title: "İlgili kaynak" },
          },
          card: {
            topic: "ilgili konu",
            tags: ["test"],
            patientSummary: "",
            clinicalTakeaway: "",
            safeGuidance: "",
            redFlags: "",
            doNotInfer: "",
          },
        },
      ],
      1,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.diagnostics.mode).toBe("model");
    expect(result.diagnostics.modelEnabled).toBe(true);

    vi.unstubAllGlobals();
  });

  it("sends bounded documents to the model reranker", async () => {
    vi.stubEnv("R3MES_RERANKER_MODE", "model");
    vi.stubEnv("R3MES_ALIGNMENT_MAX_RERANK_WORDS", "4");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scores: [0.9] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await modelRerankModule.rerankKnowledgeCardsWithFallback(
      "migration rollback",
      [
        {
          fusedScore: 1,
          lexicalScore: 1,
          embeddingScore: 0,
          chunk: {
            id: "chunk-1",
            content: "yedek rollback staging log bu metnin fazlası gitmemeli",
            document: { title: "Migration runbook" },
          },
          card: {
            topic: "migration güvenliği",
            tags: ["technical", "migration"],
            patientSummary: "Migration öncesi yedek alınır.",
            clinicalTakeaway: "",
            safeGuidance: "",
            redFlags: "",
            doNotInfer: "",
          },
        },
      ],
      1,
    );

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string | undefined) ?? "{}") as {
      documents?: string[];
    };
    expect(body.documents?.[0]).toContain("Title: Migration runbook");
    expect(body.documents?.[0]).toContain("Chunk Start: yedek rollback staging log");
    expect(body.documents?.[0]).not.toContain("fazlası");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("scores the configured model pool even when the final return limit is smaller", async () => {
    vi.stubEnv("R3MES_RERANKER_MODE", "model");
    vi.stubEnv("R3MES_RERANKER_CANDIDATE_LIMIT", "3");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scores: [0.1, 0.2, 0.9], provider: "cross_encoder" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await modelRerankModule.rerankKnowledgeCardsWithDiagnostics(
      "kaynak üç daha alakalı",
      [1, 2, 3, 4].map((index) => ({
        fusedScore: 1 / index,
        lexicalScore: 1 / index,
        embeddingScore: 0,
        chunk: {
          id: `chunk-${index}`,
          content: `aday ${index}`,
          document: { title: `Aday ${index}` },
        },
        card: {
          topic: `aday ${index}`,
          tags: [`aday-${index}`],
          patientSummary: "",
          clinicalTakeaway: "",
          safeGuidance: "",
          redFlags: "",
          doNotInfer: "",
        },
      })),
      1,
    );

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string | undefined) ?? "{}") as {
      documents?: string[];
    };
    expect(body.documents).toHaveLength(3);
    expect(result.diagnostics.modelCandidateCount).toBe(3);
    expect(result.diagnostics.returnedCandidateCount).toBe(1);
    expect(result.candidates[0]?.chunk).toMatchObject({ id: "chunk-3" });

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("allows callers to override the model candidate pool for adaptive budgets", async () => {
    vi.stubEnv("R3MES_RERANKER_MODE", "model");
    vi.stubEnv("R3MES_RERANKER_CANDIDATE_LIMIT", "5");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scores: [0.3, 0.7], provider: "cross_encoder" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await modelRerankModule.rerankKnowledgeCardsWithDiagnostics(
      "hızlı bütçe için küçük havuz",
      [1, 2, 3, 4, 5].map((index) => ({
        fusedScore: 1 / index,
        lexicalScore: 1 / index,
        embeddingScore: 0,
        chunk: {
          id: `chunk-${index}`,
          content: `aday ${index}`,
          document: { title: `Aday ${index}` },
        },
        card: {
          topic: `aday ${index}`,
          tags: [`aday-${index}`],
          patientSummary: "",
          clinicalTakeaway: "",
          safeGuidance: "",
          redFlags: "",
          doNotInfer: "",
        },
      })),
      1,
      { candidateLimit: 2 },
    );

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string | undefined) ?? "{}") as {
      documents?: string[];
    };
    expect(body.documents).toHaveLength(2);
    expect(result.diagnostics.candidateLimit).toBe(2);
    expect(result.diagnostics.modelCandidateCount).toBe(2);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails fast when a real reranker is required and ai-engine fallback is reported", async () => {
    vi.stubEnv("R3MES_RERANKER_MODE", "model");
    vi.stubEnv("R3MES_REQUIRE_REAL_RERANKER", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ scores: [0.2], provider: "lightweight_fallback", fallback_used: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      modelRerankModule.rerankKnowledgeCardsWithDiagnostics(
        "migration rollback",
        [
          {
            fusedScore: 1,
            lexicalScore: 1,
            embeddingScore: 0,
            chunk: { id: "chunk-1", content: "migration rollback", document: { title: "Runbook" } },
            card: {
              topic: "migration",
              tags: ["technical"],
              patientSummary: "",
              clinicalTakeaway: "",
              safeGuidance: "",
              redFlags: "",
              doNotInfer: "",
            },
          },
        ],
        1,
      ),
    ).rejects.toThrow("real reranker required");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails fast when a real reranker is required and ai-engine is unreachable", async () => {
    vi.stubEnv("R3MES_RERANKER_MODE", "model");
    vi.stubEnv("R3MES_REQUIRE_REAL_RERANKER", "1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    await expect(
      modelRerankModule.rerankKnowledgeCardsWithDiagnostics(
        "migration rollback",
        [
          {
            fusedScore: 1,
            lexicalScore: 1,
            embeddingScore: 0,
            chunk: { id: "chunk-1", content: "migration rollback", document: { title: "Runbook" } },
            card: {
              topic: "migration",
              tags: ["technical"],
              patientSummary: "",
              clinicalTakeaway: "",
              safeGuidance: "",
              redFlags: "",
              doNotInfer: "",
            },
          },
        ],
        1,
      ),
    ).rejects.toThrow("real reranker required but model rerank failed");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
