# Faz 6 Dilim 1 - CompiledEvidenceV2 Baseline

Tarih: 2026-05-31

## Kapsam

Faz 6 Full Evidence Intelligence icin ilk dilimde `CompiledEvidence` uzerine geriye uyumlu V2 diagnostics eklendi. Bu dilim retrieval, parser, composer, safety veya public response davranisini degistirmez.

## Degisen Contract

- `CompiledEvidenceV2`
- `EvidenceCoverage`
- `EvidenceSufficiencyDecision`
- `EvidenceCoverageStatus`
- `EvidenceSufficiencyStatus`

## Ne Degisti?

- Compiled evidence artik `version: 2` donduruyor.
- Evidence coverage su alanlari ozetliyor: requested fields, covered fields, missing fields, usable evidence item count, structured/text fact count, contradiction count.
- Evidence sufficiency su durumlari ayiriyor: `sufficient`, `partial`, `insufficient`, `contradictory`.
- Eski `facts`, `risks`, `unknowns`, `contradictions`, `sourceIds`, `confidence` ve usable grounding davranisi korundu.

## Sinirlar

- Composer ve final answer kalitesi bu dilimde duzeltilmedi.
- Safety rewrite veya no-source behavior degismedi.
- Retrieval scoring, reranker, Qdrant ve parser davranisina dokunulmadi.
- Core logic icine veri ozel literal eklenmedi.

## Test ve Eval Sonuclari

| Komut | Exit | Sonuc | Not |
| --- | --- | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/compiledEvidence.test.ts src/lib/evidenceBundle.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | 3 dosya, 16 test |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 evidence-only smoke |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 8/17 pass; kalanlar Faz 6/7 evidence/composer/safety backlog |

## Answer-Quality Gozlemi

Answer-quality suite bu dilimden sonra da kirmizi kaldi. Bu Faz 6 icin beklenen durumdur, cunku bu dilim yalnizca coverage/sufficiency diagnostics ekledi. Kalan fail siniflari cogunlukla `composer_or_model_generation_failure`, `safety_policy_or_presentation_failure`, `context_coverage_failure` ve tablo/numeric coverage gap olarak gorunuyor.

## Riskler

- `coverage.coveredFieldIds` su anda structured fact `field` degerleri ve `EvidenceBundle.requestedFieldIds` uzerinden hesaplanir; full semantic requested-field matching Faz 6 sonraki dilimlerde derinlesmeli.
- `sufficiency.shouldAnswer` henuz runtime behavior gate olarak baglanmadi; sadece diagnostics amacli.
- Answer-quality failure sayisi product kalitesinin henuz kapanmadigini gosterir; ancak bu dilimin kabul kriteri kaliteyi hemen artirmak degil, evidence yeterliligini olculebilir hale getirmekti.

## Sonraki Dilim

Faz 6 Dilim 2 icin onerilen siradaki is: `EvidenceDiagnostics` ve eval summary icinde `coverage/sufficiency` aggregation. Boylece hangi case'lerde context var ama requested field yok, hangi case'lerde contradiction var, hangi case'lerde usable evidence yok net raporlanacak.
