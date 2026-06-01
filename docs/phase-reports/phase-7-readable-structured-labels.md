# Faz 7 Slice 5 - Readable Structured Fact Labels

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: Structured fact label recovery

## Summary

Structured table facts sometimes carried normalized/ascii row labels into the final answer. The slice adds a generic label recovery path that looks for the row label token span inside `rawRow` or provenance quote and reuses the original readable document spelling when it is safe.

This intentionally does not add data-specific literals. It does not change retrieval, parser, Qdrant, embedding, reranker, UI layout, safety policy, or model runtime.

## What Changed

- `domainEvidenceComposer` now recovers readable row labels from structured fact source text using token-span matching.
- The recovery only returns the exact label span; it no longer treats every token before the first numeric value as a label.
- Source prefixes such as `generic-file.pdf:` are stripped before label recovery.
- Regression coverage was added for readable Turkish labels, source-prefix stripping, noisy table rows, and safe fallback.

## Contract / Boundary

- Public response shape is unchanged.
- Debug/admin diagnostics are unchanged.
- `AnswerPlan`, `CompiledEvidence`, retrieval diagnostics, and safety contracts are unchanged.
- The slice only improves planned structured renderer presentation for existing structured facts.

## Test / Eval Results

| Command | Exit | Result | Note |
| --- | --- | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/domainEvidenceComposer.test.ts src/lib/answerQualityValidator.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | pass | 29 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | backend typecheck passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | pass | backend build passed |
| `/ready/rag-runtime` | 0 | pass | backend runtime readiness passed |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | expected eval gate fail | 12/17 passed; improved from previous 10/17, remaining failures are known Faz 7 backlog |

## Quality Delta

- Answer-quality pass count improved from `10/17` to `12/17`.
- Failure count improved from `23` to `20`.
- Raw table dump rate is `0`.
- KAP/UI parity cases recovered:
  - `kap-eregl-other-sources-answer-quality`: pass
  - `kap-eregl-auto-private-source-default`: pass
  - `kap-eregl-ui-history-followup-net-profit`: pass
  - `kap-kchol-company-disambiguation-answer-quality`: pass
  - `kap-eregl-donations-answer-quality`: pass

## Remaining Risks / Backlog

- KAP FROTO net profit and share-group cases still fail due field completeness/table value extraction and safety presentation interaction.
- KCHOL share groups still has a table field mismatch.
- KCHOL other sources zero still misses the explicit zero value.
- Technical contradictory migration remains protected by `SOURCE_METADATA_MISMATCH`; this is not a Slice 5 regression.
- Normal RAG p95 latency warning remains (`8294ms` vs `8000ms`), not caused by this slice.

## Phase Decision

Slice 5 is acceptable for Faz 7 because it improves structured renderer presentation without widening scope or introducing data-specific literals. Continue Faz 7 with the next narrow answer intelligence slice.
