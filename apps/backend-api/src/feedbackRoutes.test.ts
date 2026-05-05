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
      findMany: vi.fn(),
    },
    knowledgeFeedbackProposal: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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

  it("summarizes feedback and generates pending human-review proposals", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedback.findMany).mockResolvedValue([
      {
        kind: "WRONG_SOURCE",
        collectionId: "kc_wrong",
        expectedCollectionId: "kc_expected",
        queryHash: "hash_1",
      },
      {
        kind: "WRONG_SOURCE",
        collectionId: "kc_wrong",
        expectedCollectionId: "kc_expected",
        queryHash: "hash_1",
      },
      {
        kind: "GOOD_SOURCE",
        collectionId: "kc_good",
        expectedCollectionId: null,
        queryHash: "hash_2",
      },
    ] as never);
    vi.mocked(prisma.knowledgeFeedbackProposal.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.knowledgeFeedbackProposal.create).mockResolvedValue({
      id: "proposal_1",
      action: "PENALIZE_SOURCE",
      status: "PENDING",
      collectionId: "kc_wrong",
      expectedCollectionId: "kc_expected",
      queryHash: "hash_1",
      confidence: 1,
      reason: "2 wrong-source feedback sinyali bu collection için temkinli ceza öneriyor.",
      evidence: {
        key: "kc_wrong|kc_expected|hash_1",
        wrongSourceCount: 2,
      },
      reviewedAt: null,
      createdAt: new Date("2026-05-05T12:00:00.000Z"),
      updatedAt: new Date("2026-05-05T12:00:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const summaryRes = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/summary",
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = JSON.parse(summaryRes.body) as {
      data?: Array<{ collectionId?: string | null; wrongSourceCount?: number; suggestedAction?: string | null }>;
      totalFeedback?: number;
    };
    expect(summary.totalFeedback).toBe(3);
    expect(summary.data?.[0]).toMatchObject({
      collectionId: "kc_wrong",
      wrongSourceCount: 2,
      suggestedAction: "PENALIZE_SOURCE",
    });

    const proposalRes = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge/proposals/generate?minSignals=2",
    });
    expect(proposalRes.statusCode).toBe(200);
    const proposalBody = JSON.parse(proposalRes.body) as {
      generatedCount?: number;
      data?: Array<{ action?: string; status?: string; collectionId?: string | null }>;
    };
    expect(proposalBody.generatedCount).toBe(1);
    expect(proposalBody.data?.[0]).toMatchObject({
      action: "PENALIZE_SOURCE",
      status: "PENDING",
      collectionId: "kc_wrong",
    });
    expect(prisma.knowledgeFeedbackProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PENALIZE_SOURCE",
          collectionId: "kc_wrong",
          expectedCollectionId: "kc_expected",
          queryHash: "hash_1",
        }),
      }),
    );
    await app.close();
  });

  it("lists feedback proposals for review", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackProposal.findMany).mockResolvedValue([
      {
        id: "proposal_list_1",
        action: "PENALIZE_SOURCE",
        status: "PENDING",
        collectionId: "kc_wrong",
        expectedCollectionId: "kc_expected",
        queryHash: "hash_1",
        confidence: 1,
        reason: "wrong source cluster",
        evidence: { wrongSourceCount: 2, total: 2 },
        reviewedAt: null,
        createdAt: new Date("2026-05-05T12:00:00.000Z"),
        updatedAt: new Date("2026-05-05T12:00:00.000Z"),
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/proposals?status=PENDING",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data?: Array<{ id?: string; status?: string }>; nextCursor?: string | null };
    expect(body.data).toHaveLength(1);
    expect(body.data?.[0]).toMatchObject({ id: "proposal_list_1", status: "PENDING" });
    expect(body.nextCursor).toBeNull();
    expect(prisma.knowledgeFeedbackProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user_1", status: "PENDING" }),
        take: 51,
      }),
    );
    await app.close();
  });

  it("approves or rejects proposals without applying router changes", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackProposal.findFirst).mockResolvedValue({ id: "proposal_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackProposal.update).mockResolvedValue({
      id: "proposal_1",
      action: "PENALIZE_SOURCE",
      status: "APPROVED",
      collectionId: "kc_wrong",
      expectedCollectionId: null,
      queryHash: "hash_1",
      confidence: 0.8,
      reason: "reviewed",
      evidence: { wrongSourceCount: 2 },
      reviewedAt: new Date("2026-05-05T12:05:00.000Z"),
      createdAt: new Date("2026-05-05T12:00:00.000Z"),
      updatedAt: new Date("2026-05-05T12:05:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge/proposals/proposal_1/approve",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      proposal: {
        id: "proposal_1",
        status: "APPROVED",
        action: "PENALIZE_SOURCE",
      },
    });
    expect(prisma.knowledgeFeedbackProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proposal_1" },
        data: expect.objectContaining({ status: "APPROVED" }),
      }),
    );
    await app.close();
  });

  it("returns a dry-run impact report without mutating router or profile state", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackProposal.findFirst).mockResolvedValue({
      id: "proposal_impact",
      action: "PENALIZE_SOURCE",
      status: "APPROVED",
      collectionId: "kc_wrong",
      expectedCollectionId: "kc_expected",
      queryHash: "hash_1",
      confidence: 1,
      reason: "reviewed",
      evidence: {
        wrongSourceCount: 3,
        total: 3,
      },
      reviewedAt: new Date("2026-05-05T12:05:00.000Z"),
      createdAt: new Date("2026-05-05T12:00:00.000Z"),
      updatedAt: new Date("2026-05-05T12:05:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/proposals/proposal_impact/impact",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      impact?: {
        action?: string;
        targetCollectionId?: string | null;
        estimatedScoreDelta?: number;
        wouldAutoApply?: boolean;
        rationale?: string[];
      };
      nextSafeAction?: string;
    };
    expect(body.impact).toMatchObject({
      action: "PENALIZE_SOURCE",
      targetCollectionId: "kc_wrong",
      wouldAutoApply: false,
    });
    expect(body.impact?.estimatedScoreDelta).toBeLessThan(0);
    expect(body.impact?.rationale?.join(" ")).toContain("dry-run only");
    expect(body.nextSafeAction).toBe("run_eval_before_apply");
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns a controlled apply preview without mutating router or profile state", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackProposal.findFirst).mockResolvedValue({
      id: "proposal_apply",
      action: "PENALIZE_SOURCE",
      status: "APPROVED",
      collectionId: "kc_wrong",
      expectedCollectionId: "kc_expected",
      queryHash: "hash_1",
      confidence: 1,
      reason: "reviewed wrong source cluster",
      evidence: {
        wrongSourceCount: 3,
        total: 3,
      },
      reviewedAt: new Date("2026-05-05T12:05:00.000Z"),
      createdAt: new Date("2026-05-05T12:00:00.000Z"),
      updatedAt: new Date("2026-05-05T12:05:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/proposals/proposal_apply/apply-plan",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      mutationEnabled?: boolean;
      applyAllowed?: boolean;
      requiredGate?: string;
      steps?: Array<{ kind?: string; targetCollectionId?: string | null; scoreDelta?: number }>;
      blockedReasons?: string[];
    };
    expect(body.mutationEnabled).toBe(false);
    expect(body.applyAllowed).toBe(false);
    expect(body.requiredGate).toBe("feedback_eval_gate");
    expect(body.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "PENALIZE_COLLECTION_SCORE",
          targetCollectionId: "kc_wrong",
        }),
        expect.objectContaining({
          kind: "BOOST_COLLECTION_SCORE",
          targetCollectionId: "kc_expected",
        }),
      ]),
    );
    expect(body.steps?.[0]?.scoreDelta).toBeLessThan(0);
    expect(body.blockedReasons?.join(" ")).toContain("mutation disabled");
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    await app.close();
  });
});
