-- CreateEnum
CREATE TYPE "KnowledgeFeedbackKind" AS ENUM (
  'GOOD_SOURCE',
  'WRONG_SOURCE',
  'MISSING_SOURCE',
  'BAD_ANSWER',
  'GOOD_ANSWER'
);

-- CreateTable
CREATE TABLE "KnowledgeFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "collectionId" TEXT,
  "documentId" TEXT,
  "chunkId" TEXT,
  "expectedCollectionId" TEXT,
  "traceId" TEXT,
  "queryHash" TEXT,
  "kind" "KnowledgeFeedbackKind" NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeFeedback_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "KnowledgeFeedback"
  ADD CONSTRAINT "KnowledgeFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFeedback"
  ADD CONSTRAINT "KnowledgeFeedback_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "KnowledgeFeedback_userId_createdAt_idx"
  ON "KnowledgeFeedback"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeFeedback_collectionId_kind_createdAt_idx"
  ON "KnowledgeFeedback"("collectionId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeFeedback_queryHash_idx" ON "KnowledgeFeedback"("queryHash");

-- CreateIndex
CREATE INDEX "KnowledgeFeedback_traceId_idx" ON "KnowledgeFeedback"("traceId");
