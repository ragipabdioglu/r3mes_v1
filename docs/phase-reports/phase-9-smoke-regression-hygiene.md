# Phase 9 Smoke Regression Hygiene Closure

Generated: 2026-06-02

## Scope

Phase 9 remains Feedback / Controlled Learning. This slice closed the Phase 9 closure blocker where lifecycle smoke feedback polluted production feedback regression gates.

No retrieval, composer, parser, safety, UI layout, embedding, reranker, Qdrant reset, or runtime answer behavior was changed.

## Root Cause

`smoke:feedback-lifecycle` created `GOOD_SOURCE` feedback rows with artificial queries such as `feedback lifecycle smoke ...`.

Those rows were valid for lifecycle mechanics, but `generate-feedback-regression-eval.mjs` treated them as production feedback-derived regression cases. The resulting eval cases asked RAG to answer artificial smoke strings and correctly fell into no-source/suggest, producing `retrieval_quality/wrong_source` failures.

A second gate issue existed in beta feedback fixture generation: beta fixture expected collections were derived from runtime suggested collections instead of the golden eval expectations. That could create self-contradictory feedback regression expectations.

## Changes

- Added an explicit regression-exclusion policy for lifecycle smoke feedback.
- Marked new lifecycle smoke feedback metadata with `regressionExcluded: true`.
- Excluded existing lifecycle-smoke feedback from generated production feedback regression cases using metadata and query-shape detection.
- Excluded approved proposals tied to regression-excluded smoke feedback from feedback-case coverage counts.
- Updated beta feedback fixture generation to use `golden.expectedSuggestedCollectionIds` as truth before falling back to observed runtime suggestions.

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm run local:status` | 0 | Pass | backend-api, dApp, ai-engine, Qdrant, ipfs gateway OK; LoRA unavailable by accepted runtime condition |
| `pnpm --filter @r3mes/backend-api run eval:generate-feedback-regression` | 0 | Pass | 7 DB rows inspected, 0 cases generated, 5 lifecycle smoke rows skipped |
| `pnpm --filter @r3mes/backend-api exec vitest run src/feedbackRoutes.test.ts src/lib/chatResponseBoundary.test.ts src/lib/chatDebugBoundary.test.ts` | 0 | Pass | 28 focused feedback/boundary tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm --filter @r3mes/backend-api run eval:feedback-gate -- --quick --skip-production-rag --timeout-ms 120000` | 0 | Pass | Feedback gate OK; beta feedback regression 5/5; rag quality and collection suggestion checks passed |

## Gate Evidence

- Database feedback regression: skipped lifecycle-smoke rows are reported as `regression_excluded_smoke_feedback`.
- `regressionExcludedApprovedCount`: 4 approved smoke-linked proposals excluded from production coverage counts.
- `approvedProposalCount`: 0 production-approved proposals requiring regression coverage.
- Beta feedback regression: 5/5 passed after fixture expected collection truth switched to golden expectations.
- Public/debug boundary remained unchanged.

## Remaining Risks

- Full production RAG gate was intentionally skipped by the quick closure command and remains part of the normal phase/release gate.
- Current local runtime still has LoRA unavailable, which is accepted for the current no-LoRA run condition.
- Existing DB has smoke feedback/proposals from prior lifecycle runs; they are now classified and excluded rather than deleted.

## Phase 9 Decision

Phase 9 closure blocker from smoke feedback pollution is closed.

Phase 9 can proceed to final closure verification with the full gate set when requested. If full production gate is required, run the non-quick feedback gate or the full production RAG suite.
