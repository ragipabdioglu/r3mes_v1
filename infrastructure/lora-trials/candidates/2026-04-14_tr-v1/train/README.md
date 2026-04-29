# Train — eğitim çalışma alanı

## Repo içi (küçük kanıt)

- **`tr-conversations-v1.jsonl`** — ilk Türkçe instruction örnekleri.

## Repo dışı / `.gitignore` (büyük)

- **`checkpoints/`** — eğitim checkpoint’leri (klasör oluşturulduğunda uzak arşiv veya yerel disk).
- **`logs/`** — tam eğitim logları.

Checkpoint veya ağır log **commit edilmez**. Özet metrik istenirse kök `config/NOTES.md` veya burada tek satırlık `metrics-summary.md` (küçük) kullanılabilir.
