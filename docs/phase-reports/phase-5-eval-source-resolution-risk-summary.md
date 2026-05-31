# Phase 5 Report - Eval Source Resolution Risk Summary

Date: 2026-05-31
Phase: Faz 5 - Query / Source Intelligence
Slice: Eval summary support for source-resolution risk diagnostics
Status: Completed

## Scope

This slice connects the existing source-resolution risk diagnostics to grounded eval summaries. It does not change runtime source selection, retrieval scoring, composer behavior, parser behavior, safety policy, UI layout, or provider architecture.

## Changed Files

- `apps/backend-api/scripts/run-grounded-response-eval.mjs`
- `docs/phase-reports/phase-5-eval-source-resolution-risk-summary.md`
- `docs/agents/project-memory.md`

## Contract / Eval Output Changes

Eval result rows now capture:

- `sourceResolutionAutoSelectionScope`
- `sourceResolutionRiskSignals`
- `sourceResolutionTopCandidateScore`
- `sourceResolutionSecondCandidateScore`
- `sourceResolutionTopCandidateScoreGap`
- `sourceResolutionSelectionReason`

Eval summary now exposes `routerQuality.sourceResolution` with:

- `modes`
- `autoSelectionScopes`
- `selectionReasons`
- `riskSignals`
- `casesWithRiskSignals`
- `riskSignalRatio`
- `averageTopCandidateScore`
- `averageTopCandidateScoreGap`
- `broadAutoSelectionCases`
- `includePublicBroadScopeCases`

## Why

Faz 5 closure needs to measure whether source resolution is explicit, profile-ranked, broad include-public, low-confidence broad, or needs-user-scope. Before this slice, these signals existed in debug trace but were not aggregated into eval reports.

## Verification

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `node --check scripts/run-grounded-response-eval.mjs` | 0 | Pass | Eval runner syntax valid |
| `pnpm exec vitest run src/sourceResolutionPlan.test.ts src/lib/knowledgeAccess.test.ts src/lib/retrievalQualityContracts.test.ts` | 0 | Pass | 46 tests passed |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm run eval:collection-suggestion` | 0 | Pass | 5/5; `routerQuality.sourceResolution` populated |
| `pnpm run eval:retrieval-quality` | 0 | Pass | 16/16; fallback 0 |
| `pnpm run eval:ui-reality` | 0 | Pass with warning | 5/5; source-resolution risk summary detected `fallback_profile_score_missing` in one auto-private case |

## Observed Eval Signals

- `collection-suggestion`: source resolution was explicit in 5/5 cases; risk ratio 0.
- `retrieval-quality`: source resolution was explicit in 16/16 cases; risk ratio 0.
- `ui-reality`: source resolution included one `auto_private_ranked` case with `fallback_profile_score_missing`; risk ratio 0.2.

## Public / Debug Boundary

This slice only changes eval artifacts and summary output. Public chat response shape is unchanged. Source-resolution risk diagnostics remain debug/eval-facing.

## Risks / Backlog

- UI-reality still shows local CPU reranker fallback/latency warning. This remains Faz 6 Adaptive Pipeline / Latency backlog.
- Broad auto-source risk now becomes visible in eval summaries; future Faz 5 closure can decide whether additional source-scope guard tests are required.

## Acceptance

Accepted for Faz 5 continuation. The eval layer can now quantify source-resolution risk behavior across suites.
