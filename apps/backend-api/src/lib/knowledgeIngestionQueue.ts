import { processKnowledgeIngestionJob } from "./knowledgeIngestionProcessor.js";
import { prisma } from "./prisma.js";

export type KnowledgeIngestionQueueMode = "inline" | "background" | "manual" | "bullmq";

export interface KnowledgeIngestionEnqueueResult {
  jobId: string;
  mode: KnowledgeIngestionQueueMode;
  enqueued: boolean;
  provider?: "local" | "bullmq";
  queueName?: string;
}

export function getKnowledgeIngestionQueueName(): string {
  return process.env.R3MES_KNOWLEDGE_INGESTION_QUEUE_NAME?.trim() || "r3mes-knowledge-ingestion";
}

export function getKnowledgeIngestionRedisUrl(): string | undefined {
  return process.env.R3MES_KNOWLEDGE_INGESTION_REDIS_URL?.trim() || process.env.REDIS_URL?.trim() || undefined;
}

export function getKnowledgeIngestionMode(): KnowledgeIngestionQueueMode {
  const raw = process.env.R3MES_KNOWLEDGE_INGESTION_MODE?.trim().toLowerCase();
  if (raw === "inline" || raw === "background" || raw === "manual" || raw === "bullmq") return raw;
  return "background";
}

async function enqueueBullMqKnowledgeIngestionJob(jobId: string): Promise<KnowledgeIngestionEnqueueResult> {
  const redisUrl = getKnowledgeIngestionRedisUrl();
  if (!redisUrl) {
    throw new Error("R3MES_KNOWLEDGE_INGESTION_MODE=bullmq requires R3MES_KNOWLEDGE_INGESTION_REDIS_URL or REDIS_URL.");
  }

  const { Queue } = await import("bullmq");
  const queueName = getKnowledgeIngestionQueueName();
  const queue = new Queue(queueName, {
    connection: { url: redisUrl },
  });

  try {
    await queue.add(
      "process-knowledge-ingestion",
      { jobId },
      {
        jobId,
        attempts: Number(process.env.R3MES_KNOWLEDGE_INGESTION_QUEUE_ATTEMPTS || 3),
        backoff: { type: "exponential", delay: Number(process.env.R3MES_KNOWLEDGE_INGESTION_QUEUE_BACKOFF_MS || 5_000) },
        removeOnComplete: Number(process.env.R3MES_KNOWLEDGE_INGESTION_QUEUE_REMOVE_COMPLETE || 1_000),
        removeOnFail: Number(process.env.R3MES_KNOWLEDGE_INGESTION_QUEUE_REMOVE_FAIL || 5_000),
      },
    );
  } finally {
    await queue.close();
  }

  return { jobId, mode: "bullmq", enqueued: true, provider: "bullmq", queueName };
}

export async function enqueueKnowledgeIngestionJob(jobId: string): Promise<KnowledgeIngestionEnqueueResult> {
  const mode = getKnowledgeIngestionMode();
  if (mode === "manual") {
    return { jobId, mode, enqueued: false, provider: "local" };
  }

  if (mode === "inline") {
    await processKnowledgeIngestionJob({ jobId });
    return { jobId, mode, enqueued: true, provider: "local" };
  }

  if (mode === "bullmq") {
    return enqueueBullMqKnowledgeIngestionJob(jobId);
  }

  queueMicrotask(() => {
    processKnowledgeIngestionJob({ jobId }).catch((error) => {
      console.error({ err: error, jobId }, "Knowledge ingestion background processor failed");
    });
  });
  return { jobId, mode, enqueued: true, provider: "local" };
}

export async function processPendingKnowledgeIngestionJobs(limit = 5): Promise<number> {
  const jobs = await prisma.ingestionJob.findMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      document: {
        readinessStatus: { in: ["PENDING", "RUNNING"] },
        storageStatus: "READY",
        scanStatus: "READY",
      },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 25)),
    select: { jobId: true },
  });

  let processed = 0;
  for (const job of jobs) {
    try {
      await processKnowledgeIngestionJob({ jobId: job.jobId });
      processed += 1;
    } catch (error) {
      console.error({ err: error, jobId: job.jobId }, "Knowledge ingestion recovery processor failed");
    }
  }
  return processed;
}
