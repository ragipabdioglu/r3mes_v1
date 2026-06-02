# Phase 10 Slice 5 - Manifest-linked Certification Rollup

Generated: 2026-06-02

## Phase

- Current phase: Phase 10 - Real Data Certification
- Slice: manifest-linked certification rollup
- Scope: make real-data certification read active dataset manifests and summarize their latest eval artifacts in one release report.

## What Changed

- Upgraded `RealDataCertificationReport` from `v1` to `v2`.
- `eval:real-data-certification` now reads active dataset manifests from `infrastructure/evals/real-data-certification/datasets`.
- Active suite artifacts are loaded from `artifacts/evals/<suiteId>/latest.json`.
- The report now includes `datasets`, `datasetSuites`, and `datasetSuiteCounts`.
- Existing production aggregate classification is preserved.

## Contract Change

`RealDataCertificationReport.v2` adds:

- `manifestDir`
- `datasets`
- `datasetSuites`
- `datasetSuiteCounts`

Each dataset suite rollup includes:

- dataset id/name/type/privacy
- suite id/path/artifact path
- artifact existence
- status/total/passed/failed/pass rate
- release severity
- runtime lineage coverage
- quality fallback ratio
- reranker fallback ratio
- qwen call ratio
- answer path distribution
- failure classes/subtypes
- phase diagnosis classes
- blocker/provider strict failure counts

## Validation Results

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | fail report generated | Release gate is fail; report generation succeeded. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck passed. |
| `pnpm --filter @r3mes/backend-api run eval:real-data-manifests` | 0 | pass | 4 manifests valid, 0 failures, 0 warnings. |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass | Shared types build passed. |

## Current Certification Output

- Schema: `RealDataCertificationReport.v2`
- Release gate: `fail`
- Production aggregate: 185 total, 166 passed, 19 failed
- Certification backlog: 73
- Blockers: 72
- Warnings: 1
- Active dataset suites: 8
- Suite blockers: 8
- Missing suite artifacts: 0

## Active Dataset Suites

| Dataset | Suite | Result | Severity | Quality fallback | Reranker fallback |
| --- | --- | ---: | --- | ---: | ---: |
| B.Y course PDFs | `by-course-smoke` | 1/12 | blocker | 0.75 | 0.75 |
| G.P visual programming | `gp-visual-programming-smoke` | 0/15 | blocker | 0.733 | 0.786 |
| KAP pilot | `kap-pilot` | 14/18 | blocker | 0 | 0 |
| KAP pilot | `answer-quality` | 17/17 | blocker | 0 | 0 |
| synthetic stress | `real-world-stress` | 18/22 | blocker | 0.091 | 0 |
| synthetic stress | `grounded-response` | 24/30 | blocker | 0 | 0 |
| synthetic stress | `context-pruning` | 4/5 | blocker | 0 | 0 |
| synthetic stress | `ui-reality` | 5/5 | blocker | 0.2 | 0.333 |

Note: a suite can pass cases but remain a blocker because strict guardrails fail, for example provider fallback or latency.

## Owner Phase Summary

- Phase 3 - Storage / Embedding / Index Backbone: 41
- Phase 6 - Full Evidence Intelligence: 19
- Phase 7 - Full Answer Intelligence: 9
- Phase 4 - Retrieval Quality: 3
- Phase 10 - Real Data Certification: 1

## Public / Debug Boundary

- Runtime public response behavior was not changed.
- This slice only reads eval artifacts and dataset manifests.
- No provider detail, retrieval trace, Qdrant payload, score, or raw diagnostic is exposed to public chat responses.

## Decision

Phase 10 now has a single release-certification entry point that includes production aggregate plus active real-data datasets. The report is correctly red. Do not force green in this phase; route blockers to their owner phases.

## Next Step

Use the new rollup to prioritize closure work. The highest immediate blockers are provider/runtime fallback and answer/evidence quality on B.Y and G.P real-data suites.

