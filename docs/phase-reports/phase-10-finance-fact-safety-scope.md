# Phase 10 - Finance Fact Safety Scope

Date: 2026-06-06

## Scope

This slice stayed inside Phase 10 real-data certification and Phase 7 safety/answer-presentation backlog. It does not change retrieval, parser, indexing, UI layout, model runtime, or data-specific behavior.

## Change

- Refined the deterministic finance red-flag rail so supported source-grounded finance facts are not forced into investment-guidance fallback.
- Kept advisory finance questions protected: investment advice, buy/sell/hold, guaranteed return, or risk-free return prompts still require guidance.
- Applied the same distinction to query red flags and evidence-derived red flags.

## Files Changed

- `apps/backend-api/src/lib/safetyGate.ts`
- `apps/backend-api/src/lib/safetyGate.test.ts`

## Product Boundary

- No public response fields were added.
- No provider/internal trace fields were exposed.
- No data-specific literals were added to core logic.
- Deterministic safety remains active; this only narrows a false-positive finance branch.

## Validation

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/safetyGate.test.ts src/lib/safetyFallbackRenderer.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | 39 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Passed |
| `pnpm --filter @r3mes/backend-api run build` | 0 | Passed after controlled backend restart |
| `pnpm --filter @r3mes/backend-api run eval:kap-pilot` | 1 | Expected red gate; 15/18 passed |
| `pnpm --filter @r3mes/backend-api run eval:context-pruning` | 1 | Expected red gate; 4/5 passed |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | Expected red gate; 10/15 passed |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | Release gate fail; backlog 32, blockers 31 |

## Eval Impact

- KAP `kap-froto-withholding-specific` now passes with `safety=true`.
- Real-data certification improved from backlog 33 / blockers 32 to backlog 32 / blockers 31.
- Provider fallback remains 0 in the refreshed KAP and G.P suites.

## Remaining Backlog

- KAP table/detail failures are now mostly structured table/field coverage and answer quality, not provider runtime.
- Context-pruning legal failure is `ANSWER_QUALITY_TOO_LONG`, so it belongs to answer planner/composer presentation work.
- G.P smoke remains 10/15; remaining failures split into retrieval/evidence for missing source cases and composer/model generation for incomplete answer cases.

## Next Recommended Slice

Continue Phase 10 with Phase 7 answer presentation:

1. Fix generic short/list composer overrun for legal/context-pruning without changing safety behavior.
2. Improve planned renderer completeness for evidence-pass/answer-fail cases.
3. Keep table-field structured extraction work separate for Phase 6/7 table evidence.
