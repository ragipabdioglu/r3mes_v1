# Phase 10 Slice 2 - Dataset Manifest Protocol

Generated: 2026-06-02

## Phase

- Current phase: Phase 10 - Real Data Certification
- Slice: Dataset manifest protocol
- Scope: define which real/synthetic datasets are part of certification and validate that active datasets/eval suites are traceable.

## What Changed

- Added dataset manifests under `infrastructure/evals/real-data-certification/datasets`.
- Added `eval:real-data-manifests` to `@r3mes/backend-api`.
- Added `validate-real-data-manifests.mjs` to validate real-data certification inputs before broader Phase 10 eval expansion.
- Generated machine-readable and markdown manifest reports under `artifacts/evals/real-data-certification`.

## Dataset Manifests

| Dataset | Type | Documents | Status | Notes |
| --- | --- | ---: | --- | --- |
| `kap-pilot` | real documents | 30/30 | active | KAP numeric/table/company grounding suites are active. |
| `by-course-pdfs` | real documents | 7/7 | warn | B.Y eval suite is planned; fixture path is not created yet. |
| `gp-visual-programming` | real documents | 10/10 | warn | G.P smoke suite is planned; fixture path is not created yet. |
| `synthetic-stress-evals` | synthetic eval | 0/0 | active | Existing stress/grounded/context/ui suites are active. |

## Contract

`DatasetManifest.v1` is represented as JSON manifest files, not runtime code. It captures:

- dataset identity and status
- dataset type and privacy class
- source path and expected document count for real-document datasets
- expected artifact capabilities
- certification buckets
- linked eval suites and their active/planned status

This contract is intentionally outside core runtime logic. Data-specific names such as KAP, B.Y, and G.P are allowed here because manifests are certification fixtures, not product decision code.

## Validation Result

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api run eval:real-data-manifests` | 0 | warn | 4 manifests valid, 0 failures, 2 warnings for planned eval suite paths. |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass | Shared types build passed. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck passed. |

## Public / Debug Boundary

- Runtime public response shape is unchanged.
- No parser, retrieval, evidence, composer, safety, provider, Qdrant, or UI runtime behavior changed.
- Provider details, internal scores, raw vectors, and diagnostics are not introduced into public payloads by this slice.

## Warnings

- `by-course-pdfs` has a planned eval suite with no fixture file yet.
- `gp-visual-programming` has a planned eval suite with no fixture file yet.

These are not blockers for Slice 2 because the purpose here is dataset certification inventory. They become implementation work inside later Phase 10 eval expansion slices.

## Next Step

Build the first real-data certification smoke fixtures from the active/planned dataset manifests without adding data-specific literals to runtime code. The next slice should create eval fixtures and metrics for B.Y/G.P/KAP coverage, then connect them to the release certification report.

