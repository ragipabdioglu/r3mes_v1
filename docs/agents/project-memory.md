# R3MES Agent Project Memory

## Purpose

This directory implements the fixed-agent operating protocol approved on
2026-05-27. Notion phase context pages remain the durable architectural source
of truth; these files are the short working charter read before each task.

## Current Phase State

- Completed: Faz 0, Faz 1, Faz 2, Faz 3, Faz 4, Faz 5.
- Current implementation phase: Faz 6 - Full Evidence Intelligence.
- Faz 5 Dilim 1 completed metadata/source suggestion quality tie-break.
- Faz 5 Dilim 2 completed source resolution profile scorer wiring.
- SourceResolutionPlan now receives metadata/profile ranked candidates from chat runtime.
- Unranked accessible collections remain visible with `fallback_profile_score_missing`.
- Collection-suggestion now passes 5/5 after backend restart on new dist.
- Latest Faz 5 verification: collection-suggestion 5/5, retrieval-quality 16/16, ui-reality 5/5 with provider fallback 0.
- Faz 5 Dilim 3 replaced hardcoded requested-field aliases with generic phrase/cue extraction.
- Field extraction no longer treats `ne yapmalıyım` procedure queries as requested fields.
- Table numeric bridge no longer infers field semantics from stripped row numbers without artifacts.
- Latest Dilim 3 gates: requested-field/table numeric tests 28/28, retrieval-quality 16/16, collection-suggestion 5/5, ui-reality 5/5.
- Faz 5 Dilim 4 added `SourceResolutionPlan.decisionDiagnostics` for query/source decision traceability.
- Dilim 4 does not change retrieval scoring, composer, parser, safety, or public response shape.
- Dilim 4 gates: source-resolution/knowledge/retrieval-contract tests 45/45, BGE-M3 smoke pass, reranker smoke pass, retrieval-quality 16/16, collection-suggestion 5/5.
- UI-reality passes 5/5 but CPU reranker latency/fallback warning remains a Faz 6 provider-budget backlog item.
- Faz 5 Dilim 5 added source-resolution risk diagnostics: autoSelectionScope, top/second score, score gap, and riskSignals.
- Dilim 5 gates: source-resolution/knowledge/retrieval-contract tests 46/46, backend typecheck/build, BGE-M3 smoke, reranker smoke, retrieval-quality 16/16, collection-suggestion 5/5, ui-reality 5/5 with known local CPU reranker warning.
- Faz 5 Dilim 6 added eval summary aggregation for source-resolution risk diagnostics under `routerQuality.sourceResolution`.
- Dilim 6 gates: eval runner syntax, source-resolution tests 46/46, backend typecheck, collection-suggestion 5/5, retrieval-quality 16/16, ui-reality 5/5 with known local CPU reranker warning.
- Faz 5 Dilim 7 added UI-reality trace assertions for source-resolution autoSelectionScope, selectionReason, and riskSignals.
- Dilim 7 gates: ui-reality 5/5 and source-resolution/knowledge/retrieval-contract tests 46/46; local CPU reranker warning remains Faz 6 backlog.
- Faz 5 closure completed with 71 query/source tests, backend typecheck, provider smokes, collection-suggestion 5/5, retrieval-quality 16/16, ui-reality 5/5.
- Faz 6 starts with known backlog: evidence coverage gaps plus local CPU reranker/provider-budget warning.
- Faz 6 Dilim 1 added `CompiledEvidenceV2` diagnostics with coverage and sufficiency decisions.
- Dilim 1 did not change retrieval, parser, composer, safety, Qdrant, or public response behavior.
- Dilim 1 gates: compiledEvidence/evidenceBundle/evalDebugContract tests 16/16, backend typecheck, evidence-only 1/1.
- Answer-quality remains 8/17 and is expected Faz 6/7 backlog, not Dilim 1 blocker.
- Next Faz 6 slice should aggregate coverage/sufficiency in evidence diagnostics/eval summaries.
- Faz 6 Dilim 2 added coverage/sufficiency to eval debug contract and eval summaries.
- Dilim 2 gates: evalDebug/compiledEvidence tests 13/13, backend typecheck, eval runner syntax, public boundary tests 3/3, evidence-only 1/1.
- Dilim 2 answer-quality remains 8/17 but now reports coverage complete 5, partial 11, sufficiency sufficient 4, partial 11, contradictory 1.
- Dilim 2 found requested-field coverage gap: compiledEvidence missing-field case ratio 0.688 in answer-quality.
- Windows Prisma generate hit locked DLL; dist was updated with tsc and backend restarted for runtime eval.
- Faz 6 Dilim 3 added generic `fieldCoverageResolver` for requested-field to structured-fact matching.
- Dilim 3 assumes V2 data for quality judgment and does not change parser/retrieval/composer/safety.
- Dilim 3 gates: resolver/compiledEvidence/answerPlan/debug tests 21/21, typecheck, evidence-only 1/1, public boundary/resolver tests 22/22.
- Dilim 3 answer-quality remains 8/17, but coverage improved: complete 10/partial 6, missing-field ratio 0.375.
- Next Faz 6 slice should inspect sufficiency-to-composer/safety path diagnostics before changing answer behavior.
- Faz 6 Dilim 4 added `answerBaseline.evidenceToAnswerPath` diagnostics.
- Dilim 4 does not change parser/retrieval/composer/safety or public response shape.
- Dilim 4 gates: evalDebug/boundary tests 3/3, typecheck, eval runner syntax, backend readiness, evidence-only 1/1.
- Dilim 4 answer-quality remains 8/17, expected; new diagnostic shows 9/9 sufficient-evidence cases still fall to fallback paths.
- Faz 7 backlog: planned renderer/composer must reduce fallback/template usage when evidence is sufficient.
- Faz 6 Dilim 5 added `CompiledEvidence.factLevelDiagnostics` and eval aggregation.
- Dilim 5 keeps parser/retrieval/composer/safety behavior unchanged; diagnostics are debug/eval only.
- Dilim 5 gates: compiled/evalDebug/boundary tests 17/17, typecheck, eval runner syntax, backend readiness, evidence-only 1/1.
- Dilim 5 answer-quality remains 8/17; fact diagnostics show 16 observed cases, table_row 13, numeric_fact 0, text_fact 79.
- Next step should be Faz 6 closure verification before Faz 7 answer intelligence.
- Faz 6 closure completed with evidence intelligence accepted.
- Closure gates: compiled/evidence/field/evalDebug/boundary tests 24/24, backend typecheck, eval runner syntax, backend readiness, evidence-only 1/1.
- Closure answer-quality remains expected 8/17; this is Faz 7 backlog, not Faz 6 blocker.
- Evidence coverage: 16 observed cases, 0.941 coverage ratio, sufficient 9, partial 6, contradictory 1.
- Evidence-to-answer path shows 9 sufficient-evidence cases still using fallback/template paths.
- Fact-level diagnostics show table_row 13, numeric_fact 0, text_fact 79.
- Faz 7 should focus on answer planning/rendering/safety presentation without weakening evidence contracts.
- Faz 7 Slice 1 started answer intelligence with structured renderer path baseline.
- Slice 1 changed only domain composer label resolution, composer path classification, and tests.
- Gates: domain composer/boundary/evalDebug tests 20/20, backend typecheck, dist build, backend readiness, evidence-only 1/1.
- Answer-quality remains 8/17, expected; composer paths improved to planned_structured 5, planned_fallback_template 3, safety_fallback 9.
- Next Faz 7 slice should target partial evidence rendering and safety presentation bridge.
- Faz 7 Slice 2 used real Pascal worker and Newton verifier agents.
- Slice 2 added partial field extraction text-fact rendering in domainEvidenceComposer only.
- Gates: composer/boundary/evalDebug tests 23/23, backend typecheck, dist build, readiness, evidence-only 1/1.
- Answer-quality remains 8/17 but failure count improved 35 -> 29 and answer-quality failure rate 0.412 -> 0.294.
- Newton warning: safetyFallbackRenderer can still bypass partial renderer; next slice should bridge that path.
- Ai-engine local verification used LoRA-free CPU BGE-M3/reranker mode.
- Faz 4 acceptance should use the Phase 3 Verified B.Y and G.P collections.
- BGE-M3 and QdrantPayloadV2 are verified Phase 3 backbone work.
- LoRA is not part of knowledge correctness; chat must retain a LoRA-free path.

