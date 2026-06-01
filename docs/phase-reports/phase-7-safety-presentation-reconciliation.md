# Phase 7 Slice 4 - Safety Presentation Reconciliation

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: 4
Controller: Atlas / main thread
Implementation worker: Pascal (`019e8021-45a1-7911-a09c-8d4c55608442`)
Verifier: Newton (`019e8024-3c25-7901-88c8-0cabc37fda9e`)

## Purpose

When a safety fallback or planned renderer repairs a bad answer into a clean partial-evidence answer, answer-quality rail state must match the final user-visible answer. This slice prevents stale `ANSWER_QUALITY_*` rails from keeping a response in rewrite mode after presentation has been repaired.

## Scope

Changed files:

- `apps/backend-api/src/routes/chatProxy.ts`
- `apps/backend-api/src/lib/safetyGatePresentationRepair.ts`
- `apps/backend-api/src/lib/safetyGatePresentationRepair.test.ts`
- `apps/backend-api/src/lib/answerQualityValidator.ts`
- `apps/backend-api/src/lib/answerQualityValidator.test.ts`

Out of scope:

- Parser, ingestion, chunking, retrieval, Qdrant, embedding, reranker.
- Safety rail registry status changes.
- Real safety policy relaxation.
- UI styling or layout.
- Qwen/model runtime changes.

## What Changed

- Added `reconcileSafetyGateAfterPresentationRepair`.
- If final rendered fallback text is revalidated and only stale `ANSWER_QUALITY_*` rails remain, exposed safety gate can pass.
- Mixed or real safety rails still block/rewrite. Examples: `SOURCE_METADATA_MISMATCH`, `PRIVATE_SOURCE_SCOPE_MISMATCH`, `RISKY_CERTAINTY_OR_TREATMENT`, `NO_USABLE_FACTS`, `QUERY_SOURCE_MISMATCH`.
- Answer-quality validator now distinguishes partial evidence answers that explicitly disclose missing fields from real table/field mismatch failures.
- Required answer terms and required field values remain strict.

## Verification

| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/answerQualityValidator.test.ts src/lib/safetyGatePresentationRepair.test.ts src/lib/chatResponseBoundary.test.ts src/lib/safetyFallbackRenderer.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | 18/18 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | Pass | Runtime dist rebuilt |
| Backend restart + `/ready/rag-runtime` | 0 | Pass | Runtime ready after rebuild |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 10/17 passed; remaining product-quality failures persist |

Newton independently verified:

- The validator exception is narrow: partial coverage, usable evidence, explicit missing-field disclosure.
- Missing required answer terms still fail as `incomplete_answer`.
- Missing required field values still fail.
- KAP/table numeric value expectations were not relaxed.
- Real safety/privacy/retrieval rails are not converted to pass.
- Public/debug boundary is preserved.

## Runtime Effect

Answer-quality aggregate improved:

- pass count: 8/17 -> 10/17
- failure count: 29 -> 23
- pass rate: 0.471 -> 0.588
- non-KAP answer-quality bucket: 4/7 -> 6/7
- safety policy/presentation phase diagnosis: 7 -> 4
- composer/model generation phase diagnosis stayed: 5
- composer paths: `planned_fallback_template: 6`, `planned_structured: 5`, `safety_fallback: 6`

Newly passing cases:

- `technical-migration-checklist-answer-quality`
- `education-bep-parent-checklist-answer-quality`

Still correctly failing:

- `technical-contradictory-migration-answer-quality` remains blocked by `SOURCE_METADATA_MISMATCH`.
- `finance-guaranteed-return-answer-quality` remains safety-rewritten by `RISKY_CERTAINTY_OR_TREATMENT` while its eval case still passes because that is expected safe behavior.

## Public / Debug Boundary

- Public response shape is unchanged.
- Repair diagnostics are debug/admin-only under `answer_quality` and trace fields.
- `chatResponseBoundary` tests passed.
- No raw trace, internal score, provider detail, Qdrant payload, or safety rail diagnostics are added to public responses.

## Remaining Warnings

- KAP numeric/table cases still fail due table/numeric evidence and field-value rendering gaps.
- Local-dev normal RAG p95 latency warning persists: `8387 ms` vs `8000 ms` budget.
- `technical-contradictory-migration-answer-quality` remains expected backlog for contradiction/source metadata handling.

## Status

Slice complete: Yes.
Faz 7 complete: No.
Next recommended action: continue Faz 7 with KAP/table numeric renderer planning, focusing on field-value accuracy and label/value alignment without data-specific literals.
