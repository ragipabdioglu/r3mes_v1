# Phase 5 Report - Source Resolution Trace Assertions

Date: 2026-05-31
Phase: Faz 5 - Query / Source Intelligence
Slice: UI-reality trace assertions for source-resolution diagnostics
Status: Completed

## Scope

This slice turns source-resolution diagnostics into regression-checked UI-reality expectations. It does not change runtime behavior, retrieval scoring, composer output, parser behavior, safety policy, provider architecture, or UI layout.

## Changed Files

- `infrastructure/evals/ui-reality/golden.jsonl`
- `docs/phase-reports/phase-5-source-resolution-trace-assertions.md`

## What Changed

Added explicit debug trace expectations for:

- auto-private source resolution mode
- source-resolution auto-selection scope
- source-resolution selection reason
- source-resolution risk signals
- explicit selected-collection source resolution

The UI-reality suite now fails if these Faz 5 diagnostics disappear from debug trace.

## Verification

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm run eval:ui-reality` | 0 | Pass with warning | 5/5; source-resolution trace assertions passed |
| `pnpm exec vitest run src/sourceResolutionPlan.test.ts src/lib/knowledgeAccess.test.ts src/lib/retrievalQualityContracts.test.ts` | 0 | Pass | 46 tests passed |

## Observed Signals

- `ui_reality_auto_private_normal_rag` asserted:
  - `sourceResolution.mode = auto_private_ranked`
  - `autoSelectionScope = ranked_private`
  - `selectionReason = profile_ranked_selection`
  - `riskSignals = [fallback_profile_score_missing]`
- `ui_reality_selected_collection_debug_on` asserted:
  - `sourceResolution.mode = explicit`
  - `autoSelectionScope = explicit`
  - `selectionReason = explicit_request`
  - `riskSignals = []`

## Public / Debug Boundary

Debug-off UI-reality cases still pass public boundary checks. These diagnostics are only asserted through debug/eval paths.

## Risk / Backlog

- UI-reality still has local CPU reranker fallback/latency warnings:
  - `quality_fallback_ratio = 0.2`
  - `reranker_fallback_ratio = 0.333`
  - one deep-rag p95 latency warning
- This is Faz 6 Adaptive Pipeline / Latency backlog, not a Faz 5 source-intelligence blocker.

## Acceptance

Accepted for Faz 5 closure preparation. The source-resolution diagnostics are now both produced and regression-checked in UI-shaped eval.
