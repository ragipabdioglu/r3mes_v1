# Phase 9 Slice 3 - Promotion Readiness Gate

## Phase

- Phase: 9 - Feedback / Controlled Learning
- Slice: 3 - Promotion readiness and shadow gate hardening
- Status: Completed

## Goal

Passive feedback adjustments must not become promotion candidates unless the system can prove:

- feedback regression coverage exists,
- production gate evidence ran,
- the adjustment is rollback-ready,
- score delta remains inside the configured promotion cap.

## Scope

- Extended promotion gate contract with regression and rollback readiness fields.
- Made promotion gate stricter without mutating runtime router behavior.
- Made shadow runtime eligibility use the same strict gate evidence.
- Updated route and shadow runtime tests.

## Contract Change

`KnowledgeFeedbackPromotionGateItem` now includes:

- `feedbackCaseCount`
- `feedbackCaseCoverageOk`
- `productionGateRan`
- `rollbackReady`
- `gateReportGeneratedAt`

## Behavior Change

Promotion eligibility now requires:

- `applyRecord.status === "APPLIED"`
- gate report `ok === true`
- `feedbackCaseCoverageOk === true`
- `productionGateRan === true`
- non-empty target collection and query hash
- rollback path available
- score delta within `feedbackRuntime.promotionMaxAbsDelta`

If any of these are missing, the item stays passive with a structured `blockedReasons` entry.

## Files Changed

- `packages/shared-types/src/apiContract.ts`
- `packages/shared-types/src/schemas.ts`
- `apps/backend-api/src/routes/feedback.ts`
- `apps/backend-api/src/lib/feedbackShadowRuntime.ts`
- `apps/backend-api/src/feedbackRoutes.test.ts`
- `apps/backend-api/src/lib/feedbackShadowRuntime.test.ts`
- `docs/agents/project-memory.md`

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass | Shared contract build passed. |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/feedbackShadowRuntime.test.ts src/feedbackRoutes.test.ts` | 0 | pass | 23 feedback route/shadow tests passed after sequential shared build. |
| `pnpm --filter @r3mes/shared-types run test` | 0 | pass | 19 shared contract tests passed. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck passed. |

## Boundary Check

- Runtime router mutation remains disabled.
- Promotion gate still reports candidates only; it does not promote production behavior.
- No public chat response field was changed.
- No retrieval, composer, safety, parser, Qdrant, embedding, reranker, or UI layout behavior was changed.

## Warning

The first focused backend test attempt was run in parallel with shared-types build and observed stale contract behavior. Re-running sequentially passed.

## Next Slice

Proceed to feedback learning observability: surface promotion gate, shadow runtime, rollback readiness, and regression coverage in admin/debug diagnostics without leaking these internals into public chat responses.
