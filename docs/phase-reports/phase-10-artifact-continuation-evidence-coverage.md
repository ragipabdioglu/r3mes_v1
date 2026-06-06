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

## Incremental Closure - Concise List Evidence Ranking

Date: 2026-06-06 16:16:00 +03:00

### Scope
- Active roadmap phase: Phase 10 - Real Data Certification.
- Backlog owner touched: Phase 6 - Full Evidence Intelligence / context-evidence-coverage.
- Goal: finish the remaining list-evidence coverage gap where concise list items existed in evidence but long heading/prose facts consumed the answer/eval budget first.

### Changes
- Added generic list-task ranking that prioritizes concise list-item facts ahead of long explanatory prose when enough concise facts are available.
- Kept the logic evidence-shape based; no document-specific or fixture-specific literal was added.
- Preserved retrieval, source selection, reranker, composer, safety, parser, and UI behavior.

### Additional Verification
| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| pnpm --filter @r3mes/backend-api exec vitest run src/lib/skillPipeline.test.ts src/lib/hybridKnowledgeRetrieval.test.ts | 0 | pass | 55 tests passed |
| pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit | 0 | pass | Typecheck clean |
| pnpm --filter @r3mes/backend-api run build | 0 | pass | Prisma generate + tsc succeeded |
| pnpm local:status | 0 | pass | backend/dApp/ai-engine/Qdrant/Postgres healthy; llama false, LoRA unavailable |
| pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke | 1 | expected fail | 8/15 pass; gp_vs_project_types_list now passes; list_extraction bucket 2/2 |
| pnpm --filter @r3mes/backend-api run eval:real-data-certification | 0 | fail gate report generated | certificationBacklogCount 30, blockerCount 29 |

### Measured Impact
- G.P smoke improved from 7/15 to 8/15.
- `gp_vs_project_types_list` now passes.
- `list_extraction` bucket is now 2/2 for the G.P smoke suite.
- Certification backlog improved from 31/30 to 30/29.
- Remaining certification owners: Phase 7 answer presentation 22, Phase 4 retrieval 3, Phase 5 query/source 2, Phase 6 context-evidence 2, Phase 10 triage 1.

### Remaining Risks / Backlog
- G.P smoke remains red with 7 failed cases.
- Remaining Phase 6 context-evidence failures now appear outside the closed list-extraction target.
- Definition, code, comparison, and visual/layout failures remain for their proper phase owners.
- Overall release gate remains fail and should not be treated as product-ready.

## Incremental Closure - Event Evidence Eval Contract

Date: 2026-06-06 16:32:00 +03:00

### Scope
- Active roadmap phase: Phase 10 - Real Data Certification.
- Backlog touched: eval contract accuracy for evidence-only classification.
- Goal: close a false negative where an event/timing question had correct source-grounded text evidence and a clean final answer, but the fixture incorrectly required `procedure` evidence.

### Changes
- Added generic `event` and `timing` evidence-type aliases in the evidence-only scorer.
- Updated the G.P `Form Load olayı ne zaman çalışır?` fixture to require `event` evidence instead of `procedure`.
- No product runtime, retrieval, evidence extraction, composer, safety, parser, provider, or UI behavior was changed.

### Verification
| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| node JSONL parse smoke | 0 | pass | 15 G.P smoke cases parse successfully |
| pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit | 0 | pass | Typecheck clean |
| pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke | 1 | expected fail | 9/15 pass; `gp_form_load_event` now passes |
| pnpm --filter @r3mes/backend-api run eval:real-data-certification | 0 | fail gate | certificationBacklogCount 30, blockerCount 29 |

### Measured Impact
- G.P smoke improved from 8/15 to 9/15.
- `procedure_extraction` bucket is now 2/2.
- The release gate remains fail; global certification counts stayed 30 backlog / 29 blockers because production aggregate and other dataset blockers still remain.

### Decision
- Keep this as a Phase 10 eval-contract correction, not a product runtime fix.
- Remaining G.P failures still route to real owner phases: definition source/retrieval, code evidence, comparison/table evidence, and visual/layout evidence.

