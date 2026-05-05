CREATE TYPE "KnowledgeFeedbackApplyStatus" AS ENUM (
  'PLANNED',
  'GATE_PASSED',
  'APPLIED',
  'ROLLED_BACK',
  'BLOCKED'
);

CREATE TABLE "KnowledgeFeedbackApplyRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "status" "KnowledgeFeedbackApplyStatus" NOT NULL DEFAULT 'PLANNED',
  "plan" JSONB NOT NULL,
  "gateReport" JSONB,
  "appliedDelta" JSONB,
  "rollbackPlan" JSONB,
  "reason" TEXT,
  "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "gateCheckedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeFeedbackApplyRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeFeedbackApplyRecord_userId_status_createdAt_idx"
  ON "KnowledgeFeedbackApplyRecord"("userId", "status", "createdAt" DESC);

CREATE INDEX "KnowledgeFeedbackApplyRecord_proposalId_status_idx"
  ON "KnowledgeFeedbackApplyRecord"("proposalId", "status");

ALTER TABLE "KnowledgeFeedbackApplyRecord"
  ADD CONSTRAINT "KnowledgeFeedbackApplyRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeFeedbackApplyRecord"
  ADD CONSTRAINT "KnowledgeFeedbackApplyRecord_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "KnowledgeFeedbackProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
