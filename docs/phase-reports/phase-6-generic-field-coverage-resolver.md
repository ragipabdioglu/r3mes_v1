# Faz 6 Dilim 3 - Generic Field Coverage Resolver

Tarih: 2026-05-31

## Kapsam

Bu dilim V2 veri varsayimi ile `CompiledEvidenceV2.coverage` ve `AnswerPlan` requested-field eslesmesini generic hale getirdi. Eski veri kalite kaniti sayilmadi; runtime dogrulama V2 structured fact sinyalleri uzerinden yorumlandi.

## Ne Degisti?

- `fieldCoverageResolver` eklendi.
- Resolver, requested field `id/label/alias` degerlerini structured fact `field`, `subject`, `table.title`, `table.rowLabel`, `table.columnLabel`, `table.headers`, `table.rawRow` ve `provenance.quote` ile normalize-token seviyesinde eslestiriyor.
- `answerPlan` icindeki lokal field matcher bu ortak resolver'a tasindi.
- `compiledEvidence.coverage` artik sadece birebir id eslesmesine bakmiyor; snake_case id ile insan okunur field/table/provenance metnini de eslestiriyor.

## Ne Degismedi?

- Retrieval scoring degismedi.
- Parser, ingestion, Qdrant, embedding, reranker degismedi.
- Composer ve final answer rendering degismedi.
- Safety behavior degismedi.
- Public response payload genisletilmedi.

## Veri Ozel Literal Kontrolu

Yeni core logic dosyalari icin `KAP`, `CheckBox`, `ComboBox`, `5V`, `Ders 7`, `EREGL`, `KCHOL`, `FROTO`, `B.Y`, `G.P` tarandi. Yeni resolver ve degisen core dosyalarda veri ozel literal bulunmadi.

## Test ve Eval Sonuclari

| Komut | Exit | Sonuc | Not |
| --- | --- | --- | --- |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/fieldCoverageResolver.test.ts src/lib/compiledEvidence.test.ts src/lib/answerPlan.test.ts src/lib/evalDebugContract.test.ts` | 0 | Pass | 21 test |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit` | 0 | Pass | Backend typecheck |
| `pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json` | 0 | Pass | Runtime dist guncellendi |
| `/ready/rag-runtime` | 0 | Pass | Backend port 3000, runtime healthy |
| `pnpm --filter @r3mes/backend-api run eval:evidence-only` | 0 | Pass | 1/1 evidence-only smoke |
| `pnpm --filter @r3mes/backend-api run eval:answer-quality` | 1 | Expected fail | 8/17; coverage diagnostics improved |
| `pnpm --filter @r3mes/backend-api exec vitest run src/lib/chatResponseBoundary.test.ts src/lib/fieldCoverageResolver.test.ts src/lib/compiledEvidence.test.ts src/lib/answerPlan.test.ts` | 0 | Pass | Public boundary + resolver regression, 22 test |

## Evidence Diagnostic Degisimi

Answer-quality pass sayisi ayni kaldi: 8/17. Bu beklenen durum, cunku Dilim 3 composer veya safety davranisini degistirmedi.

Evidence coverage tarafinda iyilesme:

- `compiledEvidenceQuality.coverageStatuses`: once complete 5 / partial 11; sonra complete 10 / partial 6.
- `compiledEvidenceQuality.sufficiencyStatuses`: once sufficient 4 / partial 11 / contradictory 1; sonra sufficient 9 / partial 6 / contradictory 1.
- `compiledEvidenceQuality.missingFieldCaseRatio`: once 0.688; sonra 0.375.
- `answerBaselineQuality.compiledEvidenceMissingFieldCaseRatio`: once 0.647; sonra 0.353.
- `coveredFields` ortalamasi 0'dan 0.75'e cikti.

## Kalan Riskler

- Final cevap kalitesi hala 8/17; bu Dilim 3 blocker degil, Faz 7 Answer Intelligence ve safety presentation backlog.
- `retrievalEvidenceDemandCoverageQuality` hala numeric/table artifact gap gosteriyor; bu fact extraction ve structured artifact derinlestirme isidir.
- Normal RAG p95 latency tek kosuda 8635ms ile warn verdi; provider/runtime budget backlog.

## Sonraki Dilim

Faz 6 Dilim 4 icin onerilen is: evidence sufficiency gate diagnostics. Ama davranis degistirmeden once hangi partial/complete evidence durumlarinda composer'a raw fallback gittigini, hangilerinde safety fallback'in devreye girdigini case seviyesinde raporlamak gerekir.
