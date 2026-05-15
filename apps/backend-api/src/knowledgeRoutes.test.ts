import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseKnowledgeDetailResponse,
  parseKnowledgeIngestionJobStatusResponse,
  parseKnowledgeListResponse,
} from "@r3mes/shared-types";

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    adapter: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    knowledgeCollection: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    knowledgeDocument: {
      create: vi.fn(),
      update: vi.fn(),
    },
    ingestionJob: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    knowledgeChunk: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    knowledgeEmbedding: {
      create: vi.fn(),
    },
    stakePosition: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn((await import("./lib/prisma.js")).prisma)),
    $executeRawUnsafe: vi.fn(),
  },
}));

describe("knowledge routes access control", () => {
  beforeEach(() => {
    vi.stubEnv("R3MES_DISABLE_RATE_LIMIT", "1");
    vi.stubEnv("R3MES_SKIP_CHAT_FEE", "1");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "1");
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

  it("GET /v1/knowledge scope=all returns own + public collections in canonical shape", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValueOnce([
      {
        id: "kc_private",
        name: "private set",
        visibility: "PRIVATE",
        publishedAt: null,
        createdAt: new Date("2026-04-22T10:00:00.000Z"),
        updatedAt: new Date("2026-04-22T10:00:00.000Z"),
        owner: {
          walletAddress:
            "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204",
        },
        _count: { documents: 1 },
        autoMetadata: {
          domain: "general",
          subtopics: [],
          keywords: [],
          entities: [],
          documentType: "knowledge_note",
          audience: "general_user",
          riskLevel: "low",
          summary: "",
          questionsAnswered: [],
          sourceQuality: "thin",
          profile: {
            version: 1,
            profileVersion: 3,
            domains: ["hr"],
            subtopics: ["onboarding"],
            keywords: ["personel", "hesap", "erişim"],
            entities: ["onboarding"],
            documentTypes: ["runbook"],
            audiences: ["operator"],
            sampleQuestions: ["Yeni personel onboarding sürecinde hangi hesaplar açılmalı?"],
            summary: "Yeni personel onboarding ve hesap açılışı notları.",
            riskLevel: "low",
            sourceQuality: "structured",
            confidence: "high",
            profileText: "Domains: hr\nSubtopics: onboarding",
            profileTextHash: "hash",
            profileEmbedding: [],
            summaryEmbedding: [],
            sampleQuestionsEmbedding: [],
            keywordsEmbedding: [],
            entityEmbedding: [],
            lastProfiledAt: "2026-04-23T10:00:00.000Z",
            updatedAt: "2026-04-23T10:00:00.000Z",
          },
        },
        documents: [],
      },
      {
        id: "kc_public",
        name: "public set",
        visibility: "PUBLIC",
        publishedAt: new Date("2026-04-22T10:00:00.000Z"),
        createdAt: new Date("2026-04-22T10:00:00.000Z"),
        updatedAt: new Date("2026-04-22T10:00:00.000Z"),
        owner: { walletAddress: "0x2222222222222222222222222222222222222222222222222222222222222222" },
        _count: { documents: 3 },
        documents: [],
      },
    ] as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/knowledge?scope=all" });
    expect(res.statusCode).toBe(200);
    const parsed = parseKnowledgeListResponse(JSON.parse(res.body));
    expect(parsed.data.map((item) => item.id)).toEqual(["kc_private", "kc_public"]);
    expect(parsed.data[0]).toMatchObject({
      inferredDomain: "hr",
      inferredTopic: "onboarding",
      sourceQuality: "structured",
      profileConfidence: "high",
      profileVersion: 3,
      lastProfiledAt: "2026-04-23T10:00:00.000Z",
    });
    await app.close();
  });

  it("GET /v1/knowledge/:id blocks private collection access for non-owner and allows public", async () => {
    const { prisma } = await import("./lib/prisma.js");
    vi.mocked(prisma.knowledgeCollection.findUnique)
      .mockResolvedValueOnce({
        id: "kc_private",
        name: "private set",
        visibility: "PRIVATE",
        publishedAt: null,
        createdAt: new Date("2026-04-22T10:00:00.000Z"),
        updatedAt: new Date("2026-04-22T10:00:00.000Z"),
        owner: { walletAddress: "0x9999999999999999999999999999999999999999999999999999999999999999" },
        documents: [],
      } as never)
      .mockResolvedValueOnce({
        id: "kc_public",
        name: "public set",
        visibility: "PUBLIC",
        publishedAt: new Date("2026-04-22T10:00:00.000Z"),
        createdAt: new Date("2026-04-22T10:00:00.000Z"),
        updatedAt: new Date("2026-04-22T10:00:00.000Z"),
        owner: { walletAddress: "0x9999999999999999999999999999999999999999999999999999999999999999" },
        documents: [],
      } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();

    const forbidden = await app.inject({ method: "GET", url: "/v1/knowledge/kc_private" });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({ method: "GET", url: "/v1/knowledge/kc_public" });
    expect(allowed.statusCode).toBe(200);
    parseKnowledgeDetailResponse(JSON.parse(allowed.body));
    await app.close();
  });

  it("GET /v1/knowledge/jobs/:id enforces collection access and exposes partial indexing status", async () => {
    const { prisma } = await import("./lib/prisma.js");
    const baseJob = {
      jobId: "job_1",
      documentId: "doc_1",
      stage: "VECTOR_INDEX",
      status: "PARTIAL_READY",
      attempts: 1,
      errorCode: "QDRANT_DUAL_WRITE_FAILED",
      errorMessage: "Qdrant upsert failed",
      startedAt: new Date("2026-05-15T10:00:00.000Z"),
      completedAt: new Date("2026-05-15T10:01:00.000Z"),
      createdAt: new Date("2026-05-15T10:00:00.000Z"),
      updatedAt: new Date("2026-05-15T10:01:00.000Z"),
      document: {
        id: "doc_1",
        parseStatus: "READY",
        chunkStatus: "READY",
        embeddingStatus: "READY",
        vectorIndexStatus: "FAILED",
        qualityStatus: "READY",
        readinessStatus: "PARTIAL_READY",
        _count: { chunks: 2 },
        collection: {
          id: "kc_private",
          visibility: "PRIVATE",
          owner: { walletAddress: "0x9999999999999999999999999999999999999999999999999999999999999999" },
        },
      },
    };
    vi.mocked(prisma.ingestionJob.findUnique)
      .mockResolvedValueOnce(baseJob as never)
      .mockResolvedValueOnce({
        ...baseJob,
        document: {
          ...baseJob.document,
          collection: {
            ...baseJob.document.collection,
            id: "kc_public",
            visibility: "PUBLIC",
          },
        },
      } as never);

    const { buildApp } = await import("./app.js");
    const app = await buildApp();

    const forbidden = await app.inject({ method: "GET", url: "/v1/knowledge/jobs/job_1" });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({ method: "GET", url: "/v1/knowledge/jobs/job_1" });
    expect(allowed.statusCode).toBe(200);
    const parsed = parseKnowledgeIngestionJobStatusResponse(JSON.parse(allowed.body));
    expect(parsed).toMatchObject({
      jobId: "job_1",
      status: "PARTIAL_READY",
      readiness: "PARTIAL_READY",
      indexStatus: "FAILED",
      stage: "VECTOR_INDEX",
      jobStatus: "PARTIAL_READY",
      errorCode: "QDRANT_DUAL_WRITE_FAILED",
    });
    expect(parsed.indexing).toMatchObject({
      status: "FAILED",
      vectorIndexStatus: "FAILED",
      indexedChunkCount: null,
    });
    await app.close();
  });
});
