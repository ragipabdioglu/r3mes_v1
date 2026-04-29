Özet
Faz 5’te ana hedef, bilinçli 501 yüzeylerin kaderini netleştirmek: gerçek implementasyon mu olacak, kalıcı olarak ürün dışı mı kalacak?

Yapılanlar
- onChainRestSurface, ApiErrorBody, contract guard ve integration test zemini hazır.
- Stake/claim yüzeyleri dürüst biçimde 501 ile sınırlandırılmış durumda.

Açıklar
- Stake ve kullanıcı aksiyonları için gerçek backend orkestrasyonu gerekiyorsa tamamlanmalı.
- Gerekmiyorsa endpoint yüzeyi azaltılmalı veya ürün dışı kararı netleştirilmeli.
- Runtime schema guard’lar kritik route’larda tutarlı biçimde kullanılmalı.
- Başarı/hata gövdeleri son ürün davranışına göre son kez sadeleştirilmeli.

Bağımlılık
- BLOCKCHAIN ürün/zincir yüzeyi
- ORTAK contract güncellemesi
- GÜVENLİK idempotency/replay kararları

Engel
- 501’yi sonsuz backlog gibi taşımak.
- Zincirde olmayan davranışı backend’de simüle etmek.
- Frontend için özel-case alan üretmek.

Sonraki Adım
- Her 501 yüzeyi için tek tek karar çıkar: implement et / kaldır / bilinçli koru.
- Gerçeklenen yüzeyler için integration contract + tests + README birlikte güncellensin.
- Başarı kriteri: backend’de “yarım feature” kalmasın.

---------------------------------------------------------------------------------------------

ADR-002 — §11 ve §12 eklendi
§11 — Faz 5 uygulama matrisi: Her satır için Uygulandı / Gerekmedi / Backlog ile kapanış:

Claim tanımı, stake ↔ Move eşlemesi → Uygulandı (belge + mevcut modüller; ek Move yok).
Genel “claim” entry, Faz 5’te yeni reward yüzeyi, reward_pool indexer → Gerekmedi (kasıtlı; RPC yeterli).
reason_code Prisma’da tutma, UI/API metin hizası → Backlog (BACKEND/ORTAK).
Özet cümle (§11): Mevcut zincir yüzeyi ADR-002 ile uyumlu ve Faz 5 için yeterli; ek Move veya indexer zorunlu değil.

§12 — Dar blockchain PR kapsamı: Bu turdaki iş = matris + README netliği; gereksiz Move PR yok.

README düzeltmeleri (belirsizliği gidermek için)
packages/sui-contracts/README.md: Tüm olaylar “indexer” altında toplanmıyordu; indexer’a girenler ile UsageRecordedEvent / RPC ayrımı yazıldı, ADR-002’ye link verildi.
packages/sui-indexer/README.md: reward_pool’un dinlenmediği ve kullanım ücreti özetinin backend RPC ile olduğu tek cümleyle sabitlendi.
Başarı kriteri: Backend/ORTAK için “hangi veri Prisma, hangisi RPC?” sorusu artık ADR-002 §9–§11 + ONCHAIN_READ_MODEL + paket README’leriyle tek kaynaktan okunabilir; zincir tarafında Faz 5’te yapılması zorunlu ek iş yok olarak kapatıldı. Kalan işler metin/şema backlog’unda.

---------------------------------------------------------------------------------------------

Faz 5 kapanış senkronu (ORTAK)
Özetlediğiniz hedefe göre dört artefakt arasında kalan boşluğu kapattım: OpenAPI, runtime’da zaten var olan §3.6 bilinçli 501 yüzeylerini tanımlamıyordu; bu da “kısmi doküman” riski yaratıyordu.

Yapılanlar
docs/api/openapi.contract.yaml

POST /v1/stake ve POST /v1/user/{wallet}/rewards/claim eklendi; yanıt 501 + NotImplementedOnChainRestResponse.
components.schemas.NotImplementedOnChainRestResponse eklendi (Zod / apiContract ile aynı yüzey dizisi).
Açıklamada walletAuthPreHandler, 401 / 403 / 400 sırasına kısa referans.
docs/api/INTEGRATION_CONTRACT.md

