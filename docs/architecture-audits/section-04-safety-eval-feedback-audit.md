# R3MES Architecture Audit - Section 04

Date: 2026-05-16
Scope: safety gate, answer quality validation, eval runners, feedback regression, feedback runtime loop.
Out of scope for this section: retrieval implementation, evidence extraction internals, model selection, UI layout.

## Executive Summary

Section 04 is conservative and useful for a pilot, but it is not yet a product-grade closed quality loop.

Observed runtime flow:

1. `chatProxy.ts` renders the final response through the Section 03 answer planning/composer path.
2. `answerQualityValidator.ts` checks answer quality buckets.
3. `safetyGate.ts` independently applies safety/retrieval/output rails.
4. `chatProxy.ts` may hide citations or replace content with a fallback.
5. Eval scripts inspect debug fields and duplicate parts of answer-quality logic.
6. Feedback is persisted, aggregated into proposals, converted into passive apply records, then optionally used by a shadow/active source-selection runtime.

Main architectural issue: safety, answer quality, and feedback regression are three adjacent systems, not one typed loop. The runtime can detect a bad answer, the safety gate can pass or rewrite using different criteria, and feedback can become a weak regression case that mostly checks retrieval/safety shape rather than the exact bad-answer failure.

This means the system can be "green" while UI answer quality is still bad.

## Evidence Base

All findings below are based on repo files read during this audit.

- Safety input/result contract: `apps/backend-api/src/lib/safetyGate.ts:42`, `apps/backend-api/src/lib/safetyGate.ts:53`
- Safety fallback rendering: `apps/backend-api/src/lib/safetyGate.ts:138`
- Safety usable fact count: `apps/backend-api/src/lib/safetyGate.ts:208`
- Safety rail checks: `apps/backend-api/src/lib/safetyGate.ts:258`, `apps/backend-api/src/lib/safetyGate.ts:309`
- Safety rail registry: `apps/backend-api/src/lib/safetyRailRegistry.ts:2`, `apps/backend-api/src/lib/safetyRailRegistry.ts:14`
- Chat finalization path: `apps/backend-api/src/routes/chatProxy.ts:906`
- Runtime answer quality validation: `apps/backend-api/src/routes/chatProxy.ts:958`
- Runtime safety gate call: `apps/backend-api/src/routes/chatProxy.ts:1000`
- Citation hiding after safety: `apps/backend-api/src/routes/chatProxy.ts:1010`
- Debug exposure: `apps/backend-api/src/routes/chatProxy.ts:1060`
- Answer quality validator buckets: `apps/backend-api/src/lib/answerQualityValidator.ts:2`
- Eval duplicate answer-quality detector: `apps/backend-api/scripts/run-grounded-response-eval.mjs:262`
- Eval safety rail assertions: `apps/backend-api/scripts/run-grounded-response-eval.mjs:484`, `apps/backend-api/scripts/run-grounded-response-eval.mjs:491`
- Eval evidence assertions: `apps/backend-api/scripts/run-grounded-response-eval.mjs:503`, `apps/backend-api/scripts/run-grounded-response-eval.mjs:510`
- Feedback kinds/models: `apps/backend-api/prisma/schema.prisma:90`, `apps/backend-api/prisma/schema.prisma:195`
- Feedback metadata sanitization: `apps/backend-api/src/routes/feedback.ts:395`
- Feedback query redaction: `apps/backend-api/src/routes/feedback.ts:419`
- Feedback submit route: `apps/backend-api/src/routes/feedback.ts:862`
- Feedback passive apply: `apps/backend-api/src/routes/feedback.ts:1142`
- Feedback regression generator: `apps/backend-api/scripts/generate-feedback-regression-eval.mjs:161`
- BAD_ANSWER regression shape: `apps/backend-api/scripts/generate-feedback-regression-eval.mjs:241`
- Feedback eval gate coverage check: `apps/backend-api/scripts/run-feedback-eval-gate.mjs:357`
- Feedback runtime mode: `apps/backend-api/src/lib/decisionConfig.ts:719`
- Feedback shadow runtime: `apps/backend-api/src/lib/feedbackShadowRuntime.ts:62`
- Feedback runtime only affects ranking in active mode: `apps/backend-api/src/lib/feedbackShadowRuntime.ts:192`

## A) Current Architecture Map

### 1. Runtime final answer rendering

