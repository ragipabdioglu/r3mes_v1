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
    knowledgeFeedbackApplyRecord: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    knowledgeFeedbackRouterAdjustment: {
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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

  it("records a planned apply record without applying router or profile mutations", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackProposal.findFirst).mockResolvedValue({
      id: "proposal_record",
      action: "BOOST_SOURCE",
      status: "APPROVED",
      collectionId: "kc_good",
      expectedCollectionId: null,
      queryHash: "hash_2",
      confidence: 1,
      reason: "reviewed good source cluster",
      evidence: {
        goodSourceCount: 2,
        total: 2,
      },
      reviewedAt: new Date("2026-05-05T12:05:00.000Z"),
      createdAt: new Date("2026-05-05T12:00:00.000Z"),
      updatedAt: new Date("2026-05-05T12:05:00.000Z"),
    } as never);
    vi.mocked(prisma.knowledgeFeedbackApplyRecord.create).mockResolvedValue({
      id: "apply_record_1",
      proposalId: "proposal_record",
      status: "PLANNED",
      plan: {
        proposal: {
          id: "proposal_record",
          action: "BOOST_SOURCE",
          status: "APPROVED",
          collectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          confidence: 1,
          reason: "reviewed good source cluster",
          evidence: { goodSourceCount: 2, total: 2 },
          reviewedAt: "2026-05-05T12:05:00.000Z",
          createdAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:05:00.000Z",
        },
        impact: {
          proposalId: "proposal_record",
          action: "BOOST_SOURCE",
          targetCollectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          estimatedScoreDelta: 0.16,
          riskLevel: "low",
          wouldAutoApply: false,
          rationale: ["dry-run only: router/profile state is not mutated"],
        },
        steps: [],
        mutationEnabled: false,
        applyAllowed: false,
        requiredGate: "feedback_eval_gate",
        blockedReasons: ["mutation disabled: controlled apply preview only"],
      },
      reason: "controlled apply preview recorded; no router/profile mutation applied",
      plannedAt: new Date("2026-05-05T12:06:00.000Z"),
      gateCheckedAt: null,
      appliedAt: null,
      rolledBackAt: null,
      createdAt: new Date("2026-05-05T12:06:00.000Z"),
      updatedAt: new Date("2026-05-05T12:06:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge/proposals/proposal_record/apply-records",
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      mutationApplied?: boolean;
      nextSafeAction?: string;
      record?: { status?: string; proposalId?: string };
    };
    expect(body.mutationApplied).toBe(false);
    expect(body.nextSafeAction).toBe("run_feedback_eval_gate");
    expect(body.record).toMatchObject({ status: "PLANNED", proposalId: "proposal_record" });
    expect(prisma.knowledgeFeedbackApplyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user_1",
          proposalId: "proposal_record",
          status: "PLANNED",
        }),
      }),
    );
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists controlled apply records for manual review", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackApplyRecord.findMany).mockResolvedValue([
      {
        id: "apply_record_1",
        proposalId: "proposal_record",
        status: "GATE_PASSED",
        plan: {
          proposal: {
            id: "proposal_record",
            action: "BOOST_SOURCE",
            status: "APPROVED",
            collectionId: "kc_good",
            expectedCollectionId: null,
            queryHash: "hash_2",
            confidence: 1,
            reason: "reviewed good source cluster",
            evidence: { goodSourceCount: 2, total: 2 },
            reviewedAt: "2026-05-05T12:05:00.000Z",
            createdAt: "2026-05-05T12:00:00.000Z",
            updatedAt: "2026-05-05T12:05:00.000Z",
          },
          impact: {
            proposalId: "proposal_record",
            action: "BOOST_SOURCE",
            targetCollectionId: "kc_good",
            expectedCollectionId: null,
            queryHash: "hash_2",
            estimatedScoreDelta: 0.16,
            riskLevel: "low",
            wouldAutoApply: false,
            rationale: ["dry-run only: router/profile state is not mutated"],
          },
          steps: [],
          mutationEnabled: false,
          applyAllowed: false,
          requiredGate: "feedback_eval_gate",
          blockedReasons: ["mutation disabled: controlled apply preview only"],
        },
        reason: "feedback eval gate passed",
        plannedAt: new Date("2026-05-05T12:06:00.000Z"),
        gateCheckedAt: new Date("2026-05-05T12:07:00.000Z"),
        appliedAt: null,
        rolledBackAt: null,
        createdAt: new Date("2026-05-05T12:06:00.000Z"),
        updatedAt: new Date("2026-05-05T12:07:00.000Z"),
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/apply-records?status=GATE_PASSED",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { total?: number; data?: Array<{ status?: string; proposalId?: string }> };
    expect(body.total).toBe(1);
    expect(body.data?.[0]).toMatchObject({ status: "GATE_PASSED", proposalId: "proposal_record" });
    expect(prisma.knowledgeFeedbackApplyRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user_1",
          status: "GATE_PASSED",
        }),
      }),
    );
    await app.close();
  });

  it("returns mutation preview diff without applying router state", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackApplyRecord.findFirst).mockResolvedValue({
      id: "apply_record_1",
      proposalId: "proposal_record",
      status: "GATE_PASSED",
      plan: {
        proposal: {
          id: "proposal_record",
          action: "BOOST_SOURCE",
          status: "APPROVED",
          collectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          confidence: 1,
          reason: "reviewed good source cluster",
          evidence: { goodSourceCount: 2, total: 2 },
          reviewedAt: "2026-05-05T12:05:00.000Z",
          createdAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:05:00.000Z",
        },
        impact: {
          proposalId: "proposal_record",
          action: "BOOST_SOURCE",
          targetCollectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          estimatedScoreDelta: 0.16,
          riskLevel: "low",
          wouldAutoApply: false,
          rationale: ["dry-run only: router/profile state is not mutated"],
        },
        steps: [
          {
            id: "proposal_record:boost:kc_good",
            kind: "BOOST_COLLECTION_SCORE",
            targetCollectionId: "kc_good",
            expectedCollectionId: null,
            queryHash: "hash_2",
            scoreDelta: 0.16,
            reversible: true,
            rollback: "Remove or invert this query-scoped collection boost.",
            rationale: "Good-source feedback says this collection should rank higher.",
          },
        ],
        mutationEnabled: false,
        applyAllowed: false,
        requiredGate: "feedback_eval_gate",
        blockedReasons: ["mutation disabled: controlled apply preview only"],
      },
      gateReport: { ok: true, checks: [{ name: "rag_quality_gates", ok: true }] },
      reason: "feedback eval gate passed",
      plannedAt: new Date("2026-05-05T12:06:00.000Z"),
      gateCheckedAt: new Date("2026-05-05T12:07:00.000Z"),
      appliedAt: null,
      rolledBackAt: null,
      createdAt: new Date("2026-05-05T12:06:00.000Z"),
      updatedAt: new Date("2026-05-05T12:07:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/apply-records/apply_record_1/mutation-preview",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      mutationApplied?: boolean;
      applyAllowed?: boolean;
      previewSteps?: Array<{ simulatedCurrentScore?: number; scoreDelta?: number; simulatedNextScore?: number; effect?: string }>;
      record?: { status?: string; gateReportSummary?: { ok?: boolean } | null };
    };
    expect(body.mutationApplied).toBe(false);
    expect(body.applyAllowed).toBe(false);
    expect(body.record).toMatchObject({ status: "GATE_PASSED", gateReportSummary: { ok: true } });
    expect(body.previewSteps?.[0]).toMatchObject({
      simulatedCurrentScore: 0,
      scoreDelta: 0.16,
      simulatedNextScore: 0.16,
      effect: "boost",
    });
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    expect(prisma.knowledgeFeedbackApplyRecord.update).not.toHaveBeenCalled();
    await app.close();
  });

  it("records passive router adjustments without affecting runtime scoring", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackApplyRecord.findFirst).mockResolvedValue({
      id: "apply_record_1",
      proposalId: "proposal_record",
      status: "GATE_PASSED",
      plan: {
        proposal: {
          id: "proposal_record",
          action: "BOOST_SOURCE",
          status: "APPROVED",
          collectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          confidence: 1,
          reason: "reviewed good source cluster",
          evidence: { goodSourceCount: 2, total: 2 },
          reviewedAt: "2026-05-05T12:05:00.000Z",
          createdAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:05:00.000Z",
        },
        impact: {
          proposalId: "proposal_record",
          action: "BOOST_SOURCE",
          targetCollectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          estimatedScoreDelta: 0.16,
          riskLevel: "low",
          wouldAutoApply: false,
          rationale: ["dry-run only: router/profile state is not mutated"],
        },
        steps: [
          {
            id: "proposal_record:boost:kc_good",
            kind: "BOOST_COLLECTION_SCORE",
            targetCollectionId: "kc_good",
            expectedCollectionId: null,
            queryHash: "hash_2",
            scoreDelta: 0.16,
            reversible: true,
            rollback: "Remove or invert this query-scoped collection boost.",
            rationale: "Good-source feedback says this collection should rank higher.",
          },
        ],
        mutationEnabled: false,
        applyAllowed: false,
        requiredGate: "feedback_eval_gate",
        blockedReasons: ["mutation disabled: controlled apply preview only"],
      },
      gateReport: { ok: true, checks: [{ name: "rag_quality_gates", ok: true }] },
      reason: "feedback eval gate passed",
      plannedAt: new Date("2026-05-05T12:06:00.000Z"),
      gateCheckedAt: new Date("2026-05-05T12:07:00.000Z"),
      appliedAt: null,
      rolledBackAt: null,
      createdAt: new Date("2026-05-05T12:06:00.000Z"),
      updatedAt: new Date("2026-05-05T12:07:00.000Z"),
    } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: "adjustment_1",
          proposalId: "proposal_record",
          applyRecordId: "apply_record_1",
          status: "ACTIVE",
          stepId: "proposal_record:boost:kc_good",
          kind: "BOOST_COLLECTION_SCORE",
          mutationPath: "query_scoped_collection_adjustment",
          collectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          scoreDelta: 0.16,
          simulatedBefore: 0,
          simulatedAfter: 0.16,
          rollbackReason: null,
          createdAt: new Date("2026-05-05T12:08:00.000Z"),
          rolledBackAt: null,
          updatedAt: new Date("2026-05-05T12:08:00.000Z"),
        },
      ] as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.createMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.knowledgeFeedbackApplyRecord.update).mockResolvedValue({
      id: "apply_record_1",
      proposalId: "proposal_record",
      status: "APPLIED",
      plan: {
        proposal: {
          id: "proposal_record",
          action: "BOOST_SOURCE",
          status: "APPROVED",
          collectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          confidence: 1,
          reason: "reviewed good source cluster",
          evidence: { goodSourceCount: 2, total: 2 },
          reviewedAt: "2026-05-05T12:05:00.000Z",
          createdAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:05:00.000Z",
        },
        impact: {
          proposalId: "proposal_record",
          action: "BOOST_SOURCE",
          targetCollectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          estimatedScoreDelta: 0.16,
          riskLevel: "low",
          wouldAutoApply: false,
          rationale: ["dry-run only: router/profile state is not mutated"],
        },
        steps: [],
        mutationEnabled: false,
        applyAllowed: false,
        requiredGate: "feedback_eval_gate",
        blockedReasons: ["mutation disabled: controlled apply preview only"],
      },
      gateReport: { ok: true, checks: [{ name: "rag_quality_gates", ok: true }] },
      reason: "passive router adjustments recorded; router runtime integration remains disabled",
      plannedAt: new Date("2026-05-05T12:06:00.000Z"),
      gateCheckedAt: new Date("2026-05-05T12:07:00.000Z"),
      appliedAt: new Date("2026-05-05T12:08:00.000Z"),
      rolledBackAt: null,
      createdAt: new Date("2026-05-05T12:06:00.000Z"),
      updatedAt: new Date("2026-05-05T12:08:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge/apply-records/apply_record_1/apply-passive",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      mutationApplied?: boolean;
      routerRuntimeAffected?: boolean;
      record?: { status?: string };
      adjustments?: Array<{ status?: string; scoreDelta?: number }>;
    };
    expect(body.mutationApplied).toBe(false);
    expect(body.routerRuntimeAffected).toBe(false);
    expect(body.record).toMatchObject({ status: "APPLIED" });
    expect(body.adjustments?.[0]).toMatchObject({ status: "ACTIVE", scoreDelta: 0.16 });
    expect(prisma.knowledgeFeedbackRouterAdjustment.createMany).toHaveBeenCalled();
    expect(prisma.knowledgeFeedbackApplyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPLIED",
          appliedDelta: expect.objectContaining({ passive: true, routerRuntimeAffected: false }),
        }),
      }),
    );
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    await app.close();
  });

  it("rolls back a passive router adjustment without affecting runtime scoring", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findFirst).mockResolvedValue({
      id: "adjustment_1",
      proposalId: "proposal_record",
      applyRecordId: "apply_record_1",
      status: "ACTIVE",
      stepId: "proposal_record:boost:kc_good",
      kind: "BOOST_COLLECTION_SCORE",
      mutationPath: "query_scoped_collection_adjustment",
      collectionId: "kc_good",
      expectedCollectionId: null,
      queryHash: "hash_2",
      scoreDelta: 0.16,
      simulatedBefore: 0,
      simulatedAfter: 0.16,
      rollbackReason: null,
      createdAt: new Date("2026-05-05T12:08:00.000Z"),
      rolledBackAt: null,
      updatedAt: new Date("2026-05-05T12:08:00.000Z"),
    } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.update).mockResolvedValue({
      id: "adjustment_1",
      proposalId: "proposal_record",
      applyRecordId: "apply_record_1",
      status: "ROLLED_BACK",
      stepId: "proposal_record:boost:kc_good",
      kind: "BOOST_COLLECTION_SCORE",
      mutationPath: "query_scoped_collection_adjustment",
      collectionId: "kc_good",
      expectedCollectionId: null,
      queryHash: "hash_2",
      scoreDelta: 0.16,
      simulatedBefore: 0,
      simulatedAfter: 0.16,
      rollbackReason: "manual rollback in test",
      createdAt: new Date("2026-05-05T12:08:00.000Z"),
      rolledBackAt: new Date("2026-05-05T12:09:00.000Z"),
      updatedAt: new Date("2026-05-05T12:09:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge/router-adjustments/adjustment_1/rollback",
      headers: { "content-type": "application/json" },
      payload: { reason: "manual rollback in test" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      mutationApplied?: boolean;
      routerRuntimeAffected?: boolean;
      adjustment?: { status?: string; rollbackReason?: string };
    };
    expect(body.mutationApplied).toBe(false);
    expect(body.routerRuntimeAffected).toBe(false);
    expect(body.adjustment).toMatchObject({ status: "ROLLED_BACK", rollbackReason: "manual rollback in test" });
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists passive router adjustments without exposing runtime mutation", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findMany).mockResolvedValue([
      {
        id: "adjustment_1",
        proposalId: "proposal_record",
        applyRecordId: "apply_record_1",
        status: "ACTIVE",
        stepId: "proposal_record:boost:kc_good",
        kind: "BOOST_COLLECTION_SCORE",
        mutationPath: "query_scoped_collection_adjustment",
        collectionId: "kc_good",
        expectedCollectionId: null,
        queryHash: "hash_2",
        scoreDelta: 0.16,
        simulatedBefore: 0,
        simulatedAfter: 0.16,
        rollbackReason: null,
        createdAt: new Date("2026-05-05T12:08:00.000Z"),
        rolledBackAt: null,
        updatedAt: new Date("2026-05-05T12:08:00.000Z"),
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/router-adjustments?status=ACTIVE",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { total?: number; data?: Array<{ status?: string; mutationPath?: string }> };
    expect(body.total).toBe(1);
    expect(body.data?.[0]).toMatchObject({
      status: "ACTIVE",
      mutationPath: "query_scoped_collection_adjustment",
    });
    expect(prisma.knowledgeFeedbackRouterAdjustment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user_1",
          status: "ACTIVE",
        }),
      }),
    );
    await app.close();
  });

  it("simulates active passive adjustment score impact without affecting runtime scoring", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findMany).mockResolvedValue([
      {
        id: "adjustment_1",
        proposalId: "proposal_record_1",
        applyRecordId: "apply_record_1",
        status: "ACTIVE",
        stepId: "proposal_record_1:penalty:kc_wrong",
        kind: "PENALIZE_COLLECTION_SCORE",
        mutationPath: "query_scoped_collection_adjustment",
        collectionId: "kc_wrong",
        expectedCollectionId: null,
        queryHash: "abc123def4567890",
        scoreDelta: -0.18,
        simulatedBefore: 0,
        simulatedAfter: -0.18,
        rollbackReason: null,
        createdAt: new Date("2026-05-05T12:08:00.000Z"),
        rolledBackAt: null,
        updatedAt: new Date("2026-05-05T12:08:00.000Z"),
      },
      {
        id: "adjustment_2",
        proposalId: "proposal_record_2",
        applyRecordId: "apply_record_2",
        status: "ACTIVE",
        stepId: "proposal_record_2:penalty:kc_wrong",
        kind: "PENALIZE_COLLECTION_SCORE",
        mutationPath: "query_scoped_collection_adjustment",
        collectionId: "kc_wrong",
        expectedCollectionId: null,
        queryHash: "abc123def4567890",
        scoreDelta: -0.12,
        simulatedBefore: 0,
        simulatedAfter: -0.12,
        rollbackReason: null,
        createdAt: new Date("2026-05-05T12:09:00.000Z"),
        rolledBackAt: null,
        updatedAt: new Date("2026-05-05T12:09:00.000Z"),
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/feedback/knowledge/router-adjustments/simulation?queryHash=abc123def4567890&collectionIds=kc_wrong",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      runtimeAffected?: boolean;
      queryHash?: string | null;
      collectionIds?: string[];
      results?: Array<{
        collectionId?: string | null;
        queryHash?: string | null;
        activeAdjustmentCount?: number;
        totalScoreDelta?: number;
        simulatedAfter?: number;
        adjustmentIds?: string[];
      }>;
    };
    expect(body.runtimeAffected).toBe(false);
    expect(body.queryHash).toBe("abc123def4567890");
    expect(body.collectionIds).toEqual(["kc_wrong"]);
    expect(body.results?.[0]).toMatchObject({
      collectionId: "kc_wrong",
      queryHash: "abc123def4567890",
      activeAdjustmentCount: 2,
      totalScoreDelta: -0.3,
      simulatedAfter: -0.3,
      adjustmentIds: ["adjustment_1", "adjustment_2"],
    });
    expect(prisma.knowledgeFeedbackRouterAdjustment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user_1",
          status: "ACTIVE",
          queryHash: "abc123def4567890",
          collectionId: { in: ["kc_wrong"] },
        }),
      }),
    );
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    await app.close();
  });

  it("marks a planned apply record as gate passed without applying mutations", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackApplyRecord.findFirst).mockResolvedValue({
      id: "apply_record_1",
      status: "PLANNED",
    } as never);
    vi.mocked(prisma.knowledgeFeedbackApplyRecord.update).mockResolvedValue({
      id: "apply_record_1",
      proposalId: "proposal_record",
      status: "GATE_PASSED",
      plan: {
        proposal: {
          id: "proposal_record",
          action: "BOOST_SOURCE",
          status: "APPROVED",
          collectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          confidence: 1,
          reason: "reviewed good source cluster",
          evidence: { goodSourceCount: 2, total: 2 },
          reviewedAt: "2026-05-05T12:05:00.000Z",
          createdAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:05:00.000Z",
        },
        impact: {
          proposalId: "proposal_record",
          action: "BOOST_SOURCE",
          targetCollectionId: "kc_good",
          expectedCollectionId: null,
          queryHash: "hash_2",
          estimatedScoreDelta: 0.16,
          riskLevel: "low",
          wouldAutoApply: false,
          rationale: ["dry-run only: router/profile state is not mutated"],
        },
        steps: [],
        mutationEnabled: false,
        applyAllowed: false,
        requiredGate: "feedback_eval_gate",
        blockedReasons: ["mutation disabled: controlled apply preview only"],
      },
      reason: "gate passed in test",
      plannedAt: new Date("2026-05-05T12:06:00.000Z"),
      gateCheckedAt: new Date("2026-05-05T12:07:00.000Z"),
      appliedAt: null,
      rolledBackAt: null,
      createdAt: new Date("2026-05-05T12:06:00.000Z"),
      updatedAt: new Date("2026-05-05T12:07:00.000Z"),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback/knowledge/apply-records/apply_record_1/gate-result",
      headers: { "content-type": "application/json" },
      payload: {
        ok: true,
        report: {
          ok: true,
          checks: [{ name: "rag_quality_gates", ok: true }],
        },
        reason: "gate passed in test",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      gatePassed?: boolean;
      mutationApplied?: boolean;
      nextSafeAction?: string;
      record?: { status?: string };
    };
    expect(body.gatePassed).toBe(true);
    expect(body.mutationApplied).toBe(false);
    expect(body.nextSafeAction).toBe("manual_apply_review");
    expect(body.record).toMatchObject({ status: "GATE_PASSED" });
    expect(prisma.knowledgeFeedbackApplyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "GATE_PASSED",
          gateReport: expect.objectContaining({ ok: true }),
          reason: "gate passed in test",
        }),
      }),
    );
    expect(prisma.knowledgeFeedbackProposal.update).not.toHaveBeenCalled();
    await app.close();
  });
});
