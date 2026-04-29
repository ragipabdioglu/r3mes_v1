# Eğitim / export artefakt düzeni — somut şema

**Amaç:** Cluster kurmak değil; **ilk tur ve sonrası** için dağılmayan çalışma alanı. Eğitim artefaktı (`train/`) ile **runtime** ve **ürün trial** kayıtları karışmasın.

**Trial disiplini:** [LORA_CANDIDATE_TRIALS.md](../LORA_CANDIDATE_TRIALS.md) — matris: [BITNET_QVAC_PRODUCTION_MATRIX.md](../BITNET_QVAC_PRODUCTION_MATRIX.md).

---

## 1) Tam ağaç (tek kök)

Kök: `infrastructure/lora-trials/`

```text
lora-trials/
  COMPARISON.md
  ARTIFACT_LAYOUT.md          # bu dosya
  candidates/
    <trial_id>/
      README.md               # isteğe bağlı: amaç (1 paragraf)
      config/                 # hiperparam / küçük yaml-json — repo içi
      train/                  # eğitim çalışma alanı — büyük dosyalar repo dışı
        checkpoints/          # .gitignore
        logs/                 # .gitignore (veya sadece özet .md repo içi)
      export/                 # tek canonical GGUF + kanıt metinleri
        <adapter_etiketi>.gguf
        <adapter_etiketi>.gguf.sha256
        EXPORT.md
      run/                    # opsiyonel: export kopyası + kısa smoke metni
        README.md
        llama-snippet.txt
  runs/
    <trial_id>/               # upload / verify sonrası ürün trial kaydı (API ile hizalı)
      TRIAL_RECORD.md         # TRIAL_RECORD.template.md şablonundan
      snippets/               # isteğe bağlı kısa log kesitleri
```

**`trial_id`** aynı string hem `candidates/<trial_id>/` hem `runs/<trial_id>/` için kullanılır.

---

## 2) Klasör rolleri (kesin)

| Yol | Rol |
|-----|-----|
| **`candidates/<trial_id>/config/`** | Yeniden üretilebilirlik için **küçük** config (hiperparam özeti). |
| **`candidates/<trial_id>/train/`** | Checkpoint, eğitim logu — **upload hattına girmez**. |
| **`candidates/<trial_id>/export/`** | **Yalnızca buradan** upload; GGUF + checksum + EXPORT.md. |
| **`candidates/<trial_id>/run/`** | İsteğe bağlı yerel BitNet smoke; **export’un kopyası** ile çalışır. |
| **`runs/<trial_id>/`** | Ürün tarafı: upload sonrası **TRIAL_RECORD**, verify çıktısı, snippets. |

---

## 2.5) Windows host: ASCII / kısa yol (eğitim ve araçlar)

**Sorun (kanıtlanmış):** Repo veya çıktı klasörü `OneDrive\Masaüstü\...` gibi **Unicode** segmentler içerdiğinde, bazı eğitim / dönüştürme araçları (ve bazı çalışma zamanı kabukları) **yolları yanlış keser veya sessizce başarısız olur.** İlk gerçek koşuda kırılma nedeni budur; **8.3 kısa yol** veya **ASCII-only kök** ile aşıldı.

**Kural (kalıcı):**

| Ne | Ne yapılır |
|----|------------|
| **Çalışma kökü** | Mümkünse repoyu **`C:\dev\R3MES`** veya benzeri **yalnız ASCII** path altına klonlayın; OneDrive + Türkçe `Desktop` adı riskli kabul edilir. |
| **Kısa sürücü (`SUBST`)** | Uzun Unicode yolunu koruyup araçlara **ASCII** göstermek için: örn. `subst R: C:\Users\...\R3MES` — tüm girdi/çıktı yollarını `R:\infrastructure\...` üzerinden verin ([trial `EXPORT.md` örneği](candidates/2026-04-14_tr-v1/export/EXPORT.md)). |
| **8.3 kısa ad** | `cmd` ile `dir /x` — klasör için kısa adı script veya ortam değişkeninde kullanın; Unicode segmentini komut satırına düz yazmayın. |

**Semantik düzen değişmez:** Üretilen dosyaların **mantıksal** yeri yine repo şemasındadır: `candidates/<trial_id>/export/<adapter_etiketi>.gguf`. Windows’ta mutlak yol ne olursa olsun **yazım yalnızca o trial’ın `export/` klasörüne**; `train/` veya `run/` upload kaynağı değildir (§2 tablo).

