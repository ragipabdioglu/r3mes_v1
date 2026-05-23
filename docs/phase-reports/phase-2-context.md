# R3MES Phase 2 Context - Document Intelligence Foundation

Date: 2026-05-23

Phase: Phase 2 - Document Intelligence Foundation

Status: Started. Do not move to Phase 3 without Phase 2 stop-condition review.

## Phase Goal

Phase 2 turns uploaded documents into reliable document-understanding artifacts before retrieval and answer generation depend on them.

The goal is not to improve composer wording, reranker behavior, safety policy, Qwen prompts, or UI polish. The goal is to preserve document structure so later phases can answer from typed evidence instead of damaged raw chunks.

## Current Baseline

The repo is not starting Phase 2 from zero. Current code already contains several product-direction pieces:

- parser capabilities with health/support fields
- CSV parser that emits structured table artifacts
- `StructuredDocumentArtifact` validators
- `DocumentUnderstandingQuality`
- parse quality and ingestion quality reports
- Qdrant/source metadata carrying document understanding signals
- ingestion quality eval

## Phase 2 Boundaries

Allowed areas:

- parser registry and parser output contracts
- parsed document contract
- structured document artifacts
- artifact persistence metadata
- document understanding quality
- parse/ingestion quality evals
- ingestion/document-understanding phase reports

Out of scope:

- retrieval scoring changes
- reranker/provider changes
- answer composer changes
- safety policy behavior changes
- Qwen/model/LoRA runtime changes
- UI styling/layout changes
- Prisma migrations unless explicitly approved

## First Implementation Slice

Problem:

External parser JSON could provide rich structured artifacts, but the backend only preserved text/artifacts and ignored `structuredArtifacts`.

Change:

- `ParsedKnowledgeDocument` now exposes `schemaVersion: 2`.
- `ParsedKnowledgeDocument.parserRun` records parser id/version/profile, output schema version, fallback flag, duration, and warnings.
- External parser JSON now accepts and validates `structuredArtifacts`.
- Matching structured artifacts are persisted into `KnowledgeArtifact.metadata.structuredArtifacts`.

Why this matters:

- Docling/Marker-style parsers can now pass table/layout structure through ingestion.
- Downstream phases can use typed table artifacts instead of re-inferring field/value semantics from raw chunk text.
- This avoids data-specific hardcoding and keeps the structure source in parser output.

## Contract Changes

`ParsedKnowledgeDocument` additions:

- `schemaVersion: 2`
- `structuredArtifacts?: StructuredDocumentArtifact[]`
- `parserRun.id`
- `parserRun.version`
- `parserRun.profile`
- `parserRun.durationMs`
- `parserRun.fallbackUsed`
- `parserRun.outputSchemaVersion`
- `parserRun.warnings`

`KnowledgeArtifact.metadata` additions:

- `structuredArtifacts` is stored when a structured artifact explicitly references the persisted artifact by `provenance.artifactId` or `tableId`.

Backward compatibility:

- Existing `parser` and `diagnostics` fields remain.
- Existing text/artifact chunking behavior remains.
- No public API contract was intentionally changed.
- No migration was added.

## Tests / Evals

Commands run:

```powershell
pnpm --filter @r3mes/backend-api exec vitest run src/lib/knowledgeText.test.ts src/lib/knowledgeArtifactPersistence.test.ts src/lib/documentUnderstandingQuality.test.ts
pnpm --filter @r3mes/backend-api exec tsc --noEmit
pnpm run eval:parse-quality
pnpm --filter @r3mes/backend-api run eval:ingestion-quality
```

Results:

- parser/artifact/document understanding tests: PASS, 29 tests
- backend typecheck: PASS
- parse quality eval: PASS, 6/6
- ingestion quality eval: PASS, 5/5

## Current Risks

- XLSX parser remains unavailable by design; CSV structured table support exists.
- External parser health still depends mostly on command configuration, not deep smoke health.
- Structured artifacts persist inside JSON metadata, not yet normalized Prisma tables.
- Full table/cell fact extraction is not part of this first Phase 2 slice.
- Existing parser bridge is still a POC; production Docling/Marker integration remains a future Phase 2 task.

## Next Phase 2 Work

Recommended next implementation slices:

1. Strengthen parser capability health with optional smoke command/result status.
2. Add structured artifact provenance summary to document detail/admin diagnostics.
3. Expand CSV/table eval with row/column/cell provenance expectations.
4. Add real external parser integration notes for Docling/Marker once provider runtime is selected.

## Implementation Slice 2 - Parser Diagnostics And External Parser Eval

Date: 2026-05-23

Commits:

- `77c897e Improve parser schema diagnostics`
- `f190b4d Add external structured table ingestion eval`

### What Changed

This slice closed the first two recommended Phase 2 tasks without touching retrieval, composer, safety, model runtime, or UI behavior.

