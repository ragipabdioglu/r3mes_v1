Özet aşağıda.

Canonical contract decisions (Faz 2 korundu)
Kimlik, wire status, skor anlamları değiştirilmedi; yalnızca Faz 2’deki docs/api/INTEGRATION_CONTRACT.md ve fazlar/v3/faz_2.md ile uyumlu doğrulama katmanı eklendi.
Tek runtime kaynak: packages/shared-types/src/schemas.ts (Zod) + contractGuards.ts (invariant) + test/contractRegression.test.ts.
OpenAPI: docs/api/openapi.contract.yaml — §3.1 / §3.4 özet yüzeyi; tam kanon yine markdown + Zod.
Payload tipleri payloadTypes.ts içinde toplandı; index.ts döngüsel import olmadan schemas export ediyor.
Breaking / non-breaking (migration notları)
Değişiklik	Sınıf
payloadTypes.ts ile import yolu (BenchmarkJobPayload vb. hâlâ @r3mes/shared-types ana girişinden)
Non-breaking (aynı paket export’ları)
Tüketicilerin doğrudan ./payloadTypes alt yoluna geçmesi
İsteğe bağlı; public API index
Zod’un liste yanıtında status için yalnızca AdapterStatusWire kabul etmesi
Wire ile uyumlu; eski “bilinmeyen status string” listeleri artık parseAdapterListResponse ile reddedilir — dağıtımda eski veri varsa bu davranış değişikliği sayılır (Faz 2’ye uyum için doğru sıkılık)
Yeni PR’lar için §7 + FAZ3_CONTRACT_GOVERNANCE checklist
Süreç zorunluluğu
Eklenen / güncellenen dosyalar (sahiplik alanı)
Dosya
packages/shared-types/src/payloadTypes.ts
packages/shared-types/src/schemas.ts
packages/shared-types/src/contractGuards.ts
packages/shared-types/test/contractRegression.test.ts
packages/shared-types/vitest.config.ts
packages/shared-types/package.json (zod, vitest, test script)
docs/api/openapi.contract.yaml
docs/api/FAZ3_CONTRACT_GOVERNANCE.md
docs/api/INTEGRATION_CONTRACT.md (§7 PR notu + §8)
fazlar/v3/faz_3_validation.md
packages/shared-types/README.md, INTEGRATION_CONTRACT.md (kök)
ENGEL: YOK (pnpm run build + pnpm run test @r3mes/shared-types içinde geçti).

SONRAKİ ADIM: CI’da pnpm --filter @r3mes/shared-types test eklemesi (Altyapı/Güvenlik); backend route’larda isteğe bağlı parseAdapterListResponse / safeParse kullanımı (Backend ajanı).

---------------------------------------------------------------------------------------

Özetinle uyumlu Faz 3 blockchain karar notu eklendi: docs/adr/ADR-002-stake-claim-source-of-truth.md.

İçerik (kısa):

Bugün zincirde kaynak gerçek sayılan tablo: stake deposit / withdraw / slash, record_usage (OperatorCap, 1 MIST), withdraw_rewards (OperatorCap) — kullanıcıya doğrudan “claim” entry’si yok; bu net yazıldı.
“Claim” için olası anlamlar ayrıştırıldı; hangisinin ürün dilinde resmi olacağı açık karar olarak bırakıldı.
Stake lifecycle için ürün ↔ Move ↔ olay hedef tablosu (örnek isimlerle) ve indexer / RPC ayrımı.
Engel ilkesi: Zincirde olmayan davranış “varmış” gibi yazılmamalı; erken mimari doc ile operasyonel doc ayrımı.
Sonunda doldurulacak karar tablosu (claim tanımı, ödül özeti kaynağı, reward_pool indexer’a alınsın mı).
Çapraz referans: ONCHAIN_READ_MODEL_AND_EVENTS.md ve blockchain_architecture.md içine ADR-002 linki eklendi.

Sonraki somut adım: BACKEND + ürün ile ADR-002’deki tabloyu doldurup durumu Taslak → Kabul yapmak; ardından gerekiyorsa tek sayfalık “ORTAK sözleşme notu” (API + UI terimleri) bu ADR’ye referans vererek yazılabilir.

---------------------------------------------------------------------------------------

Özet
Faz 3 hedefiyle uyumlu olarak route yüzeyi aynı kaldı; 501 stake/claim için net bir servis sınırı, hata gövdesi tekleştirmesi, adapter listesi için tek DTO eşlemesi ve genişletilmiş integration testleri eklendi. Zincir tarafı netleşene kadar sahte “tamamlandı” davranışı yok; BLOCKCHAIN için hazırlık services/onChainRestSurface.ts içinde belgelendi.

