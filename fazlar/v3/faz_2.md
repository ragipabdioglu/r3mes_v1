Canonical contract decisions
Ana adapter kimliği: adapterDbId = PostgreSQL Adapter.id (cuid). Tüm REST path’lerdeki :id, kuyruk yükündeki adapterDbId ve “hangi adaptör?” sorusunun cevabı budur.
Türetilmiş: onChainAdapterId (Move u64 string), onChainObjectId (Sui object id), weightsCid / manifestCid (IPFS).
QA / webhook / kuyruk: adapterCid = benchmark edilen artefakt CID’si; kanonik olarak adapterCid === weightsCid.
Eski/çevresel: adapter_id (snake_case) = çoğu yerde adapterDbId ile aynı anlam; yeni kod adapterDbId kullanmalı.

Durum: Wire formatı AdapterStatusWire = Prisma enum string’leri (PENDING_REVIEW … DEPRECATED). Move tarafı MoveAdapterStatusU8 (0/1/2) ayrı katman; dönüşüm indexer/köprüde yapılır; istemci yalnızca AdapterStatusWire görür.

Matris: docs/api/INTEGRATION_CONTRACT.md içinde Chat (x-r3mes-wallet), adapter listeleme/detay/yükleme, QA webhook, user stake/balance/rewards için istek/yanıt özeti tablolar halinde sabitlendi. docs/backend_architecture.md üstüne “taslak vs kanon” uyarısı eklendi.

Skorlar: benchmarkScore = tek ürün özeti (0–100, QA sonrası). Ayrı bir rougeScore üst alanı yok; ROUGE vb. QaResultWebhookPayload.metrics içinde.

IPFS: weightsCid = birincil artefakt; manifestCid = ayrı pin; liste API’deki ipfsCid = weightsCid ?? manifestCid (yalnızca gösterim kısayolu).

Kod / doküman: packages/shared-types/src/canonical.ts eklendi; index.ts buna export veriyor. Köprü: INTEGRATION_CONTRACT.md → docs/api/INTEGRATION_CONTRACT.md. packages/shared-types/README.md güncellendi. Kök README.md Happy path 3. adımı Studio’nun safetensors + manifest akışıyla hizalandı.

Breaking / non-breaking migration notes
Değişiklik türü	Örnek	Etki
Non-breaking
metrics içine yeni anahtar; yeni opsiyonel query/header; yeni AdapterStatusWire değeri (istemci bilinmeyeni yok sayarsa)
Eski istemciler çalışmaya devam eder.
Breaking
id / adapterDbId kaldırma veya yeniden adlandırma; zorunlu QaResultWebhookPayload alanını kaldırma; AdapterStatusWire string’lerini değiştirme
Senkron istemci + backend + indexer güncellemesi gerekir.
Migration ilkesi
Yeni “ana kimlik” eklenmez; yeni bağlar her zaman adapterDbId üzerinden genişletilir.
—
BAĞIMLILIK: Backend/FE ajanları isteğe bağlı olarak AdapterStatusWire ve AdapterIdentity tiplerini doğrudan import edebilir; davranış değişikliği bu belgeye göre yapılmalıdır.

ENGEL: YOK.

SONRAKİ ADIM: İsteğe bağlı Zod şemaları (canonical ile aynı kurallar) ve OpenAPI tek dosyada §3 matrisine bağlanması.

---

Özet: Backend tarafı ORTAK sözleşmesiyle hizalanmış durumda; shared-types derlendi ve apps/backend-api içinde 16 test (integration contract dahil) tamamı geçti.

Yapılanlar (kanonik yüzey)
POST /v1/chat/completions
adapter_cid yoksa adapter_db_id / adapter_id / on_chain_adapter_id ile sahip cüzdanına göre Prisma’dan çözülüp upstream gövdeye yazılıyor; id alanları strip ediliyor (chatAdapterResolve.ts + chatProxy.ts).

Stake / claim
POST /v1/stake ve POST /v1/user/:wallet/rewards/claim 501 + NotImplementedOnChainRestResponse (code: "NOT_IMPLEMENTED"); claim’de path wallet ≠ doğrulanmış cüzdan → 403.

Adapter listesi
GET /v1/adapters yanıtı @r3mes/shared-types içindeki AdapterListResponse / AdapterListItem şekline (ör. benchmarkScore sayı veya null) sabitlendi.

Testler