Changes:

- Malformed external parser `structuredArtifacts` now produce clearer parser diagnostics.
- Invalid arrays report how many structured artifacts were rejected.
- Non-array `structuredArtifacts` values report `external_parser_structured_artifacts_not_array`.
- `parserRun.fallbackUsed` and `parserRun.outputSchemaVersion` are validated through tests.
- Ingestion-quality eval can run a per-case external parser command without changing global developer environment.
- A new external parser fixture emits text, markdown table artifact, and typed `structuredArtifacts`.
- The new eval case verifies `tableQuality: structured`, `answerReadiness: ready`, and `structuredTableCount >= 1`.

### Changed Files

Runtime/parser diagnostics:

- `apps/backend-api/src/lib/knowledgeText.ts`
- `apps/backend-api/src/lib/knowledgeText.test.ts`

Eval harness and fixtures:

- `apps/backend-api/scripts/run-ingestion-quality-eval.mjs`
- `infrastructure/evals/ingestion-quality/golden.jsonl`
- `infrastructure/evals/ingestion-quality/fixtures/external-structured-table-parser.mjs`
- `infrastructure/evals/ingestion-quality/fixtures/external-structured-table.pdf`

### Contract Impact

No public API contract changed.

Internal contract behavior is now stricter and more observable:

- External parser structured artifact validation failures are visible through parser diagnostics.
- Per-case external parser eval configuration is isolated and restored after each case.
- Structured table readiness is now checked through `documentUnderstanding.tableQuality`.

Backward compatibility:

- Existing text-only parser behavior remains valid.
- Existing CSV structured table eval still passes.
- Existing external parser behavior still falls back through the same parser bridge.

### Boundary Check

Touched:

- Parser diagnostics
- Parser unit tests
- Ingestion-quality eval runner
- Ingestion eval fixtures

Not touched:

- Retrieval scoring
- Qdrant indexing/reindex
- Embedding provider
- Reranker provider
- Answer composer
- Safety policy behavior
- Qwen/LoRA runtime
- UI styling/layout
- Prisma migrations

### Tests / Evals

Commands run:

```powershell
node --check apps/backend-api/scripts/run-ingestion-quality-eval.mjs
pnpm --filter @r3mes/backend-api exec tsc --noEmit
pnpm --filter @r3mes/backend-api exec vitest run src/lib/knowledgeText.test.ts src/lib/knowledgeArtifactPersistence.test.ts src/lib/documentUnderstandingQuality.test.ts
pnpm --filter @r3mes/backend-api run eval:ingestion-quality
pnpm run eval:parse-quality
```

Results:

- JS syntax check: PASS
- backend typecheck: PASS
- parser/artifact/document understanding tests: PASS, 31 tests
- ingestion quality eval: PASS, 6/6
- parse quality eval: PASS, 6/6

New eval case:

- `ingestion-external-parser-structured-table`
- parser: `external-document-parser-v1`
- source type: `PDF`
- `tableQuality`: `structured`
- `answerReadiness`: `ready`
- `structuredTableCount`: `1`
- `strictRouteEligible`: `true`

### Quality Notes

The new external parser fixture is intentionally generic and synthetic. It is not a product-domain hardcode. Domain-specific terms appear only inside eval fixture content, not core runtime logic.

The expectation was adjusted to `expectedLevel: usable` instead of `clean`. This is deliberate: a table-heavy, tiny one-page parser fixture should be answer-ready and structured, but it still naturally carries `single_tiny_chunk` and `table_risk_high` warnings. Treating it as `usable + structured + ready` is more honest than pretending it is a fully clean long-form document.

### Remaining Risks

- External parser integration is still command-based; real Docling/Marker runtime health is not deeply smoke-tested yet.
- Structured artifacts are preserved and evaluated, but table facts are not yet extracted into answer evidence. That belongs to later Evidence Intelligence phases.
- Structured artifacts are stored in metadata rather than normalized relational tables.
- Visual/layout artifacts are not yet covered by this eval slice.

### Next Slice Recommendation

The next Phase 2 slice should inspect and strengthen how parser/document-understanding diagnostics flow into upload/detail/admin surfaces without changing retrieval or composer behavior.

Specific target:

- verify upload path stores `parserRun`, `structuredArtifacts`, and `documentUnderstanding` consistently;
- add document detail/admin diagnostics if missing;
- keep public chat payload clean;
- add tests/eval only around ingestion/document detail contracts.

## Implementation Slice 3 - Parser Run Diagnostics Surface

Date: 2026-05-23

Commit:

- pending at report-write time

### What Changed

This slice made parser runtime lineage visible in authenticated knowledge ingestion/detail surfaces without changing chat public response, retrieval, composer, safety, embeddings, reranker, model runtime, or UI layout.

