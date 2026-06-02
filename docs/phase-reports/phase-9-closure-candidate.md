# Phase 9 Closure Candidate - Feedback / Controlled Learning

## Status

- Phase: 9 - Feedback / Controlled Learning
- Closure status: Not fully closed
- Decision: Implementation slices are complete, but full feedback eval gate is red on current live DB-derived regression cases.

## What Was Verified

| Check | Exit | Result | Notes |
| --- | ---: | --- | --- |
| `pnpm run local:status` | 0 | partial pass | backend, dApp, ai-engine, Qdrant, ipfs gateway OK. llama/LoRA unavailable. |
| `pnpm --filter @r3mes/backend-api run smoke:feedback-lifecycle` | 0 | pass | Feedback create -> proposal -> approve -> plan -> gate result -> passive adjustment -> promotion gate -> rollback worked. |
| `pnpm --filter @r3mes/backend-api run eval:feedback-gate -- --quick --skip-production-rag --timeout-ms 120000` | 1 | fail | Gate correctly failed because feedback regression checks are red. |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/chatResponseBoundary.test.ts src/lib/chatDebugBoundary.test.ts src/chatProxy.rag.test.ts src/feedbackRoutes.test.ts` | 0 | pass | 37 tests passed. Public/debug boundary remains guarded. |

## Feedback Lifecycle Smoke Result

The lifecycle smoke completed successfully:

- feedback created
- proposal generated and approved
- apply plan generated with `requiredGate: feedback_eval_gate`
- apply record created
- gate result recorded
- passive adjustment created
- promotion gate reported 1 eligible shadow candidate
- rollback executed

This verifies the controlled-learning mechanics without enabling direct runtime mutation.

## Feedback Eval Gate Result

The quick feedback gate failed:

- `ok: false`
- `feedbackCaseCount: 4`
- `feedback_regression: fail`
- `beta_feedback_regression: fail`
- `rag_quality_gates: pass`
- `collection_suggestion: pass`
- `feedback_case_coverage: pass`
- `production_rag_gate: skipped` because this was a quick closure run

The generated feedback regression suite shows:

- total: 4
- passed: 0
- failed: 4
- answer path: `no_source_fallback`
- failure class: `retrieval_quality`
- subtype: `wrong_source`
- route decision mode: `suggest`
- bucket: `feedback_good_source`

## Interpretation

This is not a Phase 9 implementation failure. The gate is doing the right thing: it refuses to approve production learning while feedback-derived regression cases fail.

The actual failing behavior belongs to earlier quality layers:

- Phase 4/5 backlog: source/retrieval/profile scoring is not selecting the expected source strongly enough for current DB-derived good-source feedback.
- Phase 6/7 backlog: if evidence exists but answer path remains no-source, evidence/answer diagnostics must be checked after retrieval is fixed.
- Data backlog: some cases may depend on old MVP/legacy-loaded collections and should be retested after controlled V2 reingestion.

## Public / Debug Boundary

Boundary tests passed:

- public response allowlist remains enforced
- debug fields are detected before public shaping
- chat proxy RAG tests keep public response clean unless debug is requested
- feedback metadata sanitizer still strips raw diagnostics

## Phase 9 Scope Completed

The following Phase 9 implementation slices are complete:

- repair-track gating
- BAD_ANSWER strict regression case classification
- promotion readiness gate
- feedback diagnostics bridge

These establish controlled learning:

- feedback does not directly mutate production behavior
- non-routing repair tracks cannot create router score changes
- promotion requires regression evidence, production gate evidence, rollback readiness, and score delta safety
- debug/admin trace can explain promotion blockers

## Blocker / Warning

### Blocker For Full Phase 9 Closure

- Current live DB-derived feedback eval gate is red. The system must not be marked production-learning-ready until feedback regression cases pass or are explicitly triaged into correct backlog/reingestion state.

### Warning

- llama/LoRA was unavailable during startup. This does not block Phase 9 because this phase does not depend on LoRA, and feedback lifecycle/backend diagnostics ran successfully.

## Next Recommended Step

Do not patch feedback learning to force green.

Recommended next action:

1. Triage the 4 feedback regression failures by source/retrieval/profile state.
2. Decide whether they require V2 reingestion, profile refresh, or Phase 4/5 retrieval/source scoring work.
3. Re-run `eval:feedback-gate -- --quick --skip-production-rag`.
4. Only then mark Phase 9 fully closed.

## Commit / Push Plan

- Commit this closure candidate report.
- Push to `main`.
- Keep Phase 9 status as closure-candidate, not fully closed.
