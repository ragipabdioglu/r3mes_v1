# `@r3mes/backend-api`

Fastify + Prisma + Sui operatör köprüsü. **Kanonik REST sözleşmesi:** [docs/api/INTEGRATION_CONTRACT.md](../../docs/api/INTEGRATION_CONTRACT.md).

## Dörtlü hizalama (ORTAK + backend + OpenAPI)

| Katman | Ne anlatır |
|--------|------------|
| **README (bu dosya)** | Release yüzeyi, hata kodları özeti, ortam matrisi; Faz 5’te 501 stake/claim **bilinçli koru** |
| **Runtime** | Seçili çıkışlar `@r3mes/shared-types` Zod ile `safeParse`; ihlalde `500` + `CONTRACT_INVARIANT_VIOLATION` |
| **OpenAPI** | `docs/api/openapi.contract.yaml` — makine-okur alt küme; kanon ile çelişirse önce INTEGRATION_CONTRACT |
| **Testler** | `vitest`: `parse*` regression, chat, 501 politika, idempotency, auth |

## Faz 5 — 501 yüzeyi kaderi (ürün kararı)

`POST /v1/stake` ve `POST /v1/user/:wallet/rewards/claim` için **şu anki karar: bilinçli koru (501)**. Sunucu bu uçlarda zincir işlemi simüle etmez; istemci `code` / `surface` ile **stabil** sözleşmeyi okur. Bu, **sonsuz backlog** değildir; sunucu köprülü akış gelirse ORTAK belge + semver ile **implement** edilir; gerekmezse uç **kaldırma** ayrı bir major kararıdır. Ayrıntı: [INTEGRATION_CONTRACT §3.6 Faz 5](../../docs/api/INTEGRATION_CONTRACT.md).

**Başarı kriteri:** GET read-model uçları (stake, rewards, balance) ile POST 501 ayrımı net; “yarım feature” (sahte başarı, uydurma alan) yok.

## Özet davranış

| Konu | Davranış |
|------|----------|
| Adapter listesi | `GET /v1/adapters` — yanıt `AdapterListResponseSchema` ile doğrulanır (`data[]` = `AdapterListItem`) |
| LoRA upload | `201` gövde `LoRAUploadAcceptedResponseSchema` ile doğrulanır |
| Chat proxy | `POST /v1/chat/completions` — knowledge retrieval + optional behavior adapter + source metadata |
| Stake / claim REST | **501** + `NotImplementedOnChainRestResponse` — `ON_CHAIN_REST_SURFACE_POLICY_FAZ5` = **bilinçli koru** (`services/onChainRestSurface.ts`). |
| Hata gövdeleri | Çoğu uç: `{ error, message }` — `lib/apiErrors.ts` |

## Faz 6 — release öncesi yüzey (sürpriz yok)

**Güvenlik release kapısı:** [release_checklist_faz6.md](../../security/release_checklist_faz6.md) — zorunlu ortam kombinasyonları, kabul edilen riskler, uç auth özeti.

**Faz 7 (release sonrası — canlı teyit):** [mvp_security_sanity_faz7.md](../../security/mvp_security_sanity_faz7.md) — MVP journey auth/abuse gözlemi, kabul edilen risk sahipliği, demo sırlar kontrolü.

**İlk gerçek GGUF lifecycle kanıtı (Faz 6 — tek kaynak):** [GGUF_LIFECYCLE_PROOF_FAZ6.md](../../docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md) — başarı/başarısız sonuç burada sabitlenir; §3.3.1 kanonu ile uyum için dağınık log yeterli değildir.

**İç üretim — ACTIVE aday minimum kanıt:** [docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md](./docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md) — zorunlu alanlar ve smoke vs gerçek aday ayrımı.

**Dörtlü (tek doğruluk zinciri):** [INTEGRATION_CONTRACT](../../docs/api/INTEGRATION_CONTRACT.md) → `@r3mes/shared-types` (`schemas.ts`) → [openapi.contract.yaml](../../docs/api/openapi.contract.yaml) → `pnpm exec vitest run` (`apps/backend-api`). Çelişki durumunda önce ORTAK belge, sonra kod/YAML.

**Hata gövdesi (çoğu uç):** `{ "error": "<kod>", "message": "<açıklama>" }` — `ApiErrorBody` (OpenAPI). **501 stake/claim:** `NotImplementedOnChainRestResponse` (`success`, `code`, `message`, `surface`).

