import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    qaWebhookReceipt: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    adapter: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("./lib/suiOperator.js", () => ({
  getOperatorKeypair: () => null,
  getPublishedPackageId: () => "0xpkg",
  applyQaResultOnChain: vi.fn(),
}));

describe("POST /v1/internal/qa-result", () => {
  const secret = "test-hmac-secret";

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("R3MES_QA_WEBHOOK_SECRET", secret);
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.qaWebhookReceipt.create).mockResolvedValue({} as never);
    vi.mocked(prisma.qaWebhookReceipt.update).mockResolvedValue({} as never);
    vi.mocked(prisma.qaWebhookReceipt.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.adapter.update).mockResolvedValue({} as never);
    vi.mocked(prisma.adapter.findFirst).mockResolvedValue({
      id: "adp-1",
      onChainObjectId: null,
      onChainAdapterId: null,
    } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function signBody(raw: string): string {
    return createHmac("sha256", secret).update(raw).digest("hex");
  }

  it("200: ilk teslim — adapter güncellenir, receipt tamamlanır", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const raw = JSON.stringify({
      jobId: "qa-job-1",
      adapterCid: "bafycid",
      status: "approved",
      score: 0.85,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/qa-result",
      headers: {
        "content-type": "application/json",
        "x-qa-hmac": signBody(raw),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const j = JSON.parse(res.body) as { ok: boolean; duplicate?: boolean };
    expect(j.ok).toBe(true);
    expect(j.duplicate).toBe(false);

    const { prisma } = await import("./lib/prisma.js");
    expect(prisma.qaWebhookReceipt.create).toHaveBeenCalled();
    expect(prisma.adapter.update).toHaveBeenCalled();
    expect(prisma.qaWebhookReceipt.update).toHaveBeenCalled();
    await app.close();
  });

  it("200: query string ile aynı route — ham gövde bufferlanır (eski url=== karşılaştırması 403 Ham gövde eksik üretirdi)", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const raw = JSON.stringify({
      jobId: "qa-job-query",
      adapterCid: "bafycid",
      status: "approved",
      score: 0.9,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/qa-result?retry=1",
      headers: {
        "content-type": "application/json",
        "x-qa-hmac": signBody(raw),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const j = JSON.parse(res.body) as { ok: boolean };
    expect(j.ok).toBe(true);
    await app.close();
  });

  it("200: aynı gövde tekrar — duplicate (tamamlanmış receipt)", async () => {
    const { Prisma } = await import("@prisma/client");
    const { prisma } = await import("./lib/prisma.js");
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "test",
    });
    vi.mocked(prisma.qaWebhookReceipt.create).mockRejectedValue(p2002);
    vi.mocked(prisma.qaWebhookReceipt.findUnique).mockResolvedValue({
      jobId: "qa-job-dup",
      bodySha256: "",
      completedAt: new Date(),
      createdAt: new Date(),
    } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const raw = JSON.stringify({
      jobId: "qa-job-dup",
      adapterCid: "bafycid",
      status: "approved",
      score: 0.85,
    });
    const { sha256HexBuffer } = await import("./lib/qaWebhookIdempotency.js");
    const hash = sha256HexBuffer(Buffer.from(raw, "utf8"));
    vi.mocked(prisma.qaWebhookReceipt.findUnique).mockResolvedValue({
      jobId: "qa-job-dup",
      bodySha256: hash,
      completedAt: new Date(),
      createdAt: new Date(),
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/qa-result",
      headers: {
        "content-type": "application/json",
        "x-qa-hmac": signBody(raw),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const j = JSON.parse(res.body) as { duplicate: boolean };
    expect(j.duplicate).toBe(true);
    expect(prisma.adapter.update).not.toHaveBeenCalled();
    await app.close();
  });
});
