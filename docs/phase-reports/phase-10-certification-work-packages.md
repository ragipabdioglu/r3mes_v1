# Phase 10 Slice 6 - Certification Work Packages

Generated: 2026-06-02

## Phase

- Current phase: Phase 10 - Real Data Certification
- Slice: certification backlog work packages
- Scope: turn 73 certification backlog items into prioritized closure packages with owner phase and acceptance gates.

## What Changed

- `eval:real-data-certification` now emits `workPackages` and `workPackageCounts`.
- Work packages are grouped from `layerFamily`, owner phase, active dataset suites, provider strict failures, and backlog items.
- The existing release gate and dataset suite rollup behavior is preserved.
- Runtime behavior was not changed.

## Current Output

- Release gate: `fail`
- Certification backlog: 73
- Blockers: 72
- Work packages: 6
- Blocker packages: 5
- Warning-only packages: 1

## Work Package Order

| Priority | Package | Owner phase | Items | Blockers | Affected suites |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | `wp-provider-runtime-strict` | Phase 3 | 41 | 41 | B.Y, G.P, real-world-stress, realistic-rag, ui-reality |
| 2 | `wp-evidence-coverage` | Phase 6 | 17 | 17 | G.P, grounded-response, education-basic, multi-domain-basic |
| 3 | `wp-structured-table-evidence` | Phase 6 | 2 | 2 | KAP pilot |
| 4 | `wp-retrieval-quality` | Phase 4 | 3 | 3 | G.P, real-world-stress |
| 5 | `wp-answer-safety-presentation` | Phase 7 | 9 | 9 | B.Y, context-pruning, KAP pilot |
| 6 | `wp-certification-triage` | Phase 10 | 1 | 0 | residual warning triage |

## Why This Order

1. Provider/runtime fallback must be fixed first because strict fallback makes later evidence/answer conclusions noisy.
2. Evidence coverage comes next because answer improvements are not meaningful if context/facts are missing.
3. Structured table evidence is separated because KAP numeric/table failures need field-level proof, not generic text tuning.
4. Retrieval wrong source/chunk is next after provider stability, so candidate and rerank diagnostics are trustworthy.
5. Answer safety/presentation comes after evidence is reliable; otherwise it may mask upstream failures.
6. Certification triage is last because it should shrink as owner-phase packages close.

## Acceptance Gates Added To Report

Each package now carries acceptance gates. Examples:

- Provider/runtime: `qualityFallbackRatio = 0`, `rerankerFallbackRatio = 0`, `providerStrictFailures = 0`.
- Evidence coverage: evidence-only failures must be routed to retrieval, artifact, or evidence compiler.
- Structured table evidence: KAP numeric/table blockers must expose structured facts or explicit missing-field diagnostics.
- Retrieval: wrong source/chunk blockers must have candidate, rerank, and alignment diagnosis.
- Answer presentation: template pollution and unnecessary warnings must disappear from B.Y/G.P smoke.

## Validation Results

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | pass command / fail gate | Report generation passed; release gate remains fail. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck passed. |

## Public / Debug Boundary

- Runtime public response behavior was not changed.
- This slice only classifies eval artifacts and dataset manifests.
- No provider detail, retrieval trace, Qdrant payload, score, or raw diagnostic is exposed to public chat responses.

## Decision

Phase 10 now tells us not only that release certification fails, but what closure package should be handled first. The immediate next implementation target should be `wp-provider-runtime-strict`.