src/chatAdapterResolve.test.ts — CID çözümü
src/integration.contract.test.ts — auth (401), chat proxy (fetch + Prisma mock), adapter list shape, stake/claim 501/403
Dokümantasyon
docs/api/INTEGRATION_CONTRACT.md güncel; apps/backend-api/README.md sözleşmeye referans veriyor.

Teknik not
packages/shared-types için npx tsc -p tsconfig.json çalıştırıldı; apiContract export’ları dist/’e düşüyor. Testlerde R3MES_DISABLE_RATE_LIMIT=1 ve ilgili skip env’leri kullanılıyor.

Frontend ve AI engine’e dokunulmadı; backend tek entegrasyon yüzeyi olarak kalacak şekilde kurgulandı. Başka bir endpoint veya sözleşme maddesini sıkılaştırmak istersen söylemen yeterli.

---

Özet aşağıda. Backend route dosyalarına dokunulmadı; zincir semantiği, indexer ve dokümantasyon güncellendi.

1. Event semantiği ↔ backend read model

Olay	Zincir alanları	Prisma / backend
Adapter*
adapter_id, object_id, ipfs_cid / onay-red
onChainAdapterId, onChainObjectId, weightsCid, status
Stake*
adapter_id, trainer, amount, deposit’te pool_object_id
StakePosition upsert / silme
UsageRecorded
pool_id, user, amount_mist
Prisma yok; aggregateRewardTotals doğrudan queryEvents (suiRewards.ts)
StakeWithdrawnEvent / StakeSlashedEvent alanları suiRewards.ts ile uyumlu (trainer, amount).

1. onChainAdapterId, object id, CID

adapter_id (u64): Protokol sıra numarası; Prisma’da onChainAdapterId.
object_id: Paylaşımlı Adapter nesnesinin Sui ID’si; Prisma’da onChainObjectId.
ipfs_cid: Ağırlık CID’si; Prisma’da weightsCid.
Kayıt sırasında üçü birlikte AdapterUploadedEvent ile gelir; onay/red olaylarında yalnızca adapter_id + object_id tekrarlanır.

1. Stake / “claim” ve zincir

Zincirde: deposit (yalnızca Pending), withdraw (Active), slash (Rejected + admin).
SUI havuzu: record_usage (OperatorCap) ve withdraw_rewards (OperatorCap); kullanıcıya otomatik R3MES/SUI “claim” yok.
GET /v1/user/:wallet/rewards RPC olaylarından özet üretir; POST .../rewards/claim backend’de stub — zincirle bire bir eşleşen bir talep akışı tanımlı değil (belgede netleştirildi).

1. Indexer ↔ Prisma kayıpları

UsageRecordedEvent: İşlenmiyor (tasarım: ödül özeti RPC’den); bilinçli ayrım.
reason_code: AdapterRejectedEvent ve StakeSlashedEvent içinde var, Prisma’da alan yok.
Checkpoint: Yalnızca adapter_registry + staking_pool; reward_pool modülü dinlenmiyor.
5. Test yüzeyi
Move: test_record_usage_aborts_when_paused, test_withdraw_rewards_reduces_vault eklendi; toplam 9 test geçiyor.
Indexer: eventHandlers.test.ts eklendi (adapter upload/approve/reject, stake deposit/withdraw/slash, bilinmeyen olay, benchmark kuyruğu); 10 vitest geçiyor.
Dokümantasyon
Yeni: docs/blockchain/ONCHAIN_READ_MODEL_AND_EVENTS.md
docs/blockchain_architecture.md içine bu dosyaya referans eklendi.

---

Özet: ai-engine tarafında çıkarım sözleşmesi tek alana indirildi, proxy hataları yapılandırıldı, testler ve README gerçek davranışla uyumlu hale getirildi.

1. Chat completion contract (schemas_openai.py)

