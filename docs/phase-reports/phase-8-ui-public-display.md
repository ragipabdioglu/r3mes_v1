# Faz 8 Slice 3 - UI Public Display Wiring

## Scope

- Phase: Faz 8 - Product Boundary / UX
- Slice: UI consumption of public source/suggestion/status fields
- Date: 2026-06-02
- Owner role: Atlas

## What Changed

- dApp chat transport now reads root-level public `suggestions` and `status` fields.
- Chat turn state preserves `sources`, `suggestions`, `userFacingStatus`, debug, trace, and runtime lineage consistently.
- Source suggestion badge can render safe public suggestions even when debug mode is disabled.
- Source list now shows user-facing `whyThisSource` explanations without exposing raw debug details.

## Boundary Notes

- Debug panel behavior remains behind the existing debug details control.
- UI still supports legacy/debug `sourceSelection` when available, but public suggestions no longer require `retrieval_debug`.
- No retrieval, evidence, answer composer, parser, safety, or feedback runtime behavior changed.
- No broad visual redesign was performed; this was contract wiring and safe display only.

## Files Changed

- `apps/dApp/lib/api/chat-stream.ts`
- `apps/dApp/components/chat-screen.tsx`
- `docs/phase-reports/phase-8-ui-public-display.md`
- `docs/agents/project-memory.md`

## Tests

| Command | Exit Code | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/dapp exec tsc -p tsconfig.json --noEmit` | 0 | passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | passed |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/publicChatDisplay.test.ts src/lib/chatResponseBoundary.test.ts src/chatProxy.rag.test.ts` | 0 | passed, 17 tests |

## Out Of Scope

- UI layout redesign.
- Admin debug console.
- FeedbackPayloadV2.
- New UI parity runner.

## Risks / Follow-Up

- Next slice should add explicit public/debug UI parity fixtures or test helpers.
- FeedbackPayloadV2 still needs to use safe lineage rather than raw debug.
- Source explanation text is safe and simple; product copy can be polished later without changing backend decisions.

## Phase Status

- Faz 8 Slice 3 is complete.
- Faz 8 overall remains in progress.