Observed path starts in `applyRenderedAnswer` at `apps/backend-api/src/routes/chatProxy.ts:906`.

Flow:

1. Input contains an `AnswerSpec`, sources, retrieval debug, optional compiled evidence, and optional evidence bundle.
2. `buildAnswerPlan(answerSpec)` creates an `AnswerPlan`.
3. `createComposerInput(...)` connects `AnswerSpec`, `AnswerPlan`, `EvidenceBundle`, source metadata, and user query.
4. `composePlannedAnswer(...)` creates a deterministic planned answer when the path is eligible.
5. `validateAnswerQuality(...)` checks runtime quality buckets.
6. If quality fails, the function tries a planned-render fallback and validates that second rendering.
7. `evaluateSafetyGate(...)` applies safety rails.
8. If safety requires rewrite/block, fallback text can replace the answer.
9. If selected rails indicate unsafe or ungrounded source state, citations may be hidden.
10. Debug fields can include `answer_plan`, `safety_gate`, `answer_quality`, and retrieval debug data.

Deterministic:

- `buildAnswerPlan`
- `composePlannedAnswer`
- `validateAnswerQuality`
- `evaluateSafetyGate`
- citation hiding

Model/AI:

- Not in this finalization segment. The model may have produced earlier draft fields, but this segment is deterministic.

Fallback:

- Planned answer fallback inside `chatProxy.ts`
- Safety fallback inside `safetyGate.ts`

### 2. Safety gate

Observed files:

- `apps/backend-api/src/lib/safetyGate.ts`
- `apps/backend-api/src/lib/safetyRailRegistry.ts`
- `apps/backend-api/src/lib/domainSafetyPolicy.ts`

Flow:

1. Safety gate receives `SafetyInput`.
2. It computes answer text, query, route decision, source counts, evidence counts, alignment diagnostics, and accessible source scope.
3. It adds rails from a static registry.
4. It computes pass/severity/rewrite/fallback mode.
5. On failure, it renders a fallback with `composeAnswerSpec(...)`.

Deterministic:

- Rail registry
- Domain regex patterns
- Fallback mode selection
- Safety fallback rendering

Fallback:

- `source_suggestion`
- `privacy_safe`
- `low_grounding`
- `domain_safe`

Gap:

- The safety gate still uses `evidence?.usableFacts.length ?? answerSpec?.facts.length` as the core usable-fact signal (`apps/backend-api/src/lib/safetyGate.ts:208`). It does not directly understand `EvidenceBundle`, `CompiledEvidence`, selected structured facts, or answer plan coverage.

### 3. Answer quality validator

Observed file:

- `apps/backend-api/src/lib/answerQualityValidator.ts`

Buckets exist for:

- `incomplete_answer`
- `template_answer`
- `unnecessary_warning`
- `table_field_mismatch`
- `raw_table_dump`
- `ignored_user_constraint`
- `source_found_but_bad_answer`
- `over_aggressive_no_source`
- `answer_too_long`
- `wrong_output_format`

Deterministic:

- Expected terms
- Forbidden terms
- requested field coverage
- raw table dump signals
- generic caution signals
- length checks
- format checks

Gap:

- These findings are not first-class safety rails. Runtime records them and can retry rendering, but the safety gate does not consume them as a typed policy input.

### 4. Eval runner

Observed file:

- `apps/backend-api/scripts/run-grounded-response-eval.mjs`

Flow:

1. Reads eval cases.
2. Calls backend chat.
3. Reads response content and debug fields.
4. Computes answer-quality findings through a local JS function.
5. Checks safety pass/severity/rails.
6. Checks evidence counts, evidence bundle counts, sources, answer plan fields, route decision, and latency.
7. Writes summary artifact and exits non-zero on failures.

Deterministic:

- Scoring
- Answer quality detector inside eval script
- Rail assertions
- Source/evidence assertions

Fallback:

- Eval allows source-suggestion alternatives in some cases.

Gap:

- Eval duplicates answer-quality logic instead of reusing the TypeScript runtime validator. This creates drift risk between runtime and CI.

### 5. Feedback capture and proposal loop

Observed files:

- `apps/backend-api/src/routes/feedback.ts`
- `apps/backend-api/prisma/schema.prisma`

Flow:

1. User/API submits feedback to `/v1/feedback/knowledge`.
2. Metadata is sanitized and query text is redacted before storage.
3. Feedback rows are aggregated.
4. Proposals are generated with actions such as `BOOST_SOURCE`, `PENALIZE_SOURCE`, `REVIEW_MISSING_SOURCE`, `REVIEW_ANSWER_QUALITY`.
5. Proposal review endpoints approve/reject proposals.
6. Apply records and mutation previews are created.
7. Passive apply records can be marked, but response fields show `mutationApplied: false` and `routerRuntimeAffected: false`.
8. Gate results can be posted back to apply records.

Deterministic:

- Metadata sanitization
- Query redaction
- Aggregation
- Proposal action selection
- Passive apply plan

Fallback:

- Human review and passive apply; no automatic mutation.

Gap:

- BAD_ANSWER feedback does not automatically become a strong answer-quality regression with expected fields, forbidden template terms, bad-answer bucket, or exact output format requirements.

### 6. Feedback shadow/active runtime

Observed files:

- `apps/backend-api/src/lib/feedbackShadowRuntime.ts`
- `apps/backend-api/src/lib/decisionConfig.ts`
- `apps/backend-api/src/routes/chatProxy.ts`

Flow:

1. Runtime mode defaults to `shadow` unless `R3MES_FEEDBACK_RUNTIME_MODE=active`.
2. Shadow runtime loads active router adjustments for the query hash and candidate collections.
3. It computes score deltas and an adjusted candidate order.
4. Runtime source selection is affected only when mode is `active` and the adjusted order changes.
5. `chatProxy.ts` records shadow runtime diagnostics.

Deterministic:

- Query-hash based adjustment lookup
- Score delta caps
- Active/shadow gating
- Candidate reorder

Gap:

- The feedback runtime can influence source selection, but it does not yet close the loop for composer failures, table-field mismatch, or unnecessary-warning failures.

## B) Gap Analysis

| Layer | Ideal product architecture | Current repo observation | Gap / risk | Recommended direction |
|---|---|---|---|---|
| Safety input contract | Receives typed evidence, answer plan, quality findings, retrieval decision, source scope, and final answer | `SafetyInput` receives answer text, answer, optional `AnswerSpec`, optional extracted evidence, sources, diagnostics | Safety decisions still depend on string-first and old fact signals | Add `SafetyInputV2` fields for `compiledEvidence`, `evidenceBundle`, `answerPlan`, `answerQualityFindings` |
| Safety rail registry | Versioned policy with deployment/tenant overrides, rail ownership, eval mode, runtime mode | Static registry in `safetyRailRegistry.ts` | Hard to tune product behavior without code changes | Add `RailPolicyConfig` with default statuses and opt-in overrides |
| Evidence grounding | Uses usable structured facts and answer-plan coverage | Uses `evidence.usableFacts` or `answerSpec.facts` count | Can mark structured evidence as unusable or miss evidence-bundle coverage | Count usable `EvidenceBundle` items and selected structured facts |
| Answer quality | Shared runtime/eval validator | Runtime TS validator plus duplicated JS eval detector | Drift between CI and production behavior | Export validator to build artifact or create shared JSON quality schema |
| Fallback rendering | Uses same planned composer and presentation policy as normal answers | `safetyGate.ts` fallback uses `composeAnswerSpec(...)` | Fallback can reintroduce generic caution/template prose | Route fallback through planned composer or a dedicated planned fallback renderer |
| Short answer policy | Plan-aware and task-aware | `ANSWER_TOO_THIN` is length based with a finance extraction exception | Valid numeric/table answers can be rewritten for being concise | Replace length-only check with answer-plan coverage and requested-field coverage |
| Feedback bad-answer loop | BAD_ANSWER captures quality bucket, expected answer shape, missing fields, unwanted text, and safe query | BAD_ANSWER regression only requires sources/facts and forbids `LOW_LANGUAGE_QUALITY` | Bad UI answers can become weak green regressions | Add `FeedbackBadAnswerPayload` and quality expectations to generated eval cases |
| Proposal apply | Safe staged apply with eval gate and reversible runtime effect | Passive apply records; router adjustments can exist separately | Good safety, but incomplete product loop for answer quality | Keep passive-first, add answer-quality regression generation before any active runtime use |
| Eval gate | Modular, typed, stable output, trend-aware | Monolithic script with many checks and debug-shape dependency | Hard to reason about failures and long-term quality movement | Split scorers by retrieval, safety, answer quality, feedback regression, trend |
| Feedback runtime | Improves both source routing and answer policies | Only affects source selection in active mode | Composer/safety failures are not corrected by feedback runtime | Keep routing runtime separate; bridge answer feedback to eval/composer fixtures |

