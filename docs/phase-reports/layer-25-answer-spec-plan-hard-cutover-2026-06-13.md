# Layer 25 AnswerSpec / AnswerPlan Hard Cutover Report

Date: 2026-06-13

## Scope

Layer 25 owns answer planning boundaries. It must not extract evidence, write final prose, make safety decisions, or apply domain-specific scoring. Its job is to consume Layer 24 compiled evidence and produce a stable planning substrate for Layer 26.

## What Changed

- Replaced the old `answerSpec.ts` domain-scoring implementation with a typed-evidence planning bridge.
- Removed finance/medical/domain-specific fragment scoring from AnswerSpec.
- Kept the public `AnswerSpec` shape backward-compatible for downstream callers.
- Made compiled evidence readiness, coverage, contradictions, unknowns, source ids, and structured facts the primary planning inputs.
- Reworked `answerSpec.test.ts` around data-agnostic typed evidence, no-source planning state, contradiction planning, and compiled evidence handoff.

## Contract Boundary

- Layer 23: extracts evidence items.
- Layer 24: compiles evidence into `CompiledEvidence`.
- Layer 25: plans from `CompiledEvidence` / `EvidenceBundle`.
- Layer 26: renders the final answer.

Layer 25 no longer treats domain keywords or fixture-specific literals as final authority.

## Hardcoded / Data-Specific Audit

Command:

```powershell
rg -n "medicalQueryContext|shareGroup|answerShare|withholding|netPeriod|periodProfit|evidenceLexicon|legacy|KAP|Ders 7|CheckBox|ComboBox|5V" apps/backend-api/src/lib/answerSpec.ts apps/backend-api/src/lib/answerSpec.test.ts -S
```

Result: no matches.

## Verification

| Command | Exit Code | Result |
| --- | ---: | --- |
| `pnpm --filter @r3mes/backend-api exec tsc --noEmit` | 0 | Pass |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/answerSpec.test.ts src/lib/answerPlan.test.ts src/lib/compiledEvidence.test.ts src/lib/groundedBrief.test.ts` | 0 | Pass, 23 tests |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/skillPipeline.test.ts src/lib/evidence/evidenceExtractorOrchestrator.test.ts src/lib/tableNumericFactExtractor.test.ts src/lib/compiledEvidence.test.ts src/lib/groundedBrief.test.ts src/lib/noSourceEvidence.test.ts src/lib/answerSpec.test.ts src/lib/answerPlan.test.ts src/lib/safetyEvidenceSignals.test.ts src/lib/safetyGate.test.ts` | 1 | 73 pass, 2 fail in `safetyGate.test.ts` |

## Remaining Failures

The remaining failures are not Layer 25 blockers:

- `safetyGate.test.ts` expects old safety pass behavior for AnswerSpec-derived metrics.
- `safetyGate.test.ts` expects red-flag safety blocking but receives `NO_USABLE_FACTS`.

Backlog target: Layer 28 / Layer 30 safety boundary migration. Do not patch this in Layer 25.

## Public / Debug Boundary

No public response contract was changed in this layer. The implementation only changes backend planning internals and tests.

## Decision

Layer 25 hard cutover is complete at the AnswerSpec boundary. Proceed to Layer 26 only after acknowledging that the safety test failures belong to the safety layers, not answer planning.
