# Phase 6 Slice 5 - Fact-Level Evidence Diagnostics

Date: 2026-06-01

## Scope

Faz 6 Dilim 5, compiled evidence icindeki fact seviyesini debug/eval contract'a tasir.

Bu slice parser, retrieval scoring, composer behavior, safety behavior, Qdrant, embedding provider veya public response shape degistirmedi.

## Changed Contracts

- `CompiledEvidence.factLevelDiagnostics` eklendi.
- `EvalDebugContract.answerBaseline.compiledEvidence.factLevelDiagnostics` eklendi.
- Eval summary `answerBaselineQuality.factLevelDiagnostics` aggregate etmeye basladi.

## New Diagnostics

- `usableEvidenceItemCount`
- `selectedTextFactCount`
- `selectedStructuredFactCount`
- `selectedRiskFactCount`
- `selectedUnknownCount`
- `selectedContradictionCount`
- `selectedSourceCount`
- `bundleKindCounts`
- `structuredFactKinds`
- `structuredFactConfidenceCounts`
- `sourceDistribution`
- `contradictionSources`
- `diagnosticsMode: observed_only`

## Runtime Adapter Note

Runtime path'te compiled evidence bazen yeni `factLevelDiagnostics` alanini tasimadan debug contract'a geliyor. Bu nedenle `buildEvalDebugContract`, alan eksikse mevcut `compiledEvidence + evidenceBundle` uzerinden observed-only fallback diagnostic turetiyor.

Bu behavior degisikligi degildir; yalnizca debug/eval contract coverage'ini tamamlar.

## Test Results

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/compiledEvidence.test.ts src/lib/evalDebugContract.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | pass | 17/17 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Typecheck passed |
| `node --check apps/backend-api/scripts/run-grounded-response-eval.mjs` | 0 | pass | Eval runner syntax passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | pass | Dist updated |
| backend restart + `/ready/rag-runtime` | 0 | pass | Backend healthy on port 3000 |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | expected fail | 8/17 passed; answer behavior unchanged |

## Answer Quality Findings

Answer-quality remains 8/17 as expected.

New fact-level evidence summary:

- `factLevelDiagnostics.observedCases`: 16
- `coverageRatio`: 0.941
- Avg selected structured facts: 0.765
- Avg selected text facts: 3.471
- Avg selected risk facts: 1.294
- Avg selected unknowns: 1.412
- Avg selected contradictions: 0.294
- `structuredFactKinds.table_row`: 13
- `structuredFactKinds.numeric_value`: 0
- `bundleKindCounts.table_fact`: 13
- `bundleKindCounts.numeric_fact`: 0
- `bundleKindCounts.text_fact`: 79
- `bundleKindCounts.source_limit`: 22
- `bundleKindCounts.contradiction`: 5

Interpretation:

The current evidence layer mostly carries table rows and text facts, not normalized numeric facts. This explains why answer-quality numeric/table cases still depend on fallback rendering and why Faz 7 answer intelligence should not assume field-level numeric facts are already mature.

## Public Debug Boundary

- Public response shape did not change.
- Fact-level diagnostics appear only in debug/eval contract.
- Raw vectors, Qdrant payloads, provider internals, internal scores, and safety rails were not added to public response.

## Risk / Backlog

- Faz 6 closure should decide whether current fact diagnostics are enough before moving to answer behavior changes.
- Faz 7 backlog: answer renderer must use structured rows/facts intentionally and reduce fallback template usage.
- Faz 2/6 future backlog: table-row artifacts should eventually produce stronger `numeric_fact` coverage where parser artifacts support it.
- Local CPU run produced `normal_rag_p95_latency` warning; provider budget remains a non-blocking local performance backlog.

## Next Step

Run Faz 6 closure verification. If accepted, move to Faz 7 Full Answer Intelligence.