## Fixed Roster

| Responsibility | Actor | Agent ID | Product Code Write Permission |
| --- | --- | --- | --- |
| Architecture controller | Atlas / main Codex thread | Main thread | No, except announced tiny integration repair |
| Explorer / risk auditor | Locke | Historical / inactive | No |
| Contract and implementation worker | Pascal | `019e8021-45a1-7911-a09c-8d4c55608442` | Yes, assigned files only |
| Verifier / eval guard | Newton | `019e8024-3c25-7901-88c8-0cabc37fda9e` | No |
| Reserve | Huygens | `019e611e-e0de-7540-b718-2838b670f4a4` | Only after user approval |

## Non-Negotiable Rules

- Do not create a new subagent unless the user explicitly authorizes it.
- All other prior agents are historical/inactive.
- One implementation slice has one writer; do not write the same file in parallel.
- Out-of-phase findings are recorded in the proper backlog, not patched in.
- Public/debug boundary, strict fallback policy, and failure taxonomy are verified per slice.
- Core logic must not contain dataset-specific literals; fixtures and generated content may.
- Do not perform destructive cleanup without audit and user approval.

## Required Read Order

1. Relevant Notion Phase Context and Global Contract Map entries.
2. This project memory file.
3. The assigned role charter in this directory.
4. Only the source files owned by the assigned task.

