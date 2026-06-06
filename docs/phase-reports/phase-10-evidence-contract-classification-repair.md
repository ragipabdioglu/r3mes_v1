# Phase 10 Slice Report - Evidence Contract Classification Repair

Date: 2026-06-06
Phase: Phase 10 - Real Data Certification
Owner area: Control Tower / eval contract accuracy

## What Changed

- Fixed Eval Contract V2 normalization so evidence-only expectations keep the context/source/title/evidence-type fields already supported by the scorer.
- Added generic evidence type aliases in the evidence-only scorer:
  - `list` maps to `list_item`
  - `comparison` maps to `comparison_point`
  - `procedure` maps to `procedure_step`
  - `code` maps to `code_fact` and `procedure_step`
  - `visual_layout` maps to visual/layout artifact labels
- No product runtime behavior changed.

## Why

G.P smoke showed a false diagnosis: `gp_vs_project_types_list` was marked as evidence-only pass and answer/composer fail, but live debug showed the expected list terms never reached answer evidence. The V2 contract adapter had dropped `requiredContextTerms`, so the scorer could not catch missing evidence coverage.

## Scope Guard

- No retrieval scoring changes.
- No evidence extraction, parser, Qdrant, embedding, reranker, UI, model, safety, or composer behavior changed.
- No data-specific literals were added to product code.
- Fixture data remains the only place where G.P-specific expected terms appear.

## Validation

| Command | Exit | Result |
| --- | --- | --- |
| `node --input-type=module` contract smoke | 0 | V2 evidence expectations preserve context/type/source/title terms |
| `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` | 1 | expected red gate; classification corrected; 7/15 pass |
| `pnpm --filter @r3mes/backend-api run eval:real-data-certification` | 0 | rollup generated; release gate still fail |

## Certification Impact

- Backlog remains 31, blockers remain 30.
- Owner phase classification changed:
  - Phase 7: 25 -> 22
  - Phase 6: 0 -> 3
- Layer family classification changed:
  - answer-presentation: 20 -> 17
  - context-evidence-coverage: 0 -> 3

## Interpretation

This did not improve final answers. It made certification more honest. Several G.P cases that looked like composer failures are now correctly marked as retrieval/evidence coverage failures because required context terms are absent from the evidence-only surface.

## Next Step

Continue Phase 10 triage using the corrected owner map. The next work should not blindly patch composer for G.P list/code/visual cases; those now point to Phase 6 evidence coverage or Phase 4/5 retrieval/source intelligence depending on case diagnostics.
