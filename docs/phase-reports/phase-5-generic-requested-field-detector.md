# Phase 5 Report - Generic Requested Field Detection

Date: 2026-05-28
Phase: Faz 5 - Query / Source Intelligence
Slice: Generic requested-field extraction and source-safe table numeric bridge

## Summary

This slice removed the finance/table field alias registry from core query understanding and replaced it with generic requested-field phrase extraction. The goal was to keep core logic data-agnostic while still detecting user requests such as "field X value", "only these numbers", "rows for A/B groups", and output constraints.

## What Changed

- `requestedFieldDetector` no longer owns a hardcoded finance/KAP field catalog.
- Requested fields are now derived from quoted phrases and generic cue patterns.
- "What should I do?" / procedure-style questions are no longer misclassified as field extraction.
- Numeric-only table extraction now requires either explicit field labels or structured table facts; it does not infer business field semantics from stripped row numbers.
- Grouped numeric row extraction is generic capability-based instead of tied to a specific field id.
- `answerPlan` field matching now normalizes diacritics and no longer special-cases a field id.

## Contract Impact

- `RequestedField` remains backward-compatible.
- Field ids are generated from detected phrases instead of a domain alias catalog.
- Output constraints remain public-response safe and visible only through debug/eval contracts.
- No public response payload shape changed.

## Product Decisions

- Core logic must not know specific KAP/finance table fields.
- Label-stripped numeric rows are treated as insufficient without artifact/table metadata.
- This intentionally moves row-number-to-field intelligence to Document Intelligence / Structured Evidence phases, not Query Understanding.

## Files Changed

- `apps/backend-api/src/lib/requestedFieldDetector.ts`
- `apps/backend-api/src/lib/requestedFieldDetector.test.ts`
- `apps/backend-api/src/lib/queryUnderstanding.test.ts`
- `apps/backend-api/src/lib/answerPlan.ts`
- `apps/backend-api/src/lib/answerPlan.test.ts`
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts`
- `apps/backend-api/src/lib/tableNumericFactExtractor.test.ts`

## Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm exec vitest run src/lib/requestedFieldDetector.test.ts src/lib/queryUnderstanding.test.ts src/lib/answerPlan.test.ts src/lib/tableNumericFactExtractor.test.ts` | 0 | 28/28 pass |
| `pnpm exec vitest run src/lib/retrievalQualityContracts.test.ts src/lib/sourceResolutionPlan.test.ts src/lib/knowledgeAccess.test.ts` | 0 | 38/38 pass |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 0 | pass |
| `pnpm exec tsc -p tsconfig.json` | 0 | pass |
| `pnpm run eval:retrieval-quality` | 0 | 16/16 pass |
| `pnpm run eval:collection-suggestion` | 0 | 5/5 pass |
| `pnpm run eval:ui-reality` | 0 | 5/5 pass |

## Runtime Notes

- Backend was rebuilt and restarted on `http://127.0.0.1:3000`.
- AI engine runtime was healthy with CPU BGE-M3 embedding and model reranker loaded.
- Qdrant readiness returned all shards ready.
- Provider fallback ratios stayed at 0 in the evals above.

## Risks / Backlog

- Display labels are currently normalized phrases; prettier user-facing labels should come from evidence/artifact labels in later phases.
- Label-stripped numbered table rows require structured artifacts; old MVP data may need reingestion to benefit fully.
- Existing `inferColumnLabel` still contains domain-column phrase recognition and should be moved behind artifact/profile metadata in the structured evidence phase if it grows.

## Phase 5 Status

This slice is complete and compatible with Phase 5 goals. It reduces hardcoded final-decision logic without changing retrieval scoring, composer behavior, safety behavior, parser behavior, or public UI shape.
