# R3MES Architecture Audit - Section 03

Date: 2026-05-16

Scope: evidence extraction, compiled evidence, structured facts, answer spec, answer plan, deterministic composer, model fallback, safety presentation, answer-quality eval.

Non-scope: source resolution and retrieval runtime planning. Those were handled in Section 02.

## Executive Summary

Section 03 is the layer where retrieved chunks become user-visible answers.

The system now has a real deterministic answer stack:

1. Retrieved chunks are converted into evidence cards.
2. `runEvidenceExtractorSkill` produces string evidence arrays and optional `structuredFacts`.
3. True hybrid retrieval compiles those into `CompiledEvidence`.
4. `buildAnswerSpec` merges evidence into an answer-oriented spec.
5. `buildAnswerPlan` detects the answer task and selects structured facts.
6. `composeAnswerSpec` renders a deterministic answer when fast path is used.
7. `evaluateSafetyGate` validates or rewrites the final rendered answer.
8. Qwen is used only when deterministic fast paths are not taken.

The product gap is narrower than before, but still significant:

- `StructuredFact` exists, but most evidence is still string-first.
- Table/numeric fact extraction is regex-driven over already flattened facts.
- `CompiledEvidence` is only produced by true hybrid retrieval.
- `hasCompiledUsableGrounding` ignores structured facts when string facts are absent.
- `AnswerPlan` exists, but it is built late inside rendering, not as a pre-composer contract.
- Composer still contains KAP/finance-specific table heuristics.
- Safety can still become presentation logic, adding generic fallback/caution language.
- Eval checks answer terms and formatting, but does not yet assert answer-plan coverage or structured-fact correctness strongly enough.

This section is no longer "missing architecture"; it is an immature but working architecture. The next step is to make the existing pieces first-class contracts instead of late helper functions.

## Current Architecture Map

### 1. Evidence Extraction

Observed files:

- `apps/backend-api/src/lib/skillPipeline.ts`
- `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts`
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts`
- `apps/backend-api/src/lib/requestedFieldDetector.ts`

Flow:

1. Retrieval selects final candidates.
2. The true hybrid retriever builds pruned evidence cards from final candidates.
3. `runEvidenceExtractorSkill` calls `buildDeterministicEvidenceExtraction`.
4. Evidence extraction is deterministic, not LLM-based.
5. It fills:
   - `directAnswerFacts`
   - `supportingContext`
   - `riskFacts`
   - `notSupported`
   - `usableFacts`
   - `uncertainOrUnusable`
   - `redFlags`
   - `sourceIds`
   - `missingInfo`
   - optional `structuredFacts`
6. `structuredFacts` are extracted by `extractTableNumericFacts`.
7. `extractTableNumericFacts` uses `detectAnswerTask`, requested field aliases, row-number heuristics, share-group regexes, and number extraction over string evidence.

Evidence:

- `apps/backend-api/src/lib/skillPipeline.ts:57` defines `EvidenceExtractorOutput`.
- `apps/backend-api/src/lib/skillPipeline.ts:1226` starts deterministic evidence extraction.
- `apps/backend-api/src/lib/skillPipeline.ts:1366` calls `extractTableNumericFacts`.
- `apps/backend-api/src/lib/skillPipeline.ts:1388` exposes `runEvidenceExtractorSkill`.
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts:182` extracts table/numeric structured facts.
- `apps/backend-api/src/lib/requestedFieldDetector.ts:37` defines hardcoded finance table field aliases.

Classification:

- Deterministic: yes.
- Model/AI: no.
- Fallback: string evidence first; regex table extraction over strings.

### 2. Compiled Evidence

Observed file:

- `apps/backend-api/src/lib/compiledEvidence.ts`

Flow:

1. `compileEvidence` merges direct, usable, and supporting string facts.
2. It deduplicates structured facts separately.
3. It carries risks, unknowns, contradictions, source IDs, confidence, counts, and diagnostics.
4. Confidence is derived from string fact count, source count, grounding confidence, and contradiction count.
5. `hasCompiledUsableGrounding` returns true only when `usableFactCount > 0`.

