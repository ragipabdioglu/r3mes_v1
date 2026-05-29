# Phase 5 Report - Source Resolution Decision Diagnostics

Date: 2026-05-29
Phase: Faz 5 - Query / Source Intelligence
Slice: Source resolution decision diagnostics

## Summary

This slice added a structured `decisionDiagnostics` contract to `SourceResolutionPlan`. The goal is to make source selection explainable from the query/source side without changing retrieval scoring, answer composition, safety behavior, parser behavior, or public response shape.

## What Changed

- `SourceResolutionPlan` now includes `decisionDiagnostics`.
- Diagnostics summarize query contract fields used by source resolution:
  - operation
  - required evidence type
  - output format
  - source-only flag
  - requested field count
  - query shape and clarity score
  - retrieval intent and query confidence
- Diagnostics also summarize source-resolution inputs and outputs:
  - profile-ranked candidate count
  - accessible collection count
  - explicit requested collection count
  - include-public flag
  - low-confidence guard state
  - source-discovery intent
  - selected/candidate/rejected counts
  - selection reason
  - warnings
- `summarizeSourceResolutionPlan` now carries the same diagnostics for debug/eval trace consumption.

## What Did Not Change

- Retrieval scoring did not change.
- Reranker provider did not change.
- Composer / answer generation did not change.
- Safety behavior did not change.
- Parser, chunking, Qdrant schema, and reindex behavior did not change.
- Public response contract did not change.
- No data-specific literal was added to core logic.

## Changed Files

- `apps/backend-api/src/lib/sourceResolutionPlan.ts`
- `apps/backend-api/src/sourceResolutionPlan.test.ts`

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm exec vitest run src/sourceResolutionPlan.test.ts` | 0 | pass | 7/7 source-resolution tests pass. |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck clean. |
| `pnpm exec vitest run src/sourceResolutionPlan.test.ts src/lib/knowledgeAccess.test.ts src/lib/retrievalQualityContracts.test.ts` | 0 | pass | 45/45 tests pass. |
| `pnpm exec tsc -p tsconfig.json` | 0 | pass | Backend build updated. |
| `pnpm run smoke:bge-m3-provider` | 0 | pass | BGE-M3 provider, dimension 1024, fallback false. |
| `pnpm run smoke:reranker-provider` | 0 | pass | Cross-encoder provider, fallback false. |
| `pnpm run eval:retrieval-quality` | 0 | pass | 16/16, provider fallback 0. |
| `pnpm run eval:collection-suggestion` | 0 | pass | 5/5, final rerun provider fallback 0. |
| `pnpm run eval:ui-reality` | 0 | pass with warning | 5/5, but CPU reranker fallback/latency warning remains in auto-private case. |

## Runtime Notes

- Docker Desktop and R3MES containers were restarted for this verification.
- AI engine was restarted in LoRA-free CPU BGE-M3/reranker mode.
- First BGE smoke failed during cold start; after AI engine restart with logs, BGE-M3 smoke passed with fallback false.
- Parallel eval execution caused reranker timeout/fallback; final accepted evals were run serially.

## Risks / Backlog

- CPU reranker latency can still exceed UI-reality latency budgets and trigger fallback in the auto-private deep RAG case.
- This belongs to Faz 6 Adaptive Pipeline / Latency and provider-budget hardening, not this diagnostics slice.
- `decisionDiagnostics` is internal/debug/eval only; public response must continue to hide it.

## Decision

This Faz 5 slice is complete. It improves traceability of Query / Source Intelligence decisions and keeps behavior unchanged. Continue Faz 5 with the next bounded source/profile decision slice before moving to Faz 6.
