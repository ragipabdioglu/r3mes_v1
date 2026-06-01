# Faz 8 Slice 1 - Public / Debug Response Contracts

## Scope

- Phase: Faz 8 - Product Boundary / UX
- Slice: Public response and debug diagnostics contract baseline
- Date: 2026-06-02
- Owner role: Atlas

## What Changed

- Added `PublicChatResponseV2` as the strict user-facing chat display contract.
- Added `SourceDisplayModel`, `SuggestionDisplayModel`, and `UserFacingStatus`.
- Added `DebugTraceEnvelope` as the separate debug/admin diagnostics carrier.
- Added strict Zod schemas for the new public/debug contracts.
- Added parse/safeParse helpers for the public response and debug envelope.
- Added backend boundary helpers for public key allowlisting and debug field detection.

## Contract Changes

- `PublicChatResponseV2` contains only `version`, `answer`, `sources`, `suggestions`, and `status`.
- `DebugTraceEnvelope` keeps `runtimeLineage`, `evalDebugContract`, and `retrievalDebug` outside public payloads.
- Public schema is strict and rejects internal diagnostic fields such as `evalDebugContract`.
- Debug schema is strict and accepts diagnostics only in the debug envelope.

## Files Changed

- `packages/shared-types/src/apiContract.ts`
- `packages/shared-types/src/schemas.ts`
- `packages/shared-types/test/contractRegression.test.ts`
- `apps/backend-api/src/lib/chatResponseBoundary.ts`
- `apps/backend-api/src/lib/chatResponseBoundary.test.ts`

## Public / Debug Boundary

- Public contract rejects unknown internal diagnostic fields.
- Backend keeps debug field stripping in a single registry.
- Backend public response key allowlist is separate from debug key registry.
- Raw embedding vectors, Qdrant payloads, provider internals, and safety rails were not exposed or added to public response contracts.

## Tests

| Command | Exit Code | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/shared-types run build` | 0 | passed |
| `pnpm --filter @r3mes/shared-types run test` | 0 | passed, 17 tests |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/chatResponseBoundary.test.ts` | 0 | passed, 4 tests |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | passed |

## Out Of Scope

- No retrieval, reranker, evidence, answer composer, parser, safety behavior, or UI layout logic changed.
- `/v1/chat/completions` runtime payload was not replaced in this slice.
- Feedback runtime behavior was not changed.

## Risks / Follow-Up

- Next Faz 8 slice should map existing chat responses into `SourceDisplayModel` / `SuggestionDisplayModel` without breaking `/v1/chat/completions`.
- UI parity fixtures should assert that public payloads do not include debug fields while debug/admin mode can still access `DebugTraceEnvelope`.
- Feedback payload V2 still needs a separate safety-focused slice.

## Phase Status

- Faz 8 Slice 1 is complete.
- Faz 8 overall is in progress.