adapter_cid zorunlu tek uzantı; adapter_id kaldırıldı.
adapter_cid önce trimleniyor, boş kalırsa doğrulama hatası (422).
Docstring: CID’nin ürün/zincir ile ortak tek kaynak olduğu belirtiliyor.
2. Ürün akışı uyumu
Doğrudan ai-engine çağrıları yalnızca adapter_cid kullanır.
DB / zincir kimliği çözümlemesi backend veya uygulama katmanında kalır; README’de bu ayrım tek cümleyle anlatıldı (backend koduna dokunulmadı).
3. Adapter yükleme / hot-swap hataları (proxy_service.py)
detail sözlüğü: stage, message, adapter_cid; gerekiyorsa upstream_status, upstream_url.
Aşamalar: llama_process, adapter_download, lora_hot_swap, upstream_completion.
HTTP: indirme / upstream çoğunlukla 502, bağlantı / llama yok 503 (tablo README’de).
4. Testler (tests/test_chat_completions.py)
Modül docstring: R3MES_SKIP_LLAMA, birim testi, proxy mock ile gerçek çıkarım yok.
test_chat_proxy_route_mocked: adapter_cid kullanıyor; isim “route + mock” ile net.
test_whitespace_only_adapter_cid_returns_422 eklendi.
5. README
İstek tablosu, örnek JSON, hata tablosu, lock ile sıralı LoRA, R3MES_SKIP_LLAMA açıklaması güncellendi.
python -m pytest -q ve ruff check geçti.

---

Özet: apps/dApp içinde API istemcileri backend INTEGRATION_CONTRACT ve mevcut Fastify rotalarıyla hizalandı; gereksiz tolerans ve yanıltıcı metinler kaldırıldı.

Yapılanlar
Adaptör listesi (lib/types/adapter.ts, lib/api/adapters.ts, lib/api/adapters-trainer.ts)

@r3mes/shared-types içindeki AdapterListItem / AdapterListResponse kullanılıyor.
Çoklu data/items/normalize katmanı kaldırıldı; sadece data[] + isAdapterListResponse.
Sıralama: benchmarkScore (0–100, dokümandaki kanonik skor).
fetchActiveAdaptersSorted() = GET /v1/adapters?status=ACTIVE.
Eğitmen listesi: GET /v1/adapters?limit=100 + ownerWallet filtresi.
Durum rozetleri (lib/types/adapter-status.ts)

Prisma AdapterStatus ile birebir: PENDING_REVIEW, ACTIVE, REJECTED, SLASHED, DEPRECATED.
Pazaryeri → chat (marketplace-list.tsx)

Link: /chat?adapter=&cid= (ipfsCid varsa) — hem DB id hem CID taşınıyor.
Chat (lib/api/chat-stream.ts, components/chat-screen.tsx)

Yalnızca getBackendUrl() + POST /v1/chat/completions.
model yalnızca NEXT_PUBLIC_CHAT_MODEL doluysa gönderiliyor (AI motoru URL’si UI’da yok).
x-r3mes-wallet kaldırıldı; doğrulama X-Wallet-Address ile.
Boş durum metni backend proxy’yi anlatıyor, FastAPI geçmiyor.
Stake / ödüller (lib/api/stake-api.ts + stake bileşenleri)

Stake: wallet, totalStakedNano, positions[] — başka uydurma alan yok.
Rewards: stakeWithdrawnBaseUnits, stakeSlashedBaseUnits, chatUsageFeesPaidMist, eventPagesScanned, source: "sui_events".
UI’da claimable/total/currency yok; 501 için formlarda ve rewards’ta sözleşme notu var.
Hata gövdeleri readErrorMessage ile JSON message okuyor.
Studio (studio-upload-panel.tsx, app/studio/page.tsx)

Backend’in gerçekten işlediği alanlar: weights (.safetensors), isteğe bağlı manifest, displayName, wallet.
.gguf ve adapter_config kaldırıldı (Fastify multipart’ta yok).
Gönderim, en az bir weights dosyasına bağlı.
Ortam (lib/env.ts, .env.example)

getAiEngineUrl kaldırıldı; yerine getOptionalChatModel().
.env.example: NEXT_PUBLIC_AI_ENGINE_URL kaldırıldı; NEXT_PUBLIC_CHAT_MODEL yorum satırı eklendi.
Bağımlılık notu (ORTAK / paket)
AdapterListItem / AdapterListResponse için @r3mes/shared-types import ediliyor; paket derlemesi (packages/shared-types dist) monorepo build’de güncel olmalı — shared-types paketini değiştirmedim, yalnızca tükettim.
Doğrulama
pnpm exec tsc --noEmit ( apps/dApp ) — temiz.
next build — derleme tamamlandı (build sırasında backend’e fetch denemesi olursa log’da ECONNREFUSED görülebilir; beklenen).

---

Özet aşağıda.

1. Wallet auth (replay, expiry, binding, cache)

