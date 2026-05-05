-- Passive, auditable feedback adjustments. These records are not consumed by
-- retrieval/router scoring until a later explicit integration phase.

CREATE TYPE "KnowledgeFeedbackRouterAdjustmentStatus" AS ENUM ('ACTIVE', 'ROLLED_BACK');

CREATE TABLE "KnowledgeFeedbackRouterAdjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "applyRecordId" TEXT NOT NULL,
    "status" "KnowledgeFeedbackRouterAdjustmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "stepId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mutationPath" TEXT NOT NULL,
    "collectionId" TEXT,
    "expectedCollectionId" TEXT,
    "queryHash" TEXT,
    "scoreDelta" DOUBLE PRECISION NOT NULL,
    "simulatedBefore" DOUBLE PRECISION,
    "simulatedAfter" DOUBLE PRECISION,
    "metadata" JSONB,
    "rollbackReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeFeedbackRouterAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeFeedbackRouterAdjustment_userId_status_createdAt_idx"
    ON "KnowledgeFeedbackRouterAdjustment"("userId", "status", "createdAt" DESC);

CREATE INDEX "KnowledgeFeedbackRouterAdjustment_applyRecordId_status_idx"
    ON "KnowledgeFeedbackRouterAdjustment"("applyRecordId", "status");

CREATE INDEX "KnowledgeFeedbackRouterAdjustment_proposalId_status_idx"
    ON "KnowledgeFeedbackRouterAdjustment"("proposalId", "status");

CREATE INDEX "KnowledgeFeedbackRouterAdjustment_collectionId_queryHash_status_idx"
    ON "KnowledgeFeedbackRouterAdjustment"("collectionId", "queryHash", "status");

ALTER TABLE "KnowledgeFeedbackRouterAdjustment"
    ADD CONSTRAINT "KnowledgeFeedbackRouterAdjustment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeFeedbackRouterAdjustment"
    ADD CONSTRAINT "KnowledgeFeedbackRouterAdjustment_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "KnowledgeFeedbackProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeFeedbackRouterAdjustment"
    ADD CONSTRAINT "KnowledgeFeedbackRouterAdjustment_applyRecordId_fkey"
    FOREIGN KEY ("applyRecordId") REFERENCES "KnowledgeFeedbackApplyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
