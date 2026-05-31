# Phase 5 Report - Source Resolution Risk Diagnostics

Date: 2026-05-31
Phase: Faz 5 - Query / Source Intelligence
Slice: Auto-source and low-confidence source decision diagnostics
Status: Completed

## Scope

This slice strengthened source-resolution observability without changing retrieval scoring, composer behavior, parser behavior, safety policy, UI layout, or provider architecture.

## Changed Files

- `apps/backend-api/src/lib/sourceResolutionPlan.ts`
- `apps/backend-api/src/sourceResolutionPlan.test.ts`

## Contract Changes

`SourceResolutionDecisionDiagnostics` now includes:

- `autoSelectionScope`
- `topCandidateScore`
- `secondCandidateScore`
- `topCandidateScoreGap`
- `riskSignals`

New internal diagnostic enums:

- `SourceResolutionAutoSelectionScope`
- `SourceResolutionRiskSignal`

These diagnostics are internal/debug/eval-facing. Public response shape was not changed.

## Why

Faz 5 needs to distinguish safe profile-ranked source selection from broad or risky automatic source behavior. Before this slice, trace could show mode and warnings, but it did not clearly answer:

- Was this an explicit selection, single private auto-scope, broad include-public selection, or low-confidence broad legacy selection?
- Were top candidates ambiguous?
- Did profile scoring miss a collection and fall back to metadata/token scoring?
- Did low-confidence guard block broad auto-selection?

## Implementation Notes

- Added `autoSelectionScope` to classify the source-resolution scope.
- Added top/second candidate scores and score gap to make ambiguity measurable.
- Added structured `riskSignals` for:
  - `low_confidence_source_resolution`
  - `low_confidence_guard_enforced`
  - `legacy_broad_auto_selection`
  - `ambiguous_top_candidates`
  - `include_public_broad_scope`
  - `single_private_auto_scope`
  - `fallback_profile_score_missing`
  - and existing no-query / source-discovery / inaccessible-source conditions.
- No data-specific literals were added to core logic.
- Router remains weak signal only.

## Verification

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm exec vitest run src/sourceResolutionPlan.test.ts src/lib/knowledgeAccess.test.ts src/lib/retrievalQualityContracts.test.ts` | 0 | Pass | 46 tests passed |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm exec tsc -p tsconfig.json` | 0 | Pass | Backend dist rebuilt |
| backend restart + `/health` + `/ready/rag-runtime` | 0 | Pass | Runtime readiness pass |
| `pnpm run smoke:bge-m3-provider` | 0 | Pass | BGE-M3 provider, 1024 dim, fallback false |
| `pnpm run smoke:reranker-provider` | 0 | Pass | Cross-encoder provider, fallback false |
| `pnpm run eval:retrieval-quality` | 0 | Pass | 16/16, embedding/reranker fallback 0 |
| `pnpm run eval:collection-suggestion` | 0 | Pass | 5/5, fallback 0 |
| `pnpm run eval:ui-reality` | 0 | Pass with warning | 5/5; local CPU reranker fallback ratio 0.2 in UI-reality guardrail |

## Runtime / System Status

- Backend: running
- AI-engine: running
- Postgres: healthy
- Redis: healthy
- Qdrant: healthy
- `/ready/rag-runtime`: pass

Docker Desktop initially returned engine API 500 and storage ports were down. A non-destructive WSL/Docker runtime restart fixed the local daemon; no volumes or data were reset.

## Risks / Backlog

- UI-reality still shows local CPU reranker latency/fallback warning in one case. This remains a Faz 6 Adaptive Pipeline / Latency and provider-budget backlog item.
- `HIGH_CONFIDENCE` / `LOW_CONFIDENCE` thresholds still live in `sourceResolutionPlan.ts`; later decision-config registry work should centralize these if Faz 11 cleanup requires it.

## Acceptance

Accepted for Faz 5 continuation. The slice improves decision traceability and does not change public response shape or answer-generation behavior.