## Standard Stage Flow

1. Atlas defines a bounded task and file ownership.
2. Locke audits first only when the scope is new or risky.
3. Pascal implements within ownership.
4. Newton independently verifies the diff and required gates.
5. Atlas accepts or rejects, commits/pushes accepted work, and updates Notion.

## Search and Reporting Limits

- No unscoped repository-wide scans.
- Default search budget is five targeted `rg` searches per task; explain expansion.
- Agent handoffs are at most 80 lines; per-task memory additions are at most 15 lines.
- Report test results as command, exit code, outcome, and failure reason; omit raw logs.

## Latest Phase 7 Note

- Slice 3 added a narrow low-grounding safety fallback bridge in `safetyFallbackRenderer`.
- Domain-safe must remain cautious and must not be forced into concise missing-field fallback.
- Latest answer-quality baseline after Slice 3: 8/17 pass, failure count 29, answer-quality failure rate 0.294.
- Remaining Faz 7 focus: safety presentation compatibility and KAP/table numeric answer planning, not retrieval or parser changes.

## Latest Phase 7 Slice 4 Note

- Slice 4 reconciled repaired presentation with answer-quality-only safety rails.
- Real rails such as source metadata mismatch and risky certainty still block/rewrite.
- Partial evidence answers with explicit missing-field disclosure no longer fail as table mismatch solely due plan missing fields.
- Latest answer-quality baseline after Slice 4: 10/17 pass, failure count 23, non-KAP bucket 6/7.

## Latest Phase 7 Slice 5 Note

- Slice 5 narrowed structured fact row-label recovery to exact token-span matching from `rawRow`/provenance.
- Do not recover labels by taking all text before the first numeric value; that caused table-header label pollution.
- Latest answer-quality baseline after Slice 5: 12/17 pass, failure count 20, raw table dump rate 0.
- Remaining Faz 7 fails are FROTO/KCHOL field completeness, share-group table mismatch, zero-value extraction, and protected contradiction safety.

