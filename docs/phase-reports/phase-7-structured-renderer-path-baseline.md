# Phase 7 Slice 1 - Structured Renderer Path Baseline

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: 1
Controller: Atlas
Implementation owner: Pascal
Verification owner: Newton

## Purpose

Start Faz 7 by reducing ambiguity between real structured rendering and legacy fallback/template rendering.

This slice does not rewrite answer generation. It makes the existing planned structured renderer use better labels when a structured fact is available, and fixes composer path classification so selected-fact rendering is reported as `planned_structured`.

## Scope

Changed files:

- `apps/backend-api/src/lib/domainEvidenceComposer.ts`
- `apps/backend-api/src/lib/domainEvidenceComposer.test.ts`
- `apps/backend-api/src/routes/chatProxy.ts`

Out of scope:

- Parser, ingestion, chunking, retrieval scoring, reranker, Qdrant, embedding provider.
- Safety policy behavior rewrite.
- Qwen/model runtime changes.
- UI styling or layout.
- Data-specific literal logic in product code.

## What Changed

- Added generic structured fact display label resolution:
  - prefer table row label when available;
  - otherwise infer a label from provenance quote before the first numeric value;
  - otherwise fall back to matching requested field label;
  - otherwise use existing fact field/subject.
- Updated composer path classification:
  - if planned composer rendered selected facts, classify as `planned_structured` even when the request initially entered the safe template path.
- Added a unit test proving readable labels can come from generic provenance/table evidence without hardcoding dataset-specific behavior.

## Why This Matters

Faz 6 closure showed many sufficient-evidence cases were reported as fallback/template. Some of that was real answer-quality debt, but some was path classification debt. Faz 7 needs a truthful baseline before larger renderer and safety presentation work.

## Verification

| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/domainEvidenceComposer.test.ts src/lib/chatResponseBoundary.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | 20/20 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | Pass | Dist rebuilt for runtime eval |
| Backend restart + `/ready/rag-runtime` | 0 | Pass | Runtime ready after rebuild |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 8/17 passed; same score, better composer path split |

## Runtime Effect

Answer-quality score did not change yet:

- total: 17
- passed: 8
- failed: 9
- passRate: 0.471

Composer path distribution changed:

- before Faz 7 Slice 1 closure baseline: `planned_fallback_template: 8`, `safety_fallback: 9`
- after this slice: `planned_structured: 5`, `planned_fallback_template: 3`, `safety_fallback: 9`

This is a useful improvement because Faz 7 can now target real fallback/template cases instead of overcounting selected-fact rendering as fallback.

## Remaining Issues

- KAP/table answer-quality cases remain red where field labels or values are normalized before reaching the composer.
- `numeric_value` facts are still not mature enough to claim normalized numeric extraction.
- Safety presentation still rewrites several partial evidence answers into missing-field fallback.
- `evalGuardrails` reported a local-dev latency warning: `normal_rag_p95_latency` 8253 ms vs 8000 ms. This is not caused by this slice's logic and should be watched in performance passes.

## Public / Debug Boundary

- Public response shape is unchanged.
- New label resolution is answer text only; it does not expose diagnostics.
- Existing boundary tests pass.

## Next Slice Recommendation

Faz 7 Slice 2 should address partial-evidence answer rendering:

- When compiled evidence is partial but shouldAnswer is true, answer from usable facts instead of immediately producing missing-field fallback.
- Keep safety blocking rails intact.
- Separate safety policy from safety presentation so non-blocking rewrites do not erase usable evidence.

## Status

Slice complete: Yes.
Faz 7 complete: No.
Next action: Faz 7 Slice 2 - partial evidence renderer / safety presentation bridge.