Risk	Etki	Öneri
Replay: exp/iat var ama nonce yok; aynı başlıklar süre bitene kadar tekrar kullanılabilir
Çalınan isteklerle kimlik / chat tetikleme
Kısa TTL; isteğe bağlı jti + tek kullanımlık depo (dokümante)
Expiry: assertAuthTimingValid + skew
Düşük
Prod için R3MES_AUTH_* değerlerini sabitle
Binding: İsteğe bağlı address JSON’da header ile çakışırsa red
Düşük
İstemcide üretimde address zorunluluğu (opsiyonel)
Cache: Sunucu imza önbelleği yok; CDN yanlış yapılandırması
Teorik başlık sızıntısı
Cache-Control: private, no-store
2. R3MES_SKIP_* prod ayrımı
Yapılan: buildApp() başında assertNoInsecureSkipFlagsInProduction() — NODE_ENV=production iken R3MES_SKIP_WALLET_AUTH=1 veya R3MES_SKIP_CHAT_FEE=1 process başlamadan Error fırlatır.
Dosyalar: apps/backend-api/src/app.ts, apps/backend-api/src/skipFlags.test.ts, apps/backend-api/.env.example notu.

R3MES_DISABLE_RATE_LIMIT için aynı blok eklenmedi (staging yük testi ihtimali); checklist’te prod’da kapalı tutulması yazıyor.

1. Chat fee (kayıt ve hatalar)

Sıra: Önce zincir record_usage, sonra AI fetch. TX başarılı, upstream başarısızsa operatör maliyeti oluşur, kullanıcı yanıt alamayabilir — security/audit_wallet_chat_internal.md içinde anlatıldı.
402: Operatör SUI yetersiz veya zincir hatası — mevcut dallanma uygun; iyileştirme ürün/operasyon (log, idempotency).
4. İç webhook / rotalar
/v1/internal/qa-result: R3MES_QA_WEBHOOK_SECRET + ham gövde HMAC + timingSafeEqual — güçlü temel. Eksik: HMAC replay / çift teslim için jobId idempotency (dokümante).
Public GET’ler (adapters, stake read model): bilinçli; gizlilik gereksinimine göre değerlendirme notu eklendi.
5. Dokümantasyon ve test
security/audit_wallet_chat_internal.md — tam analiz, check-list, regression test önerileri.
apps/backend-api/src/skipFlags.test.ts — prod + skip bayrakları için 3 test.
Tüm testler geçti (19/19).

---

Özet: Eldeki handoff maddelerini tamamladım; aşağıda neyin değiştiği ve nasıl kullanacağınız var.

Kök scriptler (package.json)
pnpm bootstrap — Postgres + storage compose up -d, ardından pnpm db:migrate.
pnpm smoke — smoke:ts + smoke:contracts (sui move build ve sui move test).
pnpm smoke:ts — smoke:build + smoke:test (backend, dApp, indexer, ai-engine, qa-worker, bilinçli skip’ler).
Paket testleri
@r3mes/ai-engine: pytest + requirements.txt içinde pytest.
@r3mes/qa-worker: pytest.
@r3mes/dapp, shared-types, qa-sandbox: infrastructure/scripts/test-skip.mjs ile açık TESTS_DISABLED uyarısı.
start-all.sh
apps/dApp/.env.example → .env.local de kopyalanıyor (Next.js önceliği, Windows dahil).
CI
.github/workflows/ci.yml: Python 3.11 + pip (ai-engine + qa-worker), ardından infrastructure/scripts/install-sui-ci.sh (varsayılan SUI_RELEASE_TAG=mainnet-v1.61.2), böylece Move build/test ve pytest koşabiliyor.
Tam smoke workflow
.github/workflows/smoke.yml: Postgres servisi, DATABASE_URL, pnpm install, Python bağımlılıkları, Sui kurulumu, pnpm db:migrate, pnpm smoke. Tetikleyiciler: workflow_dispatch ve push (main/master/develop).
Diğer
infrastructure/scripts/install-sui-ci.sh: Linux CI için Sui CLI indirme + PATH.
Makefile: bootstrap ve smoke hedefleri.
infrastructure/README.md: smoke:contracts ve workflow’lar güncellendi.
Yerelde pnpm run smoke:ts çalıştırıldı ve başarılı tamamlandı. Tam pnpm smoke için makinede veya CI’da Sui CLI gerekir; yalnızca TS tarafı için pnpm run smoke:ts yeterli.

Yerel Python: smoke:test / turbo test ai-engine ve qa-worker için python -m pytest kullanır; bağımlılıklar yüklü değilse önce:

pip install -r apps/ai-engine/requirements.txt ve pip install -e "packages/qa-sandbox/worker[dev]" (veya proje içi .venv).