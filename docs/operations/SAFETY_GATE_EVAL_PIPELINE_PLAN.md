# R3MES Safety Gate + Eval Pipeline Architecture Plan

Status: planned
Scope: `apps/backend-api`, `infrastructure/evals`, `docs/operations`
Goal: Make safety and evaluation a connected quality layer for the adaptive RAG pipeline without adding heavy judge models or making the MVP more complex.

## Why This Matters

R3MES is moving toward a self-adapting RAG system:

```text
User Query
-> Query Signals
-> Collection Profiles
-> Adaptive Router / Suggestions
-> Hybrid Retrieval
-> Rerank / Pruning
-> Evidence Extractor
-> AnswerSpec
-> Composer
-> Safety Gate
-> Eval + Logs
```

The current safety gate already catches risky certainty, missing sources, bad language, source metadata mismatch, and urgent medical red flags. The eval runner already checks sources, facts, route decisions, collection suggestions, required concepts, forbidden terms, latency, and safety pass/fail.

The missing step is to make these two systems **shared-signal aware**:

- Safety should understand `AnswerSpec`, retrieval diagnostics, route decision mode, evidence quality, and domain policy.
- Eval should measure the full RAG triad: context relevance, groundedness, and answer relevance.
- Both should stay deterministic by default. Qwen2.5-3B must not become the validator.

## Research Basis

RAG evaluation should not be a single pass/fail. The most useful frame is the RAG triad:

- Context relevance: retrieved chunks should match the query.
- Groundedness: final claims should be supported by retrieved context.
- Answer relevance: final answer should actually answer the user.

This matches TruLens' RAG triad framing and RAGAS' context precision / faithfulness style metrics.

Guardrails should also be applied at multiple points, not only at final output. NeMo Guardrails separates input rails, retrieval rails, dialog rails, execution rails, and output rails. For R3MES, we do not need to adopt NeMo as a dependency right now, but its architecture maps well to our backend:

- Input rail: query sanity, jailbreak/off-topic/risk hints.
- Retrieval rail: chunk filtering, private/public enforcement, low-score pruning.
- Evidence rail: unsupported or risky claims should be marked before generation.
- Output rail: final answer safety, language quality, source consistency.

Useful references:

- TruLens RAG triad: https://www.trulens.org/getting_started/core_concepts/rag_triad/
- RAGAS context precision: https://docs.ragas.io/en/v0.2.10/concepts/metrics/available_metrics/context_precision/
- NeMo Guardrails rail types: https://docs.nvidia.com/nemo/guardrails/latest/about/rail-types.html
- NeMo Guardrails process: https://docs.nvidia.com/nemo/guardrails/0.19.0/user-guides/guardrails-process.html
- LlamaIndex faithfulness evaluator: https://docs.llamaindex.ai/en/v0.10.33/examples/evaluation/faithfulness_eval/

## Current State

### Existing Safety Gate

File: `apps/backend-api/src/lib/safetyGate.ts`

Already covers:

- empty answer
- retrieval used but no sources
- risky certainty / treatment / legal / finance phrases
- malformed multilingual output
- low-grounding overconfidence
- source metadata mismatch
- medical red-flag query without urgent guidance
- too-thin answer

Limitations:

- Works mostly from `GroundedMedicalAnswer`, not `AnswerSpec`.
- Domain rules are hardcoded arrays instead of a registry.
- Red-flag detection is strongest for medical, weaker for legal/finance/technical/education.
- Retrieval/evidence diagnostics are not first-class safety inputs.
- Fallback text is assembled inside safety gate, which makes it harder to keep composer and safety language aligned.

### Existing Eval Pipeline

File: `apps/backend-api/scripts/run-grounded-response-eval.mjs`

Already covers:

- source count
- safety gate pass
- retrieval debug presence
- evidence fact count
- latency budget
- expected domain / intent / retrieval mode
- fallback template usage
- language quality signal
- expected used/accessed/suggested/rejected collection ids
- route decision mode/confidence/domain
- forbidden terms
- required concepts with synonym support

Limitations:

- Eval cases are still mostly handcrafted.
- No explicit metric buckets for RAG triad.
- Context quality is inferred through source/fact counts, not scored directly.
- Safety failures are not categorized into severity.
- No collection-level automatic smoke generation yet.
- No trend comparison between latest and previous eval artifacts.

## Target Safety Architecture

Safety should become a deterministic rail engine:

```text
SafetyInput
  query
  answerText
  answerSpec
  groundedAnswer
  sources
  routeDecision
  retrievalDiagnostics
  evidence
  domainPolicy
  retrievalWasUsed
  includePublic / collection scope

SafetyRule[]
  input rules
  retrieval rules
  evidence rules
  output rules
  source/privacy rules

SafetyGateResult
  pass
  severity
  blockedReasons[]
  warnings[]
  requiredRewrite
  fallbackMode
  safeFallback
  metrics
```

### Rule Categories

#### 1. Input Rules

Purpose: catch query-level risk before generation.

Rules:

- suspicious prompt injection terms should create a warning, not necessarily block
- medical emergency terms should require urgent-guidance coverage
- legal deadline / finance decision / destructive technical operation should increase caution level
- empty or too-short query should lower grounding expectations

Implementation:

- Extend query signal output, do not add another LLM call.
- Store query risk hints in safety input.

#### 2. Retrieval Rules

Purpose: prevent bad context from poisoning the model.

Rules:

- if retrieval was requested and final candidates are empty, force `low` grounding
- if route mode is `suggest`, do not let model answer as if grounded
- if selected collection produced no usable facts, prefer source suggestion answer
- if private collection scope exists, source ids must be within accessible collection ids
- if too many chunks survive pruning, warn because Qwen3B context quality may drop

Implementation:

- Use existing `retrieval_debug`, `sourceSelection`, `routeDecision`, and candidate counts.
- Add explicit `retrievalSafety` object in debug output later.

#### 3. Evidence Rules

Purpose: ensure final answer is supported by extracted evidence.

Rules:

- if `usableFacts.length === 0`, final answer must explicitly say enough source support is missing
- if answer contains a claim that is not present in facts/supporting context and is high-risk, fallback
- if red flags exist, answer must include caution/action
- if unknowns/missing info exist and grounding is low, answer must not sound definitive

Implementation:

- Prefer deterministic claim checks for MVP.
- Do not use Qwen3B as a judge.
- Optional future: lightweight NLI/entailment or sentence-transformer claim support, only if deterministic checks hit a ceiling.

#### 4. Output Rules

Purpose: final response quality and policy compliance.

Rules:

- malformed multilingual output fails
- risky certainty fails
- low-grounding overconfidence fails
- source metadata mismatch fails
- too-thin answer fails
- answer must not expose private metadata beyond allowed source fields
- answer should not mention internal route/debug details

Implementation:

- Continue current regex/rule approach.
- Move domain-specific patterns into a registry.

## Target Eval Architecture

Eval should measure the whole pipeline, not just final text.

```text
Eval Case
  query
  collectionIds / includePublic
  expected route behavior
  expected retrieval behavior
  expected evidence behavior
  expected answer behavior
  expected safety behavior

Eval Runner
  call backend
  collect response + retrieval_debug + safety_gate
  compute metrics
  write artifact
  compare thresholds
```

### Metric Buckets

#### 1. Router / Suggestion Metrics

- `routeDecisionMode`
- `routeDecisionConfidence`
- `routePrimaryDomain`
- selected / used / suggested / rejected collection ids
- top metadata candidate score
- thin profile behavior

Target:

- wrong selected source should lead to `suggest`, not hallucinated answer
- thin profile should avoid overconfident `strict`
- new collection profile should become selectable without hardcoded domain logic

#### 2. Retrieval Metrics

- source count min/max
- final candidate count
- qdrant candidate count
- lexical/prisma candidate count
- deduped candidate count
- reranked candidate count
- retrieval mode
- source visibility correctness

Target:

- retrieval should be broad before rerank, narrow before generation
- top context should be small enough for Qwen3B
- private data must never appear in unrelated user scope

#### 3. Evidence Metrics

