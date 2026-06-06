# Phase 10 / Phase 6 Handoff - Artifact Continuation Evidence Coverage

Date: 2026-06-06 15:43:08 +03:00

## Scope
- Active roadmap phase: Phase 10 - Real Data Certification.
- Backlog owner touched: Phase 6 - Full Evidence Intelligence / context-evidence-coverage.
- Goal: improve evidence coverage when the selected chunk is the start of an artifact and required evidence continues in adjacent same-artifact chunks.

## Changes
- Added same-artifact continuation context expansion before evidence extraction.
- Added artifact continuation diagnostics to retrieval diagnostics.
- Preserved final source/candidate selection; source resolution and reranker scoring were not changed.
- Normalized inline bullet markers before evidence pruning.
- Made list-task pruning preserve more nearby list items when the query contract is list_items.
- Made rawContent run through structure-specific evidence extractors for list/definition/numeric/table facts without blindly promoting raw prose.
- Made near-heading list extraction preserve document order instead of score-ordering list items.

## Files Changed
- apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts
- apps/backend-api/src/lib/hybridKnowledgeRetrieval.test.ts
- apps/backend-api/src/lib/skillPipeline.ts
- apps/backend-api/src/lib/skillPipeline.test.ts

## Verification
| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| pnpm --filter @r3mes/backend-api exec vitest run src/lib/hybridKnowledgeRetrieval.test.ts src/lib/skillPipeline.test.ts | 0 | pass | 54 tests passed |
| pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit | 0 | pass | Typecheck clean |
| pnpm --filter @r3mes/backend-api run build | 0 | pass | Prisma generate + tsc succeeded after backend restart |
| pnpm local:status | 0 | pass | backend/dApp/ai-engine/Qdrant/Postgres healthy; llama false, LoRA unavailable |
| pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke | 1 | expected fail | 7/15 pass; gp_vs_project_types_list improved from all 5 missing terms to 2 missing terms |
| pnpm --filter @r3mes/backend-api run eval:real-data-certification | 0 | fail gate report generated | certificationBacklogCount 31, blockerCount 30 |

## Measured Impact
- G.P smoke remains 7/15 and release gate remains fail.
- Target case gp_vs_project_types_list now produces 5 facts and captures more list evidence.
- Missing terms reduced in the target case: previously Windows Form Application, WPF Application, Console Application, ASP.NET Web Application, Class Library were all missing; latest run still misses ASP.NET Web Application and Class Library.
- Evidence bundle list_item count in smoke increased from 12/15 range to 15 total list_item observations.

## Remaining Risks / Backlog
- Phase 6 still has context-evidence-coverage blockers; artifact continuation alone is not enough.
- Long list extraction still needs better item-level coverage/required-term preservation inside EvidenceBundle.
- Code understanding blocker gp_button3_click_code remains; selected evidence is still heading/intro rather than code method body.
- Visual/layout blocker remains; current parsed text does not provide enough visual artifact evidence.
- Overall certification remains blocked mostly by Phase 7 answer presentation and remaining Phase 4/5/6 cases.

## Boundary Check
- No composer/safety/UI/parser behavior rewrite was done.
- No data-specific literal was added to core logic.
- Tests use generic project/list examples, not G.P fixture literals.
- Public/debug response boundary was not changed.
