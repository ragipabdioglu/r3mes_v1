# Faz 9 Slice 1 - Repair Track Contract and Apply Safety Gate

Date: 2026-06-02

## Scope
- Added an explicit `FeedbackRepairTrack` contract for feedback proposals.
- Exposed `repairTrack` on `KnowledgeFeedbackProposalItem`.
- Persisted repair-track intent in generated proposal evidence.
- Hardened passive apply so only routing repair-track plans can create router adjustments.

## Out Of Scope
- No retrieval, query understanding, evidence, composer, parser, safety behavior, UI layout, or runtime active-mode behavior changed.
- No DB migration was added; older apply plans are normalized at response time.

## Contracts
- `FeedbackRepairTrack`
  - Values: `routing`, `ingestion_evidence`, `answer_quality`, `safety_policy`.
- `KnowledgeFeedbackProposalItem.repairTrack`
  - `BOOST_SOURCE` / `PENALIZE_SOURCE` -> `routing`.
  - `REVIEW_MISSING_SOURCE` -> `ingestion_evidence`.
  - `REVIEW_ANSWER_QUALITY` -> `answer_quality`.

## Implementation
- Proposal generation writes `repairTrack` into proposal evidence.
- Proposal response derives `repairTrack` from evidence, falling back to action-based compatibility.
- Apply-record plan responses normalize older stored plans that do not yet have `repairTrack`.
- Passive apply ignores score-adjustment preview steps when `repairTrack !== routing`.

## Safety Boundary
- BAD_ANSWER / answer-quality feedback cannot create router adjustments, even if a malformed plan contains score-adjustment steps.
- Feedback still requires eval gate and manual passive apply before any adjustment record is created.
- Runtime remains unaffected: `mutationApplied=false`, `routerRuntimeAffected=false`.

## Tests
| Command | Exit code | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass |
| `pnpm --filter @r3mes/backend-api exec vitest run src/feedbackRoutes.test.ts src/lib/feedbackQualityPayload.test.ts src/lib/feedbackShadowRuntime.test.ts` | 0 | pass, 27 tests |
| `pnpm --filter @r3mes/shared-types run test` | 0 | pass, 19 tests |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass |

## Notes
- Initial parallel test run produced one stale-dist failure while `shared-types` build was racing backend tests. After rebuilding shared-types first, the same backend suite passed.
- This slice makes the learning loop safer before deeper feedback-derived regression work.

## Next
- Faz 9 Slice 2 should strengthen BAD_ANSWER regression coverage and gate reporting, using existing `FeedbackBadAnswerPayload` and feedback eval gate scripts.
