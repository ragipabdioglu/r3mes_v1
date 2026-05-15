# R3MES Ingestion Product Audit

Date: 2026-05-15
Scope: Knowledge ingestion / document intake only. Retrieval, evidence extraction, answer planning, composer, safety, and eval are intentionally out of scope except where they depend on ingestion status.

## Implementation Status After Closure Pass

Date: 2026-05-15

The first ingestion section is now implemented to a product-usable baseline:

- Upload streams to durable local raw storage instead of using `part.toBuffer()`.
- Upload computes SHA-256 `contentHash` during streaming and stores `storagePath`, source extension, detected MIME, and source type.
- Extension + magic/text/JSON validation is enforced before parsing.
- Malware scanner interface exists with deterministic local behavior and EICAR quarantine support.
- Upload creates `KnowledgeDocument` + `IngestionJob` and returns `202 Accepted` with `jobId` and `statusUrl`.
- Parse/chunk/embed/vector indexing runs through `knowledgeIngestionProcessor`.
- Pending jobs can be recovered from DB on backend startup.
- `READY` is only set after parse, chunking, lexical embedding, and required indexing states complete.
- Qdrant failure becomes `PARTIAL_READY`; Prisma lexical retrieval remains usable.
- `KnowledgeDocumentVersion` and `KnowledgeArtifact` persist version/artifact provenance for future StructuredFact/Table extraction.
- Chat retrieval filters out documents that are not parse/chunk/embedding ready.
- UI upload polls ingestion job status and status board exposes readiness/storage/scan/vector/artifact states.

Remaining ingestion hardening that is intentionally not part of this closure pass:

- Real AV/CDR integration behind the scanner interface.
- External object storage/S3 instead of local durable raw storage.
- Multi-worker distributed BullMQ consumer if the deployment needs ingestion outside the API process.

## Goal

R3MES should accept heterogeneous enterprise knowledge sources without relying on hardcoded, data-specific behavior. The ingestion layer should be durable, observable, parser-agnostic, and explicit about whether a document is only uploaded, parsed, indexed, partially ready, or actually usable by chat.

## Current Flow Observed In Repo

```text
UI file select
-> POST /v1/knowledge/parsers
-> POST /v1/knowledge/upload multipart
-> wallet auth
-> extension support check
-> parseKnowledgeBuffer
-> chunkParsedKnowledgeDocument
-> scoreKnowledgeParseQuality
-> inferKnowledgeAutoMetadata per chunk
-> mergeKnowledgeAutoMetadata
-> IPFS add
-> Prisma KnowledgeDocument / KnowledgeChunk / KnowledgeEmbedding
-> pgvector update
-> Qdrant dual-write best effort
-> 201 response with parseStatus=READY
```

Primary local evidence:
- UI upload form builds `FormData` with `collectionName`, `wallet`, optional `title`, and one `file`: `apps/dApp/components/studio/knowledge-upload-panel.tsx:116`.
- Upload client posts to `/v1/knowledge/upload`: `apps/dApp/lib/api/knowledge.ts:82`.
- Backend endpoint is `POST /v1/knowledge/upload`: `apps/backend-api/src/routes/knowledge.ts:434`.
- Backend reads file with `part.toBuffer()`: `apps/backend-api/src/routes/knowledge.ts:449`.
- Backend parses and chunks in the same request: `apps/backend-api/src/routes/knowledge.ts:478`.
- Backend sets document `PENDING`, then updates to `READY` inside the same transaction: `apps/backend-api/src/routes/knowledge.ts:543`, `apps/backend-api/src/routes/knowledge.ts:583`.
- Qdrant dual-write failure is logged but upload still returns `READY`: `apps/backend-api/src/routes/knowledge.ts:605`.
- Source type enum is fixed to `TEXT`, `MARKDOWN`, `JSON`, `PDF`, `DOCX`, `PPTX`, `HTML`: `apps/backend-api/prisma/schema.prisma:46`.

## Research Notes

- OWASP File Upload Cheat Sheet recommends allowlisting extensions, validating file type beyond the user-controlled filename/content-type, limiting file size, changing filenames, storing files safely, and using malware/CDR controls for risky document types. Source: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- `@fastify/multipart` supports streaming file handling and an `onFile` handler to avoid accumulating entire files in memory. Source: https://github.com/fastify/fastify-multipart
- Prisma documents warn that long-running transactions hurt performance and can cause deadlocks. Source: https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- Qdrant recommends payload indexes for filtered queries and notes that payload indexes can significantly speed up filtering. Source: https://qdrant.tech/documentation/manage-data/indexing/
- BullMQ supports durable jobs with attempts and backoff for retrying failed work. Source: https://docs.bullmq.io/guide/retrying-failing-jobs
- Apache Tika supports many document formats, including Office/PDF families, and is a common parser-registry style option for broad enterprise intake. Source: https://tika.apache.org/3.2.2/formats.html
- Docling is relevant for layout-aware PDF/document conversion and table structure recognition, especially where OCR/table fidelity matters. Source: https://arxiv.org/abs/2408.09869

