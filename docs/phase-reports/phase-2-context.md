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

1. Add parser output schema validation diagnostics for malformed structured artifacts.
2. Add ingestion eval fixture for external parser structured table envelope.
3. Strengthen parser capability health with optional smoke command/result status.
4. Add structured artifact provenance summary to document detail/admin diagnostics.
5. Expand CSV/table eval with row/column/cell provenance expectations.

## Stop Condition Reminder

Phase 2 is not complete until:

- parser output can preserve text, artifacts, structured artifacts, parser run diagnostics, and quality signals;
- dirty/noisy/text-only-table inputs are clearly marked as partial/needs-review;
- parser/document-understanding evals include successful, partial, failed, and structured table cases;
- no ingestion issue is hidden by retrieval/composer/safety patches;
- phase report is written and committed.

