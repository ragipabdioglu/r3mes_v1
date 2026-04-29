# Wallet Auth, Skip Bayrakları, Chat Ücreti ve İç Rotalar — Güvenlik Denetimi

**Kapsam:** `walletAuth.ts`, `chatProxy.ts`, `suiOperator.ts` (chat fee), `qaHmac.ts` / `internalQa.ts`, ilgili abuse yüzeyi.  
**Format:** Risk → Etki → Öneri (somut).

---

## 1. Wallet auth (`walletAuth.ts`)

### 1.1 Replay (imza yeniden kullanımı)

| | |
|---|---|
| **Risk (Faz 5 öncesi)** | Aynı üçlü `exp` penceresi içinde tekrar gönderilebilirdi. |
| **Durum** | İmzalı JSON’a **`jti`** eklendiğinde `WalletAuthJti` tablosunda tek kullanımlık tüketim; tekrar → **401** `JTI_REPLAY`. **`R3MES_REQUIRE_WALLET_JTI=1`** ile üretimde zorunlu. Bkz. `security/runbook_abuse_faz5.md`. |
| **Kalan** | `jti` gönderilmeyen istekler (zorunlu değilse) hâlâ süre penceresine bağlıdır — prod’da `REQUIRE` açın. |

### 1.2 Süre / saat kayması (expiry)

| | |
|---|---|
| **Risk** | `assertAuthTimingValid` clock skew ve max TTL ile iyi sınırlanmış; istemci saati çok yanlışsa `iat` reddi. |
| **Etki** | Düşük; yalnızca destek senaryolarında “imza geçersiz” artışı. |
| **Öneri** | `R3MES_AUTH_CLOCK_SKEW_SEC` / `R3MES_AUTH_MAX_TTL_SEC` değerlerini prod için dokümante et; NTP senkronu zorunlu tut. |

### 1.3 Adres bağlama (address binding)

| | |
|---|---|
| **Risk** | JSON mesajında `address` yoksa, doğrulama yalnızca `X-Wallet-Address` + imza ile yapılır (doğru tasarım). `address` varsa ve `X-Wallet-Address` ile uyuşmazsa **403**. |
| **Etki** | Mesajda `address` alanının manipülasyonu, imza doğrulamasından önce **kesilir**. |
| **Öneri** | İstemci sözleşmesinde: üretimde mesajda **`address` alanını zorunlu** tutmak bağlayıcılığı artırır (opsiyonel sıkılaştırma). |

### 1.4 Önbellek (cache)

| | |
|---|---|
| **Risk** | Sunucu imza sonucunu önbelleklemez; CDN/proxy **Authorization benzeri başlıkları** cache’lememeli. |
| **Etki** | Yanlış cache konfigürasyonunda başka kullanıcıya aynı yanıtın servis edilmesi (teorik). |
| **Öneri** | `/v1/chat/completions` ve wallet korumalı POST’lar için `Cache-Control: private, no-store` (ters proxy katmanında). |

### 1.5 `R3MES_SKIP_WALLET_AUTH` + `R3MES_DEV_WALLET`

| | |
|---|---|
| **Risk** | `R3MES_SKIP_WALLET_AUTH=1` iken gerçek imza yerine sabit `R3MES_DEV_WALLET` adresi atanır. Prod’da yanlışlıkla açılırsa **tam kimlik bypass**. |
| **Etki** | Kritik: tüm wallet korumalı uçlar tek adres gibi davranır. |
| **Öneri** | `NODE_ENV=production` iken bu bayrakların kullanımını **uygulama başlangıcında reddet** (uygulandı: `app.ts`). Staging/test: `NODE_ENV` ≠ `production` veya ayrı ortam değişkenleri. |

---

## 2. `R3MES_SKIP_*` prod / dev ayrımı

| Bayrak | Davranış | Risk |
|--------|-----------|------|
| `R3MES_SKIP_WALLET_AUTH=1` | İmza atlanır, `R3MES_DEV_WALLET` zorunlu | Kimlik bypass |
| `R3MES_SKIP_CHAT_FEE=1` | Zincir üzerinde `record_usage` çağrılmaz | Ücret / kullanım muhasebesi atlanır |
| `R3MES_DISABLE_RATE_LIMIT=1` | Global rate limit kapatılır | DDoS / abuse |

**Öneri:** `NODE_ENV === "production"` iken `R3MES_SKIP_WALLET_AUTH` ve `R3MES_SKIP_CHAT_FEE` **ikisi de** aktif olamaz — process başlarken hata (kod). `R3MES_DISABLE_RATE_LIMIT` prod’da dokümante “yasak”; istenirse aynı blok listesine eklenebilir (şu an yalnızca dokümantasyon).

---

## 3. Chat fee akışı (`chatProxy.ts` + `recordChatUsageOnChain`)

### 3.1 Sıra ve failure mode

| | |
|---|---|
| **Risk** | Akış: önce `assertOperatorCanPayChatFee`, sonra `recordChatUsageOnChain(wallet)`, sonra upstream `fetch`. Zincir TX **başarılı**, AI motoru **hata / timeout** verirse: kullanım zincirde kayıtlı, kullanıcı yanıt alamayabilir. |
| **Etki** | Operatör maliyeti + kullanıcı deneyimi; “double charge” kullanıcı cüzdanından değil, **operatörün SUI** kesintisi ile ilgili. |
| **Öneri** | Ürün kararı: ya “önce yanıt, sonra ücret” (ters sıra, farklı risk), ya da idempotent `request_id` ile yeniden deneme; operasyonel **monitoring** (TX digest vs HTTP 5xx oranı). |

