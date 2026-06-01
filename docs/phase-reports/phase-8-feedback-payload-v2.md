# Faz 8 Slice 4 - FeedbackPayloadV2 and Feedback Boundary

Date: 2026-06-02

## Scope
- Added a typed `FeedbackPayloadV2` contract for safe UI feedback metadata.
- Kept feedback useful for learning by preserving a small runtime lineage summary.
- Blocked raw debug, retrieval, provider, safety, Qdrant payload, and embedding vector diagnostics from feedback metadata.
- Did not change retrieval, evidence, composer, safety behavior, parser behavior, or UI layout.

## Contracts
- `FeedbackRuntimeLineageSummaryV2`
  - File: `packages/shared-types/src/apiContract.ts`
  - Safe fields: answer path, Qwen called, validator called, embedding/reranker fallback flags, runtime profile.
- `FeedbackPayloadV2`
  - File: `packages/shared-types/src/apiContract.ts`
  - Safe fields: source counts, selected/used/suggested/rejected collection ids, route summary, source titles, lineage summary, optional redacted query.
- Zod schemas:
  - File: `packages/shared-types/src/schemas.ts`
  - Strict payload schema rejects unknown raw diagnostics.

## Implementation
- dApp feedback metadata now sends `FeedbackPayloadV2` instead of a loose debug-shaped object.
- Backend metadata sanitizer strips internal diagnostics recursively.
- Backend preserves only allowlisted `runtimeLineage` summary fields.
- `expectedCollectionId` can now use public suggestions when debug suggestions are unavailable.

## Public / Debug Boundary
- Public feedback payload does not include raw chat trace, retrieval debug, eval debug contract, provider status, Qdrant payload, safety rail, internal score, or embedding vectors.
- Debug/admin diagnostics remain separate from feedback payload.

## Tests
| Command | Exit code | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass |
| `pnpm --filter @r3mes/shared-types run test` | 0 | pass, 19 tests |
| `pnpm --filter @r3mes/backend-api exec vitest run src/feedbackRoutes.test.ts` | 0 | pass, 18 tests |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass |
| `pnpm --filter @r3mes/dapp exec tsc -p tsconfig.json --noEmit` | 0 | pass |
| `pnpm --filter @r3mes/backend-api exec vitest run src/feedbackRoutes.test.ts src/lib/publicChatDisplay.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | pass, 26 tests |

## Risks / Notes
- `FeedbackPayloadV2` intentionally does not carry raw diagnostics. If deeper debugging is needed, use trace id plus admin/debug surfaces.
- Feedback learning remains controlled; this slice does not apply runtime behavior changes.

## Next
- Continue Faz 8 with UX/admin product boundary checks and phase closure verification.