## Incremental Closure - Adjacent Comparison Evidence Context

Date: 2026-06-06 17:05:00 +03:00

### Scope
- Active roadmap phase: Phase 10 - Real Data Certification.
- Backlog owner touched: Phase 6 - Full Evidence Intelligence / context-evidence-coverage.
- Goal: close the generic comparison-evidence gap where retrieval selected the right V2 chunk, but evidence extraction dropped adjacent subject context required for a complete comparison answer.

### Changes
- Added a generic comparison evidence extractor that builds short adjacent sentence windows for comparison-style queries.
- Preserved subject + relation context when the source chunk contains a subject sentence followed by a comparison sentence.
- Kept the logic query-shape and evidence-shape based; no document-specific or fixture-specific literal was added.
- Preserved parser, retrieval scoring, reranker, composer, safety, provider, and UI behavior.

### Verification
| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| pnpm --filter @r3mes/backend-api exec vitest run src/lib/skillPipeline.test.ts | 0 | pass | 29 tests passed |
| pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit | 0 | pass | Typecheck clean |
| pnpm --filter @r3mes/backend-api run build | 0 | pass | Build succeeded after stopping the locked backend process |
| pnpm local:status | 0 | pass | backend/dApp/ai-engine/Qdrant/Postgres healthy; llama false, LoRA unavailable |
| pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke | 1 | expected fail | 10/15 pass; `gp_textbox_richtextbox_compare` now passes |
| pnpm --filter @r3mes/backend-api run eval:real-data-certification | 0 | fail gate | certificationBacklogCount 30, blockerCount 29 |

### Measured Impact
- G.P smoke improved from 9/15 to 10/15.
- `gp_textbox_richtextbox_compare` now passes without changing final composer behavior.
- `comparison_extraction` bucket improved to 2/3.
- Provider fallback ratios stayed 0 for the G.P smoke.
- Global certification remains fail at 30 backlog / 29 blockers; this is expected because remaining failures belong to other owner phases.

### Decision
- Keep this as a Phase 6 evidence coverage closure discovered during Phase 10 certification.
- Remaining G.P failures are still routed to definition retrieval/source, code evidence, table/comparison evidence, and visual/layout evidence owner work.

## Incremental Closure - Inflected Turkish Comparison Intent

Date: 2026-06-06 17:35:00 +03:00

### Scope
- Active roadmap phase: Phase 10 - Real Data Certification.
- Backlog owner touched: Phase 5 - Query / Source Intelligence and Phase 6 - Full Evidence Intelligence handoff.
- Goal: prevent inflected Turkish comparison wording from being misclassified as field extraction, which caused comparison evidence to be emitted as generic text facts.

### Changes
- Expanded generic Turkish comparison intent detection for inflected forms such as `farklarını`.
- Aligned requested-field suppression so comparison subjects are not converted into requested fields.
- Preserved table output constraint detection for comparison queries that ask for a table.
- No data-specific or fixture-specific literal was added.
- Preserved parser, retrieval scoring, reranker, composer, safety, provider, and UI behavior.

### Verification
| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| pnpm --filter @r3mes/backend-api exec vitest run src/lib/answerTaskDetector.test.ts src/lib/requestedFieldDetector.test.ts src/lib/skillPipeline.test.ts | 0 | pass | 47 tests passed |
| pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit | 0 | pass | Typecheck clean |
| pnpm --filter @r3mes/backend-api run build | 0 | pass | Build succeeded after controlled backend restart |
| pnpm local:status | 0 | pass | backend/dApp/ai-engine/Qdrant/Postgres healthy; llama false, LoRA unavailable |
| pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke | 1 | expected fail | 11/15 pass; `gp_arrays_collections_table_compare` now passes |
| pnpm --filter @r3mes/backend-api run eval:real-data-certification | 0 | fail gate | certificationBacklogCount 30, blockerCount 29 |

