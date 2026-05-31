# Faz 6 Dilim 2 - Evidence Diagnostics Aggregation

Tarih: 2026-05-31

## Kapsam

Bu dilim `CompiledEvidenceV2` ile gelen `coverage` ve `sufficiency` sinyallerini eval/debug raporlamasina tasidi. Runtime answer, retrieval, parser, safety ve composer davranisi degistirilmedi.

## Degisen Contract / Diagnostics

- `EvalAnswerBaselineDiagnostics.compiledEvidence.coverage`
- `EvalAnswerBaselineDiagnostics.compiledEvidence.sufficiency`
- Eval result alanlari:
  - `compiledEvidenceCoverageStatus`
  - `compiledEvidenceCoverageRequestedFieldCount`
  - `compiledEvidenceCoverageCoveredFieldCount`
  - `compiledEvidenceCoverageMissingFieldCount`
  - `compiledEvidenceSufficiencyStatus`
  - `compiledEvidenceShouldAnswer`
  - `compiledEvidenceSufficiencyReason`
- Eval summary alanlari:
  - `compiledEvidenceQuality.coverageStatuses`
  - `compiledEvidenceQuality.sufficiencyStatuses`
  - `compiledEvidenceQuality.sufficiencyReasons`
  - `compiledEvidenceQuality.missingFieldCaseRatio`
  - `answerBaselineQuality.evidenceCoverage`
  - `answerBaselineQuality.evidenceSufficiency`
  - `answerBaselineQuality.evidenceSufficiencyReasons`
  - `answerBaselineQuality.compiledEvidenceMissingFieldCaseRatio`

## Ne Degisti?

- Debug/eval path artik compiled evidence coverage ve sufficiency detaylarini tek yerde gosteriyor.
- Answer-quality eval summary artik context/evidence eksikliklerini final cevap kalitesinden ayri gosterebiliyor.
- Kalan answer-quality fail'lerde evidence coverage parcali mi, sufficiency contradiction mi, missing field mi daha net okunabiliyor.

## Sinirlar

- Final cevap composer'i degismedi.
- Safety policy veya presentation degismedi.
- Retrieval scoring, Qdrant, reranker, parser ve ingestion davranisina dokunulmadi.
- Public response payload genisletilmedi.

## Test ve Eval Sonuclari

| Komut | Exit | Sonuc | Not |
| --- | --- | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/evalDebugContract.test.ts src/lib/compiledEvidence.test.ts` | 0 | Pass | 13 test |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck |
| `node --check apps/backend-api/scripts/run-grounded-response-eval.mjs` | 0 | Pass | Eval runner syntax |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/chatResponseBoundary.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | Public/debug boundary + debug contract |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 evidence-only smoke |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 8/17 pass; diagnostics enriched |

## Runtime Notu

`pnpm --filter @r3mes/backend-api run build` Windows Prisma DLL lock nedeniyle `EPERM rename query_engine-windows.dll.node` hatasi verdi. Bu kod degisikligiyle ilgili degil; backend dist `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` ile guncellendi ve backend process kontrollu yeniden baslatildi.

## Answer-Quality Diagnostic Snapshot

Son answer-quality summary:

- `compiledEvidenceQuality.coverageStatuses`: complete 5, partial 11
- `compiledEvidenceQuality.sufficiencyStatuses`: sufficient 4, partial 11, contradictory 1
- `compiledEvidenceQuality.missingFieldCaseRatio`: 0.688
- `answerBaselineQuality.compiledEvidenceMissingFieldCaseRatio`: 0.647
- `answerBaselineQuality.compiledEvidenceShouldAnswerRatio`: 0.941

Bu tablo sunu gosteriyor: sistem cogunlukla bir miktar evidence buluyor, fakat requested field coverage eksik. Bu Faz 6'nin sonraki dilimlerinde fact-level matching ve evidence sufficiency gate ile ele alinmali.

## Kalan Riskler

- Coverage `coveredFieldIds` hala structured fact field ile requested field id eslesmesine bagli; semantic field resolver sonraki Faz 6 dilimidir.
- Answer-quality fail'leri product blocker olmaya devam eder ama bu dilimin kabul kriteri degildir.
- Normal RAG p95 latency tek kosuda 8194ms ile warn verdi; provider/runtime budget backlog olarak izlenmeli.

## Sonraki Dilim

Faz 6 Dilim 3 icin onerilen is: generic field coverage resolver. Amac, requested field id ile structured fact `field`/label/provenance arasindaki eslesmeyi veriye ozel literal olmadan normalize etmek ve `coveredFieldIds` oranini gercekci hale getirmek.
