# Phase 10 Real Data Certification Backlog

Generated: 2026-06-02

## Phase

Phase 10 - Real Data Certification.

## Scope

This slice starts Phase 10 by converting the latest full production RAG gate output into a reproducible real-data certification report.

No runtime behavior changed. No retrieval, evidence, composer, safety, parser, UI, provider, Qdrant, or feedback-learning behavior was modified.

## Contract Added

`RealDataCertificationReport.v1`

Output paths:

- `artifacts/evals/real-data-certification/latest.json`
- `artifacts/evals/real-data-certification/latest.md`

The report includes:

- production aggregate status,
- release gate decision,
- certification backlog item list,
- release severity,
- owner phase,
- layer family,
- failure classes/subtypes,
- next action per blocker.

## Implementation

Added `apps/backend-api/scripts/analyze-real-data-certification.mjs`.

Added package script:

```bash
pnpm --filter @r3mes/backend-api run eval:real-data-certification
```

The script reads `artifacts/evals/production-rag/feedback-gate.json` by default and classifies existing production failures. It does not execute chat, mutate data, or change runtime decisions.

## Latest Certification Result

- Release gate decision: `fail`
- Production status: `fail`
- Total cases: 185
- Passed: 166
- Failed: 19
- Runtime lineage coverage: 1.0
- Quality fallback ratio: 0.027
- Certification backlog items: 16
- Blockers: 15
- Warnings: 1

Owner phase distribution:

- Phase 6 - Full Evidence Intelligence: 9
- Phase 7 - Full Answer Intelligence: 4
- Phase 4 - Retrieval Quality: 1
- Phase 3 - Storage / Embedding / Index Backbone: 1
- Phase 10 - Real Data Certification: 1

Layer family distribution:

- context-evidence-coverage: 8
- safety-presentation: 4
- structured-evidence-table: 1
- retrieval: 1
- provider-runtime: 1
- certification-triage: 1

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | Pass | Generated JSON and markdown certification report |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm --filter @r3mes/shared-types run build` | 0 | Pass | Shared contracts build clean |

## Interpretation

Phase 10 has now turned the Phase 9 full-gate production failures into an explicit certification backlog. The report shows that most remaining blockers are not feedback-loop issues. They are concentrated around evidence/context coverage, safety/presentation behavior, one retrieval case, and one provider/runtime fallback case.

## Next Step

Phase 10 Slice 2 should add dataset manifest protocol and connect KAP/G.P/B.Y/dirty/OCR/table/code/no-source sets to the certification report. The current report is based on the existing production aggregate output only.