## C) Failure Chain Analysis - Bad UI Answer After Sources Exist

Example failure type: KAP/table/numeric question returns raw table text, misses requested field, or adds an unnecessary caution sentence.

| Step | Likely culprit? | Current behavior | Why |
|---|---:|---|---|
| Query | Partial | Query understanding may already have detected requested fields in earlier sections, but Section 04 only sees final expectations if they reach `AnswerSpec`/`AnswerPlan` | Safety/eval does not own query parsing |
| Source selection | Usually not primary here | Feedback runtime can adjust sources only in active mode | If correct source exists, quality failure can still happen after retrieval |
| Retrieval/rerank | Not primary for this section | Eval checks source/evidence counts | A green source count does not prove answer quality |
| Evidence | Partial | Safety reads old usable fact signals | Structured evidence may exist but not be seen by safety |
| Compiled evidence | Partial | Chat debug can expose `evidenceBundle`; eval can count it | Safety gate does not directly use it |
| Composer | High | Planned composer is used, but fallback can still use old `composeAnswerSpec` | Bad output can be introduced or reintroduced after safety |
| Safety | High | Length, low-language, no-usable-facts, caution rails are heuristic | It can miss table mismatch or overreact to concise answers |
| Eval | High | Eval has answer-quality buckets but duplicates runtime logic | It can be green if expected answer-quality contract is weak |
| Feedback | High | BAD_ANSWER feedback is stored but generated regression is weak | User-visible bad answers may not become precise failing tests |
| UI | Symptom | UI receives final content and debug optionally | UI can expose quality failure that eval did not encode |

Conclusion: for this section, the main failure is not "the model is bad." The main failure is that answer-quality semantics are not a single typed contract from runtime to safety to feedback regression.

## D) Top 10 Root Causes

### S04-RC01 - Safety gate is still string/fact-count first

Symptoms:

- `NO_USABLE_FACTS` can be triggered from old `usableFacts`/`AnswerSpec.facts` only.
- Structured evidence bundle coverage is not a direct safety input.

Files:

- `apps/backend-api/src/lib/safetyGate.ts:208`
- `apps/backend-api/src/lib/safetyGate.ts:258`

Why it matters:

- Section 03 made evidence more structured, but safety still reasons over older evidence shape. This can cause false rewrites or missed failures.

How to test:

- Add a case with zero `answerSpec.facts`, non-empty `EvidenceBundle.items`, and complete `AnswerPlan.selectedFacts`.
- Expected: safety must not raise `NO_USABLE_FACTS`.

Fix:

- Add a usable-evidence adapter:
  - `usableFactCount`
  - `usableEvidenceBundleItemCount`
  - `selectedStructuredFactCount`
  - `answerPlanCoverage`
- Feed it into `evaluateSafetyGate`.

Risk: High.

### S04-RC02 - Answer quality and safety are parallel systems

Symptoms:

- `validateAnswerQuality` runs at `chatProxy.ts:958`.
- `evaluateSafetyGate` runs later at `chatProxy.ts:1000`.
- Safety gate does not receive answer-quality findings.

Files:

- `apps/backend-api/src/routes/chatProxy.ts:958`
- `apps/backend-api/src/routes/chatProxy.ts:1000`
- `apps/backend-api/src/lib/answerQualityValidator.ts:165`
- `apps/backend-api/src/lib/safetyGate.ts:198`

Why it matters:

- A bad answer can be classified by quality validator but not represented as a safety rail, making debug, eval, and operational reporting inconsistent.

How to test:

- Force `table_field_mismatch` or `raw_table_dump`.
- Expected: safety output should include a corresponding output rail or structured quality failure.

Fix:

- Add `answerQualityFindings` to safety input.
- Map blocking quality buckets to output rails.

Risk: High.

### S04-RC03 - Safety fallback bypasses planned composer policy

Symptoms:

- `buildFallback(...)` renders with `composeAnswerSpec(...)`.
- Planned composer and `SafetyPresentationPolicy` are used elsewhere.

