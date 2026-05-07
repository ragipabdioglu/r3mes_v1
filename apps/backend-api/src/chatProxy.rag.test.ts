import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embedKnowledgeText } from "./lib/knowledgeEmbedding.js";

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    adapter: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    knowledgeCollection: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    knowledgeChunk: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    stakePosition: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe("chat proxy RAG orchestration", () => {
  beforeEach(() => {
    vi.stubEnv("R3MES_DISABLE_RATE_LIMIT", "1");
    vi.stubEnv("R3MES_SKIP_CHAT_FEE", "1");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "1");
    vi.stubEnv("R3MES_ENABLE_RAG_FAST_PATH", "0");
    vi.stubEnv("R3MES_ENABLE_FAST_GROUNDED_COMPOSER", "0");
    vi.stubEnv("R3MES_ENABLE_MINI_VALIDATOR", "force");
    vi.stubEnv("R3MES_EXPOSE_CHAT_DEBUG", "1");
    vi.stubEnv(
      "R3MES_DEV_WALLET",
      "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
    );
    vi.stubEnv("R3MES_QA_WEBHOOK_SECRET", "test-secret-for-hmac");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("adds retrieved context and returns sources metadata", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/rerank")) {
        return new Response(JSON.stringify({ scores: [0.9] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse((init?.body as string | undefined) ?? "{}") as {
        messages?: Array<{ role: string; content?: string }>;
      };
      const firstMessage = body.messages?.[0]?.content ?? "";
      const content = firstMessage.includes("TASLAK CEVAP:")
        ? JSON.stringify({
            grounding_confidence: "low",
            general_assessment: "Bilgi sınırlı.",
            recommended_action: "Muayene planlanabilir.",
            doctor_visit_when: ["Yakınma sürerse başvurmalı."],
            red_flags: [],
            avoid_inference: [],
            short_summary: "Kısa takip gerekir.",
            used_source_ids: ["doc_1"],
          })
        : JSON.stringify({
            grounding_confidence: "low",
            general_assessment: "Taslak değerlendirme.",
            recommended_action: "Taslak eylem.",
            doctor_visit_when: ["Taslak başvuru ölçütü."],
            red_flags: [],
            avoid_inference: [],
            short_summary: "Taslak özet.",
            used_source_ids: ["doc_1"],
          });
      return new Response(JSON.stringify({ id: "chatcmpl-rag", choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValueOnce([
      {
        id: "kc_1",
        owner: {
          walletAddress:
            "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
        },
      },
    ] as never);
    const chunkRows = [
      {
        id: "chunk_1",
        documentId: "doc_1",
        chunkIndex: 0,
        content: "LoRA, büyük modelleri düşük maliyetle uyarlamaya yarayan ince ayar yaklaşımıdır.",
        embedding: {
          values: embedKnowledgeText("LoRA, büyük modelleri düşük maliyetle uyarlamaya yarayan ince ayar yaklaşımıdır."),
        },
        document: {
          title: "LoRA Notları",
          collectionId: "kc_1",
          createdAt: new Date("2026-04-22T10:00:00.000Z"),
          collection: {
            owner: {
              walletAddress:
                "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
            },
          },
        },
      },
    ] as never;
    vi.mocked(prisma.knowledgeChunk.findMany)
      .mockResolvedValueOnce(chunkRows)
      .mockResolvedValueOnce(chunkRows);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        collectionIds: ["kc_1"],
        messages: [{ role: "user", content: "LoRA nedir?" }],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      sources?: Array<{ documentId: string }>;
      grounded_answer?: { grounding_confidence?: string };
      safety_gate?: { pass?: boolean };
      retrieval_debug?: {
        groundingConfidence?: string;
        responseMode?: string;
        retrievalMode?: string;
        retrievalDiagnostics?: { finalCandidateCount?: number; preRankedCandidateCount?: number };
        evidence?: { usableFacts?: string[]; sourceIds?: string[] };
        quality?: { sourceCount?: number; directFactCount?: number };
      };
      choices?: Array<{ message?: { content?: string } }>;
      answer_quality?: { fallbackTemplateUsed?: boolean; lowLanguageQualityDetected?: boolean };
      chat_trace?: {
        query?: { hash?: string; length?: number };
        stages?: Array<{ name?: string; status?: string; durationMs?: number }>;
        retrieval?: {
          mode?: string;
          sourceCount?: number;
          diagnostics?: {
            qdrantCandidateCount?: number;
            prismaCandidateCount?: number;
            finalCandidateCount?: number;
            alignment?: { fastFailed?: boolean; droppedCandidateCount?: number };
            reranker?: { mode?: string; candidateLimit?: number; fallbackUsed?: boolean };
            budget?: { mode?: string; finalSourceLimit?: number; finalSourceCount?: number };
          };
        };
        sourceSelection?: { selectionMode?: string; usedCollectionCount?: number };
        safety?: { pass?: boolean };
        answerPath?: { name?: string };
      };
    };
    expect(body.sources?.[0]?.documentId).toBe("doc_1");
    expect(body.choices?.[0]?.message?.content).toContain("LoRA");
    expect(body.answer_quality?.fallbackTemplateUsed).toBe(false);
    expect(body.grounded_answer?.grounding_confidence).toBe("low");
    expect(body.safety_gate?.pass).toBe(true);
    expect(["low", "medium", "high"]).toContain(body.retrieval_debug?.groundingConfidence);
    expect(body.retrieval_debug?.responseMode).toBe("natural");
    expect(body.retrieval_debug?.retrievalMode).toBe("true_hybrid");
    expect(body.retrieval_debug?.retrievalDiagnostics?.finalCandidateCount).toBeGreaterThanOrEqual(1);
    expect(body.retrieval_debug?.evidence?.sourceIds).toContain("doc_1");
    expect(body.retrieval_debug?.quality?.sourceCount).toBe(1);
    expect(body.retrieval_debug?.quality?.directFactCount).toBeGreaterThan(0);
    expect(body.chat_trace?.query?.hash).toHaveLength(16);
    expect(body.chat_trace?.query?.length).toBeGreaterThan(0);
    expect(body.chat_trace?.retrieval?.mode).toBe("true_hybrid");
    expect(body.chat_trace?.retrieval?.sourceCount).toBe(1);
    expect(body.chat_trace?.retrieval?.diagnostics?.qdrantCandidateCount).toBeGreaterThanOrEqual(0);
    expect(body.chat_trace?.retrieval?.diagnostics?.prismaCandidateCount).toBeGreaterThanOrEqual(0);
    expect(body.chat_trace?.retrieval?.diagnostics?.finalCandidateCount).toBeGreaterThanOrEqual(1);
    expect(body.chat_trace?.retrieval?.diagnostics?.alignment?.fastFailed).toBe(false);
    expect(body.chat_trace?.retrieval?.diagnostics?.reranker?.candidateLimit).toBeGreaterThan(0);
    expect(body.chat_trace?.retrieval?.diagnostics?.budget?.mode).toBe("deep_rag");
    expect(body.chat_trace?.sourceSelection?.selectionMode).toBe("selected");
    expect(body.chat_trace?.sourceSelection?.usedCollectionCount).toBe(1);
    expect(body.chat_trace?.safety?.pass).toBe(true);
    expect(body.chat_trace?.answerPath?.name).toBe("ai_engine_validated");
    const traceStageNames = body.chat_trace?.stages?.map((stage) => stage.name) ?? [];
    expect(traceStageNames).toEqual(
      expect.arrayContaining(["request", "source_access", "query_planning", "retrieval", "source_selection", "ai_engine", "validator", "render_safety"]),
    );
    expect(body.chat_trace?.stages?.every((stage) => typeof stage.durationMs === "number")).toBe(true);

    const chatCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/chat/completions"));
    expect(chatCalls).toHaveLength(2);
    const forwarded = JSON.parse(chatCalls[0]?.[1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(forwarded.messages[0]?.role).toBe("system");
    expect(forwarded.messages[0]?.content).toContain("GROUNDING DURUMU:");
    expect(forwarded.messages[0]?.content).toContain("Doğal Türkçe cevap döndür");
    expect(forwarded.temperature).toBe(0.2);
    const chunkQuery = vi.mocked(prisma.knowledgeChunk.findMany).mock.calls[0]?.[0] as {
      where?: { OR?: Array<{ content?: { contains?: string } }> };
    };
    const searchedTokens = chunkQuery.where?.OR?.map((item) => item.content?.contains).filter(Boolean) ?? [];
    expect(searchedTokens.join(" ")).toContain("lora");
    const validatorForwarded = JSON.parse(chatCalls[1]?.[1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(validatorForwarded.messages[0]?.content).toContain("TASLAK CEVAP:");
    expect(validatorForwarded.temperature).toBe(0.1);
    await app.close();
  });

  it("rejects inaccessible private collection ids before retrieval or source exposure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValueOnce([] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        collectionIds: ["victim-private-collection"],
        includePublic: false,
        messages: [{ role: "user", content: "Bu özel büro arşivinden cevap ver." }],
      }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("sources");
    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps public chat responses free of internal debug fields unless requested", async () => {
    vi.stubEnv("R3MES_EXPOSE_CHAT_DEBUG", "0");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-public",
          choices: [{ message: { content: "Merhaba, nasıl yardımcı olabilirim?" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        messages: [{ role: "user", content: "Merhaba" }],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.sources).toEqual([]);
    expect(body.grounded_answer).toBeUndefined();
    expect(body.safety_gate).toBeUndefined();
    expect(body.answer_quality).toBeUndefined();
    expect(body.retrieval_debug).toBeUndefined();
    expect(body.chat_trace).toBeUndefined();
    await app.close();
  });

  it("rejects mixed allowed and forbidden collection ids without partial retrieval", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValueOnce([
      {
        id: "own-private-collection",
        owner: {
          walletAddress:
            "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
        },
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        collectionIds: ["own-private-collection", "victim-private-collection"],
        includePublic: true,
        messages: [{ role: "user", content: "Bu iki arşive göre cevap ver." }],
      }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("KNOWLEDGE_ACCESS_DENIED");
    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("preserves adaptive model wording when grounded output is natural text instead of JSON", async () => {
    vi.stubEnv("R3MES_ENABLE_MINI_VALIDATOR", "0");
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/rerank")) {
        return new Response(JSON.stringify({ scores: [0.9] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse((init?.body as string | undefined) ?? "{}") as {
        messages?: Array<{ role: string; content?: string }>;
      };
      const context = body.messages?.map((message) => message.content ?? "").join("\n") ?? "";
      const content = context.toLocaleLowerCase("tr-TR").includes("panik")
        ? "Temiz smear sonucu tek başına panik gerektirmez. Ağrı sürer, artar veya yeni belirti eklenirse kadın hastalıkları kontrolü planlamak daha doğru olur."
        : "Ağrının süresini, şiddetini ve eşlik eden belirtileri takip edin. Şikayet tekrarlıyor veya günlük yaşamı etkiliyorsa kadın hastalıkları kontrolü planlayın.";
      return new Response(JSON.stringify({ id: "chatcmpl-rag", choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findMany).mockReset();
    vi.mocked(prisma.knowledgeChunk.findMany).mockReset();
    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValue([
      {
        id: "kc_1",
        owner: {
          walletAddress:
            "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
        },
      },
    ] as never);
    const chunkRows = [
      {
        id: "chunk_1",
        documentId: "doc_1",
        chunkIndex: 0,
        content:
          "# Knowledge Card\nTopic: smear ve kasık ağrısı\nClinical Takeaway: Temiz smear iyi bir bulgudur, ancak kasık ağrısını tek başına açıklamaz.\nSafe Guidance: Ağrı sürüyor veya artıyorsa kadın hastalıkları değerlendirmesi uygundur.\nRed Flags: Şiddetli ağrı, ateş veya anormal kanama varsa daha hızlı değerlendirme gerekir.",
        autoMetadata: {
          domain: "medical",
          subtopics: ["smear", "kasik_agrisi"],
          keywords: [
            "smear",
            "kasık",
            "kasik",
            "ağrı",
            "agri",
            "kasik agrisi",
            "pelvik",
            "takip",
            "kontrol",
            "temiz",
            "biyopsi",
            "patoloji",
            "servikal tarama",
            "kadın hastalıkları",
          ],
          entities: ["smear", "kasık ağrısı"],
          sourceQuality: "structured",
        },
        embedding: {
          values: embedKnowledgeText("Temiz smear iyi bir bulgudur ancak kasık ağrısını tek başına açıklamaz."),
        },
        document: {
          title: "Smear ve kasık ağrısı",
          collectionId: "kc_1",
          autoMetadata: {
            domain: "medical",
            subtopics: ["smear", "kasik_agrisi"],
            keywords: [
              "smear",
              "kasık ağrısı",
              "kasik agrisi",
              "kadın hastalıkları",
              "takip",
              "temiz",
              "biyopsi",
              "patoloji",
              "servikal tarama",
            ],
          },
          createdAt: new Date("2026-04-22T10:00:00.000Z"),
          collection: {
            owner: {
              walletAddress:
                "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
            },
          },
        },
      },
    ] as never;
    vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue(chunkRows);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const reassureRes = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        collectionIds: ["kc_1"],
        messages: [{ role: "user", content: "Smear temiz ama bazen kasığım ağrıyor, panik yapmalı mıyım?" }],
      }),
    });
    const stepsRes = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        collectionIds: ["kc_1"],
        messages: [{ role: "user", content: "Smear normal çıktı. Arada pelvik ağrı oluyor, nasıl takip etmeliyim?" }],
      }),
    });

    expect(reassureRes.statusCode).toBe(200);
    expect(stepsRes.statusCode).toBe(200);
    const reassureBody = JSON.parse(reassureRes.body) as {
      choices?: Array<{ message?: { content?: string } }>;
      grounded_answer?: { answer_intent?: string };
      answer_quality?: { fallbackTemplateUsed?: boolean };
    };
    const stepsBody = JSON.parse(stepsRes.body) as {
      choices?: Array<{ message?: { content?: string } }>;
      grounded_answer?: { answer_intent?: string };
      answer_quality?: { fallbackTemplateUsed?: boolean };
    };
    const reassure = reassureBody.choices?.[0]?.message?.content ?? "";
    const steps = stepsBody.choices?.[0]?.message?.content ?? "";

    expect(reassure).toContain("panik gerektirmez");
    expect(steps).toContain("takip edin");
    expect(reassure).not.toBe(steps);
    expect(reassure).not.toContain("Kaynağa göre durum");
    expect(steps).not.toContain("Kaynağa göre durum");
    expect(reassureBody.grounded_answer?.answer_intent).toBe("reassure");
    expect(stepsBody.grounded_answer?.answer_intent).toBe("steps");
    expect(reassureBody.answer_quality?.fallbackTemplateUsed).toBe(false);
    expect(stepsBody.answer_quality?.fallbackTemplateUsed).toBe(false);
    await app.close();
  });

  it("polishes malformed natural model text and exposes a language quality signal", async () => {
    vi.stubEnv("R3MES_ENABLE_MINI_VALIDATOR", "0");
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/rerank")) {
        return new Response(JSON.stringify({ scores: [0.9] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-rag",
          choices: [
            {
              message: {
                content:
                  "Smear sonucu temiz oldu, ancak kasik agrisi var. Daha fazla izin vermeniz gerekebilir.",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findMany).mockReset();
    vi.mocked(prisma.knowledgeChunk.findMany).mockReset();
    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValue([
      {
        id: "kc_1",
        owner: {
          walletAddress:
            "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
        },
      },
    ] as never);
    vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue([
      {
        id: "chunk_1",
        documentId: "doc_1",
        chunkIndex: 0,
        content:
          "# Knowledge Card\nTopic: smear ve kasık ağrısı\nClinical Takeaway: Temiz smear iyi bir bulgudur, ancak kasık ağrısını tek başına açıklamaz.\nSafe Guidance: Ağrı sürüyor veya artıyorsa kadın hastalıkları değerlendirmesi uygundur.",
        autoMetadata: {
          domain: "medical",
          subtopics: ["smear", "kasik_agrisi"],
          keywords: ["smear", "kasık", "ağrı", "takip", "kontrol"],
          entities: ["smear", "kasık ağrısı"],
          sourceQuality: "structured",
        },
        embedding: {
          values: embedKnowledgeText("Temiz smear iyi bir bulgudur ancak kasık ağrısını tek başına açıklamaz."),
        },
        document: {
          title: "Smear ve kasık ağrısı",
          collectionId: "kc_1",
          autoMetadata: {
            domain: "medical",
            subtopics: ["smear", "kasik_agrisi"],
            keywords: ["smear", "kasık ağrısı", "kadın hastalıkları", "takip"],
          },
          createdAt: new Date("2026-04-22T10:00:00.000Z"),
          collection: {
            owner: {
              walletAddress:
                "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
            },
          },
        },
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        collectionIds: ["kc_1"],
        messages: [{ role: "user", content: "Smear temiz ama kasık ağrım var, ne yapmalıyım?" }],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      choices?: Array<{ message?: { content?: string } }>;
      answer_quality?: { lowLanguageQualityDetected?: boolean };
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    expect(content).toContain("kasık ağrısı");
    expect(content).toContain("yeniden değerlendirme gerekebilir");
    expect(content).not.toContain("izin vermeniz");
    expect(body.answer_quality?.lowLanguageQualityDetected).toBe(true);
    await app.close();
  });
});
