# R3MES Phase 1 Closure Report

Date: 2026-05-23

Phase: Phase 1 - Minimal Evidence + Answer Baseline

Status: Closure-ready. Do not start Phase 2 without user approval.

## Purpose

Phase 1 was not intended to fix all answer quality failures. Its purpose was to make answer failures diagnosable by separating:

- retrieval/evidence/context failures
- composer/model generation failures
- safety/presentation failures
- public/debug boundary failures
- provider fallback/runtime failures

## What Changed

- Added answer baseline diagnostics into the eval debug contract.
- Added evidence-only eval separation from final answer eval.
- Added phase diagnosis inside failure taxonomy.
- Added composer path diagnostics to distinguish renderer paths.
- Added answer baseline aggregate metrics in eval summaries.
- Preserved public/debug boundary: answer baseline and internal diagnostics remain debug/eval-only.

## Contract Changes

- `EvalDebugContract.answerBaseline`
- `EvalAnswerBaselineDiagnostics.composer.path`
- `RuntimeLineage.composer.path`
- `ComposerPathName`
- `failureTaxonomy.phaseDiagnosis`
- `answerBaselineQuality.composerPaths`

## Current Composer Paths

The current renderer path distribution is now visible:

- UI reality eval: `planned_fallback_template: 2`, `safety_fallback: 1`
- Answer quality eval: `planned_fallback_template: 14`, `safety_fallback: 3`

This confirms the old template/planned-composer path is still dominant. That is not a Phase 1 blocker; it is an input to Phase 7 Full Answer Intelligence.

## Test And Eval Results

Commands run:

```powershell
node --check apps/backend-api/scripts/eval-scorers/failure-taxonomy.mjs
node --input-type=module <synthetic failure taxonomy check>
pnpm --filter @r3mes/backend-api exec tsc --noEmit
pnpm run eval:evidence-only
pnpm run eval:ui-reality
pnpm --filter @r3mes/backend-api run eval:answer-quality
```

Results:

- `node --check`: PASS
- synthetic failure taxonomy check: PASS
- `tsc --noEmit`: PASS
- `eval:evidence-only`: PASS, 1/1
- `eval:ui-reality`: PASS, 5/5
- `eval:answer-quality`: expected FAIL, 16/17

## Current Eval Summary

Evidence-only:

- total: 1
- passed: 1
- failed: 0
- runtime lineage coverage: 1
- quality fallback ratio: 0

UI reality:

- total: 5
- passed: 5
- failed: 0
- runtime lineage coverage: 1 for debug-enabled cases
- skipped public-boundary cases: 2, expected because debug-off cases must not expose runtime lineage
- quality fallback ratio: 0.2 in latest run
- guardrail warnings: reranker fallback ratio and deep RAG latency

Answer quality:

- total: 17
- passed: 16
- failed: 1
- runtime lineage coverage: 1
- quality fallback ratio: 0
- provider strict failures: 0
- remaining failed case: `technical-contradictory-migration-answer-quality`

## Remaining Failure Classification

Remaining answer-quality fail:

- id: `technical-contradictory-migration-answer-quality`
- raw class: `safety`
- subtype: `over_aggressive_no_source`
- phase diagnosis: `safety_policy_or_presentation_failure`
- answer path: `contradiction_fast_path`
- composer path: `safety_fallback`
- backlog phase: Phase 6 / Phase 7

This is not a Phase 1 blocker because Phase 1's goal is measurement and diagnosis. The failure is now correctly classified instead of appearing as an empty phase diagnosis.

## Public / Debug Boundary

Verified by:

- `chatResponseBoundary.test.ts`
- `eval:ui-reality` debug-off public boundary cases

Public response must not contain:

- `runtime_lineage`
- `chat_trace`
- `retrieval_debug`
- `eval_debug_contract`
- `answerBaseline`
- `answer_quality`
- provider details
- safety rail internals

Current status: PASS.

## Stop Condition Review

- Evidence-only and answer eval are separate: PASS.
- Context/evidence failures can be distinguished from composer/model failures: PASS.
- Safety/presentation failures are now phase-diagnosed: PASS.
- Public/debug boundary is clean: PASS.
- Existing chat contract is not broken: PASS.
- Core logic has no new data-specific literals: PASS.
- Existing answer-quality suite has one known non-Phase-1 fail: WARNING, not blocker.
- UI reality has latency/provider fallback warnings in latest run: WARNING, Phase 4 / Phase 8 backlog.

## Risks Carried Forward

- High `planned_fallback_template` usage means full answer intelligence is still needed.
- Safety fallback currently handles contradiction cases too broadly.
- UI-reality latency can spike on deep RAG.
- Reranker fallback can appear in non-strict UI reality smoke.
- Phase 1 diagnostics are not a substitute for full structured evidence or renderer registry.

## Next Phase Impact

Phase 2 should use this baseline to avoid guessing. If answers are bad after ingestion work, we can now determine whether:

- the document was parsed poorly
- the chunk/artifact is wrong
- retrieval found the wrong evidence
- evidence was sufficient but composer/safety polluted the answer

## Closure Decision

Phase 1 is closure-ready.

Recommended next action: ask for user approval before starting Phase 2 - Document Intelligence Foundation.
