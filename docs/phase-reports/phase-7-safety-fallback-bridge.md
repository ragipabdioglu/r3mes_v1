# Phase 7 Slice 3 - Safety Fallback Partial Evidence Bridge

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: 3
Controller: Atlas / main thread
Implementation worker: Pascal (`019e8021-45a1-7911-a09c-8d4c55608442`)
Verifier: Newton (`019e8024-3c25-7901-88c8-0cabc37fda9e`)

## Purpose

Prevent non-blocking safety fallback presentation from erasing usable partial evidence. If a field-extraction answer has incomplete coverage but still has usable text facts, the safety fallback renderer should try the planned partial-evidence renderer before returning the concise missing-field fallback.

## Scope

Changed files:

- `apps/backend-api/src/lib/safetyFallbackRenderer.ts`
- `apps/backend-api/src/lib/safetyFallbackRenderer.test.ts`

Out of scope:

- Parser, ingestion, chunking, retrieval scoring, Qdrant, embedding provider, reranker provider.
- Safety policy behavior rewrite or safety rail registry changes.
- Main composer rewrite.
- UI styling or layout.
- Model/Qwen/LoRA runtime changes.

## What Changed

- `renderSafetyFallback` now bridges `low_grounding + field_extraction + incomplete coverage` through `composePlannedAnswer` before using concise missing-field fallback.
- If usable text facts exist, the response can include those facts plus explicit missing fields.
- If no usable facts exist, the previous concise missing-field fallback remains unchanged.
- `source_suggestion` and `privacy_safe` still return deterministic early fallbacks.
- `domain_safe` remains on the cautious blocking fallback path; an intermediate regression that forced `domain_safe` to concise missing fallback was rejected during verification and removed.

## Verification

| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/safetyFallbackRenderer.test.ts src/lib/domainEvidenceComposer.test.ts src/lib/chatResponseBoundary.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | 30/30 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | Pass | Runtime dist rebuilt |
| Backend restart + `/ready/rag-runtime` | 0 | Pass | Runtime ready after rebuild |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 8/17 passed; existing product quality failures remain |

Newton independently verified:

- Diff stayed inside the two assigned files.
- `source_suggestion` and `privacy_safe` deterministic early returns are unchanged.
- `low_grounding` partial field extraction bridge is covered by tests.
- No-usable-fact fallback remains concise.
- Product core logic gained no data-specific literals.

## Runtime Effect

Answer-quality aggregate remains at the Slice 2 level:

- pass count: 8/17
- failure count: 29
- answer quality failure rate: 0.294
- composer/model generation phase diagnosis: 5
- safety policy/presentation phase diagnosis: 7
- fail buckets: `incomplete_answer: 4`, `table_field_mismatch: 1`
- composer paths: `planned_fallback_template: 3`, `planned_structured: 5`, `safety_fallback: 9`

This slice did not increase pass count because the current failing live cases mostly enter `domain_safe` rather than the non-blocking `low_grounding` path. It still closes a real gap: future non-blocking safety fallback cases with usable evidence will not collapse directly to missing-field fallback.

## Public / Debug Boundary

- Public response shape is unchanged.
- No new diagnostics are exposed publicly.
- Boundary tests passed.
- No raw trace, provider detail, internal score, Qdrant payload, or safety rail detail is added to public responses.

## Remaining Warnings

- Existing answer-quality failures remain mostly KAP numeric/table field extraction and safety presentation cases.
- `domain_safe` safety presentation still dominates the remaining non-KAP failures; this needs a later safety presentation / answer intelligence slice, not a safety policy shortcut.
- Normal RAG p95 latency warning persisted in local-dev eval: `8472 ms` vs `8000 ms` budget.

## Status

Slice complete: Yes.
Faz 7 complete: No.
Next recommended action: continue Faz 7 with a safety presentation / answer-plan compatibility slice that explains `domain_safe` evidence without over-triggering rewrite failures, while preserving deterministic safety.
