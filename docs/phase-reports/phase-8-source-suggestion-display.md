# Faz 8 Slice 2 - Source / Suggestion Display Mapping

## Scope

- Phase: Faz 8 - Product Boundary / UX
- Slice: Source and suggestion display model mapping
- Date: 2026-06-02
- Owner role: Atlas

## What Changed

- Added `publicChatDisplay` mapper for user-facing source, suggestion, and status models.
- Existing chat sources now include a safe `whyThisSource` explanation.
- Existing chat responses now expose root-level `suggestions` and `status` fields without requiring debug mode.
- Suggestion reasons are sanitized before public exposure so technical score fragments such as `skor 73` / `score=88.5` do not leak.
- dApp chat source types now accept optional display fields.

## Contract / Boundary Notes

- `sources` remain backward-compatible with `ChatSourceCitation` and gain optional display metadata.
- `suggestions` follow the `SuggestionDisplayModel` shape from shared-types.
- `status` follows the `UserFacingStatus` shape from shared-types.
- Internal retrieval diagnostics, provider details, reranker scores, raw Qdrant payloads, and safety rails are not exposed through this mapper.

## Files Changed

- `apps/backend-api/src/lib/publicChatDisplay.ts`
- `apps/backend-api/src/lib/publicChatDisplay.test.ts`
- `apps/backend-api/src/routes/chatProxy.ts`
- `apps/backend-api/src/chatProxy.rag.test.ts`
- `apps/dApp/lib/types/knowledge.ts`

## Tests

| Command | Exit Code | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/publicChatDisplay.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | passed, 8 tests |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | passed |
| `pnpm --filter @r3mes/shared-types run build` | 0 | passed |
| `pnpm --filter @r3mes/dapp exec tsc -p tsconfig.json --noEmit` | 0 | passed |
| `pnpm --filter @r3mes/shared-types run test` | 0 | passed, 17 tests |
| `pnpm --filter @r3mes/backend-api exec vitest run src/chatProxy.rag.test.ts` | 0 | passed, 9 tests |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/publicChatDisplay.test.ts src/lib/chatResponseBoundary.test.ts src/chatProxy.rag.test.ts` | 0 | passed, 17 tests |

## Out Of Scope

- No retrieval, reranker, evidence extraction, answer composer, parser, safety behavior, or UI layout logic changed.
- Suggestions are displayed from existing source-selection outputs; source scoring itself was not changed.
- Feedback payload V2 is still a separate Faz 8 slice.

## Risks / Follow-Up

- UI can now consume `whyThisSource`, `suggestions`, and `status`, but visual rendering/polish is intentionally deferred to a UI-specific slice.
- Suggestion reason sanitization is generic and score-focused; future leak tests should add broader provider/internal keyword checks.
- UI parity fixtures should assert public suggestions remain available when debug is disabled.

## Phase Status

- Faz 8 Slice 2 is complete.
- Faz 8 overall remains in progress.
