# Backend release — varsayılan runtime (BitNet / QVAC)

Bu not, **BitNet’in varsayılan inference olarak seçilmesinin** `@r3mes/backend-api` için **ek sözleşme veya kod riski oluşturmadığını** sabitler. Dağıtımda kopyalanabilir **release özeti** ve **production env matrisi** aşağıdadır.

## 0. Terminoloji — “hazır” vs “deploy”

| Terim | Ne demek | Ne demek değil |
|-------|----------|----------------|
| **Backend release hazır** | Sürüm **artifact** + **public contract** + bu belgedeki env matrisi ile **uyumlu** dağıtılabilir; **verify PASS** kanıtı teknik riski düşürür. | Üretimde **şu an** yeni sürümün **yüklendiği** veya BitNet’in **tek çalışan yük** olduğu. |
| **Gate kapandı** (operasyon) | [`BITNET_FLIP_FINAL_GATES.md`](../../../infrastructure/BITNET_FLIP_FINAL_GATES.md) vb. checklist’te **ön koşul** kutuları işlendi. | **Deploy** komutunun prod’da **tamamlandığı**; ikisi ayrı kayıt. |
| **Deploy icrası** | Hedef ortamda **gerçek** süreç/env güncellemesi (migrate, rollout, secret). | Dokümandaki “hazır” cümlesinin tek başına **otomatik** tamamlanmış olması. |

**Özet:** Bu dosyadaki **“hazır”** ifadeleri **release güveni** içindir; **prod’da BitNet default’ın fiilen yürürlükte olduğunu** iddia etmez — o, **operasyon + `RUNTIME_PROFILES`** ile sabitlenir.

## 1. Son teknik doğrulama (kod tabanı)

| Kontrol | Sonuç |
|--------|--------|
| `apps/backend-api` içinde `Qwen`, `BitNet`, `QVAC` sabitleri veya zorunlu dallanma | **Yok** — chat proxy yalnızca `R3MES_AI_ENGINE_URL`’e HTTP iletir; model ailesi backend’de seçilmez. |
| `BenchmarkJobPayload` / QA webhook gövdesi | **CID + kimlik + skor** — taban model adı taşınmaz (`packages/shared-types/src/payloadTypes.ts`). |
| LoRA upload doğrulaması | **llama.cpp uyumlu GGUF** (genel); BitNet/Qwen ayrımı yok (`ggufWeightsValidate.ts`, `adapters.ts`). |
| Qwen fallback | Backend’de **zorunlu kılınmaz**; yedek yol **AI engine / worker / yönlendirme (operasyon)** katmanında kalır. |

**Sonuç:** Hedef BitNet/QVAC profili için **backend tarafında ek risk kalemi yok**; **public REST sözleşmesi** değişmeden **uyumlu release** kesilebilir (INTEGRATION_CONTRACT + semver disiplini). **Prod deploy** ayrı adımdır.

## 2. Production release notu (şablon)

Aşağıyı sürüm notuna yapıştırılabilir:

---

**Backend `@r3mes/backend-api` (runtime flip ile uyumlu)**

- **Sözleşme:** Upload, adapter listesi, chat `adapter_cid` çözümü, `POST /v1/internal/qa-result` (HMAC) davranışı **değişmedi**; BitNet varsayılanı **AI engine dağıtımı** ile hizalanır, API şeması aynı kalır.
- **Güvenlik:** Üretimde `R3MES_SKIP_WALLET_AUTH` ve `R3MES_SKIP_CHAT_FEE` **kapalı**; `R3MES_QA_WEBHOOK_SECRET` worker ile aynı; bkz. `security/release_checklist_faz6.md`.
- **Canlı doğrulama (öneri):** `pnpm verify:lifecycle-chain -- --adapter-id <id> --job-id <benchmarkJobId>` (`DATABASE_URL` + `R3MES_VERIFY_BASE_URL`).
- **Bilinçli sınır:** Faz 5 stake/claim **501** yüzeyi değişmez; runtime flip ile ilgili değildir.
- **Public contract:** Kanon [INTEGRATION_CONTRACT.md](../../../docs/api/INTEGRATION_CONTRACT.md); BitNet default **şema veya hata kodu değişikliği getirmez** (semver ile uyumlu sürümleme).

