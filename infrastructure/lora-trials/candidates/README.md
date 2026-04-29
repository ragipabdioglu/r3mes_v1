# BitNet üretim adapter — `candidates/<trial_id>/` özeti

**Tam şema (repo içi/dışı, zorunlu dosyalar, upload checklist):** [../ARTIFACT_LAYOUT.md](../ARTIFACT_LAYOUT.md)

**Sabit matris:** [BITNET_QVAC_PRODUCTION_MATRIX.md](../../BITNET_QVAC_PRODUCTION_MATRIX.md)

## Kısa ağaç

`<REPO_KÖKÜ>/infrastructure/lora-trials/candidates/<trial_id>/`

```text
<trial_id>/
  README.md
  config/
  train/
    checkpoints/
    logs/
  export/
    <adapter_etiketi>.gguf
    <adapter_etiketi>.gguf.sha256
    EXPORT.md
  run/                    # opsiyonel
    README.md
    llama-snippet.txt
```

**Ürün trial kaydı** (upload sonrası): `../runs/<trial_id>/TRIAL_RECORD.md` — aynı `trial_id`.

## Üçlü ayrım

| Klasör | Upload / IPFS |
|--------|----------------|
| **train/** | Hayır |
| **export/** | **Evet — yalnızca buradan** |
| **run/** | Hayır (kanıt amaçlı kopya) |

**Checksum:** `export/*.sha256` — [ARTIFACT_LAYOUT.md §6](../ARTIFACT_LAYOUT.md) upload öncesi kontrol listesi.
