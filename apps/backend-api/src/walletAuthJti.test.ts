import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    walletAuthJti: {
      create: vi.fn(),
    },
  },
}));

describe("walletAuthJti", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.walletAuthJti.create).mockReset();
  });

  it("consumeWalletAuthJti returns ok on first insert", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.walletAuthJti.create).mockResolvedValue({} as never);
    const { consumeWalletAuthJti } = await import("./lib/walletAuthJti.js");
    const r = await consumeWalletAuthJti("uuid-1234-5678", new Date("2027-01-01"));
    expect(r).toBe("ok");
  });

  it("consumeWalletAuthJti returns replay on unique violation", async () => {
    const { prisma } = await import("./lib/prisma.js");
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "test",
    });
    vi.mocked(prisma.walletAuthJti.create).mockRejectedValue(p2002);
    const { consumeWalletAuthJti } = await import("./lib/walletAuthJti.js");
    const r = await consumeWalletAuthJti("same-jti", new Date("2027-01-01"));
    expect(r).toBe("replay");
  });

  it("isValidJtiFormat rejects short or invalid chars", async () => {
    const { isValidJtiFormat } = await import("./lib/walletAuthJti.js");
    expect(isValidJtiFormat("short")).toBe(false);
    expect(isValidJtiFormat("12345678")).toBe(true);
    expect(isValidJtiFormat("abc!defghi")).toBe(false);
  });
});
