# Phase 10 Slice 3 - G.P Visual Programming Smoke Baseline

Generated: 2026-06-02

## Phase

- Current phase: Phase 10 - Real Data Certification
- Slice: G.P visual programming smoke baseline
- Scope: add a 15-case real-data smoke suite that separates evidence/context failures from answer/composer failures.

## What Changed

- Added `infrastructure/evals/gp-visual-programming-smoke/golden.jsonl`.
- Added `eval:gp-visual-programming-smoke` script to `@r3mes/backend-api`.
- Activated the G.P manifest eval suite now that the fixture exists.
- Corrected dataset manifest collection ids:
  - G.P V2 collection: `cmpmh50070002kll4mdk1mlnf`
  - B.Y V2 collection: `cmpmh35vz0002kl1gxtqydf28`

## Fixture Shape

The smoke suite has 15 cases across:

- definition extraction
- list extraction
- comparison extraction
- procedure extraction
- code understanding
- visual/layout
- no-source

Each case uses existing eval contracts:

- `evidenceExpectations` for source/context/evidence sufficiency
- `qualityExpectations` for final answer format, directness, warning pollution, and raw dump checks

Dataset-specific names and terms exist only in eval fixtures and manifests. No runtime logic was changed.

## Validation Results

| Command | Exit Code | Result | Note |
| --- | ---: | --- | --- |
| JSONL parse smoke | 0 | pass | 15 cases parse successfully. |
| `pnpm --filter @r3mes/backend-api run eval:real-data-manifests` | 0 | warn | 4 manifests valid, 0 failures, 1 warning for planned B.Y suite path. |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | pass | Backend typecheck passed. |
| `pnpm --filter @r3mes/shared-types run build` | 0 | pass | Shared types build passed. |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | fail baseline | 0/15 passed; expected for first strict real-data certification baseline. |

## G.P Smoke Result

- Total: 15
- Passed: 0
- Failed: 15
- Pass rate: 0
- Runtime lineage coverage: 1.0
- Qwen call ratio: 0
- Validator call ratio: 0
- Embedding fallback ratio: 0
- Reranker fallback ratio: 0.733
- Quality fallback ratio: 0.733

## Failure Map

| Category | Count / Rate | Meaning |
| --- | ---: | --- |
| provider fallback | 11 cases | Reranker fallback dominates strict failures. This is Phase 3/4 provider-runtime debt. |
| evidence-only failed | 4 cases | Context/source evidence is insufficient before answer generation. |
| answer-quality failed | 10 cases | Evidence may exist, but final answer is incomplete, too long, templated, or warning-polluted. |
| composer/model generation diagnosis | 7 cases | Evidence passed but final answer quality failed. |
| retrieval/evidence diagnosis | 4 cases | Evidence-only failed; answer cannot be trusted. |
| answer path `rag_fast_path` | 11 cases | Qwen was bypassed; deterministic/planned fallback template dominated. |
| answer path `no_source_fallback` | 3 cases | Some expected supported/unsupported questions fell into no-source. |
| answer path `conversational_intent` | 1 case | One selected-source query was misclassified as conversation. |

## Important Findings

- This suite confirms the user-observed issue: source can be selected, but answer quality remains poor due to composer/template and evidence coverage issues.
- The strict provider gate is working: reranker fallback is not counted as success.
- Visual/layout remains weak: the Ders 8 visual controls case fails evidence-only and answer-quality.
- Code understanding remains weak: `button3_Click` context is not reliably surfaced in the final answer.
- The smoke suite is intentionally red; Phase 10 is certifying reality, not forcing green by fixture relaxation.

## Public / Debug Boundary

- Runtime public response behavior was not changed.
- No debug payload, provider detail, Qdrant payload, internal score, or raw vector was introduced into public response by this slice.

## Backlog Routing

- Phase 3/4: reranker fallback strict failures and provider stability.
- Phase 4/6: evidence-only failures, wrong/no chunk, missing visual/code context.
- Phase 7: answer-quality failures, template pollution, too-long answers, unnecessary warning.
- Phase 10: continue adding B.Y smoke and connect real-data suite status into the aggregate certification report.

## Next Step

Add B.Y smoke fixtures or extend the Phase 10 certification analyzer so manifest-linked suites are summarized beside production aggregate. Do not patch runtime quality yet; use this baseline to prioritize the correct owner phase.