Files:

- `apps/backend-api/src/lib/safetyGate.ts:138`
- `apps/backend-api/src/lib/domainEvidenceComposer.ts:636`
- `apps/backend-api/src/lib/safetyPresentationPolicy.ts:17`

Why it matters:

- Fallback can reintroduce generic caution/template text after the planned answer path has already suppressed it.

How to test:

- Case: numeric field extraction with source found and no red flag.
- Force a safety rewrite.
- Expected: fallback must not add unrelated risk/caution prose.

Fix:

- Move fallback rendering out of `safetyGate.ts` or inject a `plannedFallbackRenderer`.
- Use answer plan and presentation policy for fallback.

Risk: High.

### S04-RC04 - `ANSWER_TOO_THIN` is length-based

Symptoms:

- Answers shorter than 40 chars can trigger a rail when retrieval was used.
- Finance field extraction has a special exception, but the rule is not generally answer-plan aware.

Files:

- `apps/backend-api/src/lib/safetyGate.ts:309`

Why it matters:

- Product RAG must support concise factual answers. A short exact numeric/table value can be correct.

How to test:

- Query asks for one numeric value. Correct answer is `12.4 million TRY`.
- Expected: no rewrite if requested field is covered.

Fix:

- Replace generic length check with:
  - requested-field coverage
  - source support
  - answer-plan output format
  - minimum answer only for freeform/triage intents

Risk: Medium.

### S04-RC05 - Static rail registry is not product-policy configurable

Symptoms:

- Rail IDs and default statuses are hardcoded in `safetyRailRegistry.ts`.

Files:

- `apps/backend-api/src/lib/safetyRailRegistry.ts:14`

Why it matters:

- Different deployments may need different severity thresholds without code changes.

How to test:

- Configure `ANSWER_TOO_THIN` as warn in eval-only mode for table extraction.
- Expected: runtime policy resolves configured status.

Fix:

- Add `RailPolicyConfig` loaded from decision config/env.
- Keep static registry as schema/defaults.

Risk: Medium.

### S04-RC06 - BAD_ANSWER feedback creates weak regression cases

Symptoms:

- `BAD_ANSWER` returns a case with source/fact requirements and forbidden `LOW_LANGUAGE_QUALITY`, but no default expected answer terms or quality bucket requirements.

Files:

- `apps/backend-api/scripts/generate-feedback-regression-eval.mjs:241`

Why it matters:

- A user can report a bad answer, but the generated regression can still pass if retrieval is fine and language quality is not obviously low.

How to test:

- Submit BAD_ANSWER with metadata indicating `raw_table_dump`.
- Generate feedback regression.
- Expected: generated case must include answer-quality expectations for `raw_table_dump` failure prevention.

Fix:

- Define `FeedbackBadAnswerPayload`:
  - `qualityBucket`
  - `expectedAnswerTerms`
  - `forbiddenAnswerTerms`
  - `requestedFields`
  - `expectedOutputFormat`
  - `badAnswerExcerptHash`
- Generate strict answer-quality eval cases from this payload.

Risk: High.

### S04-RC07 - Eval answer-quality logic is duplicated

Symptoms:

- Runtime validator is TypeScript.
- Eval detector is JS inside `run-grounded-response-eval.mjs`.

Files:

- `apps/backend-api/src/lib/answerQualityValidator.ts:165`
- `apps/backend-api/scripts/run-grounded-response-eval.mjs:262`

Why it matters:

- Runtime and CI can drift. A fix in one validator may not affect the other.

How to test:

- Add a new answer-quality bucket to runtime only.
- Expected: eval should fail until the shared contract is updated.

Fix:

- Move validator to a buildable shared module or generate a JSON-rule contract consumed by both runtime and eval.

Risk: Medium.

### S04-RC08 - Eval success depends on debug shape

Symptoms:

- Eval checks `safety_gate`, `answer_plan`, evidence, and source debug paths.
- Runtime exposes those fields conditionally in chat debug response.

Files:

- `apps/backend-api/src/routes/chatProxy.ts:1060`
- `apps/backend-api/scripts/run-grounded-response-eval.mjs:563`

Why it matters:

- If debug headers or response fields diverge between UI and eval, eval can stop representing UI reality.

How to test:

- Run one eval case with debug disabled.
- Expected: eval must fail explicitly with `debug_contract_missing`, not silently score partial data.

