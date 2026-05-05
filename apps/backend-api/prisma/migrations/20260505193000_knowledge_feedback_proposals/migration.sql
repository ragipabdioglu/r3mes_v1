-- CreateEnum
CREATE TYPE "KnowledgeFeedbackProposalAction" AS ENUM (
  'BOOST_SOURCE',
  'PENALIZE_SOURCE',
  'REVIEW_MISSING_SOURCE',
  'REVIEW_ANSWER_QUALITY'
);

-- CreateEnum
CREATE TYPE "KnowledgeFeedbackProposalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

-- CreateTable
CREATE TABLE "KnowledgeFeedbackProposal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "collectionId" TEXT,
  "expectedCollectionId" TEXT,
  "action" "KnowledgeFeedbackProposalAction" NOT NULL,
  "status" "KnowledgeFeedbackProposalStatus" NOT NULL DEFAULT 'PENDING',
  "queryHash" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evidence" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeFeedbackProposal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "KnowledgeFeedbackProposal"
  ADD CONSTRAINT "KnowledgeFeedbackProposal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFeedbackProposal"
  ADD CONSTRAINT "KnowledgeFeedbackProposal_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "KnowledgeFeedbackProposal_userId_status_createdAt_idx"
  ON "KnowledgeFeedbackProposal"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeFeedbackProposal_collectionId_action_status_idx"
  ON "KnowledgeFeedbackProposal"("collectionId", "action", "status");

-- CreateIndex
CREATE INDEX "KnowledgeFeedbackProposal_queryHash_idx"
  ON "KnowledgeFeedbackProposal"("queryHash");
