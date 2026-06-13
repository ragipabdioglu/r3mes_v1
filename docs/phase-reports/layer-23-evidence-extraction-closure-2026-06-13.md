# Layer 23 - Evidence Extraction Closure Report

Date: 2026-06-13

## Scope

Layer 23 was updated to move evidence extraction away from legacy string fragments toward a typed, artifact-aware V2 extraction path.

This report covers only Evidence Extraction. It does not close Structured/Compiled Evidence, AnswerPlan, Composer, Safety, Retrieval, or UI layers.

## What Changed

- Added V2 evidence extractor modules under `apps/backend-api/src/lib/evidence/`.
- Added `extractEvidenceV2` orchestrator as the owner of typed evidence extraction.
- Extended `EvidenceBundle` with `coverage`, `extractorVersion`, `extractorBreakdown`, and typed item fields.
- Wired `skillPipeline.ts` to call `extractEvidenceV2`.
- Added a backward-compatible adapter from V2 `StructuredFact` to legacy `directAnswerFacts` and `usableFacts`.
- Removed dead legacy finance/table fragment extraction functions from `skillPipeline.ts`.
- Replaced column-specific literal matching in `tableNumericFactExtractor.ts` with generic column hint matching.
- Added evidence domain-pack diagnostics without making domain packs the final extractor authority yet.

## Contracts Added Or Updated

- `EvidenceItem.subject`
- `EvidenceItem.field`
- `EvidenceItem.value`
- `EvidenceItem.unit`
- `EvidenceItemCoverage`
- `EvidenceBundle.coverage`
- `EvidenceBundleDiagnostics.extractorVersion`
- `EvidenceBundleDiagnostics.extractorBreakdown`
- `EvidenceExtractorInputV2`
- `EvidenceExtractorOutputV2`
- `EvidenceExtractionDiagnostics`
- `EvidenceDomainPack`

## Validation

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec tsc --noEmit` | 0 | Pass | TypeScript clean |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/tableNumericFactExtractor.test.ts src/lib/skillPipeline.test.ts src/lib/evidence/evidenceExtractorOrchestrator.test.ts src/lib/compiledEvidence.test.ts` | 0 | Pass | 54 tests passed |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | Expected fail | 14/15 pass; remaining visual/layout coverage gap |
| `pnpm --filter @r3mes/backend-api run eval:by-course-smoke` | 1 | Expected fail | 5/12 pass; failures classified as retrieval/evidence or composer/model backlog |

## Remaining Failures

- `gp_ders8_visual_layout_controls`: evidence-only required context terms missing, visual/layout extraction gap. Target layer: Document Understanding / Visual Layout / Evidence Coverage.
- `by_big_data_5v_list` and `by_big_data_5v_bullets_format`: context coverage failure. Target layer: Retrieval/Evidence Coverage and later Composer.
- `by_yapay_zeka_definition` and `by_ai_ml_dl_compare`: evidence can be sufficient but answer quality fails. Target layer: AnswerPlan/Composer.

## Legacy Audit

- Dead legacy table/finance fragment functions were removed from `skillPipeline.ts`.
- Active legacy seed generation still exists in `skillPipeline.ts` for backward compatibility.
- `rankEvidenceFacts` and `evidenceRelevanceScore` still contain domain/lexicon scoring behavior. This is not fully product-final and must move toward registry/domain-pack driven scoring in a later cleanup.
- V2 evidence is now prepended into legacy facts to keep old downstream contracts alive until Layer 24/25 replace the consumers.

## Data-Specific Literal Audit

- No core evidence code contains G.P/B.Y/KAP company/document-specific literals such as `CheckBox`, `ComboBox`, `Ders 7`, `EREGL`, `FROTO`, or `KCHOL`.
- `kap` grep hits in this layer are false positives from Turkish `kapsam`.
- Domain-pack aliases are allowed as configuration-like domain vocabulary, not hardcoded final routing/composer logic.

## Public / Debug Boundary

- This layer changes internal evidence contracts only.
- No public response shape was changed.
- Evidence diagnostics remain debug/eval-oriented and are not intended for public payloads.

## Risks

- V2 evidence and legacy evidence coexist, so duplicate semantic content can appear across `structuredFacts`, `evidenceBundle.items`, and legacy string facts.
- Full removal of legacy evidence ranking must wait until Structured/Compiled Evidence and AnswerPlan consumers are fully migrated.
- Visual/layout evidence remains limited by parser/document-understanding quality.

## Decision

Layer 23 is ready for user review as a closure candidate.

Recommended next step after approval: Layer 24 - Structured Evidence / Compiled Evidence, where `CompiledEvidence` becomes the primary consumer of V2 evidence and legacy string facts are further reduced.
