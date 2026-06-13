# Layer 24 Hard Cutover: Evidence Contract & Coverage

Date: 2026-06-13

## Scope

Layer 24 was moved further toward the Notion target architecture: evidence is no longer treated as a legacy string packet. The central runtime contract is now the V2 evidence contract: typed items, structured facts, coverage, source map, confidence, sufficiency and answer readiness.

## What Changed

- Removed `legacyText` from `CompiledEvidence` / `CompiledEvidenceV2`.
- Removed runtime/debug terminology `legacyFallbackUsed`; replaced with `textFallbackUsed`.
- Removed safety signal terminology `legacyUsableFactCount`; replaced with `textEvidenceItemCount`.
- Updated compiled evidence tests to build V2 fixtures from `EvidenceBundle`, typed `EvidenceItem`s and `StructuredFact`s.
- Updated grounded brief tests and output language:
  - `LEGACY GERCEKLER` -> `TEXT KANITLAR`
  - answer rules now say text evidence is secondary to typed evidence.
- Updated no-source tests to assert V2 `coverage:none` instead of old `notSupported` buckets.
- Updated eval debug contract tests to assert V2 diagnostics and no legacy adapter field.

## Contract State

Layer 24 source of truth is now:

- `CompiledEvidenceV2.items`
- `CompiledEvidenceV2.structuredFacts`
- `CompiledEvidenceV2.coverage`
- `CompiledEvidenceV2.sourceMap`
- `CompiledEvidenceV2.evidenceConfidence`
- `CompiledEvidenceV2.sufficiency`
- `CompiledEvidenceV2.answerReadiness`

The remaining `facts`, `risks`, `unknowns` and count fields are derived text views for current consumers, not the decision source of truth. They should be removed or reduced when Layer 25/30 consumers finish their V2 migration.

## Verification

Passed:

- `pnpm --filter @r3mes/backend-api exec tsc --noEmit` -> exit 0
- `pnpm --filter @r3mes/backend-api exec vitest run src/lib/skillPipeline.test.ts src/lib/evidence/evidenceExtractorOrchestrator.test.ts src/lib/tableNumericFactExtractor.test.ts src/lib/compiledEvidence.test.ts src/lib/groundedBrief.test.ts src/lib/noSourceEvidence.test.ts src/lib/evalDebugContract.test.ts src/lib/safetyEvidenceSignals.test.ts` -> exit 0, 38 tests passed

Downstream consumer smoke:

- `pnpm --filter @r3mes/backend-api exec vitest run src/lib/skillPipeline.test.ts src/lib/evidence/evidenceExtractorOrchestrator.test.ts src/lib/tableNumericFactExtractor.test.ts src/lib/compiledEvidence.test.ts src/lib/groundedBrief.test.ts src/lib/noSourceEvidence.test.ts src/lib/answerSpec.test.ts src/lib/safetyEvidenceSignals.test.ts src/lib/safetyGate.test.ts` -> exit 1
- Result: 7 test files passed, 2 test files failed; 69 tests passed, 10 tests failed.

## Known Failures / Backlog

- `answerSpec.test.ts`: 8 failures remain because AnswerSpec still consumes old-style text facts and domain/template logic. This belongs to Layer 25 AnswerSpec / AnswerPlan migration.
- `safetyGate.test.ts`: 2 failures remain because safety red-flag metrics still depend on old risk/red-flag semantics. This belongs to Layer 30 Safety Gate migration.

## Notion Update

- Updated Layer 24 Notion page `366217ac-9aec-818e-ad82-dd8b80ab85a7`.
- Recorded this as a hard cutover continuation after Layer 23: no `legacyText` adapter remains in Layer 24 runtime contract.

## Risk

This is a deliberate contract cleanup. Some downstream tests are expected to fail until Layer 25 and Layer 30 are migrated to consume typed evidence/coverage/readiness directly.

## Next Recommended Work

Continue to Layer 25 AnswerSpec / AnswerPlan. The first task should be to stop AnswerSpec from treating `CompiledEvidence.facts` as the primary answer substrate and make it consume `items`, `structuredFacts`, `coverage`, `sufficiency`, and `answerReadiness`.
