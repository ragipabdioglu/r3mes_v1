# BitNet ilk veri turu — `2026-04-14_tr-v1`

Bu klasor, BitNet/QVAC icin ilk kucuk Turkce egitim denemesinin baslangic iskeletidir.

## Amac

- Kucuk bir Turkce instruction veri seti ile ilk `llama-finetune-lora` dry-run'ini baslatmak
- Veri biciminin secili QVAC release'inin bekledigi JSONL semasina uyup uymadigini hizli gormek
- Ilk adapter denemesi icin benchmark ile uyumlu, tek cumlelik kisa cevap stilini sabitlemek

## Klasor yapisi (sabit)

| Klasor | Rol |
|--------|-----|
| `config/NOTES.md` | Egitim oncesi: veri referansi, pin, hiperparametre (doldurulacak) |
| `train/` | Veri + checkpoint/log (buyuk dosyalar repo disi) — bkz. `train/README.md` |
| `export/` | Egitim **bittikten sonra** tek GGUF + checksum + EXPORT.md — bkz. `export/README.md` |
| `run/` | Istege bagli yerel BitNet smoke — bkz. `run/README.md` |
| `../runs/2026-04-14_tr-v1/` | Upload sonrasi TRIAL_RECORD — bkz. `runs/.../README.md` |

Ust belge: [ARTIFACT_LAYOUT.md](../../ARTIFACT_LAYOUT.md)

## Dosyalar

- `train/tr-conversations-v1.jsonl`
  BitNet icin ilk kucuk Turkce instruction veri seti. Her satir `messages` dizisi ile tek soru / tek cevap ornegidir.

## Not

Bu veri seti benchmark'in birebir kopyasi degildir. Ayni gorev tipine hizali acik bir baslangic setidir:

- Turkce
- kisa soru
- tek cumlelik teknik/populer bilgi cevabi
- blockchain, LoRA, IPFS, GGUF, dagitik sistemler, LLM temelleri

Ilk teknik kontrol:

1. `llama-finetune-lora --help`
2. Bu JSONL biciminin secili surumde dogrudan kabul edilip edilmedigini dogrula
3. Gerekirse yalniz alan adlarini / semayi release'in bekledigi bicime uyarlayip 1 satirlik dry-run yap

Bu klasordeki veri kucuk tutuldu; ilk amac kalite degil, egitim zincirini calistirmaktir.
