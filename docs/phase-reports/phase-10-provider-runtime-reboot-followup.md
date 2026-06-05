# Phase 10 Provider Runtime Reboot Follow-up

Generated: 2026-06-06
Phase: Phase 10 - Real Data Certification
Work package: `wp-provider-runtime-strict`

## Scope

This follow-up closes a reboot-specific BGE-M3 embedding runtime failure. It only changes ai-engine embedding model loading discipline. It does not change parser behavior, retrieval scoring, evidence extraction, answer composer, safety behavior, UI layout, model weights, LoRA runtime, Qdrant data, fixtures, or production secrets.

## What Changed

- Updated the BGE-M3 embedding loader to call `AutoModel.from_pretrained` with `low_cpu_mem_usage=False` and `device_map=None`, matching the reranker loader discipline.
- If CUDA placement fails, the loader now reloads a clean CPU model instead of moving a partially failed/meta-tensor model instance to CPU.
- This fixes the runtime error: `Cannot copy out of meta tensor; no data!`.

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm local:start` | 0 | pass | Backend, dApp, Docker services started. |
| `pnpm local:status` | 0 | pass | backend, dApp, ai-engine, Qdrant, Postgres, Redis, IPFS gateway healthy; llama false by design. |
| `pnpm --filter @r3mes/ai-engine test` | 0 | pass | 31/31 ai-engine tests passed. |
| `pnpm --filter @r3mes/backend-api run smoke:bge-m3-provider` | 0 | pass | BGE-M3 provider, fallback false, dimension 1024, device cuda. |
| `pnpm --filter @r3mes/backend-api run smoke:reranker-provider` | 0 | pass | Cross-encoder provider, fallback false, latency 2458ms. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck clean. |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | expected fail | 9/15 pass; embedding/reranker fallback ratios 0; remaining failures are retrieval/evidence and answer/composer quality. |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | pass | Release gate still fail, but provider-runtime owner phase removed. |

## Certification Result

Latest certification after refreshing the G.P smoke artifact:

- Release gate: `fail`
- Certification backlog count: 34
- Blocker count: 33
- Provider-runtime blockers: 0

Owner phase counts:

- Phase 10 - Real Data Certification: 1
- Phase 7 - Full Answer Intelligence: 28
- Phase 4 - Retrieval Quality: 3
- Phase 5 - Query / Source Intelligence: 2

## Public / Debug Boundary

No public response shape changed. Provider internals remain health/debug/eval concerns. Raw vectors, Qdrant payload internals, internal scores, and runtime trace were not added to public responses.

## Remaining Backlog

- Phase 7 answer presentation/composer is now the largest blocker family.
- Phase 4 retrieval has three remaining blockers.
- Phase 5 query/source intelligence has two remaining blockers.
- Phase 10 has one certification-triage warning/blocker item.

## Decision

The reboot-specific provider-runtime blocker is closed. Continue Phase 10 with real product-quality blockers, starting from the highest-impact Phase 7 answer presentation/composer slices unless a failing case shows evidence-only failure that belongs to Phase 4 or Phase 5.
