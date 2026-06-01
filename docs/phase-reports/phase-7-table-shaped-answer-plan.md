# Faz 7 Slice 6 - Table-Shaped AnswerPlan Coverage

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: Generic table-shaped AnswerPlan coverage

## Summary

Some table-answer cases had usable `table_row` structured facts, but `AnswerPlan` could not select them when requested field labels were generic operation constraints such as amounts/rates rather than literal row labels. Slice 6 adds a generic table-shaped fallback: when the user asks for table output and structured table facts already exist, the plan can select those facts even without exact literal field matches.

This does not add document-specific literals. It does not touch retrieval, parser, Qdrant, embeddings, reranker, UI, safety policy, or model runtime.

## What Changed

- `AnswerPlan` now recognizes existing `table_row`, `table_cell`, `numeric_value`, or fact.table metadata as table structured facts.
- If no exact requested-field match exists for a table-shaped request, `AnswerPlan` selects the highest-confidence table structured facts.
- Table-shaped requested fields are considered covered when selected table structured facts exist.
- Unit coverage was added for generic table field requests without literal field matches.

## Contract / Boundary

- Public response shape is unchanged.
- Debug/eval `answerBaseline` remains compatible.
- `AnswerPlan` diagnostics still report requested/selected/missing fields, but table-shaped requests can now rely on selected table structured facts for coverage.
- No data-specific literals were added.

## Test / Eval Results

| Command | Exit | Result | Note |
| --- | --- | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/answerPlan.test.ts src/lib/domainEvidenceComposer.test.ts src/lib/answerQualityValidator.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | pass | 33 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | backend typecheck passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | pass | backend build passed |
| `/ready/rag-runtime` | 0 | pass | backend runtime readiness passed |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | expected eval gate fail | 13/17 passed; improved from Slice 5 12/17 |

## Quality Delta

- Answer-quality pass count improved from `12/17` to `13/17`.
- Failure count improved from `20` to `17`.
- Answer-quality failure rate improved from `0.235` to `0.176`.
- `kap-froto-share-groups-answer-quality` moved from fail to pass.
- Raw table dump rate remains `0`.

## Remaining Risks / Backlog

- `kap-froto-spk-net-profit-answer-quality` still lacks the exact requested value and has safety/presentation interaction.
- `kap-kchol-share-groups-answer-quality` still has table field mismatch and safety rewrite.
- `kap-kchol-other-sources-zero-answer-quality` still misses explicit zero value.
- `technical-contradictory-migration-answer-quality` remains protected by `SOURCE_METADATA_MISMATCH`.
- Normal RAG p95 latency warning remains (`8357ms` vs `8000ms`), not caused by this slice.

## Phase Decision

Slice 6 is acceptable for Faz 7 because it improves generic table answer planning without changing retrieval/evidence generation or adding hardcoded document concepts. Continue Faz 7 with the next narrow safety/composer presentation slice.
