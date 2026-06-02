# Phase 9 Slice 2 - BAD_ANSWER Strict Regression Gate

## Phase

- Phase: 9 - Feedback / Controlled Learning
- Slice: 2 - BAD_ANSWER strict regression coverage
- Status: Completed

## Goal

BAD_ANSWER feedback must not become a strong production regression only because it has a `qualityBucket`.
It is strong only when the feedback carries actionable quality expectations that an eval can enforce.

## Scope

- Updated feedback regression generation to classify BAD_ANSWER cases as strict or weak.
- Updated feedback eval gate summary so strong BAD_ANSWER count only includes strict cases.
- Added a small fixture proving one weak BAD_ANSWER and one strict BAD_ANSWER case.
- Did not change retrieval, composer, safety, parser, UI, Qdrant, embedding, or reranker behavior.

## Contract Change

BAD_ANSWER generated eval cases may now include:

- `strictBadAnswerCase: true` when actionable expectations exist.
- `weakFeedbackCase: true` when the case only has a broad quality bucket or insufficient expectations.

Strict expectations are currently recognized from:

- `requiredAnswerTerms`
- `forbiddenAnswerTerms`
- `requiredFields`
- `format`
- `maxWords`
- `maxSentences`
- `forbidCaution`
- `noRawTableDump`

## Files Changed

- `apps/backend-api/scripts/generate-feedback-regression-eval.mjs`
- `apps/backend-api/scripts/run-feedback-eval-gate.mjs`
- `apps/backend-api/scripts/fixtures/feedback-regression-strength.jsonl`
- `docs/agents/project-memory.md`

## Verification

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass | Shared contracts still build. |
| `node scripts/generate-feedback-regression-eval.mjs --fixture apps/backend-api/scripts/fixtures/feedback-regression-strength.jsonl --out artifacts/evals/feedback-regression/phase-9-slice-2-strength.jsonl` | 0 | pass | Generated 2 cases: 1 weak, 1 strict. |
| `pnpm --filter @r3mes/backend-api exec vitest run src/feedbackRoutes.test.ts src/lib/feedbackQualityPayload.test.ts src/lib/feedbackShadowRuntime.test.ts` | 0 | pass | 27 feedback tests passed. |
| `pnpm --filter @r3mes/shared-types run test` | 0 | pass | 19 shared tests passed. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck passed. |

## Fixture Result

The strength fixture generated:

- `feedback-bad-answer-aaaaaaaaaaaaaaaa-collection-a-none`: weak BAD_ANSWER, because only a quality bucket was provided.
- `feedback-bad-answer-bbbbbbbbbbbbbbbb-collection-b-none`: strict BAD_ANSWER, because required/forbidden terms, requested field, output format, and max length were provided.

## Boundary Check

- Public response contract was not changed.
- Debug trace shape was not changed.
- No provider, retrieval, safety, Qdrant, or internal score diagnostics were added to public output.

## Risk / Warning

- The eval gate summary logic was validated through generated fixture classification and existing feedback tests, not through a full DB-backed promotion run in this slice.
- Full promotion gate behavior remains a later Phase 9 slice.

## Next Slice

Proceed to feedback promotion readiness: ensure proposals that reach promotion have regression evidence, shadow/passive lineage, rollback trace, and phase-appropriate diagnostics.
