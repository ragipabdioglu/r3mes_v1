ALTER TABLE "KnowledgeCollection" ADD COLUMN "autoMetadata" JSONB;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "autoMetadata" JSONB;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "autoMetadata" JSONB;
