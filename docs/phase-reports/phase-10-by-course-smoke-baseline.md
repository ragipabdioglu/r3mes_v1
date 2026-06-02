# Phase 10 Slice 4 - B.Y Course PDF Smoke Baseline

Generated: 2026-06-02

## Phase

- Current phase: Phase 10 - Real Data Certification
- Slice: B.Y course PDF smoke baseline
- Scope: convert user-observed bad UI answers into a repeatable real-data smoke eval.

## What Changed

- Added `infrastructure/evals/by-course-smoke/golden.jsonl`.
- Added `eval:by-course-smoke` script to `@r3mes/backend-api`.
- Activated the B.Y dataset manifest suite.
- The manifest validator now passes with zero warnings because both B.Y and G.P planned suites have fixture paths.

## Fixture Shape

The B.Y smoke suite has 12 cases across:

- definition extraction
- list extraction
- comparison extraction
- no-source
- format following
- summarization

Each case uses:

- `evidenceExpectations` for source/context/evidence sufficiency
- `qualityExpectations` for final answer completeness, format, and template pollution

Dataset-specific terms are limited to eval fixtures and manifests. Runtime logic was not changed.

## Validation Results

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| JSONL parse smoke | 0 | pass | 12 cases parse successfully. |
| `pnpm --filter @r3mes/backend-api run eval:real-data-manifests` | 0 | pass | 4 manifests valid, 0 failures, 0 warnings. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck passed. |
| `pnpm --filter @r3mes/backend-api run eval:by-course-smoke` | 1 | fail baseline | 1/12 passed; strict real-data baseline is red. |

## B.Y Smoke Result

- Total: 12
- Passed: 1
- Failed: 11
- Pass rate: 0.083
- Runtime lineage coverage: 1.0
- Qwen call ratio: 0
- Validator call ratio: 0
- Embedding fallback ratio: 0
- Reranker fallback ratio: 0.75
- Quality fallback ratio: 0.75

## Failure Map

| Category | Count / Rate | Meaning |
| --- | ---: | --- |
| provider fallback | 9 cases | Reranker fallback dominates strict failures. |
| evidence-only failed | 2 cases | Some questions fail before answer generation. |
| answer-quality failed | 7 cases | Evidence exists but output is incomplete, overlong, or wrong format. |
| composer/model generation diagnosis | 6 cases | Evidence passed, final answer failed. |
| retrieval/evidence diagnosis | 2 cases | Evidence-only failed. |
| safety/presentation diagnosis | 1 case | Big Data 5V bullet case hit safety/presentation failure. |
| answer path `rag_fast_path` | 10 cases | Qwen bypassed, deterministic/planned fallback dominates. |
| answer path `no_source_fallback` | 2 cases | Some selected-source questions fell into no-source. |

## Important Findings

- User-observed B.Y failures are now reproducible.
- The system often retrieves some evidence, but answer quality remains weak because planned fallback/template composition dominates.
- Reranker fallback is again a major strict blocker.
- No-source behavior still needs cleaner evidence/not-supported wording.
- Big Data 5V list and format following remain product-visible failures.

## Public / Debug Boundary

- Runtime public response behavior was not changed.
- No debug payload, provider detail, Qdrant payload, internal score, or raw vector was introduced into public response by this slice.

## Backlog Routing

- Phase 3/4: reranker fallback/provider stability.
- Phase 4/6: evidence-only failures and context/source sufficiency.
- Phase 7: answer-format, template fallback, answer-too-long, and structured renderer quality.
- Phase 10: connect B.Y/G.P/KAP suite summaries into the aggregate certification report.

## Next Step

Extend `eval:real-data-certification` so it reads manifest-linked active suites and reports KAP, G.P, B.Y, and synthetic suite status together. This should make Phase 10 the single release certification entry point.