## Latest Phase 7 Slice 6 Note

- Slice 6 lets table-shaped AnswerPlan requests select existing table structured facts when literal field labels do not match.
- This is generic operation-level behavior, not KAP/company/document-specific logic.
- Latest answer-quality baseline after Slice 6: 13/17 pass, failure count 17, answer-quality failure rate 0.176.
- FROTO share-group case now passes; remaining fails: FROTO net profit, KCHOL share groups, KCHOL zero row, protected contradiction safety.

## Latest Phase 7 Slice 7 Note

- Slice 7 cleans generic output/exclusion instructions before requested field IDs are created.
- Phrases like `maddelerle`, `karıştırma`, `kullanma`, `tek satır cevap`, and `bu iki grubu` must not become missing fields.
- Latest answer-quality baseline after Slice 7: 14/17 pass, failure count 14, tableFieldMismatchRate 0.
- Remaining fails: FROTO exact net profit value, KCHOL explicit zero row, and protected contradiction safety.

## Latest Phase 7 Slice 8 Note

- Slice 8 handles generic row/value cues such as `hangi rakam`, `satırı kaç`, and `sadece sonucu yaz`.
- Field-list extraction now cleans the whole candidate before splitting, so subject prefixes do not become requested fields.
- Latest answer-quality baseline after Slice 8: 16/17 pass; all KAP answer-quality cases pass.
- Remaining red case is protected contradiction safety (`SOURCE_METADATA_MISMATCH`), not an answer-quality failure.

## Latest Phase 7 Closure Note

- Faz 7 answer-quality closure reached 17/17 pass after aligning contradiction eval expectation with deterministic safety rewrite.
- Current answer-quality rates: rawTableDump 0, tableFieldMismatch 0, unnecessaryWarning 0, sourceFoundBadAnswer 0.
- Runtime lineage coverage remains 1.0 and provider fallback ratios remain 0.
- Remaining warning is normal RAG p95 latency 8320ms vs 8000ms, backlog for latency/ops rather than Faz 7 correctness.

## Latest Phase 8 Slice 1 Note

- Added strict shared-types contracts for `PublicChatResponseV2` and `DebugTraceEnvelope`.
- Public response contract only allows answer, sources, suggestions, and user-facing status.
- Debug diagnostics remain in a separate envelope; public schema rejects internal debug fields.
- Backend boundary now exposes public key allowlist and debug-field detection without changing runtime answer behavior.

## Latest Phase 8 Slice 2 Note

- Added `publicChatDisplay` mapper for source display, suggestion display, and user-facing status.
- Chat responses now expose safe root-level `suggestions` and `status` without requiring debug mode.
- Source citations gain a user-facing `whyThisSource` explanation while preserving citation fields.
- Suggestion reasons strip generic score fragments before reaching public payloads.

## Latest Phase 8 Slice 3 Note

- dApp transport now reads public root-level `suggestions` and `status`.
- Chat turn state preserves public display fields alongside debug/trace lineage.
- Source suggestion badge works from public suggestions when debug retrieval data is absent.
- Source list shows safe `whyThisSource` explanations without exposing raw debug diagnostics.

## Latest Phase 8 Slice 4 Note

- Added strict `FeedbackPayloadV2` and `FeedbackRuntimeLineageSummaryV2` contracts.
- dApp feedback sends safe source/route/lineage summary instead of loose debug-shaped metadata.
- Backend feedback sanitizer strips raw trace, retrieval, provider, safety, Qdrant, and vector diagnostics recursively.
- Public/debug boundary tests now cover feedback metadata leakage while preserving safe runtime lineage summary.

## Latest Phase 8 Closure Note

- Faz 8 product boundary is complete enough to enter Faz 9.
- Public chat contract, source/suggestion/status display, UI public display wiring, and feedback boundary are in place.
- Closure gates passed: shared build/test, backend typecheck, dApp typecheck, and 35 backend boundary/chat tests.
- Remaining warning: dApp has no active unit test runner; UI behavior is covered by typecheck plus backend/shared contracts.