### 3.2 Ücret kaydı doğruluğu

| | |
|---|---|
| **Risk** | `recordChatUsageOnChain` başarılı dönmeden önce `digest` istemciye dönmüyor; sadece zincir etkisi kontrol ediliyor — tutarlı. |
| **Etki** | Düşük. |
| **Öneri** | İstenirse structured log: `wallet`, `digest` (PII politikasına uygun). |

### 3.3 `R3MES_SKIP_CHAT_FEE`

| | |
|---|---|
| **Risk** | Prod’da açık kalırsa kullanım **zincire yazılmaz**, abuse ile sınırsız chat proxy. |
| **Etki** | İş / tokenomik tutarsızlığı. |
| **Öneri** | Prod’da bayrak reddi (`app.ts`). |

---

## 4. İç webhook ve internal rotalar

### 4.1 `POST /v1/internal/qa-result` (`qaHmac.ts`)

| | |
|---|---|
| **Risk** | `R3MES_QA_WEBHOOK_SECRET` yoksa **403**; HMAC hex, `timingSafeEqual` — iyi. |
| **Etki** | Sızıntı yoksa dışarıdan brute zor; secret sızarsa sahte QA sonucu gönderilebilir. |
| **Öneri** | Secret rotasyonu; IP allowlist (Nginx) opsiyonel; **idempotency**: aynı `jobId` ile tekrar teslimatta DB/on-chain çift yan etki — `jobId` üzerinden “işlendi” kaydı (ürün). |

### 4.2 HMAC replay / tekrar teslimat

| | |
|---|---|
| **Risk (Faz 4 öncesi)** | Aynı gövde + geçerli HMAC ile çift işlem. |
| **Durum** | `QaWebhookReceipt` + ham gövde SHA-256: tamamlanmış iş için **200 duplicate**; çakışma **409**; in-flight **503**. Bkz. `security/design_replay_idempotency_faz3.md`. |
| **Kalan** | Kısmi hata (zincir OK, DB hata) operasyonel reconcilation — nadir. |

### 4.3 Diğer uçlar (auth eksikleri — bilinçli yüzey)

| Rota | Auth | Not |
|------|------|-----|
| `GET /v1/adapters`, `GET /v1/adapters/:id` | Yok | Genelde public liste; **IDOR** değil (kayıt herkese açık veri). |
| `GET /v1/user/:wallet/stake` | Yok | Zincir indeksine paralel read model; **herkes her cüzdanı sorgulayabilir** — kabul edilebilir veya gizlilik politikasına bağlı. |
| `GET /health`, `/ready` | Yok | Beklenen; `/ready` altyapı bilgisi sızdırabilir — iç ağda sınırla. |

---

## 5. Güvenlik check-list (yayın öncesi)

**Güncel release kapısı:** `security/release_checklist_faz6.md` (zorunlu env, `jti` çifti, kabul edilen riskler, uç tablosu).

- [ ] `NODE_ENV=production` build’de `R3MES_SKIP_WALLET_AUTH`, `R3MES_SKIP_CHAT_FEE` **tanımsız veya `0`**
- [ ] `R3MES_DEV_WALLET` prod ortamında tanımlı değil
- [ ] `R3MES_QA_WEBHOOK_SECRET` güçlü ve sadece QA işçisinde
- [ ] İç webhook’a yalnızca güvenilen ağdan erişim (VPC / firewall)
- [ ] Chat proxy upstream (`R3MES_AI_ENGINE_URL`) TLS ve ayrı ağ segmenti
- [ ] Operatör anahtarı (`R3MES_OPERATOR_PRIVATE_KEY`) KMS veya secret manager
- [ ] Rate limit prod’da açık (`R3MES_DISABLE_RATE_LIMIT` ≠ `1`)

---

## 6. Regression test önerileri

**Faz 3:** `pnpm run test:security-regression` (kök) yalnızca `skipFlags`, `walletAuth`, `integration.contract` dosyalarını çalıştırır; CI ana hattı `turbo run test` ile aynı dilimi zaten kapsar. Replay / webhook idempotency için minimum tasarım: `security/design_replay_idempotency_faz3.md`. Manuel GitHub Actions: workflow **Security regression** (`workflow_dispatch`).

---

### 6.1 Orijinal öneriler

1. **Prod skip reddi:** `NODE_ENV=production` + `R3MES_SKIP_WALLET_AUTH=1` → `buildApp()` fırlatmalı (birim test).
2. **Wallet auth açık:** `R3MES_SKIP_WALLET_AUTH=0`, geçersiz/exp imza → 401 `AUTH_EXPIRED` / `INVALID_SIGNATURE`.
3. **Adres uyuşmazlığı:** Mesajda `address` ≠ header → 403 `ADDRESS_MISMATCH`.
4. **Chat fee:** `R3MES_SKIP_CHAT_FEE=0`, operatör konfig yok → 503 `CHAT_FEE_NOT_CONFIGURED`.
5. **QA webhook:** Eksik `X-QA-HMAC` → 403; yanlış HMAC → 403; doğru gövde + secret → 200.
6. **internalQa:** `canChain` false iken yalnızca DB güncellenir; zincir çağrısı atlanır — beklenen davranış snapshot testi.

---

*Güvenlik ajanı — statik kod incelemesi; canlı pentest kapsamı dışındadır.*
