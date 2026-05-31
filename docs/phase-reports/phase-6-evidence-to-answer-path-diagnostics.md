# Phase 6 Slice 4 - Evidence To Answer Path Diagnostics

Date: 2026-05-31

## Scope

Faz 6 Dilim 4, compiled evidence yeterli oldugunda cevabin hangi answer path'e dustugunu olculebilir hale getirir.

Bu slice retrieval, parser, composer davranisi, safety davranisi, Qdrant, embedding provider veya public response shape degistirmedi.

## Changed Contracts

- `EvalDebugContract.answerBaseline.evidenceToAnswerPath` eklendi.
- Yeni diagnostic alanlari:
  - `sufficiencyStatus`
  - `shouldAnswer`
  - `answerPlanCoverage`
  - `requiresModelSynthesis`
  - `composerPath`
  - `plannedComposerUsed`
  - `fallbackTemplateUsed`
  - `safetyPass`
  - `safetySeverity`
  - `diagnosis`
- Eval summary artik evidence sufficiency ile composer/safety path arasindaki gecisi aggregate ediyor:
  - `evidenceToAnswerPathDiagnoses`
  - `evidenceToAnswerPathBySufficiency`
  - `evidenceToAnswerPathByComposer`
  - `sufficientEvidenceFallbackRatio`
  - `partialEvidenceCaseRatio`
  - `contradictionEvidenceCaseRatio`

## Diagnosis Values

- `no_compiled_evidence`
- `evidence_sufficient_planned_answer`
- `evidence_sufficient_fallback`
- `evidence_partial_fallback_or_synthesis`
- `evidence_contradictory_safety`
- `evidence_insufficient_boundary`
- `evidence_path_unclassified`

## Test Results

| Command | Exit | Result | Note |
| --- | ---: | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/evalDebugContract.test.ts src/lib/chatResponseBoundary.test.ts` | 0 | pass | 3/3 tests passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Typecheck passed |
| `node --check apps/backend-api/scripts/run-grounded-response-eval.mjs` | 0 | pass | Eval runner syntax passed |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | pass | Dist updated for runtime eval |
| backend restart + `/ready/rag-runtime` | 0 | pass | Backend healthy on port 3000 |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | pass | 1/1 passed |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | expected fail | 8/17 passed; answer behavior unchanged |

## Answer Quality Findings

Answer-quality remains 8/17, as expected for Faz 6 Dilim 4.

New diagnostics show:

- `evidence_sufficient_fallback`: 9
- `evidence_partial_fallback_or_synthesis`: 6
- `evidence_contradictory_safety`: 1
- `no_compiled_evidence`: 1
- `sufficientEvidenceFallbackRatio`: 1.0

Interpretation:

Evidence/compiler tarafinda yeterli gorunen 9 case'in tamami answer/composer/safety fallback path'e dusuyor. Bu, Faz 7 icin net bir blocker degil ama net bir is paketi: structured evidence vardiginda cevap katmani eski fallback/template davranisini azaltmali.

## Public Debug Boundary

- Public response shape degismedi.
- `evidenceToAnswerPath` sadece debug/eval diagnostics icinde uretiliyor.
- Provider detail, raw trace, Qdrant payload, internal score veya safety rail public response'a eklenmedi.

## Risks And Backlog

- Faz 7 backlog: sufficient evidence cases should not default to `planned_fallback_template` or `safety_fallback` unless policy requires it.
- Faz 7 backlog: answer renderer must consume `AnswerPlan` plus structured/compiled evidence instead of relying on fallback templates.
- Faz 6 remaining backlog: partial evidence cases need deeper fact-level coverage and contradiction handling before answer planning is finalized.

## Next Step

Continue Faz 6 with contradiction/fact-level diagnostics or move to Faz 7 only after Faz 6 closure confirms evidence diagnostics are sufficient.