§3.3 LoRA: Gerçek akışa uygun auth satırı (X-Signature / X-Message / X-Wallet-Address, R3MES_SKIP_WALLET_AUTH); form wallet artık “önerilir” yerine isteğe bağlı, kimlik başlıktan diye net.
§3.5 Chat: “Faz 8.3” kaldırıldı; gerçek başlık ve mesaj JSON (exp/iat) anlatımı.
§3.6 POST satırları: 501 + gövde şeması, 401 (imza yok), claim için 400/403 ile uyumlu.
§8 tablo: OpenAPI satırına §3.6 501 kapsamı; Faz 5 notu (501 taahhüdü / 200 = breaking zinciri).
docs/api/FAZ3_CONTRACT_GOVERNANCE.md

Başlık Faz 3–5; Faz 5 için OpenAPI’de 501 yüzeylerinin drift olmaması kuralı.
INTEGRATION_CONTRACT.md (kök)

Faz 4–5 ve stake/claim referansı güncellendi.
packages/shared-types/test/contractRegression.test.ts

Claim yüzeyi için POST /v1/user/:wallet/rewards/claim parse testi (stake ile simetri).
Test: pnpm run test (packages/shared-types) — 11/11 geçti.

Başarı ölçütüne göre durum
Katman	Durum
Runtime (Fastify + onChainRestSurface)
Zaten NotImplementedOnChainRestResponse + 501
shared-types (Zod + tipler)
Değişmedi; OpenAPI ile uyumlu
Docs
Auth ve 501 gövdesi runtime ile hizalı
OpenAPI
Artık §3.6 501 yüzeylerini de kapsıyor
Tests
Her iki surface literal’ı doğrulanıyor
Yeni ürün teorisi yok; sadece mevcut davranışın kanona ve OpenAPI’ye işlenmesi.

BLOCKCHAIN/BACKEND ileride 501 → 200 veya uç kaldırma yaparsa, sizin §3.6’daki dörtlü tur + §7 breaking satırları aynen geçerli kalır.

---------------------------------------------------------------------------------------------

Faz 5 kapsamında yapılanlarin özeti: yeni API alanı veya fallback yok; tüm ana akışlarda durum + net aksiyon aynı ürün dilinde toplandı.

Merkez metinler (lib/ui/product-copy.ts)
loadingLabel — Tüm yükleme / bekleme durumları (stake kartları, ödül, studio listesi, gönder düğmeleri).
journey — Zincirde işlem, sayfa yenileme, yükleme sonrası liste yenileme, boş studio listesi için tek cümlelik sonraki adım.
mutationCompleted — Başarılı stake/claim sonrası: özetin güncellendiği açıkça söyleniyor.
marketplace.emptyLine + studioLinkLabel — Boş pazaryeri → Studio’ya tıklanabilir yönlendirme.
chat — Adaptör eksik uyarısı Pazaryeri linki ile; boş thread; “Yanıt hazırlanıyor…”; hata satırına errorHint eklendi.
walletConnectForChatAction — Gönder’e basılınca cüzdan yoksa tek net talimat.
HTTP / geri bildirim (lib/ui/http-messages.ts)
isNotImplementedResponse — 501 / NOT_IMPLEMENTED ayırtı için (uyarı vs hata).
Genel hata cümlesi sadeleştirildi (ham status kodu kullanıcıya zorunlu değil).
Ekran bazında
Alan	Ne değişti
Stake dashboard
Toast yerine başarı (yeşil) / uyarı (amber) / hata (kırmızı) + Kapat; 501 → uyarı tonu.
Stake / ödül kartları
aria-busy, metin yükleme; hata altında journey.refreshPage.
Stake form
Tek mesaj: journey.stakeOnChain + deneme düğümü.
Ödül paneli
Kısa özet satırı; alt not journey.rewardsOnChain.
Sohbet
Adaptör uyarısında Pazaryeri linki; boş asistan balonunda akış göstergesi; hata ipucu ile birlikte.
Pazaryeri
Boş liste → Studio’da model yükleyin linki.
Studio
Boş liste → yükleme ile başlama; başarı kutusunda uploadThenRefreshList; cüzdan uyarısı connectWalletToUpload.
Chat sayfası
Suspense fallback → loadingLabel.
pnpm exec tsc --noEmit ve next build başarılı.