1. Stake / claim “implementation readiness”
apps/backend-api/src/services/onChainRestSurface.ts: ON_CHAIN_REST_READINESS, notImplementedStakePost(), notImplementedRewardsClaimPost() — gerçek Move/REST işi buraya bağlanacak şekilde tek kaynak.
POST /v1/stake ve POST /v1/user/:wallet/rewards/claim yalnızca bu modülü döndürüyor (501).
2. Hata gövdesi ({ error, message })
apps/backend-api/src/lib/apiErrors.ts: ApiErrorBody, apiError, sendApiError.
Kullanıldığı yerler: user.ts, adapters.ts, chatProxy.ts, chatAdapterResolve.ts (çözümleme hataları ApiErrorBody).
3. Read model → liste şekli
apps/backend-api/src/lib/adapterDto.ts: toAdapterListItem() — GET /v1/adapters tek eşleme noktası.
4. :wallet doğrulaması (ORTAK beklentiyle uyum)
normalizeSuiAddress tek başına bazı anlamsız stringleri pad’leyip “adres” gibi iletiyordu; path parametreleri için isValidSuiAddress ile doğrulama eklendi (parseWalletParam in user.ts). Bu yalnızca user route’larındaki :wallet ile ilgili; chat/adapter sözleşmesine dokunulmadı.
5. Testler
onChainRestSurface.test.ts — 501 gövde + readiness sabitleri.
integration.contract.test.ts — health, adapter 404 ApiErrorBody, stake read-model alanları, /v1/chain/stake/:wallet alias, geçersiz cüzdan 400, stake/claim 501 alanları, chat proxy, auth.
Mock’lar: beforeEach içinde stakePosition.findMany / adapter.findMany yeniden bağlanıyor; afterEach’te clearAllMocks (restore değil) kullanılıyor.
6. README
apps/backend-api/README.md — kısa not: on-chain REST sınırı + apiErrors.
Test: npx vitest run → 28/28 geçti.

---------------------------------------------------------------------------------------

Yapılanlar
stake-dashboard.tsx — readErrorMessage kaldırıldı; toast ve GET hataları için userFacingHttpMessage / userFacingFetchFailure kullanılıyor. Başarı tostu: “İstek kabul edildi.”

stake-form.tsx — Kısa, tek mesaj: backend 501, gerçek işlem Move/cüzdan; gereksiz endpoint tekrarı azaltıldı.

rewards-panel.tsx — Başlık “Ödül özeti”; satırlar Türkçe etiket + title ile backend alan adı; boş: “Özet henüz yok.”; buton “Ödül talebi” + aria-label; alt not sadeleştirildi.

stake-balance-card.tsx — “Stake özeti”; totalStakedNano yalnızca açıklamada/tooltip benzeri; görünen değer “Toplam (nano birimi)”.

chat-screen.tsx — Cüzdan bağlıyken adaptör/CID yoksa üstte amber uyarı; boş sohbet metni kısaltıldı (SSE + backend eşlemesi).

marketplace-list.tsx — Hata başlığı “Liste yüklenemedi”; boş liste: “Şu an yayında (ACTIVE) görünen adaptör yok.”

adapter-status-board.tsx — Hata kutusu marketplace ile aynı mantık; boş metin kısaldı; alt rozet açıklaması ürün diline çekildi (status alanı vurgusu).

studio-upload-panel.tsx — Hata: userFacingHttpMessage; başarı: summarizeUploadSuccess (JSON’da PENDING_REVIEW / adapterId okunuyor, uydurma alan yok).

Doğrulama
pnpm exec tsc --noEmit — başarılı
pnpm exec next build — başarılı (build sırasında backend yoksa ECONNREFUSED logu beklenen; sayfa üretimi tamamlandı)
İstersen bir sonraki adımda http-messages.ts içindeki 501 cümlesini (Sui/Move vurgusu) tek satırlık daha da kısa bir ürün cümlesine indirebiliriz; aynı dosyadan tüm ekranlar senkron kalır.

---------------------------------------------------------------------------------------

