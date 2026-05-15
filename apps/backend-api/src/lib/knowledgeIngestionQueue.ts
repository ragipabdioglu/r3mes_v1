import { processKnowledgeIngestionJob } from "./knowledgeIngestionProcessor.js";
import { prisma } from "./prisma.js";

export type KnowledgeIngestionQueueMode = "inline" | "background" | "manual";

export interface KnowledgeIngestionEnqueueResult {
  jobId: string;
  mode: KnowledgeIngestionQueueMode;
  enqueued: boolean;
}

function ingestionMode(): KnowledgeIngestionQueueMode {
  const raw = process.env.R3MES_KNOWLEDGE_INGESTION_MODE?.trim().toLowerCase();
  if (raw === "inline" || raw === "background" || raw === "manual") return raw;
  return "background";
}

export async function enqueueKnowledgeIngestionJob(jobId: string): Promise<KnowledgeIngestionEnqueueResult> {
  const mode = ingestionMode();
  if (mode === "manual") {
    return { jobId, mode, enqueued: false };
  }

  if (mode === "inline") {
    await processKnowledgeIngestionJob({ jobId });
    return { jobId, mode, enqueued: true };
  }

  queueMicrotask(() => {
    processKnowledgeIngestionJob({ jobId }).catch((error) => {
      console.error({ err: error, jobId }, "Knowledge ingestion background processor failed");
    });
  });
  return { jobId, mode, enqueued: true };
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
