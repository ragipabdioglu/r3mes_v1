import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: {},
}));

function createPrismaMock() {
  const prisma = {
    ingestionJob: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    knowledgeDocument: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    knowledgeDocumentVersion: {
      create: vi.fn(),
      update: vi.fn(),
    },
    knowledgeArtifact: {
      createMany: vi.fn(),
    },
    knowledgeChunk: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    knowledgeEmbedding: {
      create: vi.fn(),
    },
    knowledgeCollection: {
      update: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
  };

  prisma.ingestionJob.update.mockResolvedValue({});
  prisma.knowledgeDocument.update.mockResolvedValue({});
  prisma.knowledgeDocumentVersion.create.mockResolvedValue({ id: "version_1", versionIndex: 1 });
  prisma.knowledgeDocumentVersion.update.mockResolvedValue({});
  prisma.knowledgeArtifact.createMany.mockResolvedValue({ count: 1 });
  prisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 });
  prisma.knowledgeCollection.update.mockResolvedValue({});
  prisma.$executeRawUnsafe.mockResolvedValue({});
  prisma.knowledgeChunk.create.mockImplementation(async ({ data }) => ({
    id: `chunk_${data.chunkIndex}`,
    chunkIndex: data.chunkIndex,
    content: data.content,
  }));
  prisma.knowledgeEmbedding.create.mockImplementation(async ({ data }) => ({
    id: `embedding_${data.chunkId}`,
    chunkId: data.chunkId,
  }));

  return prisma;
}

function createJob() {
  return {
    jobId: "job_1",
    documentId: "doc_1",
    stage: "RECEIVED",
    status: "QUEUED",
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-05-15T08:00:00.000Z"),
    updatedAt: new Date("2026-05-15T08:00:00.000Z"),
    document: {
      id: "doc_1",
      collectionId: "collection_1",
      title: "Legal Upload",
      sourceType: "text",
      sourceMime: "text/plain",
      sourceExtension: ".txt",
      contentHash: "hash_1",
      parserId: null,
      parserVersion: null,
      storageCid: null,
      storagePath: "C:\\tmp\\legal-upload.txt",
      scanStatus: "READY",
      storageStatus: "READY",
      autoMetadata: null,
      parseStatus: "PENDING",
      chunkStatus: "PENDING",
      embeddingStatus: "PENDING",
      vectorIndexStatus: "PENDING",
      qualityStatus: "PENDING",
      readinessStatus: "PENDING",
      errorMessage: null,
      createdAt: new Date("2026-05-15T08:01:00.000Z"),
      updatedAt: new Date("2026-05-15T08:01:00.000Z"),
      collection: {
        id: "collection_1",
        visibility: "PRIVATE",
        autoMetadata: null,
        owner: { walletAddress: "0xowner" },
      },
      versions: [],
    },
  };
}

describe("knowledge ingestion processor", () => {
  it("parses, chunks, embeds, and marks the job ready", async () => {
    const prisma = createPrismaMock();
    prisma.ingestionJob.findUnique.mockResolvedValue(createJob());
    const { processKnowledgeIngestionJob } = await import("./knowledgeIngestionProcessor.js");

    const result = await processKnowledgeIngestionJob(
      { jobId: "job_1" },
      {
        prisma: prisma as never,
        readRawFile: async () => Buffer.from("Boşanma protokolünde velayet ve nafaka maddeleri açık yazılmalıdır."),
        embedQdrantText: async () => [0.1, 0.2, 0.3],
        upsertQdrantPoints: vi.fn().mockResolvedValue(undefined),
        setQdrantProfileMetadata: vi.fn().mockResolvedValue(undefined),
        now: () => new Date("2026-05-15T08:02:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      jobId: "job_1",
      documentId: "doc_1",
      collectionId: "collection_1",
      status: "SUCCEEDED",
      stage: "READY",
      readinessStatus: "READY",
      chunkCount: 1,
    });
    expect(prisma.knowledgeChunk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: "doc_1",
          chunkIndex: 0,
          content: expect.stringContaining("Boşanma protokolünde"),
        }),
      }),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("KnowledgeEmbedding"),
      expect.stringMatching(/^\[[\d.,-]+\]$/),
      "embedding_chunk_0",
    );
    expect(prisma.knowledgeDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc_1" },
        data: expect.objectContaining({
          autoMetadata: expect.objectContaining({
            parseQuality: expect.objectContaining({ level: expect.any(String) }),
            ingestionQuality: expect.objectContaining({ version: 1 }),
            documentUnderstanding: expect.objectContaining({
              version: 1,
              answerReadiness: expect.any(String),
              strictAnswerEligible: expect.any(Boolean),
            }),
          }),
        }),
      }),
    );
    expect(prisma.ingestionJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { jobId: "job_1" },
        data: expect.objectContaining({
          stage: "READY",
          status: "SUCCEEDED",
          errorCode: null,
          errorMessage: null,
        }),
      }),
    );
  });

  it("keeps Prisma ingestion ready but marks qdrant failure as partial ready", async () => {
    const prisma = createPrismaMock();
    prisma.ingestionJob.findUnique.mockResolvedValue(createJob());
    const qdrantError = new Error("qdrant unavailable");
    const { processKnowledgeIngestionJob } = await import("./knowledgeIngestionProcessor.js");

    const result = await processKnowledgeIngestionJob(
      { jobId: "job_1" },
      {
        prisma: prisma as never,
        readRawFile: async () => Buffer.from("Kira sözleşmesinde depozito iadesi ve tahliye şartları yer alır."),
        embedQdrantText: async () => [0.1, 0.2, 0.3],
        upsertQdrantPoints: vi.fn().mockRejectedValue(qdrantError),
        setQdrantProfileMetadata: vi.fn().mockResolvedValue(undefined),
        now: () => new Date("2026-05-15T08:02:00.000Z"),
        log: { warn: vi.fn(), error: vi.fn() },
      },
    );

    expect(result).toMatchObject({
      status: "PARTIAL_READY",
      stage: "VECTOR_INDEX",
      readinessStatus: "PARTIAL_READY",
      errorCode: "QDRANT_DUAL_WRITE_FAILED",
      errorMessage: "qdrant unavailable",
    });
    expect(prisma.knowledgeDocument.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "doc_1" },
        data: expect.objectContaining({
          vectorIndexStatus: "FAILED",
          readinessStatus: "PARTIAL_READY",
          errorMessage: "qdrant unavailable",
        }),
      }),
    );
    expect(prisma.ingestionJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { jobId: "job_1" },
        data: expect.objectContaining({
          stage: "VECTOR_INDEX",
          status: "PARTIAL_READY",
          errorCode: "QDRANT_DUAL_WRITE_FAILED",
          errorMessage: "qdrant unavailable",
        }),
      }),
    );
  });
});
