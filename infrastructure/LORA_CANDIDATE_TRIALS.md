# LoRA aday test hattı — BitNet üretim adapter (tekrarlanabilir karşılaştırma)

> **Legacy / R&D notu:** Bu test hattı eski BitNet knowledge-LoRA denemeleri içindir. Aktif MVP’de LoRA yalnız behavior/style katmanıdır ve knowledge taşıma yolu değildir.

**Amaç:** Eğitim cluster kurmak değil; **BitNet üzerinde ilk/sonraki üretim adapter** denemeleri için **artefakt disiplini**. **Aynı base + aynı runtime matrisi** ile kıyas; Qwen değil **BitNet** tabanı ([BITNET_QVAC_PRODUCTION_MATRIX](BITNET_QVAC_PRODUCTION_MATRIX.md)).

**Önkoşul (sabit runtime):** [BITNET_QVAC_PRODUCTION_MATRIX.md](BITNET_QVAC_PRODUCTION_MATRIX.md) — base GGUF, `llama-server` **b7349**, TQ2 uyumlu LoRA. Ürün yaşam döngüsü: [E2E_LIFECYCLE_DEMO.md](../apps/backend-api/docs/E2E_LIFECYCLE_DEMO.md).

**Kanonik ürün kanıtı (ACTIVE aday):** [ACTIVE_CANDIDATE_MINIMUM_PROOF.md](../apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md) — repo kökünden `apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md`. Eğitim reçetesi: [fazlar/v6/faz_7.md](../fazlar/v6/faz_7.md).

**Türkçe kalite hedefi + chat smoke kapısı:** [docs/operations/TURKISH_LORA_QUALITY_PLAN.md](../docs/operations/TURKISH_LORA_QUALITY_PLAN.md).

**İlk gerçek BitNet upload anı:** [lora-trials/FIRST_BITNET_UPLOAD_CHECKLIST.md](lora-trials/FIRST_BITNET_UPLOAD_CHECKLIST.md) — upload sonrası alanlar, verify komutu, başarısızlık sınıfları.

**İlk ürün trial — runtime / worker / backend stabilitesi (`tr-v1` vb.):** [lora-trials/FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md](lora-trials/FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md) — port, webhook, slot, log arşivi.

**Windows — eğitim/export çalışma dizini:** Türkçe `Masaüstü` veya OneDrive altı gibi **Unicode** yol segmentleri bazı araçlarda kırılmaya yol açtı (dry-run kanıtı). **Kalıcı kural:** ASCII kök, `SUBST` ile sanal sürücü veya **8.3 kısa yol** — ayrıntı ve upload checklist bağlantısı [lora-trials/ARTIFACT_LAYOUT.md §2.5 ve §6](lora-trials/ARTIFACT_LAYOUT.md).

---

## BitNet üretim trial akışı — kapı sırası

1. **`trial_id`** — `YYYY-MM-DD_etiket` = `candidates/<trial_id>/` klasör adı = [COMPARISON.md](lora-trials/COMPARISON.md) ilk sütun.  
2. **`train/`** — Eğitim biter; checkpoint/loss **upload hattına girmez**.  
3. **`export/`** — Tek LoRA GGUF + **checksum**; **canonical** kaynak.  
4. **Checksum disiplini** — `sha256` ile `export/*.gguf` eşleşmesi yazılı; dosya değişmeden upload yok.  
5. **`run/` (opsiyonel)** — İstenirse `export` dosyasının **kopyası** ile yerel BitNet `llama-server` smoke; **train** klasörüne bağlanılmaz.  
6. **Upload kapısı** — Yalnızca **`export/<adapter_etiketi>.gguf`** → `POST /v1/adapters` → `adapterId`, `weightsCid`, `benchmarkJobId`.  
7. **Test hattı (ürün)** — Upload sonrası QA/benchmark worker + BitNet runtime; backend log’da webhook akışı ([E2E_LIFECYCLE_DEMO.md](../apps/backend-api/docs/E2E_LIFECYCLE_DEMO.md)).  
8. **`verify:lifecycle-chain`** + **`runs/.../TRIAL_RECORD.md`** + **[COMPARISON.md](lora-trials/COMPARISON.md)** satırı.