---

## 3. Env matrisi — üretim hedefi (BitNet varsayılanı seçildiğinde)

Aynı backend sürümü; **hedef ortamda** BitNet varsayılanı seçildiğinde yalnızca **dış hizmet URL’leri ve sırlar** güncellenir (deploy **icrasında** uygulanır). Backend’e **yeni zorunlu env** eklenmez.

### 3.1 Zorunlu (üretim)

| Değişken | Rol | Flip notu |
|----------|-----|-----------|
| `NODE_ENV` | `production` | Skip bayrakları yasak (`app.ts`). |
| `DATABASE_URL` | Prisma | Değişmez (migrate deploy). |
| `REDIS_URL` | BullMQ + sağlık | Değişmez. |
| `IPFS_API_URL` | LoRA upload IPFS add | Değişmez (Kubo erişimi). |
| `R3MES_QA_WEBHOOK_SECRET` | QA webhook HMAC | Worker ile **aynı** sır; flip tek başına değiştirmez. |
| `R3MES_AI_ENGINE_URL` | Chat proxy upstream | Flip sonrası **varsayılan (BitNet) inference** taban URL’i; sondaki `/` olmadan. Qwen yedek backend’de ikinci env değil — **AI engine / LB / ayrı servis** tarafında çözülür. |
| `PORT` / `HOST` | HTTP | Load balancer / ingress ile uyumlu. |
| Sui / operatör (`SUI_RPC_URL`, `R3MES_*_OBJECT_ID`, `R3MES_OPERATOR_PRIVATE_KEY` vb.) | Zincir + chat ücreti | Ücret açıksa zorunlu; runtime’dan bağımsız. |

### 3.2 Cüzdan imzası (üretim — tipik)

| Değişken | Rol |
|----------|-----|
| — | `R3MES_SKIP_WALLET_AUTH` **kapalı**; istemci `X-Signature` / `X-Message` / `X-Wallet-Address`. |
| `R3MES_REQUIRE_WALLET_JTI` | `1` önerilir (replay önleme). |
| `R3MES_AUTH_*` | İstemci ile uyumlu TTL / skew. |

### 3.3 Geliştirme / smoke (üretimde kullanılmaz)

| Değişken | Not |
|----------|-----|
| `R3MES_SKIP_WALLET_AUTH=1` + `R3MES_DEV_WALLET` | Yalnızca yerel E2E. |
| `R3MES_SKIP_CHAT_FEE=1` | Yalnızca yerel. |
| `R3MES_DISABLE_RATE_LIMIT=1` | Yalnızca dev/test. |

### 3.4 İsteğe bağlı

| Değişken | Rol |
|----------|-----|
| `R3MES_IPFS_GATEWAY_URL` | İstemci/gateway okuma URL’i. |
| `R3MES_MIRROR_LIST_QUEUE` | `0` ile liste köprüsü kapatılabilir (varsayılan açık). |

## 4. Özet cevaplar

| Soru | Cevap |
|------|--------|
| Backend release (sözleşme) BitNet hedefiyle uyumlu mu? | **Evet** — ek backend kodu veya contract revizyonu şart değil. **Prod deploy** ayrı adım. |
| Qwen fallback zorunlu mu (backend)? | **Hayır** — yalnızca **operasyonel** (AI engine / routing). |
| Flip sırasında backend’de ek risk? | **Ek risk kalemi yok**; riskler mevcut prod disiplinleri (sırlar, DB, IPFS, AI engine erişilebilirliği). |

## 5. Deploy sonrası / hedef ortamda zorunlu ve önerilen kontroller

**Hedef ortamda** (staging veya prod) BitNet varsayılanı **deploy edildikten** sonra aşağıdaki sıra yeterlidir. **Contract değişikliği yoktur**; bu kontroller regresyon ve bağlantı doğrulaması içindir. Gate kapanışı veya “release hazır” tek başına bu adımların **yerine geçmez**.

