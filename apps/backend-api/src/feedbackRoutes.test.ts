import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    knowledgeFeedback: {
      create: vi.fn(),
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

describe("knowledge feedback routes", () => {
  beforeEach(() => {
    vi.stubEnv("R3MES_DISABLE_RATE_LIMIT", "1");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "1");
    vi.stubEnv("R3MES_SKIP_CHAT_FEE", "1");
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

  it("records source feedback without storing raw query text", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findFirst).mockResolvedValue({ id: "kc_1" } as never);
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedback.create).mockResolvedValue({
      id: "feedback_1",
      kind: "WRONG_SOURCE",
      queryHash: "abc123def4567890",
      collectionId: "kc_1",
      expectedCollectionId: null,
      createdAt: new Date("2026-05-05T12:00:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge",
      headers: { "content-type": "application/json" },
      payload: {
        kind: "WRONG_SOURCE",
        query: "Başım ağrıyor ama kasık kaynağı geldi",
        collectionId: "kc_1",
        documentId: "doc_1",
        traceId: "trace_1",
        reason: "Yanlış konu",
        metadata: { routeMode: "suggest" },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain("Başım ağrıyor");
    expect(prisma.knowledgeFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user_1",
          kind: "WRONG_SOURCE",
          collectionId: "kc_1",
          documentId: "doc_1",
          traceId: "trace_1",
          reason: "Yanlış konu",
          queryHash: expect.stringMatching(/^[a-f0-9]{16}$/),
        }),
      }),
    );
    await app.close();
  });

  it("rejects feedback for inaccessible collections", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findFirst).mockResolvedValue(null);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge",
      headers: { "content-type": "application/json" },
      payload: {
        kind: "WRONG_SOURCE",
        queryHash: "abc123def4567890",
        collectionId: "private_other_user",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(prisma.knowledgeFeedback.create).not.toHaveBeenCalled();
    await app.close();
  });
});
