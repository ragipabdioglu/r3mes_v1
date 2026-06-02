# Phase 10 Provider Runtime Strict Closure

Generated: 2026-06-02
Phase: Phase 10 - Real Data Certification
Work package: `wp-provider-runtime-strict`

## Scope

This closure focused only on provider/runtime strict fallback hygiene. It did not change parser behavior, retrieval scoring, evidence extraction, answer composer, safety behavior, UI layout, model weights, LoRA runtime, Qdrant data volumes, or production secrets.

## What Changed

- Increased the default model reranker timeout from 8s to 15s for CPU cross-encoder cold/warm real-data smoke stability.
- Updated `.env.example` quality-provider guidance with reranker timeout, candidate limit, and max-length defaults.
- Kept local `.env` verification changes uncommitted because the file is intentionally ignored.
- Tightened runtime lineage so Qdrant fallback is counted only from explicit provider-failure diagnostics, not from source-resolution paths that never attempted Qdrant.
- Tightened failure taxonomy so `reranker_fallback:missing` is not treated as provider/runtime fallback. Actual provider fallback still maps to runtime/provider failure.
- Tightened certification owner-phase classification so only actual provider fallback signals assign backlog to provider-runtime.

## Changed Files

- `apps/backend-api/.env.example`
- `apps/backend-api/scripts/analyze-real-data-certification.mjs`
- `apps/backend-api/scripts/eval-scorers/failure-taxonomy.mjs`
- `apps/backend-api/src/lib/decisionConfig.ts`
- `apps/backend-api/src/lib/decisionConfig.test.ts`
- `apps/backend-api/src/lib/runtimeLineage.ts`
- `apps/backend-api/src/lib/runtimeLineage.test.ts`

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm run local:status` | 0 | pass | Backend, dApp, ai-engine, Qdrant, Postgres, Redis, IPFS gateway healthy; llama false by design. |
| `pnpm --filter @r3mes/backend-api exec prisma migrate deploy` | 0 | pass | DB reachable after reboot. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | pass | Backend typecheck clean. |
| `pnpm --filter @r3mes/dapp exec tsc --noEmit` | 0 | pass | dApp typecheck clean. |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/runtimeLineage.test.ts src/lib/decisionConfig.test.ts src/lib/modelRerank.test.ts` | 0 | pass | Runtime lineage, decision config, and reranker tests passed. |
| `pnpm --filter @r3mes/backend-api run smoke:reranker-provider` | 0 | pass | Warm cross-encoder provider, fallback false. |
| `pnpm --filter @r3mes/backend-api run smoke:bge-m3-provider` | 0 | pass | Real BGE-M3 provider, fallback false, 1024 dimensions. |
| `pnpm --filter @r3mes/backend-api run eval:by-course-smoke` | 1 | expected fail | 4/12 pass; provider fallback ratios 0; failures are evidence/answer quality backlog. |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | expected fail | 4/15 pass; provider fallback ratios 0; failures are evidence/answer quality backlog. |
| `pnpm --filter @r3mes/backend-api run eval:ui-reality` | 0 | pass | 5/5 pass; fallback ratios 0. |
| `pnpm --filter @r3mes/backend-api run eval:realistic-rag` | 1 | expected fail | 7/8 pass; remaining failure is retrieval/query, not provider fallback. |
| `pnpm --filter @r3mes/backend-api run eval:retrieval-quality` | 0 | pass | 16/16 pass; fallback ratios 0. |
| `pnpm --filter @r3mes/backend-api run eval:production-rag -- --out artifacts/evals/production-rag/feedback-gate.json` | 1 | expected fail | 166/185 pass; `qualityFallbackRatio=0`, `providerStrictFailureCount=0`. |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | pass | Release gate still fails, but provider-runtime backlog is gone. |

## Certification Result

Latest certification:

- Release gate: `fail`
- Total cases: 185
- Passed: 166
- Failed: 19
- Runtime lineage coverage: 1
- Quality fallback ratio: 0
- Certification backlog count: 40
- Blocker count: 39

Owner phase counts:

- Phase 10 - Real Data Certification: 1
- Phase 7 - Full Answer Intelligence: 9
- Phase 6 - Full Evidence Intelligence: 26
- Phase 4 - Retrieval Quality: 3
- Phase 5 - Query / Source Intelligence: 1

Layer family counts:

- certification-triage: 1
- safety-presentation: 9
- structured-evidence-table: 2
- retrieval: 3
- context-evidence-coverage: 24
- query-source-intelligence: 1

Provider-runtime no longer appears as an owner phase or layer family.

## Public / Debug Boundary

No public response shape was changed. Provider lineage and fallback diagnostics remain debug/eval/admin concerns. Raw vectors, Qdrant payload internals, provider metadata, runtime trace, and strict fallback details were not added to public responses.

## Remaining Backlog

- Phase 6: context/evidence coverage dominates current blockers.
- Phase 7: safety/presentation and answer quality remain visible in real-data smoke.
- Phase 4: three retrieval blockers remain in certification.
- Phase 5: one query/source intelligence blocker remains.
- Phase 10: one certification-triage item remains.
- Performance: B.Y/G.P deep RAG p95 latency remains around 13s and should be tracked as a performance backlog, not a provider fallback failure.

## Decision

`wp-provider-runtime-strict` is closure-ready. The release gate remains red for real product-quality reasons, but strict provider/runtime fallback is no longer masking downstream evidence, retrieval, or answer-quality failures.