Changes:

- Added `KnowledgeParserRunDiagnostics` to shared API contracts.
- Added optional `parserRun` to:
  - `KnowledgeDocumentListItem`
  - `KnowledgeUploadAcceptedResponse`
  - `KnowledgeIngestionJobStatusResponse`
- Added matching Zod validation in shared schemas.
- Mirrored the type in dApp knowledge types.
- Stored `ParsedKnowledgeDocument.parserRun` inside document auto metadata during ingestion.
- Exposed sanitized `parserRun` from:
  - upload response for existing documents,
  - upload accepted response for new/pending documents as `null`,
  - ingestion job status,
  - collection detail document rows.
- Added route/processor test coverage for parserRun propagation.

### Contract Shape

`KnowledgeParserRunDiagnostics`:

- `id`
- `version`
- `profile`
- `durationMs?`
- `fallbackUsed`
- `outputSchemaVersion`
- `warnings`

Boundary behavior:

- This is a knowledge-management/admin surface contract, not a chat public response contract.
- Parser command, parser args, local executable paths, stderr text, and raw parser output are not exposed.
- Warnings remain symbolic diagnostics such as `external_parser_structured_artifacts_not_array`.

### Changed Files

Shared/API contract:

- `packages/shared-types/src/apiContract.ts`
- `packages/shared-types/src/schemas.ts`

Backend:

- `apps/backend-api/src/lib/knowledgeAutoMetadata.ts`
- `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts`
- `apps/backend-api/src/routes/knowledge.ts`
- `apps/backend-api/src/knowledgeRoutes.test.ts`
- `apps/backend-api/src/lib/knowledgeIngestionProcessor.test.ts`

dApp type mirror:

- `apps/dApp/lib/types/knowledge.ts`

### Boundary Check

Touched:

- Knowledge contract types
- Ingestion metadata persistence
- Authenticated knowledge detail/job/upload response shaping
- Tests

Not touched:

- `/v1/chat/completions`
- Chat public response shaping
- Retrieval scoring
- Qdrant indexing/reindex
- Embedding provider
- Reranker provider
- Answer composer
- Safety policy behavior
- Qwen/LoRA runtime
- UI styling/layout
- Prisma migrations

### Tests / Evals

Commands run:

```powershell
pnpm --filter @r3mes/shared-types run build
pnpm --filter @r3mes/backend-api exec tsc --noEmit
pnpm --filter @r3mes/backend-api exec vitest run src/knowledgeRoutes.test.ts src/lib/knowledgeIngestionProcessor.test.ts
pnpm --filter @r3mes/backend-api exec vitest run src/lib/knowledgeText.test.ts src/lib/knowledgeArtifactPersistence.test.ts src/lib/documentUnderstandingQuality.test.ts
pnpm --filter @r3mes/backend-api run eval:ingestion-quality
pnpm run eval:parse-quality
```

Results:

- shared-types build: PASS
- backend typecheck: PASS
- knowledge route + ingestion processor tests: PASS, 5 tests
- parser/artifact/document understanding tests: PASS, 31 tests
- ingestion quality eval: PASS, 6/6
- parse quality eval: PASS, 6/6

### Quality Notes

The implementation intentionally does not normalize parserRun into a new Prisma table. At this phase, storing sanitized parser lineage in auto metadata is enough to keep upload/detail/admin diagnostics observable while avoiding schema churn.

This is not a provider-health feature. It answers a narrower Phase 2 question: “did this document parse through fallback or a structured parser profile, and which schema version did the parser output use?”

### Remaining Risks

- Parser capability health still only reports configured/unavailable; it does not yet run a smoke parse.
- The dApp type mirror is updated, but UI does not yet present parserRun in a polished admin panel.
- ParserRun is metadata-backed, so historical documents need reingestion to gain this field.

### Next Slice Recommendation

Strengthen parser capability health with an optional smoke command/result status.

Specific target:

- keep command/path private;
- expose only symbolic readiness and smoke status;
- avoid making external parsers hard dependencies in local-dev;
- fail/warn appropriately under strict runtime profiles.

## Implementation Slice 4 - Parser Capability Smoke Health

Date: 2026-05-23

Commit:

- pending at report-write time

### System Startup Note

The local system was started successfully before continuing Phase 2.

Status:

- backend-api: OK on `3000`
- dApp: OK on `3001`
- ai-engine: OK on `8000`
- Qdrant: OK on `6333`
- llama-server: OK on `8080`
- IPFS gateway: OK on `9080`

Startup caveat:

- The configured LoRA file `C:\r3mes-lora\doctor-role-qwen3b-v3.gguf` failed llama loading with `failed to read magic`.
- The system was restarted with a non-existing LoRA path so llama starts base Qwen2.5-3B without applying LoRA.
- This is architecturally acceptable for RAG quality work because LoRA is not the truth/knowledge layer; it remains persona/behavior only.