Evidence:

- `apps/backend-api/src/lib/compiledEvidence.ts:8` defines `CompiledEvidence`.
- `apps/backend-api/src/lib/compiledEvidence.ts:120` implements `compileEvidence`.
- `apps/backend-api/src/lib/compiledEvidence.ts:136` extracts `structuredFacts`.
- `apps/backend-api/src/lib/compiledEvidence.ts:189` implements `hasCompiledUsableGrounding`.

Important observation:

`CompiledEvidence` is only produced in the true hybrid path. `qdrant` and legacy `prisma` retrieval expose `evidence`, but do not expose `compiledEvidence`.

Evidence:

- `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1810` calls `compileEvidence`.
- `apps/backend-api/src/routes/chatProxy.ts:2064` reads `compiledEvidence` only if the retrieval result has that property.

Classification:

- Deterministic: yes.
- Model/AI: no.
- Fallback: qdrant/prisma paths proceed without compiled evidence.

### 3. Structured Facts

Observed files:

- `apps/backend-api/src/lib/structuredFact.ts`
- `apps/backend-api/src/lib/tableFact.ts`
- `apps/backend-api/src/lib/tableDomainPack.ts`
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts`

Flow:

1. Existing runtime answer path uses `StructuredFact`.
2. Section 02 added generic `TableFact`, `TableProfile`, and `TableDomainPack` contracts.
3. Those new generic table contracts are not yet integrated into evidence extraction.
4. Current structured facts are still produced by `tableNumericFactExtractor.ts`.

Evidence:

- `apps/backend-api/src/lib/structuredFact.ts:1` defines `StructuredFactKind`.
- `apps/backend-api/src/lib/structuredFact.ts:5` defines `StructuredFact`.
- `apps/backend-api/src/lib/tableFact.ts` defines generic table fact contracts.
- `apps/backend-api/src/lib/tableDomainPack.ts` defines pluggable table domain packs.
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts:6` defines string-based extraction input.

Conclusion:

The product-level type exists, but the runtime extraction path is still not table-artifact-first.

### 4. AnswerSpec

Observed file:

- `apps/backend-api/src/lib/answerSpec.ts`

Flow:

1. `buildAnswerSpec` receives domain, grounding confidence, user query, evidence, and optional compiled evidence.
2. It prioritizes facts, supporting context, risks, unknowns, contradictions, and structured facts.
3. It chooses:
   - `assessment`
   - `action`
   - `caution`
   - `summary`
   - `facts`
   - `structuredFacts`
4. It always has fallback action/caution strings by domain.

Evidence:

- `apps/backend-api/src/lib/answerSpec.ts:9` defines `AnswerSpec`.
- `apps/backend-api/src/lib/answerSpec.ts:365` implements `buildAnswerSpec`.
- `apps/backend-api/src/lib/answerSpec.ts:397` allows compiled evidence to override grounding confidence.
- `apps/backend-api/src/lib/answerSpec.ts:449` carries source IDs.
- `apps/backend-api/src/lib/answerSpec.ts:451` carries structured facts.

Classification:

- Deterministic: yes.
- Model/AI: no.
- Fallback: domain fallback action/caution when evidence is thin.

### 5. AnswerPlan

Observed file:

- `apps/backend-api/src/lib/answerPlan.ts`

Flow:

1. `buildAnswerPlan` re-detects answer task from `spec.userQuery`.
2. It selects structured facts matching requested fields.
3. It calculates coverage:
   - `complete`
   - `partial`
   - `none`
4. It carries constraints:
   - `maxWords`
   - `forbidCaution`
   - `noRawTableDump`
   - `sourceGroundedOnly`
   - output format
5. It sets `requiresModelSynthesis`.

Evidence:

- `apps/backend-api/src/lib/answerPlan.ts:11` defines `AnswerPlan`.
- `apps/backend-api/src/lib/answerPlan.ts:87` implements `buildAnswerPlan`.
- `apps/backend-api/src/lib/answerPlan.ts:90` selects facts for requested fields.

Important observation:

