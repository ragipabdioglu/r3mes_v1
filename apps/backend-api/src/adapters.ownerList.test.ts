import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const devWallet =
  "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204";

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    adapter: {
      findMany,
      findFirst: vi.fn(),
      findUnique: vi.fn(),
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

describe("owner adapter list stale pending filter", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([
      {
        id: "stale-pending",
        name: "old-pending",
        status: "PENDING_REVIEW",
        kind: "LORA",
        onChainAdapterId: null,
        onChainObjectId: null,
        weightsCid: "bafy-old",
        manifestCid: null,
        benchmarkScore: null,
        domainTags: [],
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        owner: { walletAddress: devWallet, displayName: null },
      },
      {
        id: "fresh-pending",
        name: "fresh-pending",
        status: "PENDING_REVIEW",
        kind: "LORA",
        onChainAdapterId: null,
        onChainObjectId: null,
        weightsCid: "bafy-fresh",
        manifestCid: null,
        benchmarkScore: null,
        domainTags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        owner: { walletAddress: devWallet, displayName: null },
      },
    ]);
    vi.stubEnv("R3MES_DISABLE_RATE_LIMIT", "1");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "1");
    vi.stubEnv("R3MES_DEV_WALLET", devWallet);
    vi.stubEnv("R3MES_QA_WEBHOOK_SECRET", "test-secret-for-hmac");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("hides stale pending adapters from /v1/me/adapters", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/me/adapters" });
    expect(res.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);

    const query = findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
    expect(query.where?.owner).toEqual({
      walletAddress: devWallet,
    });

    const body = JSON.parse(res.body) as { data: Array<{ id: string }>; nextCursor: string | null };
    expect(body.data.map((item) => item.id)).toEqual(["fresh-pending"]);

    await app.close();
  });
});