**Özet:** Upload ve IPFS **yalnızca `export/`** üzerinden; **`run/`** isteğe bağlı doğrulama alanıdır, **ikinci bir kaynak değildir**.

---

## 0) İç üretim → export → (opsiyonel run) → upload → verify (tek hat)

**Eğitim artefaktı ≠ runtime artefaktı:**

| Katman | Ne | Nereye | Kim kullanır |
|--------|-----|--------|----------------|
| **Train** | checkpoint, eğitim logu, loss | `candidates/<trial_id>/train/` | Sadece eğitim / yeniden üretim — **upload yok** |
| **Export** | tek **LoRA GGUF** + checksum | `candidates/<trial_id>/export/` | **Upload ve ürün testinin tek kanonik girdisi** |
| **Run** | (opsiyonel) export’un kopyası + kısa runtime log | `candidates/<trial_id>/run/` | Yerel BitNet smoke; **upload kaynağı değil** |
| **Runtime pin** | base GGUF + qvac ikili | [BITNET_QVAC_PRODUCTION_MATRIX](BITNET_QVAC_PRODUCTION_MATRIX.md) | `llama-server`; **train** klasörüne **bağlanmaz** |
| **Ürün** | IPFS + API | `weightsCid`, `adapterId`, … | Worker / backend |

**Standart sıra:**

1. `trial_id` + `adapter_etiketi` ata — [candidates/README.md](lora-trials/candidates/README.md).  
2. Eğitimi `train/` altında bitir (büyük dosyalar repoya girmez).  
3. **GGUF export** → yalnızca `export/<adapter_etiketi>.gguf`; checksum yaz.  
4. *(Opsiyonel)* `export` kopyasını `run/` altında BitNet profilinde smoke; **kaynak upload için yine `export/`**.  
5. **Checksum doğrulandıktan sonra** aynı `export` dosyasını upload et → `adapterId`, `weightsCid`, `benchmarkJobId`.  
6. QA tamamlanır → `status`, `benchmarkScore`.  
7. `verify:lifecycle-chain` → `OFFICIAL_VERIFY_LINE`.  
8. `runs/<trial_id>/TRIAL_RECORD.md` + [COMPARISON.md](lora-trials/COMPARISON.md) **bir satır**.

**Karışmayı öneme:** Train checkpoint’i doğrudan slot’a kopyalama; **yalnızca export GGUF** upload ve ürün testinin girdisi.

---

## 1) Aday test akışı (standart sıra)

1. **Profil kontrolü** — Aynı `llama-server` build, aynı base `-m`, aynı slot mekanizması (`--lora` + `R3MES_QA_LORA_COPY_TARGET`). Farklı base veya ikili = **yeni trial serisi** (ayrı tablo satırı veya dosya).
2. **Yerel artefakt** — Aday LoRA GGUF’u ASCII dizinde; dosya adı anlamlı (`candidate-<kısa-etiket>.gguf`). İsteğe bağlı: yerel SHA256 (checksum karışıklığa karşı).
3. **Upload** — `POST /v1/adapters` ile yükleme; yanıttan **`adapterId`**, **`weightsCid`**, **`benchmarkJobId`** kaydedilir.
4. **QA / benchmark** — Worker + `llama` hattı işi bitirene kadar bekle; backend loglarında `qa_webhook_applied` vb. ([E2E_LIFECYCLE_DEMO.md](../apps/backend-api/docs/E2E_LIFECYCLE_DEMO.md)).
5. **Terminal durum** — `GET /v1/adapters/:id` ile **`status`**, **`benchmarkScore`**, **`updatedAt`** sabitlenir.
6. **Zincir doğrulama** — `apps/backend-api` içinde `pnpm verify:lifecycle-chain -- --adapter-id … --job-id …`; çıktının son satırı **`OFFICIAL_VERIFY_LINE`** olarak trial dosyasına yapıştırılır.
7. **Kayıt dosyası** — Aşağıdaki şablon doldurulur; karşılaştırma tablosuna **tek satır** eklenir.

