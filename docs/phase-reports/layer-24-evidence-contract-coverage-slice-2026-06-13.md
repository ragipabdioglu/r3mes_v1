# Layer 24 - Evidence Contract & Coverage Slice

Date: 2026-06-13

## Scope

This slice starts Layer 24, the Evidence Contract & Coverage layer. The goal is to make `CompiledEvidenceV2` the central evidence contract while preserving legacy compatibility for existing answer/composer paths.

This slice does not rewrite AnswerPlan, Composer, Safety behavior, Retrieval, or UI.

## Notion Alignment

Implemented against `Katman 24 - Evidence Contract & Coverage Layer`.

Target concepts covered in this slice:

- `CompiledEvidenceV2`
- `EvidenceSourceMap`
- `EvidenceConfidence`
- `EvidenceAnswerReadiness`
- `LegacyEvidenceText`
- typed evidence-first grounded brief
- eval/debug metrics for typed evidence and source map coverage

## What Changed

- Extended `EvidenceItem` with optional `role` and `score`.
- Added `EvidenceSourceRef` and `EvidenceSourceMap`.
- Added `EvidenceConfidence` with `level`, `score`, `reasons`, and `penalties`.
- Added `EvidenceAnswerReadiness` with explicit answer/no-source/partial/contradiction mode.
- Added `LegacyEvidenceText` as a compatibility adapter for old string consumers.
- `compileEvidence()` now returns V2 fields: `items`, `sourceMap`, `evidenceConfidence`, `answerReadiness`, and `legacyText`.
- `buildCompiledEvidenceBrief()` now prioritizes typed evidence items before legacy facts.
- `EvalDebugContract.answerBaseline.compiledEvidence` now exposes:
  - `answerReadiness`
  - `evidenceConfidence`
  - `sourceMapCompleteness`
  - `typedEvidenceRatio`
  - `legacyFallbackUsed`

## Validation

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec tsc --noEmit` | 0 | Pass | TypeScript clean |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/compiledEvidence.test.ts src/lib/groundedBrief.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | 20 tests passed |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | Expected fail | 14/15; remaining visual/layout coverage gap |

## Remaining Risks

- `CompiledEvidenceV2` now carries typed contract fields, but downstream AnswerPlan/Composer still partly consume legacy `facts`.
- `sourceMap` is built from available evidence item/source refs; collection/document ids are only populated when upstream provides them.
- `typedEvidenceRatio` is currently debug/eval diagnostic, not a production gate.
- The GP visual/layout fail remains outside this layer and belongs to document understanding / visual artifact coverage.

## Next Step

Continue Layer 24 by reducing downstream reliance on `facts[]` and making coverage/readiness the primary decision input for AnswerPlan/Safety handoff.
