# Phase 6 Closure Report - Full Evidence Intelligence

Date: 2026-06-01
Phase: Faz 6 - Full Evidence Intelligence
Controller: Atlas
Verifier: Newton

## Decision

Faz 6 is closed. The evidence layer is now observable enough to separate retrieval/evidence sufficiency from answer/composer/safety presentation failures.

Faz 7 can start. The remaining visible answer-quality failures are not Faz 6 blockers; they are now diagnosable as Answer Intelligence and Safety Presentation backlog.

## What Changed

- Added `CompiledEvidenceV2` diagnostics for coverage, sufficiency, requested fields, source ids, and confidence reasons.
- Added eval/debug aggregation for compiled evidence coverage and sufficiency.
- Added a generic field coverage resolver without dataset-specific literals in core logic.
- Added `answerBaseline.evidenceToAnswerPath` to show whether sufficient evidence still falls into fallback/template/safety paths.
- Added `CompiledEvidence.factLevelDiagnostics` and eval aggregation for selected facts, structured fact kinds, source distribution, and contradiction sources.

## Contract Changes

- `CompiledEvidenceV2`
- `EvidenceCoverageDiagnostics`
- `EvidenceSufficiencyDiagnostics`
- `FieldCoverageResult`
- `AnswerBaseline.evidenceToAnswerPath`
- `EvidenceFactLevelDiagnostics`
- `EvalSummary.answerBaselineQuality.factLevelDiagnostics`

All diagnostics are debug/eval/internal only. Public response shape is unchanged.

## Verification

| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/compiledEvidence.test.ts src/lib/evidenceBundle.test.ts src/lib/fieldCoverageResolver.test.ts src/lib/evalDebugContract.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | Pass | 5 files, 24 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck clean |
| `node --check apps/backend-api/scripts/run-grounded-response-eval.mjs` | 0 | Pass | Eval runner syntax clean |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 8/17 passed; remaining failures classified for Faz 7 |
| `GET /ready/rag-runtime` | 0 | Pass | Backend runtime ready in local-dev profile |

## Evidence Quality Snapshot

- `compiledEvidenceQuality.observedCases`: 16
- `compiledEvidenceQuality.coverageRatio`: 0.941
- Coverage status: complete 10, partial 6
- Sufficiency status: sufficient 9, partial 6, contradictory 1
- `missingFieldCaseRatio`: 0.375
- `shouldAnswerRatio`: 1

## Evidence To Answer Path Snapshot

- `evidence_sufficient_fallback`: 9
- `evidence_partial_fallback_or_synthesis`: 6
- `evidence_contradictory_safety`: 1
- `no_compiled_evidence`: 1

Interpretation: Faz 6 successfully proves that many cases have enough evidence but still hit fallback/template/safety answer paths. This is exactly the Faz 7 target.

## Fact-Level Diagnostics Snapshot

- Observed cases: 16
- Coverage ratio: 0.941
- Structured fact kinds:
  - `table_row`: 13
  - `numeric_value`: 0
  - `table_cell`: 0
  - `text_claim`: 0
- Bundle kind counts:
  - `text_fact`: 79
  - `table_fact`: 13
  - `source_limit`: 22
  - `contradiction`: 5

Interpretation: the system can see table rows and text facts, but normalized numeric facts are still not mature. Faz 7 must not pretend numeric extraction is solved; it should plan answers from observed evidence and preserve uncertainty.

## Public / Debug Boundary

- `chatResponseBoundary` tests pass.
- `answerBaseline`, compiled evidence diagnostics, fact-level diagnostics, provider details, retrieval diagnostics, and internal scores remain debug/eval-only.
- Public response remains answer, sources, suggestions, and minimal status.

## Remaining Warnings

- `eval:answer-quality` remains 8/17 by design; failures are now classified instead of hidden.
- 7 cases diagnose as `composer_or_model_generation_failure`.
- 7 cases diagnose as `safety_policy_or_presentation_failure`.
- Answer-quality failure buckets include incomplete answer, wrong output format, template answer, and table field mismatch.
- Structured numeric facts are not produced yet (`numeric_value: 0`), so table/numeric final answers need Faz 7 answer planning/rendering discipline.

## Not Faz 6 Blockers

- Composer still uses fallback/template paths when evidence is sufficient.
- Safety presentation can rewrite otherwise usable answers.
- Numeric/table rendering is incomplete.
- Qwen is not yet used as a disciplined synthesis path for these cases.

These are Faz 7 Full Answer Intelligence concerns.

## Faz 7 Entry Conditions

Faz 7 can start with these constraints:

- Use `answerBaseline.evidenceToAnswerPath` to target fallback/template leakage.
- Use `CompiledEvidenceV2` sufficiency to decide deterministic renderer vs Qwen synthesis.
- Use `factLevelDiagnostics` to avoid overclaiming numeric/table certainty.
- Do not weaken safety; separate safety policy from presentation quality.
- Keep public/debug boundary intact.

## Commits In Scope

- `9d75703 Add compiled evidence v2 diagnostics`
- `b238697 Aggregate evidence coverage diagnostics`
- `e98028c Add generic field coverage resolver`
- `fa48a7d Add evidence to answer path diagnostics`
- `779e88a Add fact-level evidence diagnostics`

## Final Status

Faz 6 tamamlandi: Evet.
Faz 7'ye gecis uygun: Evet.
Minimum closure gerekiyor: Hayir.