Operasyonel hata sınıflandırması (inference_errors.py)
detail artık category (local_runtime, artifact_fetch, llama_inference, bilinmeyen aşama için unknown) ve retryable içeriyor.
Uygun yerlerde cause: timeout, http_status, transport, os_error, unknown (classify_httpx_cause).
Identity / adapter_id eşlemesi yok; yalnızca çıkarım hataları.
Gözlemlenebilirlik
Log: r3mes_inference — request_id (opsiyonel X-Request-ID), adapter_cid, stream, cache_hit, lock_wait_ms, resolve_ms, swap_ms.
LoRA / indirme: r3mes_adapter (cache hit/miss, indirme süresi), r3mes_lora_hot_swap / upstream için net log etiketleri.
Non-stream 200: X-R3MES-Adapter-Cache, X-R3MES-Lock-Wait-Ms, X-R3MES-Adapter-Resolve-Ms, X-R3MES-Lora-Swap-Ms, X-R3MES-Lora-Slot.
Stream: ASGI’de ölçümleri yanıt başlığına koymak güvenilir olmadığı için X-R3MES-Inference-Stage: stream ve X-R3MES-Diagnostics: see_server_logs; süreler log’da.
Adapter çözümü (gguf_adapter.py)
AdapterArtifact: path, cache_hit, resolve_ms (cache hit’te resolve_ms == 0).
İndirme sonrası max_rounds ile birlikte log.
Kısa doküman
docs/ADAPTER_CACHE_AND_SWAP.md: önbellek anahtarı, invalidation yokluğu, global lock, hot-swap, timeout/retry tablosu, stream vs header kısıtı.
README
Hata gövdesi alanları, gözlemlenebilirlik ve doküman linki güncellendi.
Testler
fake_proxy artık **_kwargs alıyor (request_id uyumu).
tests/test_inference_errors.py: sınıflandırma birimi (mock’suz).
pytest 7 test, ruff temiz.

---------------------------------------------------------------------------------------

Özet aşağıda.

Yapılanlar
security/design_replay_idempotency_faz3.md

Wallet: İmzalı mesaja jti, Redis SET NX + TTL (geri uyumluluk: jti opsiyonel başlayabilir).
Webhook: jobId ile idempotency; Redis veya DB unique.
Rate/abuse: Faz 3’te ek kod katmanı yok; mevcut rate-limit + operasyon/runbook vurgusu.
CI: Ana hat turbo run test ile aynı dilim; odaklı komut ve manuel workflow açıklaması.
Script’ler

apps/backend-api: "test:security-regression" → build + skipFlags + walletAuth + integration.contract vitest.
Kök package.json: "test:security-regression" → backend-api’ye delegasyon.
.github/workflows/security-regression.yml

Sadece workflow_dispatch — PR’da çift test yok; manuel / hızlı güvenlik paketi.
.github/workflows/ci.yml

Test adımının üstüne kısa yorum (güvenlik dilimi zaten turbo test içinde).
security/audit_wallet_chat_internal.md

Bölüm 6’ya Faz 3 referansı ve test:security-regression / tasarım belgesi bağlantısı.
pnpm run test:security-regression yerelde 21 test ile geçti.

Neden ayrı PR job’u yok?
Ana CI zaten pnpm exec turbo run test ile backend-api’nin tamamını koşuyor; ikinci bir “security-only” job aynı testleri tekrar çalıştırırdı. İstenen bağlanabilirlik kök script + isteğe bağlı manuel workflow ile sağlandı.

Sonraki adım (backlog)
jti + Redis veya webhook jobId idempotency için ince PR (feature flag ile).
İstersen security-regression.yml’e pull_request + paths: ile yalnızca walletAuth.ts vb. değişince tetikleme eklenebilir — şu an bilinçli olarak eklenmedi (çift koşum riski).

---------------------------------------------------------------------------------------

Tek komut: pnpm validate
infrastructure/scripts/golden-path.mjs — Yeni bir “orchestrator” değil; tek dosyada rapor + manifest kontrolü.
infrastructure/test-surface.json — Hangi paketin gerçek test / bilinçli skip olduğunun kalıcı kaydı; package.json ile uyumsuzluk drift sayılır.
pnpm validate şunları yapar:

Workspace package.json dosyalarındaki test script’ini sınıflandırır (test-skip.mjs → skip; vitest/pytest/sui move test → gerçek).
Manifest ile karşılaştırır; eksik/fazla paket veya yüzey uyumsuzluğunda çıkış kodu 1.
Konsola tablo basar (paket / yüzey / runner / not).
İsteğe bağlı (Faz 2 TS hattı, Move yok):
pnpm validate -- --run-smoke → önce aynı rapor, ardından smoke:ts.

Entegrasyon
Yer	Değişiklik
package.json
"validate": "node infrastructure/scripts/golden-path.mjs"
Makefile
make validate → pnpm validate
.github/workflows/ci.yml
pnpm install sonrası pnpm validate (Python/Sui’dan önce, hızlı drift yakalama)
infrastructure/README.md
Tablo güncellendi (shared-types artık Vitest); golden path + yerel/CI parite notu
turbo.json
infrastructure/test-surface.json → globalDependencies (manifest değişince önbellek invalidasyonu)
Bakım kuralı
Bir pakette scripts.test değişince infrastructure/test-surface.json içindeki ilgili surface / runner / note alanlarını güncelleyin; aksi halde CI’da pnpm validate kırılır — böylece “gizli no-op” sürprizleri azalır.

Ek kök script veya ikinci bir koşum dosyası eklenmedi; tek yeni manifest + tek golden-path.mjs + mevcut pnpm validate girişi.