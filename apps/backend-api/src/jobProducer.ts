import type { BenchmarkJobPayload, BenchmarkQueueJobMessage } from "@r3mes/shared-types";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

/** BullMQ kuyruk adı — AI benchmark worker ile aynı olmalı */
export const BENCHMARK_QUEUE_NAME = "r3mes-benchmark";

/** Python `r3mes_qa_worker.settings.list_queue_key` ile aynı — BLPOP köprüsü */
export const BENCHMARK_LIST_QUEUE_KEY = "r3mes-benchmark:jobs";

export type { BenchmarkJobPayload } from "@r3mes/shared-types";

let benchmarkQueue: Queue<BenchmarkJobPayload> | null = null;
let listBridgeRedis: Redis | null = null;

function getRedisConnection(): Redis {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  return new Redis(url, { maxRetriesPerRequest: null });
}

function getListBridgeRedis(): Redis {
  if (!listBridgeRedis) {
    listBridgeRedis = getRedisConnection();
  }
  return listBridgeRedis;
}

/**
 * BullMQ ile aynı iş yükünü Python worker’ın BLPOP ile okuduğu listeye yazar
 * (BullMQ’nun dahili Redis anahtarlarından bağımsız).
 */
export async function mirrorJobToListQueue(
  jobId: string,
  payload: BenchmarkJobPayload,
): Promise<void> {
  const msg: BenchmarkQueueJobMessage = {
    jobId,
    adapterCid: payload.ipfsCid,
    ipfsCid: payload.ipfsCid,
    adapterDbId: payload.adapterDbId,
    onChainAdapterId: payload.onChainAdapterId,
    ownerWallet: payload.ownerWallet,
  };
  const r = getListBridgeRedis();
  await r.lpush(BENCHMARK_LIST_QUEUE_KEY, JSON.stringify(msg));
}

export function getBenchmarkQueue(): Queue<BenchmarkJobPayload> {
  if (!benchmarkQueue) {
    benchmarkQueue = new Queue<BenchmarkJobPayload>(BENCHMARK_QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }
  return benchmarkQueue;
}

/**
 * LoRA yüklendiğinde (zincir olayı veya API) izole benchmark kuyruğuna iş basar.
 */
export async function enqueueBenchmarkJob(payload: BenchmarkJobPayload): Promise<string> {
  const q = getBenchmarkQueue();
  const jobId = `benchmark-${payload.onChainAdapterId}-${payload.ipfsCid.slice(0, 24)}`;
  const job = await q.add("isolate-benchmark", payload, {
    jobId,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
  const id = job.id ?? jobId;
  if (process.env.R3MES_MIRROR_LIST_QUEUE !== "0") {
    await mirrorJobToListQueue(id, payload);
  }
  return id;
}

export async function closeBenchmarkQueue(): Promise<void> {
  if (benchmarkQueue) {
    await benchmarkQueue.close();
    benchmarkQueue = null;
  }
  if (listBridgeRedis) {
    await listBridgeRedis.quit();
    listBridgeRedis = null;
  }
}