**Checksum kapısından ayrı:** Path disiplini **eğitimin çalışması** içindir; upload öncesi **SHA256 doğrulaması** (§6) ayrı ve zorunludur — ikisi birlikte uygulanır.

---

## 3) Repo içi / repo dışı

| Konum | Repo (git) | Not |
|-------|------------|-----|
| `config/*.yaml`, `*.json`, küçük `*.md` | **İçi** | Kanıt ve tekrarlanabilirlik |
| `train/checkpoints/`, `train/logs/*` (büyük) | **Dışı** | Uzak arşiv / object storage; `.gitignore` |
| `export/*.gguf` | **Dışı** | Aynı dosya artefakt deposunda tutulur; repoda yalnızca `.sha256` |
| `export/*.sha256`, `EXPORT.md` | **İçi** | Checksum disiplini |
| `run/*.gguf` | **Dışı** | `.gitignore` |
| `run/*.txt`, `run/README.md` | **İçi** | Küçük kanıt |
| `runs/<trial_id>/TRIAL_RECORD.md`, `snippets/*` | **İçi** | Ürün trial kaydı |
| `COMPARISON.md` | **İçi** | Karşılaştırma tablosu |

---

## 4) Zorunlu vs isteğe bağlı

| Dosya / öğe | Zorunlu (anlamlı trial için) |
|-------------|-------------------------------|
| `candidates/<trial_id>/` klasörü | Evet |
| `export/<adapter_etiketi>.gguf` | Evet (upload öncesi diskte; repo dışı) |
| `export/<adapter_etiketi>.gguf.sha256` veya eşdeğer | Evet |
| `export/EXPORT.md` (komut/sürüm notu) | Şiddetle önerilir |
| `config/` | Önerilir (yeniden üretim) |
| `train/` alt yapı | Eğitim yapılacaksa evet (içerik repo dışı) |
| `run/` | Hayır (opsiyonel smoke) |
| `runs/<trial_id>/TRIAL_RECORD.md` | Upload sonrası evet |
| `COMPARISON.md` satırı | Terminal deneme sonrası evet |

---

## 5) Arşivlik (uzun süreli saklama)

**Repo dışı / uzak arşiv önerilir:**

- `train/checkpoints/*` (tam checkpoint)
- `export/*.gguf` (bir kopya artefakt deposunda; checksum ile eşlenmiş)
- Ham eğitim logları (GB düzeyinde)

**Repo içi “hafif arşiv”:**

- `export/*.sha256`, `EXPORT.md`, `config/*`, `runs/.../TRIAL_RECORD.md`, `COMPARISON.md` satırı — **yeniden deneme ve denetim** için yeterli iz.

---

## 6) Upload öncesi kontrol noktası (checklist)

Upload **yalnızca** `export/<adapter_etiketi>.gguf` ile yapılır. Aşağıdakiler **evet** olmadan upload başlatılmaz:

1. [ ] Dosya yolu **`candidates/<trial_id>/export/`** altında (train/run değil).
2. [ ] **SHA256** üretildi ve `export` içindeki `.gguf` ile **byte düzeyinde** eşleşiyor (komut: `Get-FileHash` / `sha256sum` karşılaştırması).
3. [ ] *(Windows host)* Eğitim ve export üretimi **Unicode path yüzünden kırılmadan** tamamlandı (§2.5: ASCII kök, `SUBST`, veya 8.3 kısa yol — aksi halde aynı risk tekrarlanır).
4. [ ] **`adapter_etiketi`** dosya adı ile `COMPARISON.md` ve `trial_id` ile tutarlı.
5. [ ] **Base / runtime** hâlâ [BITNET_QVAC_PRODUCTION_MATRIX](BITNET_QVAC_PRODUCTION_MATRIX.md) ile uyumlu (sapma = yeni pin / yeni trial serisi).
6. [ ] *(Opsiyonel)* `run/` altında smoke yapıldıysa, kullanılan dosya **export ile aynı checksum** (kopya drift yok).

---

## 7) Export → trial hattı girişi (tek cümle)

**Export klasörü kilitlendikten sonra** (checksum yazıldı) → aynı GGUF → `POST /v1/adapters` → QA → **`runs/<trial_id>/`** altında kayıt + **`COMPARISON.md`** güncelleme.

Detay: [LORA_CANDIDATE_TRIALS.md](../LORA_CANDIDATE_TRIALS.md) §0 ve “kapı sırası”.
