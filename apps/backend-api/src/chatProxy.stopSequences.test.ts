import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    adapter: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique,
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

describe("chat proxy default stop sequences", () => {
  beforeEach(() => {
    findUnique.mockReset();
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

  it("injects safe stop tokens when caller omits stop", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "chatcmpl-test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    findUnique.mockResolvedValueOnce({
      weightsCid: "bafyweights",
      manifestCid: null,
      status: "ACTIVE",
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        adapter_db_id: "adapter-1",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const forwarded = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      stop: string[];
    };
    expect(forwarded.stop).toEqual(
      expect.arrayContaining([
        "<|im_start|>",
        "</|im_start|>",
        "<|im_end|>",
        "</|im_end|>",
      ]),
    );

    await app.close();
  });

  it("merges caller stop values with default stop tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "chatcmpl-test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    findUnique.mockResolvedValueOnce({
      weightsCid: "bafyweights",
      manifestCid: null,
      status: "ACTIVE",
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        adapter_db_id: "adapter-1",
        stop: ["<eos>"],
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.statusCode).toBe(200);
    const forwarded = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      stop: string[];
    };
    expect(forwarded.stop).toEqual(
      expect.arrayContaining([
        "<eos>",
        "<|im_start|>",
        "</|im_start|>",
        "<|im_end|>",
        "</|im_end|>",
      ]),
    );

    await app.close();
  });
});