## Latest Phase 9 Slice 1 Note

- Added `FeedbackRepairTrack` and proposal-level `repairTrack` contract.
- Generated proposals persist repair track in evidence and derive it for older records.
- Passive apply now creates router adjustments only for `routing` repair-track plans.
- BAD_ANSWER / answer-quality plans stay eval/review-only even if malformed score steps appear.

## Latest Phase 9 Slice 2 Note

- BAD_ANSWER generated regression cases now distinguish strict vs weak cases.
- A case is strict only when actionable quality expectations exist, not merely because `qualityBucket` is present.
- Feedback eval gate strong BAD_ANSWER count now uses `strictBadAnswerCase === true`.
- Added a small fixture proving one weak BAD_ANSWER and one strict BAD_ANSWER case.

## Latest Phase 9 Slice 3 Note

- Promotion gate now exposes feedback regression coverage, production gate evidence, rollback readiness, and gate report timestamp.
- Promotion eligibility requires strict gate evidence, coverage, rollback readiness, target collection/query hash, and score delta cap.
- Shadow runtime eligibility now uses the same strict gate evidence instead of accepting bare `{ ok: true }`.
- Runtime router mutation remains disabled; promotion gate still reports candidates only.

## Latest Phase 9 Slice 4 Note

- Started the local system before work; backend, dApp, ai-engine, Qdrant, and ipfs gateway were OK.
- Feedback shadow runtime impacts now carry regression coverage, production gate, rollback readiness, and gate timestamp diagnostics.
- Chat debug trace `shadowRuntime.topImpacts` now exposes the same promotion blockers and readiness signals.
- Public chat response shape remains unchanged; diagnostics stay in debug/admin trace paths.

## Latest Phase 9 Closure Candidate Note

- Feedback lifecycle smoke passed end to end: create, proposal, approve, plan, gate result, passive adjustment, promotion gate, rollback.
- Feedback eval gate quick run failed on current live DB-derived regression cases: 4/4 feedback_good_source cases fell into no-source/suggest with wrong_source taxonomy.
- Public/debug boundary focused tests passed: 37 backend tests.
- Phase 9 implementation slices are complete, but full phase closure remains blocked until feedback regression failures are triaged or fixed in the correct source/retrieval/reingestion phase.

## Latest Phase 9 Smoke Regression Hygiene Note

- Lifecycle smoke feedback is now explicitly excluded from production feedback regression generation and approved-proposal coverage counts.
- New smoke feedback rows carry `metadata.regressionExcluded: true`; older smoke rows are detected by `metadata.smoke` or query shape.
- Beta feedback fixture generation now uses golden expected suggestions as truth instead of observed runtime suggestions.
- Quick feedback gate now passes; DB feedback regression generates 0 production cases and skips 5 smoke rows.

## Latest Phase 9 Final Closure Verification Note

- Phase 9 feedback mechanics are closure-ready: focused tests, typecheck, shared build, DB feedback regression, beta feedback regression, collection suggestion, and feedback coverage all passed.
- Full non-quick `eval:feedback-gate` failed only because embedded production RAG gate is red: 185 total, 166 passed, 19 failed.
- Production failures are cross-phase product blockers: safety/presentation, context coverage, retrieval/query, runtime fallback, KAP/table detail grounding.
- Do not patch Phase 9 to force green; route remaining failures into Phase 10 Real Data Certification / Phase 11 Hardening backlog.

## Latest Phase 10 Slice 1 Note

- Added `eval:real-data-certification` and `RealDataCertificationReport.v1` output from the latest production aggregate artifact.
- Current release decision is `fail`: 185 total cases, 166 passed, 19 failed.
- Certification backlog has 16 items: 15 blockers and 1 warning.
- Main owner phases are Phase 6 evidence/context coverage, Phase 7 safety/presentation, plus Phase 4 retrieval and Phase 3 provider-runtime.
