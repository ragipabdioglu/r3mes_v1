import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    qaWebhookReceipt: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe("qaWebhookIdempotency", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.qaWebhookReceipt.create).mockReset();
    vi.mocked(prisma.qaWebhookReceipt.findUnique).mockReset();
    vi.mocked(prisma.qaWebhookReceipt.update).mockReset();
    vi.mocked(prisma.qaWebhookReceipt.delete).mockReset();
  });

  it("claim proceeds on first create", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.qaWebhookReceipt.create).mockResolvedValue({} as never);

    const { claimQaWebhookJob } = await import("./lib/qaWebhookIdempotency.js");
    const r = await claimQaWebhookJob("job-1", "abc123hash");
    expect(r).toEqual({ kind: "proceed" });
  });

  it("duplicate when same jobId and hash and completed", async () => {
    const { prisma } = await import("./lib/prisma.js");
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "test",
    });
    vi.mocked(prisma.qaWebhookReceipt.create).mockRejectedValue(p2002);
    vi.mocked(prisma.qaWebhookReceipt.findUnique).mockResolvedValue({
      jobId: "job-1",
      bodySha256: "abc",
      completedAt: new Date(),
      createdAt: new Date(),
    } as never);

    const { claimQaWebhookJob } = await import("./lib/qaWebhookIdempotency.js");
    const r = await claimQaWebhookJob("job-1", "abc");
    expect(r).toEqual({ kind: "duplicate", jobId: "job-1" });
  });

  it("conflict when same jobId different hash", async () => {
    const { prisma } = await import("./lib/prisma.js");
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "test",
    });
    vi.mocked(prisma.qaWebhookReceipt.create).mockRejectedValue(p2002);
    vi.mocked(prisma.qaWebhookReceipt.findUnique).mockResolvedValue({
      jobId: "job-1",
      bodySha256: "other",
      completedAt: new Date(),
      createdAt: new Date(),
    } as never);

    const { claimQaWebhookJob } = await import("./lib/qaWebhookIdempotency.js");
    const r = await claimQaWebhookJob("job-1", "abc");
    expect(r).toEqual({ kind: "conflict" });
  });

  it("in_flight when row exists without completedAt", async () => {
    const { prisma } = await import("./lib/prisma.js");
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "test",
    });
    vi.mocked(prisma.qaWebhookReceipt.create).mockRejectedValue(p2002);
    vi.mocked(prisma.qaWebhookReceipt.findUnique).mockResolvedValue({
      jobId: "job-1",
      bodySha256: "abc",
      completedAt: null,
      createdAt: new Date(),
    } as never);

    const { claimQaWebhookJob } = await import("./lib/qaWebhookIdempotency.js");
    const r = await claimQaWebhookJob("job-1", "abc");
    expect(r).toEqual({ kind: "in_flight", jobId: "job-1" });
  });
});