`AnswerPlan` is built inside `applyRenderedAnswer`, after retrieval and evidence extraction. It is not yet the governing plan passed into evidence extraction, composer choice, or safety policy.

Evidence:

- `apps/backend-api/src/routes/chatProxy.ts:907` builds `AnswerSpec`.
- `apps/backend-api/src/routes/chatProxy.ts:914` builds `AnswerPlan`.
- `apps/backend-api/src/routes/chatProxy.ts:920` composes from `AnswerSpec`.

Classification:

- Deterministic: yes.
- Model/AI: no.
- Fallback: late re-detection from query.

### 6. Composer

Observed file:

- `apps/backend-api/src/lib/domainEvidenceComposer.ts`

Flow:

1. `composeAnswerSpec` builds an `AnswerPlan`.
2. It first tries `composeStructuredFieldAnswer`.
3. If that fails, it tries `composeFinanceTableFacts`.
4. Then it renders by answer intent and output format.
5. It may include low-grounding lead text.
6. It may include optional caution depending on domain, task, and user suppression constraints.

Evidence:

- `apps/backend-api/src/lib/domainEvidenceComposer.ts:282` implements finance table fact fallback.
- `apps/backend-api/src/lib/domainEvidenceComposer.ts:320` implements structured field answer composition.
- `apps/backend-api/src/lib/domainEvidenceComposer.ts:363` creates low-grounding lead text.
- `apps/backend-api/src/lib/domainEvidenceComposer.ts:500` implements `composeAnswerSpec`.

Classification:

- Deterministic: yes.
- Model/AI: no.
- Fallback: KAP/finance table string mining, generic domain fallback text, low-grounding template.

### 7. Safety Gate

Observed file:

- `apps/backend-api/src/lib/safetyGate.ts`

Flow:

1. `evaluateSafetyGate` receives final rendered answer, grounded answer object, sources, evidence, retrieval diagnostics, and source selection.
2. It applies deterministic rails:
   - empty answer
   - missing sources
   - source suggestion without grounding
   - no-source mode with sources
   - too many context chunks for 3B
   - alignment failures
   - no usable facts
   - risky certainty
   - low language quality
   - low-grounding overconfidence
   - source metadata mismatch
   - private source scope mismatch
   - red flag without guidance
   - answer too thin
3. It chooses fallback mode.
4. If needed, it renders a safe fallback through `composeAnswerSpec`.

Evidence:

- `apps/backend-api/src/lib/safetyGate.ts:42` defines `SafetyInput`.
- `apps/backend-api/src/lib/safetyGate.ts:53` defines `SafetyGateResult`.
- `apps/backend-api/src/lib/safetyGate.ts:198` implements `evaluateSafetyGate`.
- `apps/backend-api/src/lib/safetyGate.ts:175` renders fallback with `composeAnswerSpec`.

Classification:

- Deterministic: yes.
- Model/AI: no.
- Fallback: safety fallback can replace user-visible answer.

### 8. Qwen / AI Engine Path

Observed file:

- `apps/backend-api/src/routes/chatProxy.ts`

Flow:

1. Grounded non-stream UI requests usually take deterministic fast path when:
   - retrieval was used
   - sources exist
   - grounding is not low
   - `R3MES_ENABLE_RAG_FAST_PATH` is not off
   - composer mode is not `model`
2. No-source, contradiction, and low-confidence-with-usable-evidence paths also use deterministic answer rendering.
3. AI engine is called only when fast paths are not taken.
4. If AI output parses as grounded answer, it is still rendered through `applyRenderedAnswer`.
5. If AI output is draft text and retrieval was used, it is wrapped into a grounded answer and rendered/safety-gated.

Evidence:

- `apps/backend-api/src/routes/chatProxy.ts:456` defines `shouldUseRagFastPath`.
- `apps/backend-api/src/routes/chatProxy.ts:2079` checks contradictory compiled evidence.
- `apps/backend-api/src/routes/chatProxy.ts:2082` defines low-confidence evidence fast path.
- `apps/backend-api/src/routes/chatProxy.ts:2120` enters deterministic fast path.
- `apps/backend-api/src/routes/chatProxy.ts:2192` injects retrieved context into model messages.
- `apps/backend-api/src/routes/chatProxy.ts:2292` parses AI-engine answer.
- `apps/backend-api/src/routes/chatProxy.ts:2305` optionally runs mini validator.

