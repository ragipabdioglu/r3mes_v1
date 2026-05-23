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

## Stop Condition Reminder

Phase 2 is not complete until:

- parser output can preserve text, artifacts, structured artifacts, parser run diagnostics, and quality signals;
- dirty/noisy/text-only-table inputs are clearly marked as partial/needs-review;
- parser/document-understanding evals include successful, partial, failed, and structured table cases;
- no ingestion issue is hidden by retrieval/composer/safety patches;
- phase report is written and committed.
