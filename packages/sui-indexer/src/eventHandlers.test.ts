import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AdapterStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SuiEvent } from "@mysten/sui/client";
import { handleSuiEvent } from "./eventHandlers.js";

vi.mock("@r3mes/backend-api/jobProducer", () => ({
  enqueueBenchmarkJob: vi.fn().mockResolvedValue(undefined),
}));

import { enqueueBenchmarkJob } from "@r3mes/backend-api/jobProducer";

function mockPrisma(): {
  prisma: PrismaClient;
  userUpsert: ReturnType<typeof vi.fn>;
  adapterUpsert: ReturnType<typeof vi.fn>;
  adapterUpdateMany: ReturnType<typeof vi.fn>;
  stakeUpsert: ReturnType<typeof vi.fn>;
  stakeDeleteMany: ReturnType<typeof vi.fn>;
} {
  const userUpsert = vi.fn().mockResolvedValue({ id: "user-1" });
  const adapterUpsert = vi.fn().mockResolvedValue({ id: "adapter-1" });
  const adapterUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const stakeUpsert = vi.fn().mockResolvedValue({ id: "stake-1" });
  const stakeDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

  const prisma = {
    user: { upsert: userUpsert },
    adapter: { upsert: adapterUpsert, updateMany: adapterUpdateMany },
    stakePosition: { upsert: stakeUpsert, deleteMany: stakeDeleteMany },
  } as unknown as PrismaClient;

  return { prisma, userUpsert, adapterUpsert, adapterUpdateMany, stakeUpsert, stakeDeleteMany };
}

function suiEvent(typeTail: string, parsedJson: Record<string, unknown>): SuiEvent {
  const packageId = "0xpkg";
  return {
    id: { txDigest: "0xt", eventSeq: "0" },
    packageId,
    transactionModule: "m",
    sender: "0x1",
    type: `${packageId}::mod::${typeTail}`,
    parsedJson,
    bcs: "AA",
    timestampMs: "1",
  } as SuiEvent;
}

describe("handleSuiEvent", () => {
  const oldSkip = process.env.SKIP_BENCHMARK_QUEUE;

  beforeEach(() => {
    process.env.SKIP_BENCHMARK_QUEUE = "1";
    vi.mocked(enqueueBenchmarkJob).mockClear();
  });

  afterEach(() => {
    process.env.SKIP_BENCHMARK_QUEUE = oldSkip;
  });

  it("AdapterUploadedEvent upserts user and adapter", async () => {
    const { prisma, userUpsert, adapterUpsert } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("AdapterUploadedEvent", {
        adapter_id: "7",
        object_id: "0xobj",
        creator: "0x00000000000000000000000000000000000000000000000000000000000000aa",
        ipfs_cid: "QmTest",
      }),
    );
    expect(userUpsert).toHaveBeenCalledTimes(1);
    expect(adapterUpsert).toHaveBeenCalledTimes(1);
    const createCall = adapterUpsert.mock.calls[0][0] as {
      create: { onChainAdapterId: bigint; onChainObjectId: string; weightsCid: string };
    };
    expect(createCall.create.onChainAdapterId).toBe(7n);
    expect(createCall.create.onChainObjectId).toBe("0xobj");
    expect(createCall.create.weightsCid).toBe("QmTest");
  });

  it("AdapterUploadedEvent enqueues benchmark when SKIP_BENCHMARK_QUEUE is unset", async () => {
    delete process.env.SKIP_BENCHMARK_QUEUE;
    const { prisma } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("AdapterUploadedEvent", {
        adapter_id: "1",
        object_id: "0xo",
        creator: "0x00000000000000000000000000000000000000000000000000000000000000bb",
        ipfs_cid: "QmX",
      }),
    );
    expect(enqueueBenchmarkJob).toHaveBeenCalled();
  });

  it("AdapterApprovedEvent sets status ACTIVE", async () => {
    const { prisma, adapterUpdateMany } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("AdapterApprovedEvent", { adapter_id: "3", object_id: "0xa" }),
    );
    expect(adapterUpdateMany).toHaveBeenCalledWith({
      where: { onChainAdapterId: 3n },
      data: { status: AdapterStatus.ACTIVE },
    });
  });

  it("AdapterRejectedEvent sets status REJECTED (reason_code not persisted)", async () => {
    const { prisma, adapterUpdateMany } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("AdapterRejectedEvent", {
        adapter_id: "4",
        object_id: "0xb",
        reason_code: 9,
      }),
    );
    expect(adapterUpdateMany).toHaveBeenCalledWith({
      where: { onChainAdapterId: 4n },
      data: { status: AdapterStatus.REJECTED },
    });
  });

  it("StakeDepositedEvent upserts stake position with pool_object_id", async () => {
    const { prisma, stakeUpsert } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("StakeDepositedEvent", {
        adapter_id: "10",
        trainer: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        amount: "5000",
        pool_object_id: "0xpool",
      }),
    );
    expect(stakeUpsert).toHaveBeenCalledWith({
      where: { onChainAdapterId: 10n },
      create: {
        trainerAddress: expect.any(String),
        onChainAdapterId: 10n,
        amountNano: 5000n,
        poolObjectId: "0xpool",
      },
      update: {
        amountNano: 5000n,
        poolObjectId: "0xpool",
        trainerAddress: expect.any(String),
      },
    });
  });

  it("StakeWithdrawnEvent deletes stake position", async () => {
    const { prisma, stakeDeleteMany } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("StakeWithdrawnEvent", {
        adapter_id: "11",
        trainer: "0x1",
        amount: "5000",
      }),
    );
    expect(stakeDeleteMany).toHaveBeenCalledWith({
      where: { onChainAdapterId: 11n },
    });
  });

  it("StakeSlashedEvent deletes stake position", async () => {
    const { prisma, stakeDeleteMany } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("StakeSlashedEvent", {
        adapter_id: "12",
        trainer: "0x1",
        amount: "1000",
        reason_code: 2,
      }),
    );
    expect(stakeDeleteMany).toHaveBeenCalledWith({
      where: { onChainAdapterId: 12n },
    });
  });

  it("ignores unknown event types (no prisma calls)", async () => {
    const { prisma, userUpsert } = mockPrisma();
    await handleSuiEvent(
      prisma,
      suiEvent("UsageRecordedEvent", {
        pool_id: "0xp",
        user: "0x1",
        amount_mist: "1",
      }),
    );
    expect(userUpsert).not.toHaveBeenCalled();
  });
});