Journey kontrol listesi (manuel): cüzdan bağla → pazaryerinden modele tıkla → sohbette mesaj gönder → stake sayfasında özet + (varsa) deneme stake/claim → Studio’da yükle → listede Yenile. Her adımda kullanıcı ne oldu / ne yapmalıyı ekrandaki kısa metinlerle takip edebilmeli; backend davranışı ORTAK sözleşmeyle değişince yalnızca http-messages ve product-copy üzerinden ince ayar yeterli olur.

---------------------------------------------------------------------------------------------

Faz 5 özeti
1. Wallet replay — jti (uygulandı)
Prisma: WalletAuthJti (jti PK, expiresAt, index).
Migration: apps/backend-api/prisma/migrations/20260410100000_wallet_auth_jti/.
Kod: lib/walletAuthJti.ts (consumeWalletAuthJti, isValidJtiFormat), walletAuth.ts içinde parseOptionalJti + R3MES_REQUIRE_WALLET_JTI=1 iken zorunluluk ve DB tüketimi.
Önemli: Tüketim yalnızca R3MES_REQUIRE_WALLET_JTI=1 olduğunda; aksi halde önbelleğe alınmış imzalar bozulmaz.
Hatalar: JTI_REQUIRED, INVALID_JTI, JTI_REPLAY.
2. dApp hizalaması (hafif)
NEXT_PUBLIC_R3MES_REQUIRE_WALLET_JTI=1 → buildR3mesAuthMessage içine jti: crypto.randomUUID(), useR3mesWalletAuth bu modda önbellek kullanmaz.
lib/env.ts: getWalletAuthRequireJti().
3. Rate limit yapılandırması
R3MES_RATE_LIMIT_MAX, R3MES_RATE_LIMIT_WINDOW (app.ts).
4. Runbook
security/runbook_abuse_faz5.md — env tabloları, abuse sırası, yeni uç kontrol listesi.
5. Dokümantasyon
security/design_replay_idempotency_faz3.md, security/audit_wallet_chat_internal.md, apps/backend-api/README.md, .env.example, apps/dApp/.env.example.
6. Testler
walletAuthJti.test.ts, walletAuth.test.ts güncellendi; test:security-regression listesine eklendi.
Deploy: pnpm db:migrate (yeni tablo).

Üretim önerisi: Aynı anda R3MES_REQUIRE_WALLET_JTI=1 ve NEXT_PUBLIC_R3MES_REQUIRE_WALLET_JTI=1 — replay kapanır; kullanıcı başına imza sıklığı artar (önbellek kapalı).

---------------------------------------------------------------------------------------------

Faz 5 için yeni çıkarım özelliği eklenmedi; ürün koşullarında güvenilirlik ve tekrarlanabilir teşhis için runbook, canlı smoke script ve stream/non-stream hata gövdesi paritesi testleri eklendi.

1. docs/RUNBOOK.md (kısa ürün runbook’u)
Backend ↔ ai-engine sorumluluk ayrımı (kimlik çözümleme backend’de).
Önkoşullar (llama, gateway, CID).
Doğrudan ai-engine smoke (scripts/smoke_ai_engine.py) ve backend zinciriyle deneme adımları.
detail triage tablosu (stage / category / cause).
Stream vs non-stream parite tablosu (başarı başlıkları vs hata gövdesi).
Yük/önbellek: log alanları, ek telemetry yok.
İlgili test ve script referansları.
2. scripts/smoke_ai_engine.py
GET /health, ardından POST /v1/chat/completions (non-stream).
Ortam: R3MES_SMOKE_BASE_URL, R3MES_SMOKE_ADAPTER_CID (veya --adapter-cid), isteğe bağlı R3MES_SMOKE_CONCURRENT (eşzamanlı isteklerle lock/X-R3MES-Lock-Wait-Ms gözlemi).
Çıkış kodları: 0 başarı, 1 hata, 2 CID yok (chat atlanır — sunucu ayaktaysa).
Hata gövdesinden stage, category, cause özetini yazdırır.
3. tests/test_error_shape_parity.py
Aynı hata koşulunda stream ve non-stream için detail anahtarları ve stage / category / cause (ve upstream için upstream_status) aynı kalıyor.
Stream tarafında hata, StreamingResponse döndükten sonra akış tüketilirken oluştuğu için _drain_or_raise ile doğrulanıyor — bu, ürün davranışıyla uyumlu ve tekrarlanabilir.
4. README.md
Runbook ve smoke script’e kısa bağlantı.
pytest tests/ → 18 passed, ruff temiz.

