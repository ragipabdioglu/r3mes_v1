-- QA webhook: jobId bazlı idempotency (Faz 4)
CREATE TABLE "QaWebhookReceipt" (
    "jobId" TEXT NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaWebhookReceipt_pkey" PRIMARY KEY ("jobId")
);