Fix:

- Add a formal `DebugTraceContract`.
- Eval cases that assert internals must set `debugRequired: true`.

Risk: Medium.

### S04-RC09 - Feedback loop mostly targets routing, not answer intelligence

Symptoms:

- Shadow runtime can reorder candidate collections.
- It does not affect composer policies, answer-quality fixtures, or table extraction rules.

Files:

- `apps/backend-api/src/lib/feedbackShadowRuntime.ts:62`
- `apps/backend-api/src/lib/feedbackShadowRuntime.ts:192`
- `apps/backend-api/src/routes/chatProxy.ts:2057`

Why it matters:

- If the source was right but answer composition was wrong, router adjustment is the wrong repair mechanism.

How to test:

- BAD_ANSWER where source is correct.
- Expected: proposal/action should target answer-quality regression, not source boost/penalty.

Fix:

- Split feedback actions into:
  - routing feedback
  - answer-quality feedback
  - ingestion/evidence feedback
- Only routing feedback should reach feedback shadow runtime.

Risk: High.

### S04-RC10 - No stable quality trend/SLO layer

Symptoms:

- Gate scripts write artifacts and summaries.
- No observed stable historical quality baseline or SLO budget in this section.

Files:

- `apps/backend-api/scripts/run-feedback-eval-gate.mjs:357`
- `apps/backend-api/scripts/run-grounded-response-eval.mjs:1790`

Why it matters:

- Product readiness requires tracking regressions over time, not only per-run green/red.

How to test:

- Compare current run against previous accepted baseline.
- Expected: gate reports answer-quality bucket deltas and blocks major regressions.

Fix:

- Add `eval-trends/latest-baseline.json`.
- Track bucket rates:
  - source found but bad answer
  - raw table dump
  - unnecessary warning
  - no-source false positive
  - table field mismatch

Risk: Medium.

## E) Recommended Solution Design

### 1. SafetyInputV2

Add a backwards-compatible extension to `SafetyInput`.

Suggested type:

```ts
export interface SafetyEvidenceSignals {
  legacyUsableFactCount: number;
  usableEvidenceBundleItemCount: number;
  selectedStructuredFactCount: number;
  requestedFieldCount: number;
  coveredRequestedFieldCount: number;
  answerPlanCoverage: "complete" | "partial" | "none";
}

export interface SafetyInputV2 extends SafetyInput {
  evidenceSignals?: SafetyEvidenceSignals;
  answerQualityFindings?: AnswerQualityFinding[];
  answerPlan?: AnswerPlan;
}
```

Integration:

- Build signals in `chatProxy.ts` near `applyRenderedAnswer`.
- Pass to `evaluateSafetyGate`.
- Keep old fields for compatibility.

Acceptance criteria:

- Non-empty `EvidenceBundle` prevents false `NO_USABLE_FACTS`.
- `AnswerPlan.coverage === "complete"` prevents false `ANSWER_TOO_THIN` for concise numeric answers.

### 2. AnswerQuality-to-Safety bridge

Suggested rail additions:

```ts
type QualityRailId =
  | "ANSWER_QUALITY_INCOMPLETE"
  | "ANSWER_QUALITY_TEMPLATE"
  | "ANSWER_QUALITY_TABLE_FIELD_MISMATCH"
  | "ANSWER_QUALITY_RAW_TABLE_DUMP"
  | "ANSWER_QUALITY_IGNORED_CONSTRAINT";
```

Integration:

- Add rails to `safetyRailRegistry.ts`.
- Map `AnswerQualityFinding.severity === "fail"` to rails in `evaluateSafetyGate`.

Acceptance criteria:

- Runtime debug has one consistent explanation for answer-quality failure.
- Eval can assert rail IDs instead of duplicating separate quality interpretation.

### 3. Planned fallback renderer

Suggested interface:

```ts
export interface SafetyFallbackRenderInput {
  answerSpec: AnswerSpec;
  answerPlan?: AnswerPlan;
  evidenceBundle?: EvidenceBundle;
  fallbackMode: SafetyFallbackMode;
  sources: ChatSourceCitation[];
}
```

Integration:

- Create `safetyFallbackRenderer.ts`.
- Use `composePlannedAnswer` or a constrained fallback composer.
- Remove direct fallback dependence on old `composeAnswerSpec` once tests pass.

