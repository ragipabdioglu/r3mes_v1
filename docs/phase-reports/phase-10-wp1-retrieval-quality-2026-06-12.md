# Phase 10 WP1 - Retrieval Quality Blocker Closure

Date: 2026-06-12
Phase: Phase 10 - Real Data Certification
Work package: WP1 - Retrieval wrong-source / wrong-chunk closure

## Scope

This slice stayed inside Phase 4 / Phase 10 retrieval quality scope. It did not change composer, safety policy behavior, UI layout, parser behavior, Qdrant destructive state, model weights, LoRA runtime, or production secrets.

## Change

Final source alignment now allows weak candidates to reach/return from model review only when the candidate has explicit route-specific topic support. This keeps model reranker authority for semantically strong candidates while preventing generic terms such as procedure, date, document, or objection from rescuing same-domain wrong-topic sources.

Changed files:
- `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts`
- `apps/backend-api/src/lib/hybridKnowledgeRetrieval.test.ts`

## Result

Retrieval-quality eval improved from 10/16 to 13/16.

Fixed or improved:
- `retrieval-technical-migration-grounded` now passes.
- `retrieval-legal-defective-product-same-collection-distractor` now passes.
- `retrieval-education-exam-objection-top-source` now passes.
- Same-domain wrong-topic guards still pass after narrowing model-reviewed rescue.
- Reranker fallback ratio remains 0.
- Runtime lineage coverage remains 1.0.

Remaining retrieval-quality failures:
- `retrieval-legal-divorce-not-traffic`: safety/presentation rewrite; evidence-only ok.
- `retrieval-finance-risk-grounded`: context coverage / required concept coverage.
- `retrieval-thin-profile-stays-broad`: thin-profile source policy / source intelligence / safety presentation backlog.

## Commands

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/hybridKnowledgeRetrieval.test.ts` | 0 | 32 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc --noEmit` | 0 | Typecheck passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | Backend dist emitted |
| `pnpm local:stop; pnpm local:start` | 0 | System restarted LoRA-less; backend/dApp/ai-engine/Qdrant/Postgres up |
| `pnpm local:status` | 0 | backend-api, dApp, ai-engine, qdrant, ipfs-gateway healthy; llama false; LoRA unavailable |
| `pnpm --filter @r3mes/backend-api run eval:retrieval-quality` | 1 | Expected red; improved to 13/16 |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | Release gate still fail; backlog remains cross-phase |

## Decision

WP1 retrieval closure is materially improved but not full suite green. The remaining red cases should not be solved by broadening model-reviewed retrieval rescue. They belong to source intelligence, context/evidence coverage, and safety/answer presentation work packages.

Next recommended blocker order:
1. WP2: Source intelligence / thin-profile routing closure.
2. WP3: Context coverage / required concept coverage for finance and procedure/list evidence.
3. WP4: Safety/answer presentation cleanup for cases where evidence is sufficient but response is rewritten.