Conclusion:

Qwen is not the primary knowledge source in this layer. It is mostly bypassed for grounded UI cases unless env settings force model composition or fast path conditions fail.

## Gap Analysis

| Layer | Current state | Product-level expectation | Gap |
| --- | --- | --- | --- |
| Evidence extraction | Deterministic string-first extraction with structured facts as regex add-on. | Evidence should be typed by source span, document section, table cell, and requested task. | Evidence is still mostly string arrays. |
| Structured facts | `StructuredFact` exists; generic `TableFact` exists but is not connected. | Table/OCR/Excel artifacts should produce structured facts before text fallback. | Runtime extractor is not table-artifact-first. |
| Compiled evidence | True hybrid compiles evidence; qdrant/prisma do not. | All retrieval modes should produce the same compiled evidence contract. | Downstream behavior differs by retrieval engine. |
| Grounding confidence | Based on string fact count and source count. | Structured facts should count as usable grounding. | Structured-only answers can be undercounted. |
| Answer planning | Exists, but built late inside rendering. | AnswerPlan should be produced before composer and validated against evidence. | Plan cannot guide extraction or answer-path selection yet. |
| Composer | Deterministic, with structured field answer and finance table fallback. | Composer should render from AnswerPlan + typed facts, with domain packs. | KAP/finance table logic remains in composer. |
| Safety | Deterministic rails and safe fallbacks. | Safety should validate and lightly rewrite presentation, not become answer policy. | Safety can add generic template language. |
| Qwen use | Bypassed in most grounded fast paths. | Correct; Qwen should synthesize only over clean evidence. | Model path still receives string context, not typed plan/facts. |
| Eval | Better answer-quality checks exist. | Eval should assert structured fact coverage, plan coverage, and field/value alignment. | `requiredFields` is present in fixtures but not enforced by quality finder. |

## Failure Chain Analysis: KAP/Table/Numeric

Failure chain:

`query -> retrieval -> evidence extraction -> structuredFacts -> compiledEvidence -> answerSpec -> answerPlan -> composer -> safety -> UI`

| Step | Likely culprit? | Reason |
| --- | --- | --- |
| query | Partial | Requested fields are detected, but aliases are hardcoded finance fields. |
| retrieval | Partial | Section 02 improved planning, but retrieved context may still be flattened table text. |
| evidence extraction | High | `extractTableNumericFacts` works from string facts and regexes, not original table cells. |
| structuredFacts | High | Facts lack row/column coordinates, table IDs, cell provenance, and normalized numeric value type. |
| compiledEvidence | Medium | Structured facts are carried, but confidence/usable grounding is string-fact-led. |
| answerSpec | Medium | Fallback action/caution can enter the spec even when the user asks only for values. |
| answerPlan | Medium | It exists, but is late and cannot force evidence extraction to fill missing fields. |
| composer | High | It still has finance table fallback that mines numbers from strings. |
| safety | Medium | Can replace/augment output with generic low-grounding or caution text. |
| UI | Low | UI mostly displays backend content; quality problem is upstream. |

## Top Root Causes

### R01 - Evidence Is Still Mostly String-First

Symptoms:

- Evidence arrays are strings.
- Structured facts are optional.
- Composer still falls back to string mining.

Files:

- `apps/backend-api/src/lib/skillPipeline.ts`
- `apps/backend-api/src/lib/compiledEvidence.ts`
- `apps/backend-api/src/lib/domainEvidenceComposer.ts`

Why important:

String evidence is brittle for tables, numbers, units, row labels, and constraints like "do not mix net profit row."

How to test:

- Add a case where the same numeric value appears in two rows.
- Require the answer to pick only the requested row and column.
- Fail when the answer contains the wrong row label or raw table dump.

Fix:

Make `EvidenceItem` and `EvidenceBundle` first-class:

```ts
export interface EvidenceItem {
  id: string;
  kind: "text" | "table_fact" | "numeric_fact" | "procedure_step";
  sourceId: string;
  quote: string;
  fact?: string;
  tableFactId?: string;
  confidence: "low" | "medium" | "high";
}
```

Risk:

Medium. Can be introduced next to current string arrays first.

### R02 - Generic TableFact Is Not Integrated

Symptoms:

- `TableFact` exists.
- `tableNumericFactExtractor` does not consume `TableFact`.
- Structured facts are extracted from flattened facts.

Files:

- `apps/backend-api/src/lib/tableFact.ts`
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts`
- `apps/backend-api/src/lib/structuredFact.ts`

Why important:

Product-level PDF/DOCX/Excel/OCR assistant must preserve table semantics before answer generation.

How to test:

- Use a non-KAP Excel-style table with repeated labels and multiple numeric columns.
- Check row/column match and normalized numeric value.

Fix:

Bridge `TableFact -> StructuredFact`:

```ts
export function structuredFactFromTableFact(fact: TableFact): StructuredFact
```

Then make evidence extraction prefer structured table artifacts before regex fallback.

Risk:

Medium/high. Depends on ingestion artifacts, but can be additive.

### R03 - CompiledEvidence Is Not Universal Across Retrieval Modes

Symptoms:

- True hybrid returns `compiledEvidence`.
- Qdrant/prisma paths do not.
- AnswerSpec falls back to raw evidence when compiled evidence is missing.

Files:

- `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts`
- `apps/backend-api/src/lib/qdrantRetrieval.ts`
- `apps/backend-api/src/lib/knowledgeRetrieval.ts`
- `apps/backend-api/src/routes/chatProxy.ts`

Why important:

The answer layer behaves differently depending on retrieval engine.

How to test:

- Same fixture under `hybrid`, `qdrant`, and `prisma`.
- Assert `retrieval_debug.compiledEvidence` exists or explicit reason is recorded.

Fix:

Move compile step to a post-retrieval adapter in `chatProxy` or shared retrieval wrapper.

Risk:

Medium. Must preserve existing true hybrid diagnostics.

### R04 - Structured Facts Do Not Count As Usable Grounding

Symptoms:

- `hasCompiledUsableGrounding` checks only `usableFactCount > 0`.
- Confidence derivation uses string `factCount`.

Files:

- `apps/backend-api/src/lib/compiledEvidence.ts:189`
- `apps/backend-api/src/lib/compiledEvidence.ts:79`

Why important:

A table cell can be a stronger answer than a paragraph string. The confidence model currently does not reflect that.

How to test:

- Build evidence with zero string facts and one high-confidence structured table cell.
- Expected compiled grounding should be usable.

Fix:

Use `factCount + structuredFactCount` for grounding, with separate diagnostics.

Risk:

Low/medium. Need careful no-source behavior.

### R05 - AnswerPlan Is Built Too Late

Symptoms:

- `buildAnswerPlan` is called in `applyRenderedAnswer`.
- Evidence extraction does not know the plan.
- Composer selection is not driven by a precomputed plan.

Files:

- `apps/backend-api/src/routes/chatProxy.ts:914`
- `apps/backend-api/src/lib/answerPlan.ts:87`

Why important:

The plan should decide what evidence is required before the system composes an answer.

How to test:

- Requested fields missing from structured facts should produce an explicit plan failure before composer fallback.

Fix:

Create `AnswerPlan` before evidence extraction/composer:

```ts
export interface AnswerPlanRequest {
  userQuery: string;
  requestedFields: RequestedField[];
  outputConstraints: AnswerOutputConstraints;
  expectedEvidenceKinds: string[];
}
```

Risk:

Medium. Should begin as trace-only.

### R06 - Requested Field Detection Is Hardcoded Finance/KAP

Symptoms:

- `FINANCE_TABLE_FIELDS` is in code.
- `extractRowNumberedValues` has field-specific row numbers.
- Share group extractor has A/B/C row patterns.

Files:

- `apps/backend-api/src/lib/requestedFieldDetector.ts:37`
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts:25`
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts:80`

Why important:

This works for KAP pilot but not arbitrary enterprise tables.

How to test:

- Add a maintenance, HR, or MES table without editing TypeScript aliases.

Fix:

Move aliases to `DomainLexiconPack` / `TableDomainPack`, and use table headers from ingestion.

Risk:

Medium. Existing KAP eval must remain green.

### R07 - Composer Still Contains Finance Table Mining

Symptoms:

- `composeFinanceTableFacts` scans `spec.facts` with KAP-oriented table label candidates.
- Composer is doing extraction work.

Files:

- `apps/backend-api/src/lib/domainEvidenceComposer.ts:282`

Why important:

Composer should render selected facts, not rediscover table values.

How to test:

- Disable `composeFinanceTableFacts`; assert structured field answer still passes.

Fix:

Deprecate finance table fallback after structured table fact coverage is reliable.

Risk:

Medium. Keep fallback behind a flag during migration.

### R08 - Safety Can Become Presentation Policy

Symptoms:

- Low-grounding lead text is template-like.
- Safety fallback uses `composeAnswerSpec`, which can add domain fallback caution/action.
- Generic caution can appear even when user asked for only values, unless constraints suppress it.

Files:

- `apps/backend-api/src/lib/domainEvidenceComposer.ts:363`
- `apps/backend-api/src/lib/safetyGate.ts:175`
- `apps/backend-api/src/lib/answerSpec.ts:335`

Why important:

Safety is necessary, but product answers should not sound templated when the evidence is clear.

How to test:

- Field extraction query with `forbidCaution=true` should never include generic safety language unless a blocking rail fires.

Fix:

Add `SafetyPresentationPolicy`:

```ts
export interface SafetyPresentationPolicy {
  allowGenericCaution: boolean;
  allowLowGroundingLead: boolean;
  preserveFieldOnlyOutput: boolean;
}
```

Risk:

Low/medium.

### R09 - Eval Does Not Enforce Plan/Structured Fact Coverage Enough

Symptoms:

- Fixtures contain `qualityExpectations.requiredFields`.
- `detectAnswerQualityFindings` does not enforce `requiredFields`.
- No explicit `table_field_mismatch` bucket in the quality finder.

Files:

- `apps/backend-api/scripts/run-grounded-response-eval.mjs:215`
- `infrastructure/evals/answer-quality/golden.jsonl:1`

Why important:

Eval can still pass if required answer terms happen to appear, even when the wrong field/value mapping is used.

How to test:

- Require `answer_plan.coverage=complete`.
- Require selected facts for each requested field.
- Fail if the answer contains a value without its requested field label.

Fix:

Add eval assertions:

```json
{
  "expectAnswerPlan": {
    "taskType": "field_extraction",
    "coverage": "complete",
    "missingFieldIds": []
  },
  "qualityExpectations": {
    "requiredFieldValues": [
      { "fieldId": "net_donem_kari", "value": "511.801.109" }
    ]
  }
}
```

Risk:

Low.

### R10 - Model Path Still Receives String Context

Symptoms:

- `injectRetrievedContextIntoMessages` injects `contextText`.
- It does not inject `AnswerPlan` or structured facts as typed JSON.

Files:

- `apps/backend-api/src/routes/chatProxy.ts:557`
- `apps/backend-api/src/routes/chatProxy.ts:2192`

Why important:

When Qwen is used, it should synthesize over clean typed evidence, not flattened context text.

How to test:

- Force model composer mode for a table field extraction case.
- Assert no raw table dump and correct field/value mapping.

Fix:

Add a model payload section:

```ts
{
  answerPlan,
  structuredFacts,
  compiledEvidence,
  prohibitedAdditions
}
```

Risk:

Medium. Keep deterministic composer as default.

## Section 03 Remediation Plan

### Phase 3.1 - EvidenceBundle Contract

Goal:

Add typed evidence alongside current string arrays.

Files:

- `apps/backend-api/src/lib/skillPipeline.ts`
- `apps/backend-api/src/lib/compiledEvidence.ts`
- new `apps/backend-api/src/lib/evidenceBundle.ts`

Acceptance:

- Existing evidence arrays remain.
- New `EvidenceBundle` appears in debug.
- No answer behavior changes yet.

### Phase 3.2 - TableFact to StructuredFact Bridge

Goal:

Use generic table facts before regex fallback.

Files:

- `apps/backend-api/src/lib/tableFact.ts`
- `apps/backend-api/src/lib/structuredFact.ts`
- `apps/backend-api/src/lib/tableNumericFactExtractor.ts`

Acceptance:

- `TableFact` can produce a `StructuredFact`.
- Regex extractor remains fallback.
- Non-KAP table test passes.

### Phase 3.3 - Universal CompiledEvidence

Goal:

Make every retrieval mode produce compiled evidence or explicit reason.

Files:

- `apps/backend-api/src/routes/chatProxy.ts`
- `apps/backend-api/src/lib/qdrantRetrieval.ts`
- `apps/backend-api/src/lib/knowledgeRetrieval.ts`
- `apps/backend-api/src/lib/compiledEvidence.ts`

Acceptance:

- `retrieval_debug.compiledEvidence` exists for hybrid/qdrant/prisma when evidence exists.
- Structured facts count toward usable grounding.

### Phase 3.4 - Pre-Composer AnswerPlan

Goal:

Build AnswerPlan before answer path selection.

Files:

- `apps/backend-api/src/routes/chatProxy.ts`
- `apps/backend-api/src/lib/answerPlan.ts`
- `apps/backend-api/src/lib/domainEvidenceComposer.ts`

Acceptance:

- Answer path trace includes plan before composer.
- Field extraction with incomplete coverage does not silently fall to generic answer.

### Phase 3.5 - Composer 2.0

Goal:

Render only from `AnswerPlan + EvidenceBundle + StructuredFact`.

Files:

- `apps/backend-api/src/lib/domainEvidenceComposer.ts`
- new composer module if needed

Acceptance:

- Composer no longer needs finance table string mining for passing KAP cases.
- Raw table dump is impossible when structured facts cover requested fields.

### Phase 3.6 - Eval Upgrade

Goal:

Eval catches field/value mismatch and source-found-but-bad-answer.

Files:

- `apps/backend-api/scripts/run-grounded-response-eval.mjs`
- `infrastructure/evals/answer-quality/golden.jsonl`
- `infrastructure/evals/ui-reality/golden.example.jsonl`

Acceptance:

- `requiredFields` is enforced.
- `table_field_mismatch` bucket exists.
- `expectAnswerPlan` exists.
- `source_found_but_bad_answer` exists.

## What Not To Do

1. Do not solve this by forcing Qwen to answer more often.
2. Do not add more KAP regex into composer as the main path.
3. Do not treat `CompiledEvidence` as structured just because it has a `structuredFacts` optional array.
4. Do not let safety fallback become the default answer style.
5. Do not consider answer-quality eval green until it asserts AnswerPlan coverage.
6. Do not remove deterministic composer; make it more typed.
7. Do not wire domain packs only for finance; the next non-KAP table must work without TypeScript alias edits.

## Final Verdict

Current level:

Section 03 is pilot-capable for known KAP and stress fixtures, but not yet product-level for arbitrary enterprise documents.

Primary bottleneck:

The answer layer is structurally present, but evidence is still string-first and AnswerPlan is late. For table/numeric questions, this is the main quality bottleneck.

Qwen2.5-3B realism:

The target remains realistic with Qwen2.5-3B because the system mostly bypasses Qwen for grounded answers. The requirement is to feed Qwen only typed, validated evidence when it is used.

Minimum product threshold:

Before a sellable pilot, the system should guarantee:

- every answer has an explicit AnswerPlan trace;
- table/numeric answers are rendered from structured facts, not raw table strings;
- safety does not add generic caution when the user asked for field-only output;
- eval fails on field/value mismatch, incomplete field coverage, raw table dump, and source-found-but-bad-answer.