---------------------------------------------------------------------------------------------

Faz 5 için yeni çıkarım özelliği eklenmedi; ürün koşullarında güvenilirlik ve tekrarlanabilir teşhis için runbook, canlı smoke script ve stream/non-stream hata gövdesi paritesi testleri eklendi.

1. docs/RUNBOOK.md (kısa ürün runbook’u)
Backend ↔ ai-engine sorumluluk ayrımı (kimlik çözümleme backend’de).
Önkoşullar (llama, gateway, CID).
Doğrudan ai-engine smoke (scripts/smoke_ai_engine.py) ve backend zinciriyle deneme adımları.
detail triage tablosu (stage / category / cause).
Stream vs non-stream parite tablosu (başarı başlıkları vs hata gövdesi).
Yük/önbellek: log alanları, ek telemetry yok.
İlgili test ve script referansları.
2. scripts/smoke_ai_engine.py
GET /health, ardından POST /v1/chat/completions (non-stream).
Ortam: R3MES_SMOKE_BASE_URL, R3MES_SMOKE_ADAPTER_CID (veya --adapter-cid), isteğe bağlı R3MES_SMOKE_CONCURRENT (eşzamanlı isteklerle lock/X-R3MES-Lock-Wait-Ms gözlemi).
Çıkış kodları: 0 başarı, 1 hata, 2 CID yok (chat atlanır — sunucu ayaktaysa).
Hata gövdesinden stage, category, cause özetini yazdırır.
3. tests/test_error_shape_parity.py
Aynı hata koşulunda stream ve non-stream için detail anahtarları ve stage / category / cause (ve upstream için upstream_status) aynı kalıyor.
Stream tarafında hata, StreamingResponse döndükten sonra akış tüketilirken oluştuğu için _drain_or_raise ile doğrulanıyor — bu, ürün davranışıyla uyumlu ve tekrarlanabilir.
4. README.md
Runbook ve smoke script’e kısa bağlantı.
pytest tests/ → 18 passed, ruff temiz.

---------------------------------------------------------------------------------------------

Özet: Faz 5 için yeni bir orchestrator script yok; kökte iki komut satırı, manifest _meta, README’de teslimat kapısı tanımı ve CI süresini azaltan smoke.yml tetikleyicisi güncellemesi yapıldı.

Teslimat kapısı (release sinyali)
Komut	İçerik
pnpm release:check
pnpm validate && pnpm smoke:ts — manifest drift + TS smoke (backend, dApp, indexer, ai-engine, qa-worker, …); Sui yok → yerelde de güvenilir.
pnpm release:check:full
pnpm validate && pnpm smoke — ayrıca sui-contracts build/test; Sui CLI gerekir.
Makefile: make release-check / make release-check-full.

Başarı kriteri (release kararı): validate UYUMLU ve release:check (veya sözleşme değiştiyse release:check:full) çıkış kodu 0 → yeşil sinyal; drift veya kırmızı smoke, sürümü bloklayan durum olarak kabul edilir. PR tarafında zorunlu taban: ci.yml yeşil (lint/build/test + validate).

Smoke kapsamı (feature’larla güncelleme)
infrastructure/test-surface.json → _meta.releaseGate: release:check / full açıklaması, smoke filtresinin kök package.json (smoke:build / smoke:test) olduğu, E2E’nin kapıda olmadığı notu.
infrastructure/README.md → “Teslimat kapısı (Faz 5)” tablosu: PR / önerilen / tam / opsiyonel CI; smoke filtresi ve E2E değerlendirmesi kısa.
CI süresi (kontrolsüz büyüme engeli)
smoke.yml: push → yalnızca main + workflow_dispatch. develop/master her push’ta tam smoke çalıştırmaz; geliştirme hattı ci.yml ile kalır, tam zincir main merge veya elle çalıştırılır.
E2E; şimdilik kapı dışı — eklendiğinde README’deki E2E paragrafı güncellenir; ağır E2E’yi yalnızca gerekli dallarda / manuel tetikleme önerisi yazıldı.