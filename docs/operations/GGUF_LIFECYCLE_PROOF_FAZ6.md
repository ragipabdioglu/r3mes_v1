# Faz 6 — İlk gerçek GGUF lifecycle kanıtı (tek kaynak)

> **Legacy / tarihî kanıt notu:** Bu belge eski adapter/benchmark/lifecycle hattının kanıt kaydıdır. Aktif MVP’de knowledge taşıma yolu RAG’dir; bu belge yeni ürün yolunu tanımlamaz.

**Sahiplik:** ORTAK (kanon ile hizalı operasyon kaydı). Slack/PR/issue’da dağılan sonuçlar **buraya özetlenmeden** “resmi kapalı” sayılmaz.

**Kanon referansı:** [INTEGRATION_CONTRACT.md §3.3.1](../api/INTEGRATION_CONTRACT.md) — LoRA **GGUF**; sunucuda dönüşüm yok.

---

## Başarı koşulu (tek cümle)

**Başarılı kanıt:** Aynı **LoRA GGUF** içeriğine ait IPFS CID’si ile **upload → benchmark kuyruğu → QA worker (`lora-adapters`) → iç webhook → adapter durumu/chat çözümü** zincirinden en az biri ölçülebilir şekilde tamamlanır ve loglarda veya API yanıtlarında **§3.3.1 ile uyumlu** davranış doğrulanır.

---

## Kanıt paketi (minimum)

Aşağıdakilerden mümkü olanlar doldurulur; eksik kalan madde **failure notunda** gerekçelendirilir.


| Adım              | Doğrulama                                    | Log / kanıt (ör. anahtar kelime veya çıktı)                      |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| 1. GGUF yükleme   | `POST /v1/adapters` ile gerçek LoRA GGUF pin | `e2eLifecycle: upload_accepted`, `weightsCid`                    |
| 2. Kuyruk         | Job üretimi                                  | `benchmarkJobId` / Redis listesi                                 |
| 3. QA worker      | IPFS indirme + `POST .../lora-adapters`      | Worker log: indirme baytı; hata yoksa `lora_register_failed` yok |
| 4. Webhook        | `POST /v1/internal/qa-result`                | Backend log: `qa_webhook_applied` veya eşdeğer                   |
| 5. Chat / çıkarım | `adapter_cid` veya DB çözümü ile AI engine   | `chat_proxy_resolved` veya ai-engine isteği 200                  |


**Yardımcı komutlar / belgeler:** [apps/backend-api/docs/E2E_LIFECYCLE_DEMO.md](../../apps/backend-api/docs/E2E_LIFECYCLE_DEMO.md), `apps/backend-api/scripts/e2e-lifecycle-smoke.mjs`, [apps/ai-engine/docs/LIVE_SMOKE.md](../../apps/ai-engine/docs/LIVE_SMOKE.md) (`--prove-inference`).

**Canlı callback + DB kanıtı (tek komut):** `apps/backend-api` içinde `pnpm verify:lifecycle-chain -- --adapter-id <upload.adapterId> --job-id <benchmarkJobId>` — ortam: `R3MES_VERIFY_BASE_URL`, `DATABASE_URL`. Çıktının sonunda **«Resmi özet (tek canlı koşu)»** bloğunu (callback, receipt, `completedAt`, `status`, score, `verify` PASS/Kısmi, zincir kapandı mı) SUCCESS kaydına yapıştırın; hemen altında tek satır **`OFFICIAL_VERIFY_LINE:`** (tartışmasız özet) vardır. Üstteki **«Canlı doğrulama raporu»** ayrıntılıdır. **FAIL** sınıfı: betik nonzero çıkış + stderr (ör. terminal status yok, receipt yok, `completedAt` null). Log korelasyonu: backend’de `e2eLifecycle: qa_webhook_applied` ve aynı `jobId`.

