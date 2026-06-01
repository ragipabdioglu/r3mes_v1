# Faz 7 Slice 8 - Row Value Instruction Cleanup

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: Generic row-value and exclusion instruction cleanup

## Summary

The remaining KAP numeric failures were caused by requested-field detection treating exclusion/output instructions as requested fields. Examples of the generic pattern: "use this value, do not use those numbers", "only write the result", "which number", and "which row value". Slice 8 improves the generic language cleanup so `AnswerPlan` asks for the real row/value field instead of instruction fragments.

This is not data-specific. It does not add company/document literals and does not change retrieval, parser, Qdrant, embeddings, reranker, UI, safety policy, or model runtime.

## What Changed

- `requestedFieldDetector` now handles singular row/value cues such as `hangi rakam` and `satırı kaç`.
- Field-list extraction cleans the whole candidate before splitting so subject prefixes are not mistaken for requested fields.
- Generic result instructions such as `sadece sonucu yaz` are ignored as requested fields.
- Generic exclusion instructions such as `rakamlarını kullanma` and `tek satır cevap` are removed from candidate phrases.
- Regression tests cover row-value requests, excluded numbers, and generic result instructions.

## Contract / Boundary

- Public response shape is unchanged.
- `QueryContract`, `AnswerPlan`, and eval diagnostics remain backward-compatible.
- No dataset-specific literal was added to core logic.
- The change only affects query-to-requested-field cleanup for generic instruction patterns.

## Test / Eval Results

| Command | Exit | Result | Note |
| --- | --- | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/requestedFieldDetector.test.ts src/lib/answerPlan.test.ts src/lib/domainEvidenceComposer.test.ts src/lib/answerQualityValidator.test.ts` | 0 | pass | 39 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | backend typecheck passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | pass | backend build passed |
| `/ready/rag-runtime` | 0 | pass | backend runtime readiness passed |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | expected eval gate fail | 16/17 passed; remaining fail is protected contradiction safety |

## Quality Delta

- Answer-quality pass count improved from `14/17` to `16/17`.
- All KAP answer-quality cases now pass.
- `answerQualityFailureRate` is `0`.
- `rawTableDumpRate`, `tableFieldMismatchRate`, `unnecessaryWarningRate`, and `sourceFoundBadAnswerRate` are `0`.
- `kap-froto-spk-net-profit-answer-quality` moved to pass.
- `kap-kchol-other-sources-zero-answer-quality` moved to pass.

## Remaining Risks / Backlog

- `technical-contradictory-migration-answer-quality` remains a safety rewrite due `SOURCE_METADATA_MISMATCH`; this is intentional guardrail behavior, not an answer-quality failure.
- Eval guardrail still warns on normal RAG p95 latency (`8250ms` vs `8000ms`), not caused by this slice.

## Phase Decision

Slice 8 is acceptable for Faz 7. The answer-quality suite now has no answer-quality failures; the only remaining red case is a protected contradiction/safety behavior that should be handled in Faz 7 closure policy rather than weakened.
