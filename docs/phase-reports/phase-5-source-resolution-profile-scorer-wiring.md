# Phase 5 Report - Source Resolution Profile Scorer Wiring

Date: 2026-05-28

## Scope

Faz 5 Query / Source Intelligence kapsamında `SourceResolutionPlan` artık chat runtime'da metadata/profile scorer adaylarıyla besleniyor. Amaç router'ı final karar verici yapmadan, source resolution kararını profile scoring sinyaline yaklaştırmak.

## Changed Files

- `apps/backend-api/src/routes/chatProxy.ts`
- `apps/backend-api/src/lib/sourceResolutionPlan.ts`
- `apps/backend-api/src/sourceResolutionPlan.test.ts`

## Contract / Behavior

- `rankMetadataRouteCandidates` sonucu `SourceResolutionRankedCandidate` contract'ına map edildi.
- `source_resolution_plan` debug trace'e `profileRankedCandidateCount` eklendi.
- `rankedAccessibleCandidates` artık sadece skorlanmış adayları döndürmüyor; erişilebilir ama scorer tarafından gelmeyen collection'ları fallback candidate olarak görünür tutuyor.
- Fallback reason: `fallback_profile_score_missing`.
- Public response contract değişmedi; internal scoring ve provider detail public payload'a eklenmedi.

## What Did Not Change

- Retrieval scoring değiştirilmedi.
- Reranker provider değiştirilmedi.
- Composer / answer generation değiştirilmedi.
- Safety behavior değiştirilmedi.
- Parser, chunking, Qdrant schema, reindex behavior değiştirilmedi.
- Veri özel literal eklenmedi.

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass | Shared contracts compile. |
| `pnpm exec vitest run src/sourceResolutionPlan.test.ts src/lib/knowledgeAccess.test.ts` | 0 | pass | 32/32 tests pass. |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck clean. |
| `pnpm run smoke:bge-m3-provider` | 0 | pass | BGE-M3 real provider, dimension 1024, fallback false. |
| `pnpm run smoke:reranker-provider` | 0 | pass | Cross-encoder provider, fallback false. |
| `pnpm run eval:collection-suggestion` | 0 | pass | 5/5, qualityFallbackRatio 0. |
| `pnpm run eval:retrieval-quality` | 0 | pass | 16/16, embedding/reranker/qdrant fallback 0. |
| `pnpm run eval:ui-reality` | 0 | pass | 5/5, public/debug boundary cases pass. |

## Provider / Runtime Notes

- Qdrant, Redis, Postgres were verified healthy before final evals.
- Ai-engine was restarted without LoRA and with CPU embedding/reranker mode for stable local verification.
- BGE-M3 CPU smoke took about 48s on first load; reranker first smoke took about 45s, then eval latency normalized after warmup.
- Earlier failures were infrastructure/provider fallback noise, not accepted as phase evidence.

## Remaining Risks / Backlog

- Reranker CPU cold start remains slow; this belongs to provider/runtime performance hardening, not this source resolution slice.
- `metadataCandidateCoverage` is intentionally partial in selected-collection evals because explicit selection limits candidate exploration.
- Query/source intelligence still needs next Faz 5 slices: query contract strengthening, profile scorer diagnostics, source resolution decision report, and UI/eval parity around auto-source decisions.

## Decision

This Faz 5 slice is complete. It can be committed and pushed. Continue Faz 5 with the next bounded Query / Source Intelligence slice; do not move to Faz 6 yet.