## Issue And Solution Matrix

| ID | Problem | Why It Matters | Product-Level Solution | Acceptance Criteria |
|---|---|---|---|---|
| ING-01 | Upload is synchronous and does parsing, chunking, embeddings, DB writes, IPFS, and Qdrant in one request. | Large PDF/DOCX/OCR files can timeout, lock resources, and fail halfway with unclear status. | Introduce durable `IngestionJob`. Upload only stores raw file and creates document/job records. Workers perform parse, chunk, metadata, embedding, and indexing. | Upload returns `202 Accepted` with `jobId`; 200 MB file does not block request thread; progress can be polled. |
| ING-02 | Entire uploaded file is buffered with `part.toBuffer()`. | Memory pressure and denial-of-service risk. Fastify body limit is 512 MB. | Stream upload to object storage/temp quarantine using multipart stream or `onFile`; compute content hash while streaming. | Multiple large concurrent uploads do not grow process RSS linearly with file size. |
| ING-03 | File type validation is extension-based. | Extension and content-type are user-controllable; wrong or malicious files can enter parser path. | Add MIME sniffing and magic-byte validation. Keep extension allowlist, but require extension + detected MIME/source kind compatibility. | `.pdf` containing non-PDF bytes is rejected before parsing. |
| ING-04 | Source type enum is too narrow and migration-bound. | Enterprise sources include XLSX, CSV, images/OCR, email, ZIP exports, SharePoint/Drive connector docs, scans, XML, etc. | Keep canonical enum if useful, but add flexible fields: `sourceMime`, `sourceExtension`, `rawSourceKind`, `connectorType`, `parserId`, `parserVersion`. Add `SPREADSHEET`, `CSV`, `IMAGE`, `EMAIL`, `ARCHIVE` when needed. | New parser/source can be introduced without breaking existing chat path. |
| ING-05 | External parser is a single env command with local absolute path. | Not reproducible across environments; no parser registry, versioning, health, fallback chain, or per-format routing. | Build `ParserRegistry`: parser id, version, supported MIME/extensions, priority, health, timeout, output schema. Support Docling/Tika/custom parsers behind the registry. | `/v1/knowledge/parsers` exposes parser health and selected parser per source type. |
| ING-06 | Parser artifacts are transient; only chunk text and JSON metadata persist. | Page, block, table, OCR, and layout structure are lost before retrieval. | Persist first-class artifacts: `KnowledgePage`, `KnowledgeArtifact`, `KnowledgeTable`, `KnowledgeTableCell` or equivalent JSONB artifact store with stable ids. | A parsed table can be traced from answer -> fact -> table cell -> page/source. |
| ING-07 | Parse status conflates upload, parse, chunk, embedding, and vector index readiness. | Chat can treat a document as ready even if Qdrant indexing failed. | Split statuses: `uploadStatus`, `parseStatus`, `chunkStatus`, `embeddingStatus`, `vectorIndexStatus`, `qualityStatus`, plus aggregate `readiness`. | Chat only uses documents where required statuses are ready; partial states are visible in UI. |
| ING-08 | Qdrant dual-write failure is best-effort log only. | Retrieval quality may silently degrade while UI shows `READY`. | Add `IndexingJob` with retry/backoff and status. Persist Qdrant point ids, index version, fallback reason. | Qdrant failure marks `vectorIndexStatus=FAILED` and schedules retry; UI shows partial readiness. |
| ING-09 | IPFS add is a synchronous hard dependency after parsing. | Storage outage blocks ingestion; raw uploaded file may not be durably recorded before parsing. | Store raw file first in primary object storage or local durable store; IPFS/content-addressed pinning runs as async storage replication. Use `storagePath` in schema. | IPFS outage does not lose upload; document remains `UPLOADED` or `STORAGE_REPLICATION_FAILED`. |
| ING-10 | Collection creation and document ingestion are tightly coupled. | Enterprise systems need datasets, connectors, versions, dedup, replacement policy, and multiple documents per source. | Separate `KnowledgeCollection`, `DataSource`, `KnowledgeDocumentVersion`, and `IngestionJob`. Add `contentHash` and dedup/version policy. | Re-upload of same file is detected; changed file creates new version or replaces according to policy. |
| ING-11 | Generic ingestion contains domain-specific heuristics and legacy medical/finance signals. | Hardcoded cues bias metadata and quality for arbitrary enterprise documents. | Split generic document quality from domain enrichers. Generic layer measures structure/OCR/table/encoding; domain plugins add optional hints. | Uploading HR/procedure/maintenance docs does not depend on medical/KAP terms for quality. |
| ING-12 | Upload response lacks job lifecycle information. | UI cannot tell whether document is parsed, indexed, partially ready, failed, or retrying. | Return `jobId`, `documentId`, `statusUrl`, `initialStatus`, selected parser, and warnings. Add `/v1/knowledge/jobs/:id`. | UI shows progress and actionable failures instead of a single success/error message. |
| ING-13 | No observed malware scanning/quarantine/CDR step. | Enterprise document upload is a high-risk attack surface. | Add quarantine state and optional scanner interface. Do not parse until scanner passes, except explicitly configured trusted local dev. | Malicious test file is rejected or quarantined before parser execution. |
| ING-14 | No observed ingestion idempotency or retry model. | Network retries can duplicate documents; parser/index transient failures require manual cleanup. | Use idempotency key/content hash. Jobs are idempotent by `documentVersionId + stage`. Retry transient stages with capped exponential backoff. | Replayed upload request does not create duplicate chunks/vectors. |

