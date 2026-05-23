# R3MES Phase 1 Decision Notes

Date: 2026-05-23

Phase: Phase 1 - Minimal Evidence + Answer Baseline

Status: Approved for Phase 2 transition after user confirmation.

## Purpose

These notes close the small architecture decisions discovered during Phase 1 verification. They are intentionally narrow. They do not change runtime behavior, retrieval, evidence extraction, safety policy, parser logic, UI layout, provider configuration, or model runtime.

## Decision 1 - Versioned Contract Names

Phase 1 verification requested names such as `EvidenceBundleBaselineV1`, `AnswerPlanV1`, and `EvidenceOnlyEvalResult`.

Current implementation uses existing runtime contracts:

- `EvidenceBundle`
- `AnswerPlan`
- `EvalAnswerBaselineDiagnostics`
- eval runner result objects for evidence-only and answer-quality results

Decision:

- Keep the current runtime names for now.
- Treat `EvalAnswerBaselineDiagnostics` as the Phase 1 baseline contract that summarizes `EvidenceBundle`, `CompiledEvidence`, `AnswerPlan`, and composer diagnostics.
- Do not introduce duplicate wrapper types only to satisfy naming symmetry.
- If Phase 2 introduces `ParsedDocumentV2` / `ArtifactGraphV1`, new version suffixes should be used where the contract is new or persistence-facing.

Rationale:

- The existing names are already wired into runtime/eval code.
- Adding duplicate aliases would increase contract drift without improving behavior.
- Phase 1 goal is diagnosis, not a broad type rename.

Impact:

- No blocker for Phase 2.
- Future contract pages should explicitly map product-facing contract names to concrete code symbols.

## Decision 2 - Debug Response vs Eval Debug Contract

Phase 1 verification asked whether live debug responses expose `eval_debug_contract.answerBaseline`.

Current behavior:

- Public response never exposes `answerBaseline` or eval internals.
- Debug-enabled chat responses expose runtime lineage and chat trace.
- Eval artifacts expose `answerBaseline` through the eval debug contract path.

Decision:

- Keep `answerBaseline` as eval/debug-contract diagnostics, not mandatory public chat debug payload.
- Do not expose full eval contract in live chat responses unless a later admin-only diagnostics endpoint explicitly requires it.
- Public/debug boundary remains stricter than observability convenience.

Rationale:

- Live debug payloads are easier to accidentally expose than local eval artifacts.
- Phase 1 acceptance requires diagnosability; eval artifacts already provide it.
- Admin/dev diagnostics can be designed later without expanding the normal chat response surface.

Impact:

- No blocker for Phase 2.
- If an admin diagnostics endpoint is added, it must use an explicit admin/debug boundary and not reuse public response shaping.

## Decision 3 - Evidence-Fail Fixture Coverage

Phase 1 verification showed:

- Evidence pass + answer pass exists.
- Evidence pass + answer fail exists.
- The current recently-run suites do not include a strong evidence-fail + answer-fail fixture.

Decision:

- Do not block Phase 2 on this.
- Add intentional evidence-fail fixtures when Phase 2 and Phase 4 introduce document artifact and retrieval quality changes.

Rationale:

- The scorer can represent evidence-only failures.
- Phase 2 will naturally create better document/artifact failure cases.
- Adding synthetic weak fixtures before parser/document work risks testing fake behavior.

Impact:

- Phase 2 must include parser/document-understanding failure fixtures.
- Phase 4 must include wrong-source/wrong-chunk retrieval failure fixtures.

## Decision 4 - Remaining Answer-Quality Fail

Remaining case:

- `technical-contradictory-migration-answer-quality`

Observed:

- evidence-only: pass
- answer path: `contradiction_fast_path`
- composer path: `safety_fallback`
- phase diagnosis: `safety_policy_or_presentation_failure`

Decision:

- Do not fix this in Phase 1.
- Carry it to Phase 6 / Phase 7, where contradiction evidence and safety/answer presentation will be redesigned.

Rationale:

- Phase 1 successfully diagnosed the failure location.
- Fixing it now would require safety policy/presentation behavior changes, which are out of Phase 1 scope.

Impact:

- Not a Phase 1 blocker.
- Must remain visible in answer-quality eval until the appropriate phase handles it.

## Decision 5 - Backend Build EPERM

Observed:

- `pnpm --filter @r3mes/backend-api build` failed at `prisma generate` with Windows `EPERM` while renaming Prisma query engine DLL.
- `tsc --noEmit` passed.
- targeted vitest tests passed when run directly.

Decision:

- Treat this as an environment/build-lock warning, not a Phase 1 code blocker.
- Before release/readiness gates, rerun backend build after stopping processes that may hold the Prisma DLL.

Rationale:

- The failure happens before TypeScript compilation and points to a locked generated Prisma binary.
- It does not indicate a Phase 1 contract/type failure.

Impact:

- Ops/build hygiene backlog.
- Not a Phase 2 blocker, but release gates must include a clean build run.

## Decision 6 - UI Reality Runtime Warnings

Observed in `eval:ui-reality`:

- quality fallback ratio warning
- reranker fallback warning
- deep RAG p95 latency slightly above threshold in one run

Decision:

- Do not fix in Phase 1.
- Carry provider/retrieval/performance warnings to Phase 3 / Phase 4 / Phase 8 depending on root cause.

Rationale:

- Phase 1 is not the retrieval/provider/performance optimization phase.
- The warnings are visible and classified, which is the desired Phase 1 outcome.

Impact:

- Phase 3 / Phase 4 must keep provider fallback and reranker fallback as quality gates.
- Phase 8 must revisit latency/user-facing performance budgets.

## Phase 2 Transition Decision

Phase 1 is complete enough to start Phase 2 - Document Intelligence Foundation.

Phase 2 must not silently change answer/composer/retrieval behavior to hide parser issues. It should focus on document input, parser output contracts, artifact graph, parse quality, and chunking semantics.

