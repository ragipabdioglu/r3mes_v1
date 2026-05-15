ALTER TABLE "KnowledgeDocument"
  ADD COLUMN "sourceMime" TEXT,
  ADD COLUMN "sourceExtension" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "parserId" TEXT,
  ADD COLUMN "parserVersion" INTEGER,
  ADD COLUMN "scanStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "storageStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "KnowledgeDocument"
SET "storageStatus" = 'READY'
WHERE "storageCid" IS NOT NULL OR "storagePath" IS NOT NULL;

UPDATE "KnowledgeDocument"
SET "scanStatus" = 'READY'
WHERE "parseStatus" = 'READY';

UPDATE "KnowledgeDocument"
SET
  "scanStatus" = 'FAILED',
  "storageStatus" = 'FAILED'
WHERE "parseStatus" = 'FAILED';

CREATE TABLE "KnowledgeDocumentVersion" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "versionIndex" INTEGER NOT NULL DEFAULT 1,
  "sourceType" "KnowledgeSourceType" NOT NULL,
  "sourceMime" TEXT,
  "sourceExtension" TEXT,
  "parserId" TEXT NOT NULL,
  "parserVersion" INTEGER NOT NULL,
  "contentHash" TEXT,
  "storagePath" TEXT,
  "storageCid" TEXT,
  "readinessStatus" "KnowledgeIngestionStepStatus" NOT NULL DEFAULT 'PENDING',
  "textHash" TEXT NOT NULL,
  "originalBytes" INTEGER,
  "normalizedChars" INTEGER NOT NULL,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeDocumentVersion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "KnowledgeDocumentVersion" (
  "id",
  "documentId",
  "version",
  "versionIndex",
  "sourceType",
  "sourceMime",
  "sourceExtension",
  "parserId",
  "parserVersion",
  "contentHash",
  "storagePath",
  "storageCid",
  "readinessStatus",
  "textHash",
  "normalizedChars",
  "createdAt",
  "updatedAt"
)
SELECT
  'kdv_' || md5("id"),
  "id",
  1,
  1,
  "sourceType",
  "sourceMime",
  "sourceExtension",
  COALESCE("parserId", 'legacy'),
  COALESCE("parserVersion", 1),
  "contentHash",
  "storagePath",
  "storageCid",
  "readinessStatus",
  COALESCE("contentHash", md5("id" || ':' || "createdAt"::TEXT)),
  0,
  "createdAt",
  "updatedAt"
FROM "KnowledgeDocument";

CREATE TABLE "KnowledgeArtifact" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT,
  "artifactId" TEXT NOT NULL,
  "artifactKey" TEXT,
  "ordinal" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "page" INTEGER,
  "pageNumber" INTEGER,
  "title" TEXT,
  "level" INTEGER,
  "text" TEXT NOT NULL,
  "metadata" JSONB,
  "answerabilityScore" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeArtifact_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KnowledgeChunk"
  ADD COLUMN "versionId" TEXT,
  ADD COLUMN "artifactRowId" TEXT,
  ADD COLUMN "artifactId" TEXT,
  ADD COLUMN "artifactSplitIndex" INTEGER;

CREATE INDEX "KnowledgeDocument_contentHash_idx" ON "KnowledgeDocument"("contentHash");
CREATE INDEX "KnowledgeDocument_scanStatus_storageStatus_idx" ON "KnowledgeDocument"("scanStatus", "storageStatus");

CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_version_key"
  ON "KnowledgeDocumentVersion"("documentId", "version");
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_versionIndex_key"
  ON "KnowledgeDocumentVersion"("documentId", "versionIndex");
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_contentHash_key"
  ON "KnowledgeDocumentVersion"("documentId", "contentHash");
CREATE INDEX "KnowledgeDocumentVersion_documentId_createdAt_idx"
  ON "KnowledgeDocumentVersion"("documentId", "createdAt" DESC);
CREATE INDEX "KnowledgeDocumentVersion_contentHash_idx"
  ON "KnowledgeDocumentVersion"("contentHash");
CREATE INDEX "KnowledgeDocumentVersion_parserId_parserVersion_idx"
  ON "KnowledgeDocumentVersion"("parserId", "parserVersion");
CREATE INDEX "KnowledgeDocumentVersion_readinessStatus_createdAt_idx"
  ON "KnowledgeDocumentVersion"("readinessStatus", "createdAt");
CREATE INDEX "KnowledgeDocumentVersion_textHash_idx"
  ON "KnowledgeDocumentVersion"("textHash");

CREATE UNIQUE INDEX "KnowledgeArtifact_artifactKey_key"
  ON "KnowledgeArtifact"("artifactKey");
CREATE UNIQUE INDEX "KnowledgeArtifact_documentId_versionId_artifactId_key"
  ON "KnowledgeArtifact"("documentId", "versionId", "artifactId");
CREATE INDEX "KnowledgeArtifact_documentId_artifactId_idx"
  ON "KnowledgeArtifact"("documentId", "artifactId");
CREATE INDEX "KnowledgeArtifact_versionId_kind_idx"
  ON "KnowledgeArtifact"("versionId", "kind");
CREATE INDEX "KnowledgeArtifact_kind_idx"
  ON "KnowledgeArtifact"("kind");
CREATE INDEX "KnowledgeArtifact_page_idx"
  ON "KnowledgeArtifact"("page");

CREATE INDEX "KnowledgeChunk_versionId_idx" ON "KnowledgeChunk"("versionId");
CREATE INDEX "KnowledgeChunk_artifactRowId_idx" ON "KnowledgeChunk"("artifactRowId");
CREATE INDEX "KnowledgeChunk_artifactId_idx" ON "KnowledgeChunk"("artifactId");

ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeArtifact" ADD CONSTRAINT "KnowledgeArtifact_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeArtifact" ADD CONSTRAINT "KnowledgeArtifact_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "KnowledgeDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "KnowledgeDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_artifactRowId_fkey"
  FOREIGN KEY ("artifactRowId") REFERENCES "KnowledgeArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
