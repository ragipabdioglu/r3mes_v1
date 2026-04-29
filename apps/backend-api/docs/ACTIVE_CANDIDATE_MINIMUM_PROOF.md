# İç üretim — ACTIVE aday için minimum kanıt (veri tarafı)

**Kanonik yol (repo):** `apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md`

**Runbook bağlantıları:** Eğitim reçetesi → [`fazlar/v6/faz_7.md`](../../../fazlar/v6/faz_7.md). Trial sırası, export/upload ve runbook sonu toplama listesi → [`infrastructure/LORA_CANDIDATE_TRIALS.md`](../../../infrastructure/LORA_CANDIDATE_TRIALS.md) **§7**.

**Amaç:** Eğitim denemesi / smoke ile **gerçek ürün adayı** (worker kararı + backend kaydı) birbirine karışmasın. Bu dosya **resmi minimum** kabul listesidir.

## 1. Zorunlu alanlar (tek kaynak)

Aşağıdakiler **aynı ortam** (upload + callback + DB) için birlikte doğrulanmalıdır; eksik biri → **ACTIVE aday sayılmaz**.

| Alan | Kaynak | Not |
|------|--------|-----|
| **adapterId** | Upload yanıtı veya `GET /v1/adapters/:id` | Prisma `Adapter.id`. |
| **weightsCid** | Upload yanıtı veya adapter detay | IPFS artefakt; eğitim çıktısı kimliği. |
| **benchmarkJobId** | Upload yanıtı | `enqueueBenchmarkJob` ile üretilen job kimliği; receipt ile eşleşmeli. |
| **benchmarkScore** | `GET /v1/adapters/:id` veya DB | Worker’ın hesapladığı skor (backend yalnızca yazar). |
| **status** | API/DB | **`ACTIVE`** olmalı (aday tanımı için). |
| **OFFICIAL_VERIFY_LINE** | `pnpm verify:lifecycle-chain` çıktısı | Aynı `adapterId` + `jobId` + `verify=PASS` (veya politikada tanımlı eşdeğer). |

**Ek (örtük zorunlu):** `QaWebhookReceipt` satırı aynı `jobId` için **`completedAt` dolu** — callback’in gerçekten işlendiğini gösterir (`verify` script bunu doğrular).

## 2. ACTIVE aday tanımı (veri)

**ACTIVE aday:** Yukarıdaki alanların tamamı mevcut ve `status === ACTIVE`, `verify:lifecycle-chain` **PASS**, receipt tamam; skor **worker** tarafından üretilmiş (backend eşik uygulamaz).

**ACTIVE değil (örnekler):**

- `PENDING_REVIEW` veya callback yok.
- `REJECTED` (ürün reddi; zincir kapanmış olsa da “aday” değil).
- `status=ACTIVE` ama **yalnızca** `e2e-lifecycle-smoke` / manuel HMAC ile sabit skor — **smoke** (§3).

## 3. Smoke vs gerçek ürün adayı

| Ayırt | Smoke / demo | Gerçek ürün adayı |
|-------|----------------|-------------------|
| **Upload** | Minimal GGUF veya test dosyası; isim `e2e-smoke` vb. | Eğitim çıktısı LoRA; takımın adlandırması / artefakt kaydı. |
| **Worker** | Bazen atlanır veya script doğrudan QA endpoint’ine gider | **QA worker** job işler; `score_threshold` (varsayılan 75) ile `approved`/`rejected` üretir. |
| **Skor** | Sıkça sabit (ör. 88.5 script içi) | Worker **aggregate_quality** çıktısı; eğitimle ilişkili. |
| **Kanıt** | `OFFICIAL_VERIFY_LINE` üretilebilir ama **ürün başarısı** iddiası yapılmaz | Minimum alanlar + worker log / benchmark job ile ilişkilendirilebilir. |

**Operasyon kuralı:** Ürün backlog’una “ACTIVE aday” olarak yalnızca **worker + gerçek upload CID** ile gelen kayıtlar alınır; smoke kayıtları **test** etiketiyle ayrı listelenir.

## 4. Trial sonrası tek kontrol listesi

1. `adapterId`, `weightsCid`, `benchmarkJobId` — upload yanıtı veya API.  
2. `pnpm verify:lifecycle-chain -- --adapter-id … --job-id …` → **PASS** + **OFFICIAL_VERIFY_LINE** arşivle.  
3. `status` + `benchmarkScore` — API/DB.  
4. Worker env: `R3MES_SCORE_THRESHOLD` ve ilgili job logunda **aynı jobId**.  
5. İsim / süreç: smoke script değilse → **gerçek aday** değerlendirmesi.

