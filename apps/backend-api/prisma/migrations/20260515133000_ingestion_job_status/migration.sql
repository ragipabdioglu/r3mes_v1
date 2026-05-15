CREATE TYPE "KnowledgeIngestionStepStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'PARTIAL_READY', 'SKIPPED');
CREATE TYPE "KnowledgeIngestionJobStage" AS ENUM ('RECEIVED', 'STORAGE', 'PARSE', 'CHUNK', 'EMBEDDING', 'VECTOR_INDEX', 'QUALITY', 'READY');
CREATE TYPE "KnowledgeIngestionJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL_READY');

ALTER TABLE "KnowledgeDocument"
  ADD COLUMN "chunkStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "embeddingStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "vectorIndexStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "qualityStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "readinessStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "KnowledgeDocument"
SET
  "chunkStatus" = 'READY',
  "embeddingStatus" = 'READY',
  "vectorIndexStatus" = 'READY',
  "qualityStatus" = 'READY',
  "readinessStatus" = 'READY'
WHERE "parseStatus" = 'READY';

UPDATE "KnowledgeDocument"
SET
  "chunkStatus" = 'FAILED',
  "embeddingStatus" = 'FAILED',
  "vectorIndexStatus" = 'FAILED',
  "qualityStatus" = 'FAILED',
  "readinessStatus" = 'FAILED'
WHERE "parseStatus" = 'FAILED';

CREATE TABLE "IngestionJob" (
  "jobId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "stage" "KnowledgeIngestionJobStage" NOT NULL DEFAULT 'RECEIVED',
  "status" "KnowledgeIngestionJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("jobId")
);

CREATE UNIQUE INDEX "IngestionJob_documentId_key" ON "IngestionJob"("documentId");
CREATE INDEX "IngestionJob_documentId_idx" ON "IngestionJob"("documentId");
CREATE INDEX "IngestionJob_status_createdAt_idx" ON "IngestionJob"("status", "createdAt");
CREATE INDEX "IngestionJob_stage_status_idx" ON "IngestionJob"("stage", "status");
CREATE INDEX "KnowledgeDocument_readinessStatus_createdAt_idx" ON "KnowledgeDocument"("readinessStatus", "createdAt");
CREATE INDEX "KnowledgeDocument_vectorIndexStatus_createdAt_idx" ON "KnowledgeDocument"("vectorIndexStatus", "createdAt");

ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
