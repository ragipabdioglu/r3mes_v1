-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdapterKind" AS ENUM ('LORA', 'DORA');

-- CreateEnum
CREATE TYPE "AdapterStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SLASHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "AiQueryStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adapter" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "AdapterKind" NOT NULL DEFAULT 'LORA',
    "weightsCid" TEXT,
    "manifestCid" TEXT,
    "onChainObjectId" TEXT,
    "onChainAdapterId" BIGINT,
    "status" "AdapterStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "benchmarkScore" DECIMAL(10,6),
    "domainTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Adapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQuery" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "userId" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "status" "AiQueryStatus" NOT NULL DEFAULT 'QUEUED',
    "queueJobId" TEXT,
    "promptHash" TEXT,
    "promptPreview" TEXT,
    "billedAmountNano" BIGINT DEFAULT 0,
    "resultSummary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "cursorAdapterModule" TEXT,
    "cursorStakingModule" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakePosition" (
    "id" TEXT NOT NULL,
    "trainerAddress" TEXT NOT NULL,
    "onChainAdapterId" BIGINT NOT NULL,
    "amountNano" BIGINT NOT NULL,
    "poolObjectId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StakePosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Adapter_onChainObjectId_key" ON "Adapter"("onChainObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Adapter_onChainAdapterId_key" ON "Adapter"("onChainAdapterId");

-- CreateIndex
CREATE INDEX "Adapter_status_benchmarkScore_idx" ON "Adapter"("status", "benchmarkScore");

-- CreateIndex
CREATE INDEX "Adapter_ownerId_idx" ON "Adapter"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AiQuery_idempotencyKey_key" ON "AiQuery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiQuery_userId_createdAt_idx" ON "AiQuery"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiQuery_adapterId_createdAt_idx" ON "AiQuery"("adapterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiQuery_status_createdAt_idx" ON "AiQuery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StakePosition_onChainAdapterId_key" ON "StakePosition"("onChainAdapterId");

-- CreateIndex
CREATE INDEX "StakePosition_trainerAddress_idx" ON "StakePosition"("trainerAddress");

-- AddForeignKey
ALTER TABLE "Adapter" ADD CONSTRAINT "Adapter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiQuery" ADD CONSTRAINT "AiQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiQuery" ADD CONSTRAINT "AiQuery_adapterId_fkey" FOREIGN KEY ("adapterId") REFERENCES "Adapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
