# Faz 6 — Release güvenlik checklist ve risk tablosu

**Amaç:** Release anında güvenlik tarafında **sürpriz veya gri alan kalmaması** — yeni mekanizma icat etmek değil; **kapatılan** ile **bilinçli kabul edilen** riskleri ayırmak.

**Kapsam:** `apps/backend-api`, ters proxy / edge (referans), dApp ortam eşlemesi.

---

## 1. Release öncesi — hızlı checklist

### 1.1 Zorunlu (üretim)

- [ ] `NODE_ENV=production`
- [ ] `R3MES_SKIP_WALLET_AUTH` ve `R3MES_SKIP_CHAT_FEE` **tanımlı değil veya `0`** (uygulama aksi halde başlamaz)
- [ ] `R3MES_DISABLE_RATE_LIMIT` **≠ `1`**
- [ ] `DATABASE_URL` üretim DB; `pnpm db:migrate` uygulanmış (`QaWebhookReceipt`, `WalletAuthJti` dahil)
- [ ] `R3MES_QA_WEBHOOK_SECRET` güçlü ve yalnızca QA işçisi / sırlar deposunda
- [ ] `R3MES_OPERATOR_PRIVATE_KEY` (ve chat ücreti için gerekli Sui env) sırlar deposunda; düz metin `.env` repo dışında
- [ ] İç webhook (`/v1/internal/qa-result`) ağ düzeyinde mümkünse yalnızca güvenilen kaynak IP / VPC

### 1.2 Önerilen kombinasyon (wallet replay kapatma)

| Backend | dApp | Sonuç |
|---------|------|--------|
| `R3MES_REQUIRE_WALLET_JTI=1` | `NEXT_PUBLIC_R3MES_REQUIRE_WALLET_JTI=1` | `jti` zorunlu + tek kullanımlık; imza önbelleği kapalı — **eşleşmeli** |

Biri açık diğeri kapalıysa: **401** (`JTI_REQUIRED`) veya replay koruması devre dışı kalır — release öncesi bilinçli karar verin.

### 1.3 Operasyonel doğrulama

- [ ] `pnpm run test:security-regression` (kök) veya tam `turbo run test` yeşil
- [ ] `/ready` üretimde gerektiği gibi (Postgres + Redis beklentisi net)
- [ ] Chat proxy upstream (`R3MES_AI_ENGINE_URL`) erişilebilir ve mümkünse TLS

---

## 2. Kapatılan riskler (referans — Faz 3–5)

| Konu | Nerede |
|------|--------|
| Skip bayrakları prod’da yanlışlıkla açılması | `assertNoInsecureSkipFlagsInProduction` |
| QA webhook tekrar teslim / çakışma | `QaWebhookReceipt` + `security/design_replay_idempotency_faz3.md` |
| Wallet imza replay (zorunlu modda) | `WalletAuthJti` + `R3MES_REQUIRE_WALLET_JTI` |
| Temel abuse hacmi | Global `@fastify/rate-limit` + yapılandırılabilir eşik |

---

## 3. Kabul edilen riskler (release notu)

*Teorik sıfır risk hedeflenmez; aşağıdakiler **dokümante** kabul.*

| ID | Risk | Etki | Azaltma / izleme | Sahip (tipik) |
|----|------|------|------------------|----------------|
| A1 | Public GET ile indekslenmiş stake / ödül özeti | Adres başına veri sızıntısı algısı (zincirle uyumlu read model) | Ürün politikası; gerekirse auth’lu read gelecek major | Ürün |
| A2 | Çoklu API instance’da varsayılan rate limit **bellek içi** (global limit paylaşılmaz) | Sunucu başına ayrı sayaç | Edge `limit_req` veya Redis store ile `@fastify/rate-limit` (ileri faz) | Altyapı |
| A3 | QA’da zincir başarılı / DB hata gibi **nadir kısmi başarısızlık** | Tutarsızlık, manuel müdahale | Log/alert; idempotency receipt ile tekrar deneme sınırlı | BACKEND |
| A4 | Chat ücreti modeli **operatör SUI** ile; kullanıcı doğrudan ödemiyor | Ekonomik / adil kullanım tartışması | Ürün ve tokenomik belge | Ürün |
| A5 | `/health` dahil tüm rotalara aynı global rate limit | Sağlık kontrolü baskı altında | Edge’de health muafiyeti veya ayrı port | Altyapı |
| A6 | Guardrails / WAF / DDoS tam katmanı | Büyük ölçekte ek yüzey | `security/audit/pentest_report.md` önerileri; aşamalı | Altyapı |

---

## 4. Uç nokta — auth / authorization özeti (snapshot)

| Method | Path | Kimlik doğrulama | Not |
|--------|------|------------------|-----|
| GET | `/health` | Yok | Liveness |
| GET | `/ready` | Yok | DB + Redis |
| GET | `/v1/version` | Yok | Sürüm bilgisi |
| GET | `/v1/adapters`, `/adapters` | Yok | Public liste |
| GET | `/v1/adapters/:id` | Yok | Detay |
| GET | `/v1/chain/adapters/:onChainId` | Yok | Zincir indeks |
| GET | `/v1/user/:wallet/stake`, `/user/...`, `/v1/chain/stake/:wallet` | Yok | Read model (A1) |
| GET | `/v1/user/:wallet/rewards`, `/user/...` | Yok | Sui olay özeti |
| GET | `/v1/user/:wallet/balance` | Yok | RPC bakiye |
| POST | `/v1/chat/completions` | Cüzdan imzası (`walletAuthPreHandler`) | Ücret + proxy |
| POST | `/v1/adapters`, `/adapters` | Cüzdan imzası | Multipart LoRA |
| POST | `/v1/internal/qa-result` | **HMAC** (`X-QA-HMAC`) | İç webhook |
| POST | `/v1/stake` | Cüzdan imzası | **501** bilinçli |
| POST | `/v1/user/:wallet/rewards/claim` | Cüzdan + path eşleşmesi | **501** bilinçli |

**Son kontrol sorusu:** Yeni eklenen rota mutasyon veya ödeme içeriyorsa `walletAuthPreHandler`, HMAC veya başka bir **güvenilir sunucu sırrı** ile mi korunuyor?

---

## 5. Abuse — uygulama sırası (kısa)

1. **Ölç:** Log, hız, 429/429 benzeri; kaynak IP / user-agent.
2. **Uygulama:** Rate limit açık; skip bayrakları kapalı; wallet `jti` çifti (prod) açık.
3. **Edge:** Gerekirse Nginx `limit_req` / WAF — `security/audit/pentest_report.md`.

Ayrıntılı env tabloları: `security/runbook_abuse_faz5.md`.

---

## 6. Başarı kriteri

- [ ] Yukarıdaki checklist işlendi ve **kabul edilen riskler** (§3) ile ürün/altyapı hizası verildi.
- [ ] Üretim ortam değişkenleri **zorunlu kombinasyonlar** (§1.2) için gözden geçirildi.
- [ ] Uç nokta tablosu (§4) ile release branch’teki kod **uyumlu** (yeni rota varsa tablo güncellendi).

---

**Faz 7 (release sonrası):** MVP akışında auth/abuse teyidi, kabul edilen risk sahipliği ve demo sırlar kontrolü — [`mvp_security_sanity_faz7.md`](./mvp_security_sanity_faz7.md).

---

*Faz 6 — güvenlik release kapısı; mimari değişince §3–4 güncellenir.*
