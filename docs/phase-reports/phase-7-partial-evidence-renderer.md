# Phase 7 Slice 2 - Partial Evidence Renderer

Date: 2026-06-01
Phase: Faz 7 - Full Answer Intelligence
Slice: 2
Controller: Atlas
Implementation worker: Pascal (`019e8021-45a1-7911-a09c-8d4c55608442`)
Verifier: Newton (`019e8024-3c25-7901-88c8-0cabc37fda9e`)

## Purpose

When evidence is partial but still usable, the answer layer should not collapse directly into "field not found" fallback. This slice adds a narrow generic renderer path for partial field extraction that can answer from usable text facts while still explicitly listing missing fields.

## Scope

Changed files:

- `apps/backend-api/src/lib/domainEvidenceComposer.ts`
- `apps/backend-api/src/lib/domainEvidenceComposer.test.ts`

Out of scope:

- Parser, ingestion, chunking, retrieval scoring, reranker, Qdrant, embedding provider.
- Safety policy behavior rewrite.
- UI styling or layout.
- Qwen/model runtime changes.
- Finance numeric/table string mining default behavior.

## What Changed

- `composePlannedAnswer` keeps structured facts as the first rendering path.
- If the answer plan is `field_extraction` with `partial` or `none` coverage and no selected structured fact, the composer can now render usable `answerSpec.facts`.
- Missing requested fields are still explicitly listed.
- Bullet and short output formats are supported.
- Generic caution remains suppressed when constraints forbid caution.
- Raw table-like facts are filtered when `noRawTableDump` is active.
- Finance numeric facts are not mined unless explicit fallback is enabled.

## Verification

| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/domainEvidenceComposer.test.ts src/lib/chatResponseBoundary.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | 23/23 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | Pass | Runtime dist rebuilt |
| Backend restart + `/ready/rag-runtime` | 0 | Pass | Runtime ready after rebuild |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 8/17 passed; quality failure count improved |

Newton independently verified:

- Patch stayed inside Faz 7 answer intelligence scope.
- No parser/retrieval/safety policy/UI/Qdrant/embedding changes.
- Structured fact precedence is preserved.
- Product code contains no data-specific literal logic.
- Public/debug boundary risk is low; boundary tests passed.

## Runtime Effect

Answer-quality pass count remained 8/17, but failure severity improved:

- failure count: 35 -> 29
- answer quality failure rate: 0.412 -> 0.294
- composer/model generation phase diagnosis: 7 -> 5
- answer-quality findings with fail severity: 7 -> 5
- `wrong_output_format` fail bucket disappeared from the summary.

Examples now render usable partial facts instead of only missing-field fallback:

- technical migration checklist now surfaces backup/staging/rollback evidence.
- education BEP checklist now surfaces BEP/support/measurement evidence.

## Remaining Warnings

- `renderSafetyFallback` can still bypass `composePlannedAnswer` for incomplete field extraction when generic caution is forbidden. This can erase usable partial evidence in some safety fallback paths. This is the next small Faz 7 bridge task.
- Some table/numeric cases still fail because normalized numeric/table facts are not yet mature.
- Some labels still come from normalized field ids when upstream field/fact labels are normalized.
- Local-dev latency warning persists in answer-quality eval: `normal_rag_p95_latency` exceeded 8000 ms in this run.

## Public / Debug Boundary

- Public response shape is unchanged.
- No new diagnostics are exposed publicly.
- Boundary tests pass.

## Next Slice Recommendation

Faz 7 Slice 3 should implement the safety fallback bridge:

- Let non-blocking safety fallback paths call the partial evidence renderer before concise missing-field fallback.
- Keep blocking rails, privacy fallback, source suggestion fallback, and contradiction handling deterministic.
- Add tests in `safetyFallbackRenderer.test.ts`.

## Status

Slice complete: Yes.
Faz 7 complete: No.
Next action: Faz 7 Slice 3 - safety fallback bridge for partial evidence.
