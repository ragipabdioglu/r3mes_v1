import { AdapterStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const findUnique = vi.fn();

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    adapter: {
      findFirst,
      findUnique,
    },
  },
}));

describe("resolveAdapterCidForChatProxy", () => {
  beforeEach(() => {
    findFirst.mockReset();
    findUnique.mockReset();
  });

  it("400 ADAPTER_RESOLUTION_FAILED when adapter_cid unknown in DB", async () => {
    findFirst.mockResolvedValueOnce(null);
    const { resolveAdapterCidForChatProxy } = await import("./lib/chatAdapterResolve.js");
    const r = await resolveAdapterCidForChatProxy({
      body: { adapter_cid: "bafy-unknown", messages: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.body.error).toBe("ADAPTER_RESOLUTION_FAILED");
    }
    expect(findFirst).toHaveBeenCalled();
  });

  it("400 ADAPTER_NOT_ACTIVE when adapter_cid matches PENDING_REVIEW", async () => {
    findFirst.mockResolvedValueOnce({
      id: "a1",
      weightsCid: "bafyweights",
      manifestCid: null,
      status: AdapterStatus.PENDING_REVIEW,
      onChainAdapterId: null,
    });
    const { resolveAdapterCidForChatProxy } = await import("./lib/chatAdapterResolve.js");
    const r = await resolveAdapterCidForChatProxy({
      body: { adapter_cid: "bafyweights", messages: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.error).toBe("ADAPTER_NOT_ACTIVE");
  });

  it("resolves adapter_cid when ACTIVE and canonicalizes weights", async () => {
    findFirst.mockResolvedValueOnce({
      id: "a1",
      weightsCid: "bafyweights",
      manifestCid: null,
      status: AdapterStatus.ACTIVE,
      onChainAdapterId: 5n,
    });
    const { resolveAdapterCidForChatProxy } = await import("./lib/chatAdapterResolve.js");
    const r = await resolveAdapterCidForChatProxy({
      body: { adapter_cid: "bafyweights", messages: [] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.upstreamBody.adapter_cid).toBe("bafyweights");
  });

  it("400 ADAPTER_RESOLUTION_CONFLICT when adapter_cid and adapter_id disagree", async () => {
    findFirst.mockResolvedValueOnce({
      id: "correct-id",
      weightsCid: "bafyweights",
      manifestCid: null,
      status: AdapterStatus.ACTIVE,
      onChainAdapterId: null,
    });
    const { resolveAdapterCidForChatProxy } = await import("./lib/chatAdapterResolve.js");
    const r = await resolveAdapterCidForChatProxy({
      body: { adapter_cid: "bafyweights", adapter_id: "wrong-id", messages: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.error).toBe("ADAPTER_RESOLUTION_CONFLICT");
  });

  it("resolves adapter_db_id to weightsCid (any owner, ACTIVE)", async () => {
    findUnique.mockResolvedValueOnce({
      weightsCid: "bafyweights",
      manifestCid: null,
      status: AdapterStatus.ACTIVE,
    });
    const { resolveAdapterCidForChatProxy } = await import("./lib/chatAdapterResolve.js");
    const r = await resolveAdapterCidForChatProxy({
      body: { adapter_db_id: "clxyz123", messages: [] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.upstreamBody.adapter_cid).toBe("bafyweights");
      expect(r.upstreamBody.adapter_db_id).toBeUndefined();
    }
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "clxyz123" },
      select: { weightsCid: true, manifestCid: true, status: true },
    });
  });

  it("400 ADAPTER_NOT_ACTIVE when adapter_db_id is PENDING_REVIEW", async () => {
    findUnique.mockResolvedValueOnce({
      weightsCid: "bafyweights",
      manifestCid: null,
      status: AdapterStatus.PENDING_REVIEW,
    });
    const { resolveAdapterCidForChatProxy } = await import("./lib/chatAdapterResolve.js");
    const r = await resolveAdapterCidForChatProxy({
      body: { adapter_db_id: "clxyz123", messages: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.statusCode).toBe(400);
      expect(r.body.error).toBe("ADAPTER_NOT_ACTIVE");
    }
  });
});