| `error` (örnek) | HTTP | Bağlam |
|-----------------|------|--------|
| `UNAUTHORIZED`, `WALLET_AUTH_MISCONFIGURED` | 401 | Cüzdan / imza (`walletAuth`) |
| `INVALID_WALLET`, `INVALID_ID` | 400 | Path veya parametre |
| `WALLET_MISMATCH` | 403 | İmzalı adres ≠ istek |
| `NOT_FOUND` | 404 | Adapter / QA CID |
| `ADAPTER_RESOLUTION_FAILED`, `INVALID_ON_CHAIN_ADAPTER_ID` | 400 | Chat `adapter_cid` çözümü |
| `PAYMENT_REQUIRED` | 402 | Chat ücreti / operatör SUI |
| `CHAT_FEE_NOT_CONFIGURED` | 503 | Operatör env eksik |
| `CONTRACT_INVARIANT_VIOLATION` | 500 | Liste/LoRA/501 gövde şema ihlali |
| `REWARDS_QUERY_FAILED`, `RPC_ERROR` | 502 | Sui RPC / özet sorgusu |
| `INVALID_BODY`, `FORBIDDEN` | 400 / 403 | QA webhook gövde / HMAC |
| `IDEMPOTENCY_CONFLICT` | 409 | QA aynı `jobId`, farklı gövde |
| `QA_WEBHOOK_IN_FLIGHT` | 503 | QA işlem devam |
| `ONCHAIN_QA_FAILED` | 500 | QA on-chain tx hatası |
| `NOT_IMPLEMENTED` (gövde `code`) | 501 | Bilinçli stake/claim yüzeyi |

**Ortam matrisi (özet):**

| Profil | `NODE_ENV` | Üretimde yasak | Tipik ek |
|--------|------------|----------------|----------|
| Üretim | `production` | `R3MES_SKIP_WALLET_AUTH`, `R3MES_SKIP_CHAT_FEE` | Tam wallet + operatör anahtarı, rate limit açık |
| Geliştirme | `development` | — | `R3MES_SKIP_*` + `R3MES_DEV_WALLET` yerel; `R3MES_DISABLE_RATE_LIMIT=1` isteğe bağlı |
| CI / contract test | — | — | `R3MES_DISABLE_RATE_LIMIT=1`, `R3MES_SKIP_WALLET_AUTH=1`, `R3MES_DEV_WALLET`, `R3MES_SKIP_CHAT_FEE=1` |

**Varsayılan inference — backend:** API sözleşmesi model ailesinden bağımsızdır; mevcut golden path Qwen2.5-3B + RAG-first mimaridir. Legacy BitNet/QVAC belgeleri ürün ana yolunu tanımlamaz.

## Ortam

`.env.example` dosyasına bakın; üst satırda Faz 6 matrisine referans vardır. Test/CI için: `R3MES_DISABLE_RATE_LIMIT=1`, entegrasyon testleri için imza atlaması: `R3MES_SKIP_WALLET_AUTH=1` + `R3MES_DEV_WALLET`.

## Faz 7 — uçtan uca yaşam döngüsü (kanıt)

**Hedef:** Upload → kuyruk → QA webhook → **ACTIVE** → chat’te `adapter_cid` çözümü. Yalnızca birim testlerin geçmesi yeterli değildir; **tekrarlanabilir** doğrulama gerekir.

| Ne | Nerede |
|----|--------|
| Senaryo + sıra diyagramı | [docs/E2E_LIFECYCLE_DEMO.md](./docs/E2E_LIFECYCLE_DEMO.md) |
| Otomatik smoke | `pnpm run e2e:lifecycle-smoke` (API + IPFS + DB + Redis + sunucuda `R3MES_QA_WEBHOOK_SECRET`) |
| Log işaretleri | `e2eLifecycle`: `upload_accepted` → `qa_webhook_applied` → `chat_proxy_resolved` |

Script başarısızsa önce IPFS / migrasyon / env. Chat adımında AI motoru kapalı olabilir; **400 `ADAPTER_RESOLUTION_FAILED`** alınırsa adapter çözümü başarısız demektir (beklenmez).

## Güvenlik notu

Üretimde `R3MES_SKIP_*` bayraklarını kapatır (`assertNoInsecureSkipFlagsInProduction`). **QA webhook** (`POST /v1/internal/qa-result`): `jobId` + ham gövde SHA-256 ile idempotency (`QaWebhookReceipt` tablosu). **Wallet imzası:** isteğe bağlı veya `R3MES_REQUIRE_WALLET_JTI=1` ile zorunlu `jti` alanı (`WalletAuthJti`). **Rate limit:** `R3MES_RATE_LIMIT_MAX` / `R3MES_RATE_LIMIT_WINDOW`. Deploy’da `pnpm db:migrate` gerekir. **Release (Faz 6):** kabul edilen riskler ve zorunlu kombinasyonlar — [`security/release_checklist_faz6.md`](../../security/release_checklist_faz6.md). **Release sonrası (Faz 7):** MVP canlı sanity, risk sahipliği, demo sırlar — [`security/mvp_security_sanity_faz7.md`](../../security/mvp_security_sanity_faz7.md). Ayrıntı: `security/design_replay_idempotency_faz3.md`, `security/runbook_abuse_faz5.md`.
