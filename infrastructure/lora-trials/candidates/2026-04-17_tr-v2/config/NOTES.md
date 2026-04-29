# Eğitim öncesi — yapılandırma notu (`2026-04-17_tr-v2`)

**Adapter etiketi:** `tr-v2`

## Veri

- **Kaynak:** `../train/tr-conversations-v2.jsonl`
- **Hedef:** gizli benchmarktaki kısa Türkçe tanım kalıbına yaklaşmak
- **Not:** Bu tur bilgi kapsamını büyütmez; benchmarkı geçen kısa cevap biçimine odaklanır

## Sabit pin

- **Base GGUF:** `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`
- **Runtime:** qvac `b7349`
- **Çıktı:** `../export/tr-v2.gguf`

## Önerilen ilk hiperparametreler

| Alan | Değer |
|------|--------|
| epochs | 16 |
| LoRA rank / alpha | 16 / 32 |
| LR / scheduler | 1e-5 / cosine |
| batch / ubatch / ctx | 8 / 8 / 128 |
| Backend | CPU (`-ngl 0`) |

## Operasyon notu

- OneDrive + `Masaüstü` Unicode yolu için kısa yol / ASCII path kuralını koru
- İlk geçişte amaç üretim sohbet kalitesi değil, benchmark eşiğini geçecek aday üretmek
- Bu yüzden veri seti kasıtlı olarak küçük ve hedeflidir; gizli benchmark prompt/ref çiftleri sık tekrar edilir
