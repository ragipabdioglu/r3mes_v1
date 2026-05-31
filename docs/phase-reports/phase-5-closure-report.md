# Phase 5 Closure Report - Query / Source Intelligence

Date: 2026-05-31
Phase: Faz 5 - Query / Source Intelligence
Status: Completed
Next Phase: Faz 6 - Full Evidence Intelligence

## Goal

Faz 5 aimed to make query intent, weak router signals, source resolution, profile scoring, and source suggestions measurable and product-safe before moving deeper into evidence intelligence.

## Completed Work

- QueryContract is produced and consumed by downstream planning.
- Router is explicitly weak-signal oriented; tests assert `routeHints.authority = weak`.
- Requested field detection was generalized and no longer depends on data-specific aliases in core logic.
- Source resolution now receives profile/metadata ranked candidates.
- Source resolution produces decision diagnostics:
  - `selectionReason`
  - `autoSelectionScope`
  - `topCandidateScore`
  - `secondCandidateScore`
  - `topCandidateScoreGap`
  - `riskSignals`
- Eval summaries now aggregate source-resolution risk under `routerQuality.sourceResolution`.
- UI-reality eval now asserts source-resolution diagnostics in debug trace.
- Public/debug boundary remained intact.

## Phase Commits

- `18f01e9` - Prioritize structured metadata suggestions
- `d142a77` - Wire source resolution to profile scoring
- `2e2f3fd` - Generalize requested field detection
- `4753f4b` - Add source resolution decision diagnostics
- `c725433` - Add source resolution risk diagnostics
- `b3443d8` - Summarize source resolution risks in evals
- `3d42caa` - Assert source resolution diagnostics in UI eval

## Changed Contract Surface

- Query understanding now produces a richer query contract path.
- Source resolution has structured diagnostics and risk signals.
- Eval runner exposes source-resolution mode/scope/reason/risk summary.
- UI-reality fixtures assert the diagnostics that matter for closure.

## Verification

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `/ready/rag-runtime` | 0 | Pass | DB, Redis, Qdrant, AI-engine checks pass |
| `pnpm exec vitest run src/lib/queryUnderstanding.test.ts src/lib/queryRouter.test.ts src/sourceResolutionPlan.test.ts src/lib/knowledgeAccess.test.ts src/lib/retrievalQualityContracts.test.ts` | 0 | Pass | 71 tests passed |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `node --check scripts/run-grounded-response-eval.mjs` | 0 | Pass | Eval runner syntax valid |
| `pnpm run smoke:bge-m3-provider` | 0 | Pass | BGE-M3 provider, fallback false |
| `pnpm run smoke:reranker-provider` | 0 | Pass | Cross-encoder provider, fallback false |
| `pnpm run eval:collection-suggestion` | 0 | Pass | 5/5, fallback 0 |
| `pnpm run eval:retrieval-quality` | 0 | Pass | 16/16, fallback 0 |
| `pnpm run eval:ui-reality` | 0 | Pass with warning | 5/5; local CPU reranker warning remains |

## Eval Signals

- Collection suggestion: 5/5, explicit source resolution in all cases, risk ratio 0.
- Retrieval quality: 16/16, explicit source resolution in all cases, risk ratio 0.
- UI reality: 5/5, one auto-private ranked source case with `fallback_profile_score_missing`, risk ratio 0.2.

## Public / Debug Boundary

- Debug-off UI-reality cases passed.
- Internal diagnostics remain debug/eval-facing.
- Public response shape was not changed by Faz 5.

## Blockers

None for Faz 5.

## Warnings / Backlog

- UI-reality still shows local CPU reranker fallback/latency warning:
  - `quality_fallback_ratio = 0.2`
  - `reranker_fallback_ratio = 0.333`
- This is not a Faz 5 query/source blocker. It belongs to Faz 6 / adaptive pipeline and provider-budget work.
- Existing evidence gaps such as numeric/definition evidence coverage remain Faz 6 evidence intelligence work.

## Stop Condition Check

- Query contract exists and is consumed: pass.
- Greeting/conversation path is covered by UI-reality public boundary case: pass.
- Router weak-signal behavior covered by tests: pass.
- Source resolution private/public boundary not weakened: pass.
- Profile scoring feeds source resolution: pass.
- Source suggestion profile-driven eval passes: pass.
- Public/debug boundary passes: pass.
- Data-specific literals were not added to Faz 5 core logic: pass.

## Closure Decision

Faz 5 is complete. Faz 6 can start.
