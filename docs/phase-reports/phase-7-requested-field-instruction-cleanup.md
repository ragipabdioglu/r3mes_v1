# Faz 7 Slice 7 - Requested Field Instruction Cleanup

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: Generic instruction cleanup for requested field detection

## Summary

Some output instructions such as "maddelerle", "karıştırma", "kullanma", and "tek satır cevap" were being treated as requested fields. This polluted `AnswerPlan.missingFieldIds` and caused table-answer cases to fail even when the structured table evidence was usable.

Slice 7 adds generic instruction cleanup and rejection rules. It does not add dataset-specific literals and does not change retrieval, parser, Qdrant, embedding, reranker, UI, safety policy, or model runtime.

## What Changed

- `requestedFieldDetector` now removes trailing format/exclusion instructions before converting candidate phrases into requested fields.
- Generic phrases like "bu iki grubu maddelerle" are rejected as output instructions rather than field requests.
- Regression tests verify that table facts remain requested while instruction phrases are excluded.

## Contract / Boundary

- Public response shape is unchanged.
- `QueryContract` / `AnswerPlan` remain backward-compatible.
- Debug/eval `answerBaseline` continues to show requested fields, selected facts, coverage, and missing fields.
- No core logic contains document-specific, company-specific, or fixture-specific literals.

## Test / Eval Results

| Command | Exit | Result | Note |
| --- | --- | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/requestedFieldDetector.test.ts src/lib/answerPlan.test.ts src/lib/domainEvidenceComposer.test.ts src/lib/answerQualityValidator.test.ts` | 0 | pass | 38 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | backend typecheck passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | pass | backend build passed |
| `/ready/rag-runtime` | 0 | pass | backend runtime readiness passed |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | expected eval gate fail | 14/17 passed; improved from Slice 6 13/17 |

## Quality Delta

- Answer-quality pass count improved from `13/17` to `14/17`.
- Failure count improved from `17` to `14`.
- Answer-quality failure rate improved from `0.176` to `0.118`.
- `kap-kchol-share-groups-answer-quality` moved from fail to pass.
- `tableFieldMismatchRate` is now `0`.
- Raw table dump and unnecessary warning rates remain `0`.

## Remaining Risks / Backlog

- `kap-froto-spk-net-profit-answer-quality` still misses the exact requested value and has safety/presentation interaction.
- `kap-kchol-other-sources-zero-answer-quality` still misses the explicit zero value.
- `technical-contradictory-migration-answer-quality` remains protected by `SOURCE_METADATA_MISMATCH`.
- Normal RAG p95 latency warning remains (`8650ms` vs `8000ms`), not caused by this slice.

## Phase Decision

Slice 7 is acceptable for Faz 7 because it removes generic instruction pollution from requested field detection and improves answer quality without widening scope. Continue Faz 7 with the next narrow evidence/answer presentation slice for zero-value and exact-value handling.
