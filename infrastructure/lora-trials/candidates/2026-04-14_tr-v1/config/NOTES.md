# Eğitim öncesi — yapılandırma notu (`2026-04-14_tr-v1`)

**Adapter etiketi (export dosya adı kökü):** `tr-v1` — `export/tr-v1.gguf` ile hizalı olmalı.

## Veri

- **Kaynak:** `../train/tr-conversations-v1.jsonl` (repo içi küçük kanıt).
- Büyük ek veri setleri **repo dışı** tutulur; burada yalnızca yol veya kısa referans yazılır.

## Sabit pin (değiştirme)

- **Base GGUF:** [BITNET_QVAC_PRODUCTION_MATRIX.md](../../../BITNET_QVAC_PRODUCTION_MATRIX.md) — `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`
- **Runtime:** qvac **b7349**, TQ2 uyumlu LoRA çıktısı

## Eğitim hiperparametreleri

*(İlk tur başlarken doldurun: LR, epoch, LoRA rank, seed — tek satır veya ayrı `params.yaml` isteğe bağlı.)*

| Alan | Değer |
|------|--------|
| epochs | 20 |
| LoRA rank / alpha | 16 / 32 |
| LoRA modules | all |
| LR / scheduler | 1e-5 / cosine, warmup 0.1, lr-min 1e-8 |
| batch / ctx (`-b`, `-ub`, `-c`) | 128 / 128 / 128 |
| Backend | CPU (`-ngl 0`), b7349 |
| Export | `../export/tr-v1.gguf` |
