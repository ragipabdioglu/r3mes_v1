# Run — eğitim komutu

Bu klasör, `tr-v2` için yerel eğitim komutunu tutar.

- `train_full.ps1` doğrudan `export/tr-v2.gguf` üretir
- Kaynak veri `../train/tr-conversations-v2.jsonl`
- Base model sabit kalır

İstenirse eğitim sonrası ayrı bir smoke turu yapılır; ancak upload için kanonik dosya yine `export/tr-v2.gguf` olur.