- usable fact count
- direct answer fact count
- risk/red flag count
- missing info count
- source id coverage
- evidence-to-answer term coverage

Target:

- final answer should be based on extracted facts, not raw chunk text
- if evidence is weak, answer should be cautious or suggest better source

#### 4. Answer Metrics

- required concepts
- forbidden terms
- answer too thin
- low language quality
- expected intent
- expected fallback template usage
- no internal debug leakage

Target:

- answer should be natural, not a rigid JSON/template echo
- answer should stay domain-agnostic when new data is added

#### 5. Safety Metrics

- safety pass
- blocked reason codes
- severity
- fallback mode
- high-risk domain coverage
- privacy/source metadata mismatch

Target:

- unsafe answer is rewritten/fallbacked before UI
- safety failures are explainable in artifacts

#### 6. Performance Metrics

- latency ms
- route/retrieval/rerank/generation/safety timings if available
- candidate counts
- retry count

Target:

- CPU rerank should stay bounded
- eval should catch latency regressions caused by bigger candidate pools

## Proposed Data Contracts

### SafetyInput

```ts
interface SafetyInput {
  answerText: string;
  answerSpec: AnswerSpec;
  groundedAnswer: GroundedMedicalAnswer;
  sources: ChatSourceCitation[];
  retrievalWasUsed: boolean;
  routeDecision?: RouteDecision;
  retrievalDiagnostics?: RetrievalDiagnostics;
  evidence?: EvidenceExtractorOutput;
  accessibleCollectionIds?: string[];
}
```

### SafetyRule

```ts
interface SafetyRule {
  id: string;
  category: "input" | "retrieval" | "evidence" | "output" | "privacy";
  severity: "info" | "warn" | "rewrite" | "block";
  evaluate(input: SafetyInput): SafetyRuleHit | null;
}
```

### SafetyGateResult

```ts
interface SafetyGateResult {
  pass: boolean;
  severity: "pass" | "warn" | "rewrite" | "block";
  blockedReasons: string[];
  warnings: string[];
  requiredRewrite: boolean;
  fallbackMode?: "none" | "low_grounding" | "source_suggestion" | "domain_safe" | "privacy_safe";
  safeFallback?: string;
  metrics: {
    sourceCount: number;
    usableFactCount: number;
    redFlagCount: number;
    answerLength: number;
  };
}
```

## Implementation Plan

### Phase 1 - Safety Gate Input Refactor

Goal: keep behavior stable, but pass richer inputs.

Tasks:

- Add `SafetyInput` type.
- Let `evaluateSafetyGate` accept `answerSpec` optionally.
- Preserve old call shape during migration.
- Add safety metrics to result.
- Add tests proving old behavior is unchanged.

Exit criteria:

- Current `safetyGate.test.ts` passes.
- `chatProxy.rag.test.ts` passes.
- No response contract break.

### Phase 2 - Domain Safety Registry

Goal: move domain-specific risk rules out of scattered arrays.

Tasks:

- Create `domainSafetyPolicy.ts`.
- Define risk patterns per domain:
  - medical: diagnosis/treatment certainty, emergency guidance
  - legal: guaranteed outcome, deadline negligence, unauthorized legal certainty
  - finance: buy/sell/guaranteed return
  - technical: destructive command, production migration risk
  - education: definitive diagnosis/placement/date without source
  - general: high-certainty unsupported claim
- Connect safety gate to registry.
- Keep deterministic rules.

Exit criteria:

- Existing safety behavior unchanged or stricter.
- New tests for legal, finance, technical, education.

### Phase 3 - Retrieval/Evidence Rail Checks

Goal: safety should know when retrieval quality is weak.

Tasks:

- Add rules:
  - `SUGGEST_MODE_CANNOT_ANSWER_AS_GROUNDED`
  - `NO_USABLE_FACTS_LOW_GROUNDING`
  - `PRIVATE_SOURCE_SCOPE_MISMATCH`
  - `TOO_MANY_CONTEXT_CHUNKS_FOR_3B`
  - `RED_FLAGS_MISSING_ACTION`
- Wire route/evidence/retrieval debug into safety input in `chatProxy.ts`.

