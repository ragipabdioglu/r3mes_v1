# İlk gerçek BitNet adapter — ürün kanıt hattı (upload → QA → verify)

**Amaç:** Export dosyası yüklendikten sonra **aynı gün** toplanacak alanlar ve **verify** komutu. Yeni kod yok; [ACTIVE_CANDIDATE_MINIMUM_PROOF.md](../../apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md) ile uyumlu.

**Export öncesi (yerel):** GGUF ve checksum dosyaları yalnızca trial **`export/`** klasöründe; Windows’ta üretim yolu için [ARTIFACT_LAYOUT.md](ARTIFACT_LAYOUT.md) §2.5 (Unicode riski) ve §6 (SHA256 kapısı).

**Upload / QA sırasında ortam:** BitNet port, worker `R3MES_QA_LLAMA_BASE_URL`, `R3MES_BACKEND_QA_WEBHOOK_URL`, log arşivi — [FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md](FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md).

---

## 1. Upload sonrası alınacak alanlar (zorunlu)

`POST /v1/adapters` yanıtından veya API’den:

| Alan | Nereden |
|------|---------|
| **adapterId** | Upload JSON `adapterId` / `adapterDbId` |
| **weightsCid** | Upload JSON `weightsCid` |
| **benchmarkJobId** | Upload JSON `benchmarkJobId` (= webhook `jobId`) |

QA worker tamamlanınca (`GET /v1/adapters/:id`):

| Alan | Nereden |
|------|---------|
| **benchmarkScore** | API `benchmarkScore` |
| **status** | API `status` — terminal: `ACTIVE` veya `REJECTED` |

Terminal olduktan sonra (`apps/backend-api` dizininde):

| Alan | Nereden |
|------|---------|
| **OFFICIAL_VERIFY_LINE** | `pnpm verify:lifecycle-chain` çıktısının **son satırı** |

**Ortam:** `DATABASE_URL` ve `R3MES_VERIFY_BASE_URL` (veya `R3MES_E2E_BASE_URL`) **çalışan API** ile aynı taban URL olmalı.

---

## 2. Verify akışı (kısa)

1. Worker’ın callback attığını ve adapter’ın `ACTIVE` veya `REJECTED` olduğunu doğrula (`GET /v1/adapters/<adapterId>`).

2. Repo kökünden veya `apps/backend-api` içinden:

```bash
cd apps/backend-api
set DATABASE_URL=postgresql://...
set R3MES_VERIFY_BASE_URL=http://127.0.0.1:3000
pnpm verify:lifecycle-chain -- --adapter-id <adapterId> --job-id <benchmarkJobId>
```

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://..."
$env:R3MES_VERIFY_BASE_URL="http://127.0.0.1:3000"
pnpm verify:lifecycle-chain -- --adapter-id <adapterId> --job-id <benchmarkJobId>
```

3. Çıktıda **`verify=PASS`** ve **`OFFICIAL_VERIFY_LINE:`** satırını kopyala → `runs/<trial_id>/TRIAL_RECORD.md` ve [TRIAL_RECORD.template.md](TRIAL_RECORD.template.md).

---

## 3. ACTIVE adayı ne zaman deriz?

**Ürün ACTIVE adayı** yalnızca şu anda:

- Altı alan eksiksiz,
- `status === ACTIVE`,
- `OFFICIAL_VERIFY_LINE` içinde **`verify=PASS`**,
- Kaynak **export** klasöründeki eğitim GGUF (smoke / minimal GGUF değil),
- Worker aynı **benchmarkJobId** ile BitNet **llama** profilinde koşmuş.

Ayrıntı: [ACTIVE_CANDIDATE_MINIMUM_PROOF.md](../../apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md) §5–§6.

---

## 4. Trial başarısızsa nasıl sınıflarız?

| Durum | Sınıf | Not |
|-------|--------|-----|
| `status === REJECTED` | **Başarısız ürün trial** (skor/eşik) | Zincir kapalı olabilir; `verify=PASS` yine üretilebilir. |
| `verify` FAIL veya receipt yok | **Hattı kırık** — kanıt yok | Önce env, HMAC, worker URL düzelt. |
| `PENDING_REVIEW` uzun süre | **Takılı** | Callback/webhook veya kuyruk. |
| Smoke / manuel QA ile `ACTIVE` | **Test** — ürün adayı değil | COMPARISON’da etiketle. |

---

## 5. İlgili belgeler

- [LORA_CANDIDATE_TRIALS.md](../LORA_CANDIDATE_TRIALS.md) §7  
- [TRIAL_RECORD.template.md](TRIAL_RECORD.template.md)  
- [E2E_LIFECYCLE_DEMO.md](../../apps/backend-api/docs/E2E_LIFECYCLE_DEMO.md)
