import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processKnowledgeIngestionJob: vi.fn(),
  add: vi.fn(),
  close: vi.fn(),
}));

vi.mock("./knowledgeIngestionProcessor.js", () => ({
  processKnowledgeIngestionJob: mocks.processKnowledgeIngestionJob,
}));

vi.mock("./prisma.js", () => ({
  prisma: {
    ingestionJob: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string, options: unknown) => ({
    name,
    options,
    add: mocks.add,
    close: mocks.close,
  })),
}));

describe("knowledgeIngestionQueue", () => {
  beforeEach(() => {
    mocks.processKnowledgeIngestionJob.mockResolvedValue(undefined);
    mocks.add.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("keeps background as the default local queue mode", async () => {
    const { enqueueKnowledgeIngestionJob } = await import("./knowledgeIngestionQueue.js");

    const result = await enqueueKnowledgeIngestionJob("job-default");

    expect(result).toMatchObject({
      jobId: "job-default",
      mode: "background",
      enqueued: true,
      provider: "local",
    });
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("exposes a BullMQ mode contract when Redis env is configured", async () => {
    vi.stubEnv("R3MES_KNOWLEDGE_INGESTION_MODE", "bullmq");
    vi.stubEnv("R3MES_KNOWLEDGE_INGESTION_REDIS_URL", "redis://localhost:6379/2");
    vi.stubEnv("R3MES_KNOWLEDGE_INGESTION_QUEUE_NAME", "knowledge-test");

    const { enqueueKnowledgeIngestionJob } = await import("./knowledgeIngestionQueue.js");

    const result = await enqueueKnowledgeIngestionJob("job-bullmq");

    expect(result).toMatchObject({
      jobId: "job-bullmq",
      mode: "bullmq",
      enqueued: true,
      provider: "bullmq",
      queueName: "knowledge-test",
    });
    expect(mocks.add).toHaveBeenCalledWith(
      "process-knowledge-ingestion",
      { jobId: "job-bullmq" },
      expect.objectContaining({ jobId: "job-bullmq", attempts: 3 }),
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("fails visibly for BullMQ mode without Redis configuration", async () => {
    vi.stubEnv("R3MES_KNOWLEDGE_INGESTION_MODE", "bullmq");

    const { enqueueKnowledgeIngestionJob } = await import("./knowledgeIngestionQueue.js");

    await expect(enqueueKnowledgeIngestionJob("job-missing-redis")).rejects.toThrow(
      "R3MES_KNOWLEDGE_INGESTION_MODE=bullmq requires",
    );
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
