# Phase 10 LoRA-less Visual Layout Slice - 2026-06-12

## Status
- Runtime: LoRA-less. `llama` is intentionally down; `ai-engine` embedding endpoint is up.
- Services verified: backend-api, dApp, ai-engine, Qdrant, Postgres, Redis, IPFS gateway.
- Phase: Phase 10 Real Data Certification.

## Changes
- Added generic `visual_layout` query/evidence contract support.
- Narrowed visual-layout intent so plain `form` definition/event questions are not misrouted as layout questions.
- Added generic UI-like identifier signals for visual/layout retrieval and evidence diagnostics.
- Added visual-layout supplemental candidate discovery based on identifier density, without dataset-specific literals.
- Preserved public/debug boundary; changes are internal diagnostics/retrieval/evidence behavior only.

## Verification
- `pnpm --filter @r3mes/backend-api exec vitest run src/lib/querySourceAlignment.test.ts src/lib/queryUnderstanding.test.ts src/lib/skillPipeline.test.ts src/lib/domainEvidenceComposer.test.ts src/lib/retrievalQualityContracts.test.ts` -> exit 0.
- `pnpm --filter @r3mes/backend-api exec tsc --noEmit` -> exit 0.
- `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` -> exit 0.
- `pnpm local:status` -> backend-api, dApp, ai-engine, Qdrant, IPFS gateway healthy; llama false; LoRA unavailable.
- `pnpm --filter @r3mes/backend-api run eval:gp-visual-programming-smoke` -> exit 1, 14/15.

## Eval Result
- G.P smoke: 14/15, passRate 0.933.
- Runtime lineage coverage: 1.0.
- Embedding fallback ratio: 0.
- Reranker fallback ratio: 0.
- Qwen call ratio: 0.

## Remaining Blocker
- `gp_ders8_visual_layout_controls` still fails.
- Current failure class: `retrieval_or_evidence_failure`.
- Current symptoms:
  - sourceCount 4 exceeds eval maxSources 3.
  - required context terms still missing: `TextBox`, `ComboBox`, `ListBox`.
  - selected text evidence is mostly parsed text/code fragments, not true visual layout extraction.

## Diagnosis
- The PDF set does not expose the full expected form design as a structured visual/layout artifact in the current parsed text.
- Retrieval can now find some UI-like evidence, but the expected visual controls require either:
  - better visual/layout document intelligence from images/OCR/layout extraction, or
  - a fixture expectation that matches text-available evidence rather than image-only evidence.
- Further retrieval/composer hacks would risk overfitting and violating the product architecture rule against data-specific core logic.

## Next Correct Step
- Treat this case as Phase 10 visual-layout certification backlog.
- Do not force-pass with hardcoded G.P terms.
- Next implementation should be a Document Intelligence / visual layout extraction slice:
  - detect image-only or layout-heavy pages,
  - generate `visual_layout` artifacts from OCR/layout providers,
  - attach visual artifact spans to chunks,
  - rerun G.P visual smoke against V2 reingested data.