Acceptance criteria:

- Field-extraction fallback remains concise.
- No generic caution when `SafetyPresentationPolicy` suppresses it.

### 4. FeedbackBadAnswerPayload

Suggested type:

```ts
export interface FeedbackBadAnswerPayload {
  qualityBucket:
    | "incomplete_answer"
    | "template_answer"
    | "unnecessary_warning"
    | "table_field_mismatch"
    | "raw_table_dump"
    | "ignored_user_constraint"
    | "source_found_but_bad_answer"
    | "answer_too_long"
    | "wrong_output_format";
  expectedAnswerTerms?: string[];
  forbiddenAnswerTerms?: string[];
  requestedFields?: string[];
  expectedOutputFormat?: "short" | "bullets" | "table" | "freeform";
  safeQuery?: string;
  badAnswerExcerptHash?: string;
}
```

Integration:

- Store this under sanitized feedback metadata.
- Update `generate-feedback-regression-eval.mjs` to emit strict quality expectations for `BAD_ANSWER`.

Acceptance criteria:

- BAD_ANSWER feedback with `raw_table_dump` generates a failing case if raw table dump returns.
- BAD_ANSWER with `unnecessary_warning` fails if warning terms reappear.

### 5. Eval modularization

Target modules:

- `evalScorers/retrieval.mjs`
- `evalScorers/safety.mjs`
- `evalScorers/answerQuality.mjs`
- `evalScorers/feedbackRegression.mjs`
- `evalScorers/debugContract.mjs`

Acceptance criteria:

- Each scorer produces bucketed failures.
- Summary includes stable bucket rates.
- Runtime and eval answer-quality buckets use the same schema.

## F) Section 04 Implementation Plan

### Phase 4.1 - Safety input signal bridge

Goal:

- Feed Section 03 typed artifacts into safety without changing external behavior.

Files:

- `apps/backend-api/src/lib/safetyGate.ts`
- `apps/backend-api/src/routes/chatProxy.ts`
- `apps/backend-api/src/lib/evidenceBundle.ts`
- `apps/backend-api/src/lib/answerPlan.ts`

Acceptance criteria:

- Existing tests pass.
- Add tests showing evidence bundle counts as usable evidence.
- Debug metrics include typed signal counts.

Risk:

- Medium. Mostly additive.

Rollback:

- Feature-flag `SafetyInputV2` signal usage and fall back to legacy counts.

### Phase 4.2 - Quality findings become safety rails

Goal:

- Make answer quality failures visible in the same policy language as safety failures.

Files:

- `apps/backend-api/src/lib/safetyRailRegistry.ts`
- `apps/backend-api/src/lib/safetyGate.ts`
- `apps/backend-api/src/lib/answerQualityValidator.ts`
- `apps/backend-api/src/routes/chatProxy.ts`

Acceptance criteria:

- `raw_table_dump` and `table_field_mismatch` appear as rail IDs.
- Eval can assert these rails.

Risk:

- Medium-high. May reveal currently hidden failures in eval.

Rollback:

- Start new rails in warn mode, then promote selected rails to rewrite.

### Phase 4.3 - Planned safety fallback

Goal:

- Prevent safety fallback from reintroducing template/caution text.

Files:

- `apps/backend-api/src/lib/safetyGate.ts`
- `apps/backend-api/src/lib/safetyFallbackRenderer.ts`
- `apps/backend-api/src/lib/domainEvidenceComposer.ts`
- `apps/backend-api/src/lib/safetyPresentationPolicy.ts`

Acceptance criteria:

- Safety fallback respects answer-plan output format.
- Numeric/table fallbacks remain concise.
- No unrelated risk/caution line appears unless domain policy requires it.

Risk:

- Medium.

Rollback:

- Keep old fallback renderer behind config.

### Phase 4.4 - Feedback bad-answer contract

Goal:

- Turn bad UI answers into precise regression tests.

Files:

- `apps/backend-api/src/routes/feedback.ts`
- `apps/backend-api/scripts/generate-feedback-regression-eval.mjs`
- `apps/backend-api/scripts/run-grounded-response-eval.mjs`
- Prisma metadata shape remains JSON; schema migration not required at first.

Acceptance criteria:

- BAD_ANSWER with a quality bucket generates strict eval expectations.
- Missing quality payload is reported as weak feedback coverage.

