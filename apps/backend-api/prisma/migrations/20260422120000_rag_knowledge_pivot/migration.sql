CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "KnowledgeVisibility" AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE "KnowledgeSourceType" AS ENUM ('TEXT', 'MARKDOWN', 'JSON');
CREATE TYPE "KnowledgeParseStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "KnowledgeCollection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'PRIVATE',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "storageCid" TEXT,
    "storagePath" TEXT,
    "parseStatus" "KnowledgeParseStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "values" DOUBLE PRECISION[],
    "vector" vector(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEmbedding_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AiQuery"
    ALTER COLUMN "adapterId" DROP NOT NULL,
    ADD COLUMN "knowledgeCollectionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "sourceSummary" JSONB;

CREATE INDEX "KnowledgeCollection_ownerId_createdAt_idx" ON "KnowledgeCollection"("ownerId", "createdAt" DESC);
CREATE INDEX "KnowledgeCollection_visibility_publishedAt_idx" ON "KnowledgeCollection"("visibility", "publishedAt");
CREATE INDEX "KnowledgeDocument_collectionId_createdAt_idx" ON "KnowledgeDocument"("collectionId", "createdAt" DESC);
CREATE INDEX "KnowledgeDocument_parseStatus_createdAt_idx" ON "KnowledgeDocument"("parseStatus", "createdAt");
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_chunkIndex_key" ON "KnowledgeChunk"("documentId", "chunkIndex");
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");
CREATE UNIQUE INDEX "KnowledgeEmbedding_chunkId_key" ON "KnowledgeEmbedding"("chunkId");
CREATE INDEX "KnowledgeEmbedding_chunkId_idx" ON "KnowledgeEmbedding"("chunkId");

ALTER TABLE "KnowledgeCollection" ADD CONSTRAINT "KnowledgeCollection_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_chunkId_fkey"
    FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