| Kontrol | Komut / uç | Beklenti |
|--------|------------|----------|
| **Canlı** | `GET /health` | `200`, `{ "status": "ok" }` — süreç ayakta. |
| **Bağımlılıklar** | `GET /ready` | `200`, `{ "status": "ready" }` — Postgres + Redis ping; `503` ise DB veya Redis env/erişim. |
| **Sürüm** | `GET /v1/version` | Servis kimliği (opsiyonel release etiketi). |
| **Lifecycle zinciri (öneri)** | `apps/backend-api` içinde: `pnpm verify:lifecycle-chain -- --adapter-id <id> --job-id <jobId>` | `DATABASE_URL` + `R3MES_VERIFY_BASE_URL` (veya `R3MES_E2E_BASE_URL`) API tabanı ile aynı olmalı. |
| **Uçtan uca smoke (staging / yerel)** | `pnpm e2e:lifecycle-smoke` | `R3MES_E2E_BASE_URL`, sunucudaki ile aynı `R3MES_QA_WEBHOOK_SECRET`; senaryo: [E2E_LIFECYCLE_DEMO.md](./E2E_LIFECYCLE_DEMO.md). Chat adımı AI engine’e bağlıdır — flip sonrası `R3MES_AI_ENGINE_URL` BitNet servisine işaret etmeli. |

**Env son kontrol (üretim):** `DATABASE_URL`, `REDIS_URL`, `IPFS_API_URL`, `R3MES_QA_WEBHOOK_SECRET` (worker ile birebir), `R3MES_AI_ENGINE_URL` (BitNet default upstream), cüzdan skip bayrakları **kapalı**.

## 6. Kanon referanslar

| Belge | İçerik |
|-------|--------|
| [INTEGRATION_CONTRACT.md](../../../docs/api/INTEGRATION_CONTRACT.md) | Public REST sözleşmesi — flip ile değişmez. |
| [README.md](../README.md) | Hata kodları özeti, ortam matrisi özeti. |
| [release_checklist_faz6.md](../../../security/release_checklist_faz6.md) | Üretim öncesi güvenlik kapısı. |
| [E2E_LIFECYCLE_DEMO.md](./E2E_LIFECYCLE_DEMO.md) | Smoke sırası ve log işaretleri. |

## 7. Gerçek çalıştırma kaydı (ortam doğrulaması)

Bu bölüm, **release güveni** için “hazır” ifadesinin **gerçek HTTP / DB çıktıları** ile desteklenmesi içindir; tarih ve sonuçlar **dağıtım ortamına göre** güncellenir. **Üretimde deploy** tamamlandı mı sorusunun cevabı **bu tablo değildir** — operasyon kaydı ile doğrulanır.

| Kontrol | Beklenen | Son doğrulama (yerel örnek) |
|--------|----------|------------------------------|
| `GET /health` | `200` + `"status":"ok"` | **200** — `{"status":"ok"}` |
| `GET /ready` | `200` + `"status":"ready"` | **200** — `{"status":"ready"}` (Postgres + Redis) |
| `R3MES_AI_ENGINE_URL` (BitNet default upstream) | Chat proxy hedefi ayakta | **Ayrı süreç:** bu ortamda varsayılan `http://127.0.0.1:8000` için bağlantı yoktu (`curl` zaman aşımı). Backend stabilitesi `/health` + `/ready` ile kanıtlanır; **upstream sağlığı** AI engine dağıtımında `GET /health` ile doğrulanmalıdır. |
| `pnpm verify:lifecycle-chain` | `PASS` (terminal adapter + receipt) | **PASS** — örnek: `adapterId=cmnxhjxvy0005kl88aba1493w`, `jobId=benchmark-0-QmbZjyP2PtMisYMovf3gnbbg`, `verify=PASS` |

**Not:** Release “hazır”ı (sözleşme + bağımlılık) backend API + DB + Redis için **§7 üst iki satır** yeterlidir; **prod deploy** yok sayılmaz. Tam uçtan uca sohbet için AI engine’in **hedef ortamda** çalışır olması gerekir (BitNet default orada seçilir).