**Backend notu:** Eşik **worker**’dadır (`R3MES_SCORE_THRESHOLD`, varsayılan 75); backend `status` için yalnızca webhook `approved`/`rejected` okur — bkz. `internalQa.ts`.

---

## 5. BitNet üretim adapter’ı — minimum ürün kanıtı

**BitNet** ile üretilen (eğitim çıktısı) bir LoRA’nın **gerçek ACTIVE aday** sayılması için §1’deki **altı alan aynen zorunludur**; ek olarak aşağıdaki **ürün anlamı** koşulları sağlanmalıdır.

### 5.1 Zorunlu alanlar (BitNet için değişmez)

| Alan | BitNet notu |
|------|-------------|
| **adapterId** | Upload sonrası sabitlenir. |
| **weightsCid** | **BitNet eğitim hattından** gelen GGUF’ın IPFS CID’i (smoke minimal GGUF değil). |
| **benchmarkJobId** | Aynı CID ile üretilen kuyruk job kimliği. |
| **benchmarkScore** | Worker’ın BitNet **llama** üzerinde koştuğu benchmark çıktısı. |
| **status** | **`ACTIVE`** (aday tanımı). |
| **OFFICIAL_VERIFY_LINE** | `verify=PASS`, aynı `adapterId` / `jobId`. |

### 5.2 ACTIVE aday değil sayılır (BitNet özel)

- **L1 mock:** Callback **3003** mock sunucuya giden akış; Prisma ile tutarlı `verify` yok — ürün adayı değil ([`BITNET_L2_STACK.md`](../../../infrastructure/BITNET_L2_STACK.md)).
- **Smoke:** `e2e-lifecycle-smoke` veya sabit skorlu manuel QA — **test**.
- **Worker BitNet’e bağlı değil:** `R3MES_QA_LLAMA_BASE_URL` BitNet pin’li **8080** profiline işaret etmiyorsa, skor **BitNet ürün başarısı** sayılmaz (operasyonel tanım: [`BITNET_PINNED_ENV_MATRIX.md`](../../../infrastructure/BITNET_PINNED_ENV_MATRIX.md)).

### 5.3 Trial sonrası — tek karar akışı (BitNet)

1. **Altı alan** §1 / §5.1 tam mı? Değilse → **aday değil**.  
2. **`pnpm verify:lifecycle-chain` → PASS** ve `OFFICIAL_VERIFY_LINE` arşivde mi? Değilse → **aday değil** (zincir şüpheli).  
3. **`status === ACTIVE` mi?** Değilse (ör. REJECTED) → **ürün adayı değil** (başarısız trial).  
4. **Worker log / env:** Aynı **`benchmarkJobId`**, BitNet **llama** üzerinde job işlendi mi? Hayır → smoke veya yanlış profil.  
5. **weightsCid** eğitim çıktısı mı (takım artefakt kaydı)? Hayır → test.

**Tek cümle:** İlk BitNet üretim adapter’ı geldiğinde **“gerçek aday”** = altı alan + **BitNet worker koşusu** + **verify PASS**; aksi **hemen** test veya başarısız trial olarak sınıflanır.

---

## 6. İlk eğitim trial’ı — tek kontrol listesi (kısa)

Çıktı geldikten sonra yalnızca şunları doldur / doğrula:

| # | Alan | Tamam? |
|---|------|--------|
| 1 | **adapterId** | |
| 2 | **weightsCid** | |
| 3 | **benchmarkJobId** | |
| 4 | **benchmarkScore** | |
| 5 | **status** | |
| 6 | **OFFICIAL_VERIFY_LINE** (`verify=PASS` içerir) | |

**ACTIVE adayı ne zaman deriz?** Hepsi dolu **ve** `status=ACTIVE` **ve** satırda `verify=PASS` **ve** export’tan gelen gerçek eğitim GGUF (smoke değil) **ve** worker aynı `jobId` ile BitNet llama’da koştu — o zaman **ürün ACTIVE adayı**. `REJECTED` veya eksik alan → **başarısız trial** veya **henüz aday değil**.

**Kayıt:** Aynı değerler `infrastructure/lora-trials/runs/<trial_id>/TRIAL_RECORD.md` şablonuna işlenir ([`TRIAL_RECORD.template.md`](../../../infrastructure/lora-trials/TRIAL_RECORD.template.md)).

**İlk gerçek upload — anlık operasyon:** [`FIRST_BITNET_UPLOAD_CHECKLIST.md`](../../../infrastructure/lora-trials/FIRST_BITNET_UPLOAD_CHECKLIST.md) (upload → QA → verify komutları ve başarısızlık sınıfları).
