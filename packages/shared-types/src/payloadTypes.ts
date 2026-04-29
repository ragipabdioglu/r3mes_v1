/**
 * Kuyruk ve webhook JSON gövdeleri — Faz 2 sözleşmesi; `schemas.ts` ile doğrulanır.
 */

/** BullMQ `BenchmarkJobPayload` ve Redis `r3mes-benchmark:jobs` LPUSH gövdesi ile uyumlu */
export interface BenchmarkJobPayload {
  /** Prisma Adapter.id */
  adapterDbId: string;
  /** Zincir u64 string; henüz yoksa "0" */
  onChainAdapterId: string;
  ipfsCid: string;
  ownerWallet: string;
}

/**
 * Python QA worker + liste kuyruğu için genişletilmiş gövde (jobId zorunlu).
 * Fastify, BullMQ iş kimliği ile LPUSH köprüsünde bu şekli yazar.
 */
export interface BenchmarkQueueJobMessage extends BenchmarkJobPayload {
  jobId: string;
  /** ipfsCid ile aynı; QA metrikleri / webhook ile uyum için */
  adapterCid: string;
}

/** POST /v1/internal/qa-result — Python `post_qa_result` ile hizalı */
export interface QaResultWebhookPayload {
  jobId: string;
  adapterCid: string;
  /** Prisma Adapter.id — duplicate uploads için backend'in doğru kaydı hedeflemesini sağlar */
  adapterDbId?: string;
  status: "approved" | "rejected" | string;
  score: number;
  threshold?: number | null;
  error?: string | null;
  metrics?: Record<string, unknown>;
  requestId?: string;
}

/** POST /v1/adapters başarı yanıtı (LoRA multipart) */
export interface LoRAUploadAcceptedResponse {
  adapterId: string;
  /** Kanonik tekrar — `adapterId` ile aynı (adapterDbId) */
  adapterDbId: string;
  weightsCid: string;
  manifestCid: string | null;
  benchmarkJobId: string;
  status: string;
  /** Yalnızca development/test: R3MES_DEV_BYPASS_QA — kuyruk/webhook atlandı */
  devQaBypassApplied?: boolean;
}