**Karışmayı önleme:** Her aday için **ayrı** `trial id` (`YYYY-MM-DD_kısa-etiket`); aynı slot dosyası üzerine üst üste yazmadan önce önceki adayın kaydı kapanmış olmalı.

---

## 2) Her denemede toplanacak veri (minimum)

| Alan | Nereden | Neden |
|------|---------|--------|
| **base model** | Pin: `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` | Karşılaştırma sadece aynı tabanda anlamlı |
| **adapter dosyası** | Yerel yol + isteğe bağlı SHA256 | Hangi dosyanın yüklendiği |
| **weightsCid** | API / DB | IPFS üzerinden tekil kimlik |
| **benchmarkJobId** | Upload / kuyruk | Webhook `jobId` ile hizalı |
| **benchmarkScore** | `GET /v1/adapters/:id` | Sayısal kıyas |
| **final status** | Aynı endpoint | Sadece **ACTIVE** adaylar ürün karşılaştırmasına girer |
| **adapterId** | Upload yanıtı | `verify` ve chat çözümü |
| **OFFICIAL_VERIFY_LINE** | `verify:lifecycle-chain` çıktısı | Tek satırda kanıt özeti |

İsteğe bağlı: eğitim hiperparametresi, veri kümesi versiyonu, llama/worker log dosya yolları — `TRIAL_RECORD.template.md` not bölümünde.

---

## 3) Klasör ve kayıt düzeni (sabit)

### 3.1 Aday üretim (içeride)

- **Şema:** [lora-trials/ARTIFACT_LAYOUT.md](lora-trials/ARTIFACT_LAYOUT.md) — `candidates/<trial_id>/{config,train,export,run}` + `runs/<trial_id>/`.
- **trial_id:** `YYYY-MM-DD_kısa-etiket` — klasör adı = `COMPARISON.md` ilk sütun.
- **adapter_etiketi:** `export/*.gguf` dosya adı kökü; karşılaştırma tablosunda tekrarlanır.
- **checksum:** `export/<etiket>.gguf.sha256` (veya eşdeğer tek dosya).

### 3.2 Ürün trial kaydı (repo)

Repoda **küçük metin** tutulur; **GGUF ve checkpoint** commit edilmez (bkz. kök `.gitignore`).

```
infrastructure/lora-trials/
  COMPARISON.md              # tek karşılaştırma tablosu
  candidates/<trial_id>/     # iç üretim + export (şema yukarıda)
  runs/<trial_id>/
      TRIAL_RECORD.md        # şablondan; upload/verify sonrası
      snippets/              # isteğe bağlı kısa log kesitleri
```

- **Ham llama/worker logları:** `logs/...` veya `R3MES_QA_WORKER_LOG_FILE` — dosya adında `trial_id` geçsin.

---

## 4) Karşılaştırma tablosu (tek kaynak)

**Tek kaynak:** `infrastructure/lora-trials/COMPARISON.md` — her export → upload → terminal deneme sonrası **bir satır** eklenir.

**Sütunlar (öneri):**

| trial_id | tarih | adapter_etiketi | weightsCid (kısaltılmış) | benchmarkJobId | score | status | adapterId (kısa) | not |
|----------|-------|-----------------|--------------------------|----------------|-------|--------|------------------|-----|

**Güncel tablo sütunları:** [COMPARISON.md](lora-trials/COMPARISON.md) içindeki `dataset` ve `chat_smoke` sütunları da doldurulur. Amaç benchmark ve gerçek sohbet kalitesini aynı aday kaydında tutmaktır.

