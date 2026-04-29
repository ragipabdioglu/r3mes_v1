import {
  parseAdapterListResponse,
  parseNotImplementedOnChainRestResponse,
} from "@r3mes/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    adapter: {
      findMany: vi.fn().mockResolvedValue([]),
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

describe("integration contract surface", () => {
  beforeEach(async () => {
    vi.stubEnv("R3MES_DISABLE_RATE_LIMIT", "1");
    vi.stubEnv("R3MES_SKIP_CHAT_FEE", "1");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "1");
    vi.stubEnv(
      "R3MES_DEV_WALLET",
      "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
    );
    vi.stubEnv("R3MES_QA_WEBHOOK_SECRET", "test-secret-for-hmac");
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.stakePosition.findMany).mockResolvedValue([]);
    vi.mocked(prisma.adapter.findMany).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("GET /v1/adapters returns canonical list shape", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/adapters" });
    expect(res.statusCode).toBe(200);
    const parsed = parseAdapterListResponse(JSON.parse(res.body));
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed).toHaveProperty("nextCursor");
    await app.close();
  });

  it("GET /v1/me/adapters hides stale pending review rows", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.adapter.findMany).mockResolvedValueOnce([
      {
        id: "stale-pending",
        name: "old-upload",
        status: "PENDING_REVIEW",
        kind: "LORA",
        onChainAdapterId: null,
        onChainObjectId: null,
        weightsCid: "bafystale",
        manifestCid: null,
        benchmarkScore: null,
        domainTags: [],
        createdAt: new Date("2026-04-10T10:00:00.000Z"),
        owner: {
          walletAddress:
            "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
          displayName: null,
        },
      },
      {
        id: "active-adapter",
        name: "live-upload",
        status: "ACTIVE",
        kind: "LORA",
        onChainAdapterId: null,
        onChainObjectId: null,
        weightsCid: "bafyactive",
        manifestCid: null,
        benchmarkScore: null,
        domainTags: ["r3mes:dev-test"],
        createdAt: new Date("2026-04-17T10:00:00.000Z"),
        owner: {
          walletAddress:
            "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
          displayName: null,
        },
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/me/adapters" });
    expect(res.statusCode).toBe(200);
    const parsed = parseAdapterListResponse(JSON.parse(res.body));
    expect(parsed.data.map((item) => item.id)).toEqual(["active-adapter"]);
    await app.close();
  });

  it("GET /v1/adapters/:id 404 uses ApiErrorBody", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.adapter.findUnique).mockResolvedValueOnce(null);
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/adapters/no-such-adapter" });
    expect(res.statusCode).toBe(404);
    const j = JSON.parse(res.body) as { error: string; message: string };
    expect(j.error).toBe("NOT_FOUND");
    expect(j).toHaveProperty("message");
    await app.close();
  });

  it("GET /health returns 200", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("GET /v1/user/:wallet/stake returns read-model contract fields", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const w = "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204";
    const res = await app.inject({ method: "GET", url: `/v1/user/${w}/stake` });
    expect(res.statusCode).toBe(200);
    const j = JSON.parse(res.body) as {
      wallet: string;
      totalStakedNano: string;
      positions: unknown[];
    };
    expect(j.wallet).toBe(w);
    expect(typeof j.totalStakedNano).toBe("string");
    expect(Array.isArray(j.positions)).toBe(true);
    await app.close();
  });

  it("GET /v1/chain/stake/:wallet matches user stake alias", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const w = "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204";
    const a = await app.inject({ method: "GET", url: `/v1/user/${w}/stake` });
    const b = await app.inject({ method: "GET", url: `/v1/chain/stake/${w}` });
    expect(b.statusCode).toBe(200);
    expect(JSON.parse(a.body)).toEqual(JSON.parse(b.body));
    await app.close();
  });

  it("GET /v1/user/:wallet/stake 400 ApiErrorBody for invalid address", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/user/not-a-sui-address/stake" });
    expect(res.statusCode).toBe(400);
    const j = JSON.parse(res.body) as { error: string; message: string };
    expect(j.error).toBe("INVALID_WALLET");
    expect(j).toHaveProperty("message");
    await app.close();
  });

  it("POST /v1/stake returns 501 NOT_IMPLEMENTED contract", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/stake" });
    expect(res.statusCode).toBe(501);
    const j = JSON.parse(res.body) as {
      code: string;
      success: boolean;
      surface: string;
      message: string;
    };
    expect(j.code).toBe("NOT_IMPLEMENTED");
    expect(j.success).toBe(false);
    expect(j.surface).toBe("POST /v1/stake");
    expect(j.message.length).toBeGreaterThan(0);
    parseNotImplementedOnChainRestResponse(JSON.parse(res.body));
    await app.close();
  });

  it("POST /v1/user/:wallet/rewards/claim returns 501 with wallet check", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const w = "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204";
    const res = await app.inject({
      method: "POST",
      url: `/v1/user/${w}/rewards/claim`,
    });
    expect(res.statusCode).toBe(501);
    const j = JSON.parse(res.body) as { surface: string; code: string };
    expect(j.code).toBe("NOT_IMPLEMENTED");
    expect(j.surface).toBe("POST /v1/user/:wallet/rewards/claim");
    parseNotImplementedOnChainRestResponse(JSON.parse(res.body));
    await app.close();
  });

  it("POST /v1/user/:wallet/rewards/claim 400 when path is not a valid Sui address", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/user/${encodeURIComponent("not-a-sui-address")}/rewards/claim`,
    });
    expect(res.statusCode).toBe(400);
    const j = JSON.parse(res.body) as { error: string };
    expect(j.error).toBe("INVALID_WALLET");
    await app.close();
  });

  it("POST /v1/user/:wallet/rewards/claim 403 when path wallet mismatches dev wallet", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/user/0x1111111111111111111111111111111111111111111111111111111111111111/rewards/claim",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /v1/chat/completions forwards resolved body (fetch mocked)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "chatcmpl-test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.adapter.findUnique).mockResolvedValueOnce({
      weightsCid: "bafyresolve",
      manifestCid: null,
      status: "ACTIVE",
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        adapter_db_id: "adapter-1",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0];
    const forwarded = JSON.parse(call[1]?.body as string) as {
      adapter_cid: string;
      stop?: string[];
    };
    expect(forwarded.adapter_cid).toBe("bafyresolve");
    expect(forwarded.stop).toEqual(
      expect.arrayContaining(["<|im_start|>", "<|im_end|>", "</|im_start|>", "</|im_end|>"]),
    );
    await app.close();
  });

  it("POST /v1/chat/completions 400 ADAPTER_NOT_ACTIVE when adapter not ACTIVE", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.adapter.findUnique).mockResolvedValueOnce({
      weightsCid: "bafypending",
      manifestCid: null,
      status: "PENDING_REVIEW",
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        adapter_db_id: "adapter-pending",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const j = JSON.parse(res.body) as { error: string };
    expect(j.error).toBe("ADAPTER_NOT_ACTIVE");
    await app.close();
  });

  it("POST /v1/chat/completions 400 ADAPTER_RESOLUTION_FAILED when adapter has no CID", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.adapter.findUnique).mockResolvedValueOnce({
      weightsCid: null,
      manifestCid: null,
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        adapter_db_id: "adapter-1",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const j = JSON.parse(res.body) as { error: string };
    expect(j.error).toBe("ADAPTER_RESOLUTION_FAILED");
    await app.close();
  });

  it("POST /v1/chat/completions 400 ADAPTER_NOT_ACTIVE when adapter_cid only matches PENDING", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.adapter.findFirst).mockResolvedValueOnce({
      id: "a1",
      weightsCid: "bafypendingcid",
      manifestCid: null,
      status: "PENDING_REVIEW",
      onChainAdapterId: null,
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        adapter_cid: "bafypendingcid",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const j = JSON.parse(res.body) as { error: string };
    expect(j.error).toBe("ADAPTER_NOT_ACTIVE");
    await app.close();
  });

  it("wallet auth required when skip off — 401 on chat", async () => {
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "0");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ messages: [] }),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
