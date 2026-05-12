import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    knowledgeFeedbackRouterAdjustment: {
      findMany: vi.fn(),
    },
  },
}));

describe("feedback shadow runtime", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.R3MES_FEEDBACK_RUNTIME_MODE;
  });

  it("reports eligible shadow adjustments without changing runtime", async () => {
    const { prisma } = await import("./prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findMany).mockResolvedValue([
      {
        id: "adj_1",
        collectionId: "kc_b",
        scoreDelta: 0.2,
        applyRecord: {
          status: "APPLIED",
          gateReport: { ok: true },
        },
      },
    ] as never);

    const { evaluateFeedbackShadowRuntime } = await import("./feedbackShadowRuntime.js");
    const report = await evaluateFeedbackShadowRuntime({
      walletAddress: "0xabc",
      query: "başım ağrıyor",
      candidateCollectionIds: ["kc_a", "kc_b"],
    });

    expect(report.runtimeAffected).toBe(false);
    expect(report.runtimeMode).toBe("shadow");
    expect(report.adjustedCandidateCollectionIds).toEqual(["kc_a", "kc_b"]);
    expect(report.activeAdjustmentCount).toBe(1);
    expect(report.promotedCandidateCount).toBe(1);
    expect(report.currentTopCandidateId).toBe("kc_a");
    expect(report.shadowTopCandidateId).toBe("kc_b");
    expect(report.wouldChangeTopCandidate).toBe(true);
    expect(report.impacts[0]).toMatchObject({
      collectionId: "kc_b",
      recommendation: "eligible_for_shadow_runtime",
      promotionStage: "eligible_shadow",
      rollbackRecommended: false,
      nextSafeAction: "eligible_for_shadow_observation",
      totalScoreDelta: 0.2,
    });
  });

  it("can expose eval-gated adjustments as active ordering when explicitly enabled", async () => {
    process.env.R3MES_FEEDBACK_RUNTIME_MODE = "active";
    const { prisma } = await import("./prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findMany).mockResolvedValue([
      {
        id: "adj_1",
        collectionId: "kc_b",
        scoreDelta: 0.2,
        applyRecord: {
          status: "APPLIED",
          gateReport: { ok: true },
        },
      },
    ] as never);

    const { evaluateFeedbackShadowRuntime } = await import("./feedbackShadowRuntime.js");
    const report = await evaluateFeedbackShadowRuntime({
      walletAddress: "0xabc",
      query: "başım ağrıyor",
      candidateCollectionIds: ["kc_a", "kc_b"],
    });

    expect(report.runtimeMode).toBe("active");
    expect(report.runtimeAffected).toBe(true);
    expect(report.adjustedCandidateCollectionIds).toEqual(["kc_b", "kc_a"]);
  });

  it("keeps adjustments passive when eval gate has not passed", async () => {
    const { prisma } = await import("./prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findMany).mockResolvedValue([
      {
        id: "adj_1",
        collectionId: "kc_b",
        scoreDelta: 0.2,
        applyRecord: {
          status: "APPLIED",
          gateReport: { ok: false },
        },
      },
    ] as never);

    const { evaluateFeedbackShadowRuntime } = await import("./feedbackShadowRuntime.js");
    const report = await evaluateFeedbackShadowRuntime({
      walletAddress: "0xabc",
      query: "başım ağrıyor",
      candidateCollectionIds: ["kc_a", "kc_b"],
    });

    expect(report.promotedCandidateCount).toBe(0);
    expect(report.shadowTopCandidateId).toBe("kc_a");
    expect(report.wouldChangeTopCandidate).toBe(false);
    expect(report.impacts[0]).toMatchObject({
      collectionId: "kc_b",
      recommendation: "keep_passive",
      promotionStage: "blocked",
      rollbackRecommended: true,
      nextSafeAction: "rollback_or_review",
    });
    expect(report.impacts[0]?.blockedReasons.join(" ")).toContain("eval gate");
  });

  it("blocks oversized active adjustments before shadow promotion", async () => {
    const { prisma } = await import("./prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(prisma.knowledgeFeedbackRouterAdjustment.findMany).mockResolvedValue([
      {
        id: "adj_1",
        collectionId: "kc_b",
        scoreDelta: 0.5,
        applyRecord: {
          status: "APPLIED",
          gateReport: { ok: true },
        },
      },
    ] as never);

    const { evaluateFeedbackShadowRuntime } = await import("./feedbackShadowRuntime.js");
    const report = await evaluateFeedbackShadowRuntime({
      walletAddress: "0xabc",
      query: "başım ağrıyor",
      candidateCollectionIds: ["kc_a", "kc_b"],
    });

    expect(report.promotedCandidateCount).toBe(0);
    expect(report.shadowTopCandidateId).toBe("kc_a");
    expect(report.impacts[0]).toMatchObject({
      collectionId: "kc_b",
      recommendation: "keep_passive",
      promotionStage: "blocked",
      rollbackRecommended: true,
      nextSafeAction: "rollback_or_review",
    });
    expect(report.impacts[0]?.blockedReasons.join(" ")).toContain("score delta exceeds promotion cap");
  });
});