## Target Product Architecture For This Section

```text
Upload API
-> stream to raw storage/quarantine
-> create KnowledgeDocument + KnowledgeDocumentVersion
-> create IngestionJob
-> return 202 with jobId/statusUrl

Worker stage 1: validate
-> extension + MIME + magic-byte + size + tenant quota + malware scan

Worker stage 2: parse
-> ParserRegistry chooses parser
-> persist parser run, diagnostics, pages/artifacts/tables

Worker stage 3: chunk
-> chunk planner uses artifacts, page boundaries, tables, headings
-> persist chunks with stable artifact/page provenance

Worker stage 4: enrich
-> generic metadata/quality
-> optional domain enrichers

Worker stage 5: index
-> lexical index ready
-> embedding ready
-> Qdrant points upserted with indexed payload fields

Readiness
-> READY only when required stages pass
-> PARTIAL_READY if lexical works but vector failed
-> FAILED with stage-specific reason and retryability
```

## Proposed Schema Direction

Minimum additions:

```prisma
model IngestionJob {
  id                String   @id @default(cuid())
  documentId        String
  documentVersionId String?
  stage             String
  status            String
  attempts          Int      @default(0)
  maxAttempts       Int      @default(3)
  errorCode         String?
  errorMessage      String?  @db.Text
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model KnowledgeDocumentVersion {
  id              String   @id @default(cuid())
  documentId      String
  contentHash     String
  sourceMime      String?
  sourceExtension String?
  parserId        String?
  parserVersion   String?
  storagePath     String?
  storageCid      String?
  readiness       String
  createdAt       DateTime @default(now())
}

model KnowledgeArtifact {
  id          String @id @default(cuid())
  documentId  String
  versionId   String?
  kind        String
  pageNumber  Int?
  title       String?
  text        String @db.Text
  metadata    Json?
}
```

Optional later additions:
- `KnowledgeTable`
- `KnowledgeTableCell`
- `KnowledgePage`
- `KnowledgeConnector`
- `KnowledgeIndexRun`

## Implementation Phases

### Phase 1: Durable Intake Skeleton

Do not change parser quality yet. Change upload semantics.

- Stream file to storage.
- Compute `contentHash`.
- Create document/version/job.
- Return `202 Accepted`.
- Add job status endpoint.
- Keep old synchronous route behind a flag for rollback.

### Phase 2: Stage Status Split

- Add status columns or job records for parse/chunk/embed/vector index.
- Chat source resolution filters out not-ready documents.
- Qdrant failure becomes visible status, not silent log.

### Phase 3: Parser Registry

- Replace one external parser command with registry abstraction.
- Keep existing `external-document-parser-v1` as one registry entry.
- Add parser health and selected parser diagnostics.

### Phase 4: Artifact Persistence

- Persist parser artifacts before chunking.
- Add artifact ids to chunks.
- Preserve table/page provenance for later StructuredFact extraction.

### Phase 5: Generic vs Domain Enrichment Split

- Move hardcoded medical/finance quality signals out of generic ingestion.
- Generic ingestion only does text/encoding/OCR/table/layout quality.
- Domain enrichers become optional plugins.

## Immediate Engineering Priority

The first product-level fix should be:

```text
Synchronous upload route -> durable asynchronous ingestion job
```

Reason: most other fixes need a stable lifecycle. Parser registry, scanner, table persistence, retry, Qdrant indexing status, and UI progress all become cleaner once ingestion is modeled as staged work rather than a single HTTP request.

## Non-Goals For This Section

- Do not solve retrieval ranking here.
- Do not tune KAP answer composer here.
- Do not add bigger model calls to compensate for bad ingestion.
- Do not add more hardcoded document-specific regexes in upload.
- Do not call a document `READY` unless its required downstream indexes are ready.
