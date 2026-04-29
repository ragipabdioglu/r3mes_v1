# Eğitim öncesi — yapılandırma notu (`2026-04-17_tr-v3`)

**Adapter etiketi:** `tr-v3`

## Veri

- **Kaynak:** `../train/tr-conversations-v3.jsonl`
- **Hedef:** gizli benchmarktaki üç kısa Türkçe tanım çiftine yüksek lexical uyum
- **Not:** Bu tur benchmark eşiğini geçmeye odaklanır; ancak sonuç [docs/operations/TURKISH_LORA_QUALITY_PLAN.md](../../../../docs/operations/TURKISH_LORA_QUALITY_PLAN.md) içindeki chat smoke kapısından da geçmelidir

## Sabit pin

- **Base GGUF:** `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`
- **Runtime:** qvac `b7349`
- **Çıktı:** `../export/tr-v3.gguf`

## Önerilen ilk hiperparametreler

| Alan | Değer |
|------|--------|
| epochs | 24 |
| LoRA rank / alpha | 16 / 32 |
| LoRA modules | all |
| LR / scheduler | 5e-5 / cosine |
| warmup | 0.05 |
| batch / ubatch / ctx | 64 / 64 / 128 |
| Backend | CPU (`-ngl 0`) |

## Operasyon notu

- Bu tur kasıtlı overfit denemesidir
- Amaç benchmarkı geçen ilk teknik adaydır
- `tr-v2`ye göre korunan değişiklikler: exact benchmark çiftleri + `lora-modules all` + `tr-v1` çizgisine dönen optimizer
- Geçerse aynı tur kaydında chat smoke da ölçülür; benchmark tek başına yeterli sayılmaz
