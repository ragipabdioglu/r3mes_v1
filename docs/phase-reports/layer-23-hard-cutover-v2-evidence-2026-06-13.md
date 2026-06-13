# Layer 23 Hard Cutover: V2 Evidence Extraction

Date: 2026-06-13

## Scope

User explicitly approved breaking compatibility to remove the old Layer 23 evidence architecture. This slice hard-cuts Layer 23 from legacy string/domain extractors to the Notion target direction: typed, artifact-aware, EvidenceBundle-first extraction.

## What Changed

- `skillPipeline.ts` was reduced to query planning plus V2 evidence extraction orchestration.
- Removed old medical/finance/domain fragment extraction, ranking, red flag, supporting context and legacy text-bucket production from Layer 23.
- Removed `legacySeeds` from `extractEvidenceV2`; V2 orchestrator no longer accepts old `directAnswerFacts`, `usableFacts`, `supportingContext`, `riskFacts` or `notSupported` as evidence input.
- Removed core share-group raw regex extraction from `tableNumericFactExtractor.ts`.
- Raw numeric fallback now requires a specific requested field; generic fields such as `oran`, `tutar`, `value`, `amount`, `rakam` cannot promote raw table rows without table artifacts.
- `EvidenceExtractorOutput` no longer exposes old string buckets:
  - removed `directAnswerFacts`
  - removed `supportingContext`
  - removed `riskFacts`
  - removed `notSupported`
  - removed `usableFacts`
  - removed `uncertainOrUnusable`
  - removed `redFlags`
- Added V2 helper accessors:
  - `evidenceOutputUsableItems`
  - `evidenceOutputUsableTextFacts`
  - `evidenceOutputLimitText`
  - `evidenceOutputRiskText`
  - `evidenceOutputStructuredFacts`
  - `createEmptyEvidenceOutput`
- Downstream consumers were moved away from direct old evidence fields:
  - `compiledEvidence.ts`
  - `answerSpec.ts`
  - `groundedBrief.ts`
  - `noSourceEvidence.ts`
  - `domainPolicy.ts`
  - `hybridKnowledgeRetrieval.ts`
  - `knowledgeRetrieval.ts`
  - `qdrantRetrieval.ts`
  - `safetyEvidenceSignals.ts`
  - `safetyGate.ts`
  - `chatProxy.ts`

## Contract State

Layer 23 source of truth is now:

- `EvidenceBundle`
- `EvidenceItem[]`
- `StructuredFact[]`
- coverage diagnostics
- source ids
- missing info

Old string buckets are no longer part of `EvidenceExtractorOutput`.

## Verification

Passed:

- `pnpm --filter @r3mes/backend-api exec tsc --noEmit` -> exit 0
- `pnpm --filter @r3mes/backend-api exec vitest run src/lib/skillPipeline.test.ts src/lib/evidence/evidenceExtractorOrchestrator.test.ts src/lib/tableNumericFactExtractor.test.ts` -> exit 0, 20 tests passed

Additional downstream smoke:

- `pnpm --filter @r3mes/backend-api exec vitest run src/lib/skillPipeline.test.ts src/lib/evidence/evidenceExtractorOrchestrator.test.ts src/lib/tableNumericFactExtractor.test.ts src/lib/compiledEvidence.test.ts src/lib/groundedBrief.test.ts src/lib/noSourceEvidence.test.ts src/lib/answerSpec.test.ts src/lib/safetyEvidenceSignals.test.ts src/lib/safetyGate.test.ts` -> exit 1
- Result: 4 test files passed, 5 test files failed; 64 tests passed, 21 tests failed.

Downstream failures are expected after the hard cutover because many tests still construct legacy `EvidenceExtractorOutput` fixtures or expect old bucket behavior. Runtime TypeScript is clean; fixture/expectation migration remains.

## Notion Update

- Updated Layer 23 Notion page `366217ac-9aec-81e1-8b94-eff396e5ec06`.
- Recorded this as an explicit architectural decision/deviation: the previous compatibility bridge is superseded by the user's hard-cutover instruction for Layer 23.

## Known Failures / Backlog

- `compiledEvidence.test.ts`: older cases expect legacy string facts to remain populated from old buckets. These must be rewritten around `EvidenceBundle` and `StructuredFact`.
- `answerSpec.test.ts`: older cases build evidence using legacy fields; those tests now produce no V2 facts and should be moved to AnswerPlan/Composer contract fixtures.
- `groundedBrief.test.ts`: label expectation must change from `KULLANILABILIR GERCEKLER` to typed evidence wording or use V2 bundle fixtures.
- `noSourceEvidence.test.ts`: old no-source fixtures must use `createEmptyEvidenceOutput` or real V2 bundle fixtures.
- `safetyGate.test.ts`: old red-flag bucket expectations must be moved to Safety/Policy layer or V2 risk evidence once Layer 24/25 contracts decide risk representation.

## Risk

This is a deliberate breaking cutover. Some downstream behavior may become more conservative until Layer 24/25 consume typed facts directly everywhere and old fixture assumptions are rewritten.

## Next Recommended Work

Before continuing Layer 24/25 implementation, migrate downstream tests to V2 fixtures and remove remaining `legacyText` naming from CompiledEvidence if the target architecture requires zero legacy vocabulary beyond migration docs.