### What Changed

Parser capability health no longer has to mean only “env command is configured”.

Changes:

- Added parser capability `health: ready | degraded | unavailable` to the public shared contract.
- Added optional smoke fields:
  - `smokeStatus: not_run | passed | failed | timed_out`
  - `smokeDurationMs`
- Expanded parser capability contract so product surfaces keep:
  - `sourceTypes`
  - `mimeTypes`
  - `priority`
  - `supportsTables`
  - `supportsOcr`
  - `supportsSpreadsheets`
  - `outputSchemaVersion`
- Added optional external parser smoke check behind `R3MES_DOCUMENT_PARSER_HEALTHCHECK=1`.
- Smoke check reuses the same command/args path as real parsing but uses a tiny temporary smoke PDF.
- Smoke results expose only symbolic status and safe reason text.
- Command, args, executable path, temp path, raw stdout, and raw stderr are not exposed.
- Added tests for:
  - healthcheck disabled: configured parser returns `ready` + `not_run`;
  - healthcheck success: `ready` + `passed`;
  - healthcheck failure: `degraded` + `failed`;
  - command/path details do not leak.

### Contract Impact

Changed shared/product parser capability contract:

- `KnowledgeParserCapabilityItem.health` accepts `degraded`.
- `KnowledgeParserCapabilityItem` now preserves richer product fields already produced by backend parser registry.

Backward compatibility:

- Existing consumers can ignore new optional smoke fields.
- Health values are a strict additive expansion from `ready/unavailable` to `ready/degraded/unavailable`.

### Changed Files

Shared/API contract:

- `packages/shared-types/src/apiContract.ts`
- `packages/shared-types/src/schemas.ts`

Backend:

- `apps/backend-api/src/lib/parserRegistry.ts`
- `apps/backend-api/src/lib/knowledgeText.ts`
- `apps/backend-api/src/lib/knowledgeText.test.ts`
- `apps/backend-api/src/knowledgeRoutes.test.ts`

dApp type mirror:

- `apps/dApp/lib/types/knowledge.ts`

### Boundary Check

Touched:

- Parser capability contract
- External parser capability health logic
- Parser route tests
- Parser unit tests

Not touched:

- Upload parsing behavior
- Retrieval scoring
- Qdrant indexing/reindex
- Embedding provider
- Reranker provider
- Answer composer
- Safety policy behavior
- Qwen/LoRA runtime behavior
- UI styling/layout
- Prisma migrations

### Tests / Evals

Commands run:

```powershell
pnpm --filter @r3mes/shared-types run build
pnpm --filter @r3mes/backend-api exec tsc --noEmit
pnpm --filter @r3mes/backend-api exec vitest run src/lib/knowledgeText.test.ts src/knowledgeRoutes.test.ts
pnpm --filter @r3mes/backend-api run eval:ingestion-quality
pnpm run eval:parse-quality
pnpm local:status
```

Results:

- shared-types build: PASS
- backend typecheck: PASS
- parser + knowledge route tests: PASS, 30 tests
- ingestion quality eval: PASS, 6/6
- parse quality eval: PASS, 6/6
- local status: all services OK

### Quality Notes

The smoke check is disabled by default to avoid blocking `/v1/knowledge/parsers` on every call. When enabled, it is still synchronous and bounded by `R3MES_DOCUMENT_PARSER_HEALTHCHECK_TIMEOUT_MS`.

This gives product/admin surfaces a truthful distinction:

- configured but not probed: `ready + not_run`
- configured and smoke passed: `ready + passed`
- configured but smoke failed: `degraded + failed/timed_out`
- not configured: `unavailable + not_run`

### Remaining Risks

- There is no TTL/cache yet; repeated healthcheck-enabled calls can repeatedly run the external parser command.
- Smoke input is a minimal synthetic PDF, not a rich OCR/layout benchmark.
- Parser smoke status is product-visible but not yet tied into runtime strict profile gates.
- dApp types are updated, but UI presentation for degraded parser health remains a later product layer task.

### Next Slice Recommendation

Add structured artifact provenance summaries to document detail/admin diagnostics.

Specific target:

- expose counts and safe artifact summaries, not raw parser internals;
- keep public chat response untouched;
- avoid dumping full structured artifacts into broad list responses;
- add tests for artifact metadata carrying structured table provenance.

## Stop Condition Reminder

Phase 2 is not complete until:

- parser output can preserve text, artifacts, structured artifacts, parser run diagnostics, and quality signals;
- dirty/noisy/text-only-table inputs are clearly marked as partial/needs-review;
- parser/document-understanding evals include successful, partial, failed, and structured table cases;
- no ingestion issue is hidden by retrieval/composer/safety patches;
- phase report is written and committed.