### Measured Impact
- G.P smoke improved from 10/15 to 11/15.
- G.P `comparison_extraction` bucket is now 3/3.
- `gp_arrays_collections_table_compare` now routes as `compare_concepts` and emits `comparison_point` evidence.
- Provider fallback ratios stayed 0.
- Global certification remains fail at 30 backlog / 29 blockers; remaining failures are definition retrieval/source, code evidence, and visual/layout evidence.

### Decision
- Keep this as a generic Turkish query/task detection correction.
- Do not add domain-specific field rules for comparison subjects.
- Remaining G.P failures should continue through their owner phases instead of composer or fixture hacks.

## Incremental Closure - Local Import Chat-Ready Lifecycle

Date: 2026-06-06 20:50:00 +03:00

### Scope
- Active roadmap phase: Phase 10 - Real Data Certification.
- Owner-phase closure touched: Phase 2/3 ingestion-storage handoff discovered by real-data certification.
- Goal: make local folder imports finish the same chat-ready lifecycle expected by retrieval filters after successful Qdrant V2 upsert.

### Changes
- Updated local knowledge folder import so every imported document is marked `chunkStatus`, `embeddingStatus`, `vectorIndexStatus`, `qualityStatus`, and `readinessStatus` as `READY` after Qdrant point upsert succeeds.
- Reingested the G.P PDF collection with the fixed generic lifecycle path.
- Updated G.P smoke and real-data certification fixture collection ids to the newly reingested V2 collection.
- No retrieval scoring, composer, safety, parser behavior, UI, or provider logic was changed.
- No data-specific literal was added to core logic; G.P-specific ids only live in eval fixture/manifest/report context.

### Verification
| Command | Exit code | Result | Note |
| --- | ---: | --- | --- |
| pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit | 0 | pass | Typecheck clean |
| pnpm --filter @r3mes/backend-api run build | 0 | pass | Build succeeded after stopping backend DLL lock |
| pnpm --filter @r3mes/backend-api run import:local-knowledge-folder -- --dir "..\\..\\data\\G.P" --collection-name "G.P PDFleri V2 - Phase 3 Verified" --wallet "<dev-wallet>" --replace | 0 | pass | 10 documents, 207 chunks, 0 embeddingText fallback |
| pnpm local:status | 0 | pass | backend/dApp/ai-engine/Qdrant/Postgres healthy; llama false, LoRA unavailable |
| pnpm --filter @r3mes/backend-api run qdrant:reindex:status -- --collection-id cmq2naxrb0002klscmec979ps | 0 | pass | 207/207 BGE-M3 points; valid payload V2; deterministic fallback 0 |
| pnpm --filter @r3mes/backend-api exec vitest run src/lib/knowledgeIngestionProcessor.test.ts src/knowledgeRoutes.test.ts | 0 | pass | 7 tests passed |
| pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke | 1 | expected fail | 11/15 pass; runtime coverage 1.0; provider fallback ratios 0 |
| pnpm --filter @r3mes/backend-api run eval:real-data-certification | 0 | fail gate | certificationBacklogCount 30, blockerCount 29 |

### Measured Impact
- Fixed the local import lifecycle drift where Qdrant had 207 valid points but DB document readiness stayed `PENDING`.
- New G.P V2 collection: `cmq2naxrb0002klscmec979ps`.
- DB readiness now shows 10/10 documents `READY` and 207/207 chunks retrievable by existing retrieval filters.
- G.P smoke is back to the real quality baseline: 11/15 pass, not 0/15 access-denied noise.
- Remaining G.P fails are real retrieval/evidence gaps:
  - `gp_dotnet_framework_definition`
  - `gp_combobox_definition`
  - `gp_button3_click_code`
  - `gp_ders8_visual_layout_controls`

### Decision
- Treat this as required Phase 2/3 closure discovered during Phase 10 certification.
- Continue Phase 10 using V2-reingested data only.
- Do not solve the remaining four cases with fixture hacks or document-specific literals; keep them assigned to Phase 4/5/6/7 owner work according to diagnostics.

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