**Qwen (veya başka taban) ürün hattı:** Backend doğrulama komutu ve tablolar **aynıdır**; fark worker/AI engine tarafındaki model ve benchmark konfigürasyonundadır. Marketplace/chat hazırlığı yine `Adapter.status === ACTIVE` (liste + `adapter_db_id` çözümü) ile tanımlıdır.

**BitNet / QVAC lifecycle:** Aynı `verify:lifecycle-chain` ve aynı webhook/receipt akışı. Callback sonrası **`REJECTED`** ürün hedefi açısından red olsa da **backend zinciri için terminal durumdur** (`verify=PASS` mümkün); `completedAt` dolu ve `benchmarkScore` yazılmış olmalı. “Resmi geçiş adayı” yükseltmesi bu dosyadaki **SUCCESS** tanımı + ORTAK karar ile ayrıdır — yalnızca teknik kanıt eksikliği `FAILED` bayrağını tek başına düzeltmez.

**L2 — backend resmi kanıt (tartışmayı kapatan halka):** Üretim veya hedef ortamda **gerçek upload** sonrası sabitlenmiş **`adapterId`**, **`benchmarkJobId`**, **`weightsCid`** (çapraz kontrol için) + aynı ortamın **`R3MES_VERIFY_BASE_URL`** ve **`DATABASE_URL`** ile `pnpm verify:lifecycle-chain` → çıktıda **`verify=PASS`** (veya eksik env’de **Kısmi**) ve arşivlenmiş **`OFFICIAL_VERIFY_LINE`**. L1 (smoke, worker log, teknik demo) **tek başına L2 değildir**.

**İlgili ortam raporu (entegrasyon):** [e2e_test_report.md](../../e2e_test_report.md) — build/unit testler; **Docker yok** nedeniyle tam konteyner lifecycle bu makinede koşturulamadı.

---

## Sonuç kaydı (resmi)

**Kanonik karar (tek cümle — BitNet/QVAC L2):** **Gerçek upload**, Fastify **`POST /v1/internal/qa-result`**, DB **QaWebhookReceipt** ve **`pnpm verify:lifecycle-chain` → `verify=PASS`** ile BitNet/QVAC **ürün zinciri L2** doğrulandı; terminal **ACTIVE** veya **REJECTED** her ikisi de zincir kapanışı için geçerlidir — kanıt **`OFFICIAL_VERIFY_LINE`** ve aşağıdaki alt kayıtta.

### Tek resmi bayrak (Faz 6 lifecycle kanıtı)

| Alan | Değer |
| ---- | ----- |
| **Resmi sonuç (ilk ORTAK ortam — Docker yok)** | **FAILED** — o makinede **ölçülmüş** tam stack lifecycle **koşturulamadı** (aşağıdaki failure notu). |
| **Resmi sonuç (BitNet/QVAC — L2 gerçek backend)** | **SUCCESS** — ayrı koşuda gerçek upload + webhook + DB + verify **PASS**; ayrıntı aşağıdaki **BitNet / QVAC — L2 resmi kanıt** bölümünde. |

### ORTAK ayrım: teknik lifecycle vs ürün kullanılabilirliği

**Soru:** “Tam olarak ne çözüldü, ne çözülmedi?” — cevap tek kaynaktan:

| Boyut | Sonuç | Kaynak / not |
| ----- | ----- | ------------ |
| **Teknik başarı — Faz 6 lifecycle** (üstteki 5 adım + `verify:lifecycle-chain`) | **Kısmi** — ilk ORTAK makinesinde **FAILED**; **BitNet/QVAC L2** ayrı ortamda **SUCCESS** (aşağı **BitNet / QVAC — L2 resmi kanıt**; kaynak [faz_12.md](../../fazlar/v5/faz_12.md)). |
| **Teknik başarı — entegrasyon kodu ve regresyon** (AI / backend / frontend hatları + paylaşılan tipler + derleme / birim test) | **Var (sınırlı kapsam)** | Birleşik özet: [e2e_test_report.md](../../e2e_test_report.md) — **backend** (CORS, `POST /v1/adapters`, webhook, BullMQ↔Redis), **frontend / dApp** (port 3001, `NEXT_PUBLIC_BACKEND_URL`, yükleme formu), **AI engine / QA worker** paketleri turbo `dev` ile; `pnpm run build` ✓, backend vitest ✓, QA pytest ✓. **Canlı çıkarım** prosedürü: [LIVE_SMOKE.md](../../apps/ai-engine/docs/LIVE_SMOKE.md) (bu turda koşturulmadı). **Bu başarı, Faz 6 lifecycle SUCCESS yerine geçmez.** |
| **Ürün başarısı — uçtan uca kullanılabilirlik** (yayımlanabilir “happy path”: yükle → ACTIVE → gerçek çıkarım / pazaryeri akışı **kanıtlanmış**) | **Kısmi** — **BitNet L2** backend zinciri (upload → QA → webhook → DB) **kanıtlandı** ([faz_12.md](../../fazlar/v5/faz_12.md)); tam pazaryeri / **chat çıkarım** happy path ayrı ölçüm ([LIVE_SMOKE.md](../../apps/ai-engine/docs/LIVE_SMOKE.md)). |
| **Contract / kanon güncellemesi** | **Gerekmez** | Ölçülen çelişki yok; gereksiz churn yok ([Kanona yansıma kuralı](#kanona-yansıma-kuralı)). |

**Özet cümle:** Entegrasyon katmanında **önemli teknik iş teslimi** var; **BitNet/QVAC L2** için **backend verify PASS** kanonik olarak işlendi — **genel ilk ORTAK ortam** kaydı ise **FAILED** ile ayrı tutulur.

---

| Alan                          | Değer                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Durum**                     | **Kısmi:** ilk ORTAK ortam **FAILED**; **BitNet/QVAC L2** alt kaydı **SUCCESS** (bu dosyada aşağıda).                                                                                                                                                                               |
| **Tarih / saat (UTC)**        | 2026-04-10 (ORTAK repo güncellemesi; canlı koşu tarihi aşağıdaki notla)                                                                                                                                           |
| **Ortam**                     | `e2e_test_report.md` üretim ortamı: **Docker yüklü değil** — Postgres/Redis/IPFS konteynerleri ve tam uçtan uca GGUF lifecycle **bu makinede çalıştırılamadı**.                                                   |
| **Donmuş çekirdek / llama**   | Tam canlı koşu ölçülmedi (ortam eksik).                                                                                                                                                                           |
| **LoRA GGUF kaynağı**         | — (IPFS pin + worker kanıtı üretilmedi)                                                                                                                                                                           |
| **Çalıştırılan doğrulamalar** | `pnpm run build` (turbo) ✓; `apps/backend-api` vitest ✓; `packages/qa-sandbox/worker` pytest ✓ — **bunlar kanon uyumluluğu için yeterli değil**; **lifecycle SUCCESS** için üstteki 5 adımın canlı akışı gerekir. |


### Failure notu (resmi kapanış — ilk kayıtlı tur)

- **Gözlemlenen durum:** Entegrasyon katmanı (tipler, CORS, multipart, webhook, BullMQ↔Redis köprüsü) doğrulandı; **GGUF lifecycle zincirinin tamamı** (özellikle IPFS + QA worker + gerçek `lora-adapters`) **bu ortamda koşturulmadı**.
- **Kök neden sınıfı:** `konfigürasyon` / **ortam** — Docker yok; tam stack erişilemedi. [e2e_test_report.md](../../e2e_test_report.md) “Engel” bölümü.
- **Kanona aykırılık var mı?** **Hayır.** Ölçülen davranış ile §3.3.1 / §3.4 / §3.5 **çelişki raporlanmadı**; sorun **operasyonel**. **Contract churn gerekmez.**

---

### Qwen adapter hattı — ilk gerçek canlı lifecycle (tek kaynak alt kayıt)

**Amaç:** MVP kanıtı için Qwen tabanlı ürün hattında (base GGUF + slotlu LoRA GGUF + aynı backend doğrulama komutları) **ölçülmüş** ilk uçtan uca lifecycle sonucunu burada sabitlemek.

| Alan | Değer |
|------|--------|
| **Durum** | **FAILED** |
| **Tarih / saat (UTC)** | 2026-04-09 (ORTAK; Qwen hattı için ayrı canlı koşu çıktısı üretilmedi) |
| **Operasyon kaydı** | Üstteki genel Faz 6 sonucu ile **aynı kök neden**: bu ORTAK çalışma makinesinde **Docker yok** → Postgres / Redis / IPFS stack’i kalkmadı → Qwen için de **upload → kuyruk → QA → webhook → chat** zinciri **ölçülmedi**. Tekrarlanabilir Qwen düzeni: [infrastructure/QWEN_ADAPTER_RUN.md](../../infrastructure/QWEN_ADAPTER_RUN.md). |
| **Contract / kanon farkı** | **Yok.** Ölçülen şey ortam eksikliği; §3.3.1 veya wire ile **yeni çelişki** raporlanmadı. |

**Ayrım özeti**

| Tür | Bu turda |
|-----|----------|
| **Operasyon kaydı** | Yeterli: engel ortam (Docker + tam stack yok); Qwen’e özel ek kanıt dosyası/repo log’u yok. |
| **Contract farkı** | Gerekmedi — kanon yüzeyine dokunulmadı. |

---

### BitNet / QVAC runtime profili — L2 resmi kanıt

**Kaynak çalışma notu:** [faz_12.md](../../fazlar/v5/faz_12.md) — gerçek **Fastify + Postgres**; mock webhook yok. Tekrar düzen: [infrastructure/BITNET_L2_STACK.md](../../infrastructure/BITNET_L2_STACK.md).

| Alan | Değer |
| ---- | ----- |
| **Durum (L2)** | **SUCCESS** — `verify:lifecycle-chain` **PASS**; gerçek **upload → kuyruk → worker → QVAC llama → HMAC webhook → DB**. |
| **Kanonik koşu (BitNet GGUF)** | **Terminal REJECTED** (kalite/eşik; teknik zincir tamam). `adapterId=cmnxhjxvy0005kl88aba1493w`, `benchmarkJobId=benchmark-0-QmbZjyP2PtMisYMovf3gnbbg`, `weightsCid=QmbZjyP2PtMisYMovf3gnbbgxyTQLPN59BtYsb3MS383Fz`. |
| **OFFICIAL_VERIFY_LINE (BitNet GGUF koşusu)** | `verify=PASS adapterId=cmnxhjxvy0005kl88aba1493w jobId=benchmark-0-QmbZjyP2PtMisYMovf3gnbbg status=REJECTED receipt=Evet completedAt=Evet score=Evet chain=Evet` |
| **Ek doğrulama (minimal e2e GGUF, aynı L2 stack)** | `ACTIVE` + ayrı `adapterId` / `jobId` — [faz_12.md](../../fazlar/v5/faz_12.md) tablo satırları 7–33. |
| **Ortam (örnek)** | `R3MES_VERIFY_BASE_URL=http://127.0.0.1:3000`, `DATABASE_URL` = yerel Postgres (`r3mes`). |
| **Runtime statü güncellemesi** | [infrastructure/RUNTIME_PROFILES.md](../../infrastructure/RUNTIME_PROFILES.md) §0 — **L2 kapalı**; **resmi geçiş adayı (ürün zinciri)** yükseltmesi. |

---

### SUCCESS için yeniden açılış

Docker + storage compose + migrate sonrası aynı tabloyu **SUCCESS** ile doldurmak için: `docs/LOCAL_DEV.md` golden path, ardından E2E demo veya `verify:lifecycle-chain` çıktısını buraya yapıştırın.

---

## Kanona yansıma kuralı

- **SUCCESS ve §3.3.1 uyumluysa:** Ek **contract** güncellemesi gerekmez; bu dosya tek başına Faz 6 kapanış kanıtıdır.
- **SUCCESS ama ölçülen yeni wire gerçeği varsa:** Önce burada kayıt → `INTEGRATION_CONTRACT` + dörtlü senkron (FAZ3 governance).
- **FAILED (ortam / operasyon):** Failure notu yeterli; kanon **dokunulmaz** (bu kayıt).

---

## Faz 7 — Çözüm sonrası ORTAK değerlendirmesi (lora register / webhook)

**Bağlam:** Artefact kanonu (§3.3.1) net; Faz 7 çoğunlukla **uygulama hatası / konfigürasyon** çözümüdür. Amaç: gereksiz **contract churn** üretmeden sonucu doğru yere yazmak.

### Ayrım


| Sonuç türü                      | Örnek                                                                                                                                      | Yazılacağı yer                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operasyonel düzeltme**        | Yanlış `R3MES_`*, sıra/race, retry, timeout, worker/llama kapalı, HMAC/secret mismatch, GGUF içeriği doğruydu ama path/port hatası         | **Bu dosya** (çözüm özeti + varsa SUCCESS/FAILED güncellemesi) veya ilgili runbook / backend README; **INTEGRATION_CONTRACT’a dokunulmaz**. |
| **Contract / kanon düzeltmesi** | Ölçülen **yeni** wire: HTTP kodu veya gövde şekli **§3 / OpenAPI / Zod** ile çelişiyor; `adapterCid` / webhook alanının **anlamı** değişti | `INTEGRATION_CONTRACT` §3 ilgili alt bölüm + **dörtlü senkron** (FAZ3 governance).                                                          |


**Varsayılan:** Düzeltme **kanonu doğruluyorsa** (zaten yazılı davranışın uygulanması) → yalnız operasyon notu. **Kanon yanlış veya eksik** olduğu ortaya çıktıysa → minimal contract güncellemesi.

### Kontrol listesi (PR öncesi)

1. Değişen şey **JSON alan adı / zorunluluk / HTTP anlamı** mı? → Evet ise contract. Hayır ise operasyon.
2. `pnpm contract:drift` yeşil ve mevcut regression **aynı** mı? → Evet ise contract değişikliği gerekmez (tipik Faz 7).

---

## Mevcut durum (repo)


| Alan | Değer |
| ---- | ----- |
| **Resmi durum (genel GGUF lifecycle)** | **FAILED** (ortam — tam lifecycle koşturulamadı) |
| **Resmi durum (Qwen adapter hattı — ilk gerçek canlı)** | **FAILED** (aynı ortam engeli; ayrı ölçüm yok) |
| **Resmi durum (BitNet/QVAC — L2)** | **SUCCESS** — verify **PASS** + `OFFICIAL_VERIFY_LINE` bu dosyada işlendi (2026-04-13). |
| İlk kanıt kaydı | 2026-04-10 |
| Son güncelleme | 2026-04-13 (BitNet L2 kanonik kayıt) |
| **Bu ORTAK raporlama turu** | **Kapanır** — “ne çözüldü / ne çözülmedi” cevabı bu dosyada sabitlendi. **Faz 6 lifecycle hedefi** bu turda **başarılı sayılmaz** (FAILED). |


**Not:** “Faz 3 canlı koşu” ifadesi ekip içi doğrulama turu ile karıştırılmamalı; **bu dosya Faz 6 lifecycle kanıtı**dır. **SUCCESS** için yukarıdaki sonuç tablosunun yeniden doldurulması gerekir.
