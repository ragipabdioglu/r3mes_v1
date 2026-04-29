import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const addMock = vi.fn();
const queueClose = vi.fn();

vi.mock("bullmq", () => ({
  Queue: class {
    add = addMock;
    close = queueClose;
  },
}));

vi.mock("ioredis", () => ({
  Redis: class {
    constructor() {}
  },
}));

describe("enqueueBenchmarkJob", () => {
  beforeEach(() => {
    vi.resetModules();
    addMock.mockReset();
    queueClose.mockReset();
    vi.stubEnv("R3MES_MIRROR_LIST_QUEUE", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("queues isolate-benchmark job with payload", async () => {
    addMock.mockResolvedValue({ id: "test-job-id" });
    const { enqueueBenchmarkJob, closeBenchmarkQueue } = await import("./jobProducer.js");
    await enqueueBenchmarkJob({
      adapterDbId: "adb",
      onChainAdapterId: "42",
      ipfsCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      ownerWallet: "0x1",
    });
    expect(addMock).toHaveBeenCalledWith(
      "isolate-benchmark",
      expect.objectContaining({
        adapterDbId: "adb",
        onChainAdapterId: "42",
      }),
      expect.any(Object),
    );
    await closeBenchmarkQueue();
  });
});