Exit criteria:

- Wrong-source cases still return suggestion behavior.
- No-source cases do not become confident answers.
- Private source mismatch test exists.

### Phase 4 - Fallback Rendering Through AnswerSpec

Goal: avoid fallback text diverging from composer.

Tasks:

- Move fallback generation out of safety gate into a small `safeFallbackComposer`.
- Fallback composer should produce an `AnswerSpec` and use `composeAnswerSpec`.
- Safety gate should decide fallback mode, not write long answer bodies itself.

Exit criteria:

- Fallback output format stays consistent with normal answers.
- Safety gate becomes decision-only plus short reason metadata.

### Phase 5 - Eval Metric Buckets

Goal: make eval artifacts explain pipeline quality.

Tasks:

- Extend `run-grounded-response-eval.mjs` summary with:
  - router pass/fail count
  - retrieval pass/fail count
  - evidence pass/fail count
  - answer pass/fail count
  - safety pass/fail count
  - latency p50/p95
- Add per-case `metricBuckets`.
- Keep current golden JSONL compatibility.

Exit criteria:

- Existing eval sets run unchanged.
- Output artifact is more diagnostic.

### Phase 6 - Collection-Level Auto Smoke Eval

Goal: every new knowledge collection should get minimum automated checks.

Tasks:

- Add script `generate-collection-smoke-eval.mjs`.
- For a collection profile, generate deterministic cases:
  - one likely in-domain query from sample questions/summary
  - one wrong-domain query
  - one no-source/unsupported query
  - one privacy/access check if private
- Avoid LLM-based case generation for MVP.
- Save generated eval to `artifacts/evals/generated/<collectionId>.jsonl`.

Exit criteria:

- New collection can be smoke-tested without hand-writing golden cases.
- Generated cases can run through existing eval runner.

### Phase 7 - Regression + Trend Reports

Goal: stop optimizing only for current examples.

Tasks:

- Add `compare-eval-runs.mjs`.
- Compare current artifact vs previous artifact:
  - pass rate
  - bucket deltas
  - latency deltas
  - changed failures
- Print a compact markdown summary.

Exit criteria:

- We can see if a refactor improved safety but hurt retrieval latency or suggestions.

### Phase 8 - Optional LLM/NLI Assisted Offline Eval

Goal: better quality measurement without affecting runtime.

Tasks:

- Add optional offline evaluator for claim support.
- Use only in eval/dev, never in production request path.
- Candidate options:
  - RAGAS-style faithfulness/context precision
  - LlamaIndex faithfulness evaluator
  - lightweight local NLI if practical

Exit criteria:

- Runtime remains deterministic and fast.
- Offline eval gives deeper groundedness signal when needed.

## Execution Order Recommendation

1. Safety Gate Input Refactor
2. Domain Safety Registry
3. Retrieval/Evidence Rail Checks
4. Fallback Rendering Through AnswerSpec
5. Eval Metric Buckets
6. Collection-Level Auto Smoke Eval
7. Regression + Trend Reports
8. Optional Offline Judge/NLI

This order is intentionally conservative: first make safety structurally cleaner, then make eval more honest, then automate new-collection smoke tests.

## What We Should Not Do Yet

- Do not add a heavy online validator model.
- Do not ask Qwen2.5-3B to judge its own answer.
- Do not block many user requests at input stage unless clearly unsafe.
- Do not make eval dependent on cloud APIs for the default local workflow.
- Do not add GraphRAG/RAPTOR before hybrid retrieval, pruning, and eval are stable.

## Near-Term Definition Of Done

Safety Gate is good enough when:

- high-risk unsupported answers are rewritten or fallbacked
- low-grounding answers cannot sound definitive
- private source leakage is tested
- wrong-source suggestions do not produce fake grounded answers
- fallback text is produced through AnswerSpec/composer

Eval Pipeline is good enough when:

- each run reports router/retrieval/evidence/answer/safety/performance buckets
- adaptive RAG and collection suggestion evals remain green
- generated collection smoke eval can run for at least one new/demo collection
- failures clearly explain whether the issue is route, retrieval, evidence, composer, or safety