- **ACTIVE** adayları filtrelemek için `status=ACTIVE` satırları üstte tutulabilir veya aynı dosyada ikinci bir “Sadece ACTIVE” tablosu (manuel kopya) kullanılır.
- Excel tercih eden ekipler için aynı sütunlarla **`COMPARISON.csv`** tutulabilir; kaynak gerçeği yine markdown ile hizalanır.

**Kural:** Yeni aday = yeni satır; eski satırlar **silinmez** (tarihçe).

---

## 5) Arşiv — hangi dosyalar tutulmalı

| Ne | Nerede | Zorunlu |
|----|--------|---------|
| Export GGUF | artefakt deposu / güvenilir disk; checksum ile | ürün için evet |
| `*.sha256` veya `CHECKSUMS.txt` | `export/` + isteğe bağlı repo metni | evet |
| `EXPORT.md` (export komutu/sürümü) | `candidates/<trial_id>/export/` | önerilir |
| `run/` küçük metin | smoke komutu / stderr kesiti | isteğe bağlı |
| Eğitim config (küçük) | `candidates/<trial_id>/config/` | yeniden üretim için önerilir |
| Checkpoint / büyük train log | uzak arşiv; **repo dışı** | isteğe bağlı |
| `TRIAL_RECORD.md` | `runs/<trial_id>/` | evet |
| `OFFICIAL_VERIFY_LINE` | trial kaydı içinde | evet |
| `COMPARISON.md` satırı | repo | evet |

## 6) Trial kayıt standardı (özet)

- **Kimlik:** `trial_id` + `adapter_etiketi` + export dosya SHA256.  
- **API:** `adapterId`, `weightsCid`, `benchmarkJobId`, `benchmarkScore`, `status`.  
- **Kanıt:** `verify:lifecycle-chain` çıktısı (son satır).  
- **Tablo:** [COMPARISON.md](lora-trials/COMPARISON.md) — tarihçe silinmez.

**İlgili:** [BITNET_PINNED_ENV_MATRIX.md](BITNET_PINNED_ENV_MATRIX.md), [QWEN_ADAPTER_RUN.md](QWEN_ADAPTER_RUN.md) (yalnızca Qwen fallback; BitNet adaylarıyla karıştırma).

---

## 7) Runbook sonu — ilk iç üretim BitNet adapter: ürün kanıt kapısı

Eğitim (`faz_7` reçetesi) ve export tamamlandıktan sonra **upload → worker → verify** zinciri kapanmadan **ürün adayı** ilan edilmez. Aşağıdaki alanlar **birlikte** toplanır ve `runs/<trial_id>/TRIAL_RECORD.md` + [COMPARISON.md](lora-trials/COMPARISON.md) satırına işlenir.

| # | Alan | Nereden |
|---|------|---------|
| 1 | **adapterId** | `POST /v1/adapters` yanıtı veya `GET /v1/adapters/:id` |
| 2 | **weightsCid** | Upload yanıtı / adapter detay (export GGUF’ın IPFS CID’i) |
| 3 | **benchmarkJobId** | Upload yanıtı (`QaWebhookReceipt.jobId` ile aynı) |
| 4 | **benchmarkScore** | `GET /v1/adapters/:id` (worker aggregate skoru) |
| 5 | **status** | Aynı endpoint; **ACTIVE aday** için `ACTIVE` |
| 6 | **OFFICIAL_VERIFY_LINE** | `pnpm verify:lifecycle-chain` çıktısının son satırı (`verify=PASS`) |

**Tek doğruluk kaynağı:** [ACTIVE_CANDIDATE_MINIMUM_PROOF.md](../apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md) (§1 genel, §5 BitNet). Smoke ile gerçek aday ayrımı aynı belgede.

**İlk eğitim sonrası karar:** Altı alan eksiksiz + `verify=PASS` + worker’ın BitNet **8080** profilinde aynı `jobId` ile işlediği log kanıtı → **gerçek ürün ACTIVE adayı**; aksi → trial kaydında **başarısız** veya **test** etiketi (COMPARISON `not` sütunu).
