# Phase 10 WP0 - Certification Refresh / Baseline Freeze

Date: 2026-06-12

## Scope

WP0 refreshed the current certification baseline without changing runtime logic. No parser, retrieval, evidence, composer, safety, UI, provider, Qdrant, LoRA, or data-specific core logic was modified.

## Commands

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm local:status` | 0 | backend-api, dApp, ai-engine, Qdrant, Postgres/Redis/IPFS healthy; llama false; LoRA unavailable |
| `pnpm --filter @r3mes/backend-api run eval:real-data-manifests` | 0 | pass; 4 manifests, 0 failures, 0 warnings |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | expected red gate; 14/15 pass |
| `pnpm --filter @r3mes/backend-api run eval:by-course-smoke` | 1 | expected red gate; 6/12 pass |
| `pnpm --filter @r3mes/backend-api run eval:production-rag` | 1 | expected red gate; release aggregate fail |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | certification rollup generated |
| `pnpm --filter @r3mes/backend-api run eval:readiness-baseline` | 0 | baseline generated; status has gaps |

## Updated Baseline

### Real Data Certification

- Release gate: `fail`
- Backlog items: 40
- Blockers: 39
- Warnings: 1

Owner phase distribution:

- Phase 7 - Full Answer Intelligence: 30
- Phase 4 - Retrieval Quality: 6
- Phase 6 - Full Evidence Intelligence: 2
- Phase 5 - Query / Source Intelligence: 1
- Phase 10 - Real Data Certification: 1

Layer family distribution:

- answer-presentation: 22
- safety-presentation: 8
- retrieval: 6
- context-evidence-coverage: 2
- query-source-intelligence: 1
- certification-triage: 1

### Production RAG Aggregate

- Status: `fail`
- Runtime lineage coverage: 1.0
- Quality fallback ratio: 0
- Provider strict failures: 0

Failure classes:

- retrieval_quality: 49
- boundary: 43
- safety: 30
- query_understanding: 14
- evidence_quality: 2
- answer_quality: 2

Failure subtypes:

- context_coverage_failure: 43
- wrong_chunk: 30
- safety: 24
- wrong_source: 15
- query_understanding: 14
- over_aggressive_no_source: 9
- wrong_chunk_within_correct_source: 5
- composer_failure: 2

### G.P Smoke

- Total: 15
- Passed: 14
- Failed: 1
- Pass rate: 0.933
- Runtime lineage coverage: 1.0
- Embedding fallback ratio: 0
- Reranker fallback ratio: 0
- Provider strict failures: 0

Remaining blocker:

- `gp_ders8_visual_layout_controls`
- Diagnosis: retrieval/evidence failure for visual/layout evidence coverage and source budget.
- Decision: do not force-pass with data-specific object names or composer hacks.

### B.Y Smoke

- Total: 12
- Passed: 6
- Failed: 6
- Pass rate: 0.5
- Runtime lineage coverage: 1.0
- Embedding fallback ratio: 0
- Reranker fallback ratio: 0
- Provider strict failures: 0

Key current blockers:

- `by_big_data_5v_list`
- `by_big_data_5v_bullets_format`

Main failure pattern: list/evidence coverage and answer presentation, not provider fallback.

## Closure Plan After Refresh

1. WP1 - Retrieval wrong-source / wrong-chunk closure.
2. WP2 - Query/source intelligence plus visual-layout triage.
3. WP3 - Safety presentation closure.
4. WP4 - Answer presentation/composer closure.
5. WP5 - Final certification/readiness regeneration.

## Decision

WP0 is complete. The current blocker surface is now refreshed and should be treated as the Phase 10 source of truth. Next correct implementation step is WP1, starting with retrieval-quality blockers, while keeping G.P visual-layout as a separate document-intelligence/evidence capability item rather than a data-specific patch.