Risk:

- Medium.

Rollback:

- Accept old metadata but mark generated cases as weak.

### Phase 4.5 - Eval scorer split and trend report

Goal:

- Make eval failures diagnosable by product-quality bucket.

Files:

- `apps/backend-api/scripts/run-grounded-response-eval.mjs`
- new `apps/backend-api/scripts/eval-scorers/*.mjs`
- `apps/backend-api/scripts/run-feedback-eval-gate.mjs`

Acceptance criteria:

- Summary reports answer-quality bucket counts.
- Gate can block on bucket regression.
- Debug contract failures are explicit.

Risk:

- Medium.

Rollback:

- Keep old monolithic script path while scorer modules are phased in.

## G) Eval Redesign Targets

Minimum new regression buckets:

| Bucket | Example case contract |
|---|---|
| `incomplete_answer` | Query asks for revenue and period; expected terms include both. Missing one fails. |
| `template_answer` | Query expects one field; forbidden terms include generic "kaynaklarda sinirli" style boilerplate. |
| `unnecessary_warning` | Non-risky financial extraction must not include risk/caution terms. |
| `table_field_mismatch` | Query asks `Net sales`; answer must not return `Gross profit`. |
| `raw_table_dump` | Answer must not contain pipe-heavy table rows or key-value dumps when expected format is short. |
| `ignored_user_constraint` | Query says "only amount"; answer must not include explanation paragraphs. |
| `source_found_but_bad_answer` | Source and facts exist; answer must satisfy expected terms and output format. |
| `over_aggressive_no_source` | Correct source exists; answer must not return no-source fallback. |
| `answer_too_long` | One-field extraction must stay under configured character/line count. |
| `wrong_output_format` | Expected bullets/table/short format must match answer plan. |

Recommended case shape:

```json
{
  "id": "kap-table-net-sales-short-answer",
  "bucket": "answer_quality_table_numeric",
  "query": "Net satis tutari nedir? Sadece tutari yaz.",
  "collectionIds": ["kap-pilot"],
  "mustHaveSources": true,
  "minEvidenceBundleItemCount": 1,
  "expectAnswerPlan": {
    "outputFormat": "short",
    "coverage": "complete"
  },
  "qualityExpectations": {
    "expectedAnswerTerms": ["Net satis", "TRY"],
    "forbiddenAnswerTerms": ["risk", "uyari", "|"],
    "expectedOutputFormat": "short",
    "requestedFields": ["net_sales"],
    "maxLength": 160
  }
}
```

## H) What Not To Do

- Do not make runtime safety an LLM judge. Keep runtime deterministic.
- Do not let feedback automatically mutate router behavior without eval gate and rollback.
- Do not treat safety pass as answer-quality pass.
- Do not fix bad UI quality by only increasing model size.
- Do not use LoRA for factual correctness.
- Do not hide answer-quality failures behind generic low-grounding fallbacks.
- Do not let BAD_ANSWER feedback become only a retrieval regression.
- Do not collect raw prompts or private document text in feedback metadata.
- Do not turn the whole RAG path into an agent loop before typed evidence/planning contracts are stable.
- Do not consider eval green unless it exercises the same backend path and debug contract as UI.

## I) Final Verdict

Current level:

- Safety/eval/feedback is pilot-grade conservative infrastructure.
- It is not yet product-grade answer-quality governance.

Primary bottleneck:

- The typed answer-intelligence artifacts added in Section 03 do not yet drive safety and feedback regression as first-class inputs.

Most important next step:

- Add the SafetyInputV2 signal bridge and answer-quality-to-safety rail mapping before expanding eval volume.

Expected impact:

- This will not make retrieval smarter by itself.
- It will make bad UI answers visible, reproducible, and blockable in the same loop that controls safety and feedback promotion.

Qwen2.5-3B implication:

- The target remains realistic if Qwen stays a synthesis layer over typed evidence.
- The product risk is not primarily model size in this section; it is missing typed governance between composer, safety, eval, and feedback.

Minimum sellable pilot threshold for this section:

- Correct source found but bad answer must become a failing regression.
- BAD_ANSWER feedback must generate a precise answer-quality test.
- Safety fallback must not degrade a structured answer into boilerplate.
- Eval output must report answer-quality buckets separately from retrieval/safety buckets.
