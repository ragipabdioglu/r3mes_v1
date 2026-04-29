1. Sistem entegrasyonu (Proxy → llama-server, streaming/JSON)
Gecikme (latency)

Her POST /v1/chat/completions için akış sırası: LoRA GGUF indirme (ensure_adapter_gguf) → /lora-adapters POST → upstream /v1/chat/completions. Önbellekte dosya varsa indirme atlanır; yoksa IPFS tam indirme + yeniden deneme döngüsü eklenir. Bu, P95/P99 gecikmeyi özellikle büyük adaptörlerde ciddi şekilde şişirir; FastAPI tarafında istek başına kuyruk veya SLA yok.
Streaming modunda yanıt gövdesi için iç AsyncClient + stream kullanılıyor; bağlantı istek başına açılıyor. Ek TCP/HTTP el sıkışma maliyeti var (küçük ama ölçülebilir).
httpx zaman aşımı: connect_timeout / read_timeout (varsayılan 30s / 600s) upstream için tanımlı; IPFS indirme ayrı http_download.download_with_retries ile yürür — iki aşamanın toplam süresi tek bir uçtan uca bütçe ile sınırlı değil.
Model çarpışması / eşzamanlılık

Kodda Python thread kilidi veya adapter bazlı mutex yok. lora_adapter_slot_id varsayılan 0 ve her istek aynı slota yazıyorsa, eşzamanlı istekler farklı CID’ler için aynı slotta üst üste lora-adapters çağırır; doğru davranış tamamen llama-server (C++) içi serileştirme ile belirlenir. Bu, mimari olarak ortak durum yarışı (race) riski taşır; Python proxy bunu görmezden gelir.
IPFS / zaman aşımı

İndirme tarafında kopmalarda tam yeniden deneme var; kısmi içerik / Content-Length uyumsuzluğu için ileri seviye doğrulama yok (sadece stream yazımı + isteğe bağlı SHA256 çekirdek için).
read_timeout=600 büyük dosyalarda yetersiz kalabilir veya tersine çok uzun askıda istek bırakabilir; ortam bazlı ayar şart, kodda sabit varsayılanlar risk.
Özet zafiyet: Sıralı ağır adımlar, slot başına koordinasyon eksikliği, tek süre sınırı olmayan uçtan uca gecikme — üretim yükü altında “Sıfır gecikme” iddiası ile çelişkili bir profil.

2. Hardcoded veriler
Evet — derinlemesine gömülü / güçlü varsayılanlar var:

Konum	Ne
r3mes_ai_engine/settings.py
ipfs_gateway varsayılan http://127.0.0.1:9080, llama_internal_host 127.0.0.1, llama_internal_port 8080, frozen_core_hf_url tam Hugging Face URL (microsoft/bitnet.../ggml-model-i2_s.gguf), frozen_gguf_filename ggml-model-i2_s.gguf, default_model_name bitnet-b1.58-gguf
r3mes_ai_engine/app.py
CORS için localhost / 127.0.0.1 (3000, 3001)
model_loader.py
IPFS gateway varsayılan 127.0.0.1:9080
packages/qa-sandbox/worker/.../settings.py
ipfs_gateway 9080, qa_llama_base_url 127.0.0.1:8080, backend_qa_webhook_url localhost:3000, Redis 127.0.0.1:6379
Bunların çoğu pydantic-settings ile ortam değişkeniyle override edilebilir; fakat varsayılanların üretim/cluster DNS, TLS ve servis keşfi ile uyumsuz kalması ve HF model yolunun repoda sabit görünmesi konfigürasyon borcu ve ortam karışması riski oluşturur.

3. Teknik borç ve şeffaflık
Python’da RAM’de tensör şişmesi

Mevcut ai-engine yolunda PyTorch / tensör tutulmuyor; proxy bayt akışı + HTTP ile sınırlı. Bellek baskısı esas olarak llama-server sürecinde (C++) oluşur; bu kod tabanında ölçülmedi, sınırlandırılmadı.
İstek sonrası Python tarafında zorunlu gc.collect() veya bellek tabanlı temizlik yok — bu senaryoda anlamlı da değil (büyük nesne tutulmuyor). Disk üzerinde artifacts/adapter_cache ve frozen sınırsız büyüme politikası kodda yok (TTL / kota yok).
QA sandbox — ROUGE “sentetik mi gerçek mi”

Üretim yolu: job_runner gerçekten register_lora_adapter + chat_completion_text ile llama HTTP üzerinden metin üretir; ROUGE/BLEU üretilen metin vs paket içi hidden_dataset.json referansı üzerinden hesaplanır. Yani skorlar sentetik metinle değil, model çıktısıyla (servis ayaktaysa) üretilir.
Test yolu: tests/test_job_runner.py içinde tamamlama ve indirme mock’lanabiliyor — bu birim testi için normal; üretim davranışı README + kod ile “gerçek llama” deniyor ama çalışma zamanı manifesti (ör. metrics içinde evaluation_mode: live|mock) yok; şeffaflık dökümü zayıf.
Sonuç (denetçi özeti)
Alan	Değerlendirme
Entegrasyon
Orta-yüksek risk: sıralı IPFS + LoRA kayıt + proxy, eşzamanlı isteklerde slot çakışması için uygulama katmanında koruma yok.
Hardcoded
Evet: 9080/8080/127.0.0.1, Microsoft HF GGUF yolu ve dosya adı kaynakta sabit varsayılan.
Teknik borç / şeffaflık
Python tensör şişmesi iddiasına uygun kod yok; asıl risk C++ süreç ve disk. QA canlı yolda gerçek metin; metriklerde mod ayrımı eksik.
ENGEL: Kod yazılmadı; rapor tarama ile sınırlıdır.
Not: apps/ai-engine/.venv içeriği denetim dışı bırakıldı.

---------------------------------------------------------------------------------------

1. Ağ izolasyonu (Docker)
Bulgu: “İzole ağ” kısmen var; “kapılı erişim” çoğunlukla yok — geliştirme için her şey host’a açılmış.

docker-compose.storage.yml

ipfs, redis, gateway aynı kullanıcı tanımlı ağda: storage → r3mes-storage-net. Konteynerler arası trafik teoride bu ağ üzerinden (ör. gateway → ipfs:8080, Lua → redis:6379).
Buna karşılık host’a geniş yüzey: 4001 (TCP/UDP), 5001, 6379, 9080 doğrudan localhost’a map’lenmiş. Bu, “sadece izinli kapılar” modeli değil; tüm yerel süreçler ve aynı makinedeki kötü niyetli yazılımlar bu portlara erişebilir.
ipfs için expose: "8080" var ama P2P ve API zaten ports ile dışarıda; izolasyon iddiası zayıflatılıyor.
internal: true, ayrı “sadece frontend” ağı, veya compose içinde yalnızca gateway’den IPFS’e erişim kısıtı tanımlı değil.
docker-compose.postgres.yml

Ayrı bir compose projesi (r3mes-postgres); storage ağı ile köprülenmiş tek bir networks: tanımı yok.
5432:5432 ile Postgres de global localhost’a sabitlenmiş.
Uygulama (Node) konteynerde değil host’ta çalışıyorsa zaten model 127.0.0.1 üzerinden — bu, Docker’ın iç ağ segmentasyonundan tamamen bağımsız, klasik “tek makine dev” düzeni.
Özet: İçeride (storage stack) servisler birbirini servis adıyla buluyor; üretim anlamında “izole segment” veya “minimum privilege ağ topolojisi” yok. Pratikte her şey localhost portlarına saçılmış; bu, denetim dilinde kabul edilebilir yerel dev, kabul edilemez prod varsayımı.

2. Hardcoded scriptler (Bash / Makefile / Windows)
start-all.sh

#!/usr/bin/env bash, set -euo pipefail, [[ ]], trap, arka plan & — POSIX olmayan bash özellikleri kullanılıyor.
WSL veya Git Bash olmadan saf Windows (cmd.exe / PowerShell) üzerinde doğrudan çalışması beklenemez; Makefile da açıkça bash çağırıyor.
sudo / root şifresi / şifrelenmiş satır yok; güvenlik açısından olumlu.
Makefile

SHELL := /bin/bash — Windows’ta bash yoksa make start-all kırılır (README’de Git Bash/WSL notu var; yine de “taşınabilir” değil).
Özet: Scriptler Linux/macOS + bash için uygun; Windows’ta WSL/Git Bash olmadan “çökme” riski yüksek — bu bir platform teknik borcu, “sert” gerçek.

3. Teknik borç: imaj boyutu, multi-stage, log bombası
infrastructure/docker/Dockerfile.base

Tek aşama: FROM node:20-alpine + tini + non-root kullanıcı. Alpine tabanı GB seviyesinde şişkinlik üretmez; multi-stage yok çünkü bu bir uygulama imajı değil, “ince taban” şablonu.
Risk: Türetilmiş servis Dockerfile’ları yazılmadan npm install / build katmanları eklenirse boyut büyür; şu anki tek dosya GB’ı tek başına aşmaz.
Log dosyaları (start-all.sh)

ai-engine için: >>"$LOG_FILE" ile sınırsız ekleme; rotation, logrotate, Docker logging driver limiti, boyut kotası yok.
Uzun süre çalışan dev oturumunda disk dolması teorik olarak mümkün — “saatli bomba” abartılı retorik olsa da SRE açısından gerçek bir eksik.
Prometheus uyarıları (r3mes-k8s-hpa-oom.rules.yml)

Dosya uyarı kuralı; “limit” veya “kota” uygulamaz, sadece gözlemler.
kube_pod_container_resource_requests{resource="cpu", unit="core"} gibi etiketler kuruluma göre kırılabilir (metrik şema uyumsuzluğu) — sessiz alarm boşluğu / yanlış negatif riski, teknik borç.
4. Genel not (denetçi dili)
Alan	Derece
Yerel dev rahatlığı
Yüksek
Ağ izolasyonu (prod beklentisi)
Düşük — port yayılımı, birleşik internal ağ yok
Windows uyumluluğu (bash’siz)
Zayıf
Gizli ayrıcalık / sudo
Yok (iyi)
Imaj şişkinliği (mevcut base)
Düşük risk
Log rotasyonu (start-all)
Yok — borç
Prometheus kuralları
İyi niyetli; küme metrikleriyle doğrulanmadan prod’a güvenilmemeli
Tek cümle: Bu yapı “herkes localhost’a bağlansın” geliştirme düzenine uygun; “servisler birbirini ağda minimum yüzeyle görsün” üretim modeline henüz uygun değil. Kod yazmadan rapor burada biter.

---------------------------------------------------------------------------------------

R3MES Sui Move — Mimari Denetim Özeti (Audit)
Kapsam: adapter_registry, r3mes_coin, staking_pool, reward_pool
Dışlama: TypeScript backend, deploy süreci, zincir dışı oracle mantığı.

1. Modüller arası bağımlılık ve yetki (capabilities)
1.1 RegistryAdminCap (adapter_registry + staking slash)
RegistryAdminCap store taşıyor: nesne başka adreslere transfer edilebilir; “tek doğru yönetici” garantisi yalnızca operasyonel disiplinle sağlanır, kontrat seviyesinde multisig / zaman kilidi / rol ayrımı yok.
Onay / red: approve_adapter ve reject_adapter yalnızca &RegistryAdminCap ile korunuyor; cap’e sahip herkes geçiş yapabilir. İmza doğrulaması Move içinde yok (beklenen: dışarıda PTB’yi imzalayan adres).
Slash: slash_stake_on_rejected aynı RegistryAdminCap tipini kullanıyor; ayrı bir “slasher” veya güvenlik konseyi capability’si yok. Cap ele geçerse hem registry hem slash tek anahtarda toplanır — tek nokta arızası (SPOF) riski yüksek.
1.2 record_usage (reward_pool) — kritik zayıf nokta

reward_pool.move
Lines 43-50
public fun record_usage(pool: &mut RewardPool, fee: Coin<SUI>, user: address) {
    assert!(coin::value(&fee) == USAGE_FEE_MIST, EWrongFeeAmount);
    coin::put(&mut pool.sui_vault, fee);
    event::emit(UsageRecordedEvent {
        pool_id: object::id(pool),
        user,
        amount_mist: USAGE_FEE_MIST,
    });
}
Hiçbir capability veya ctx.sender() kısıtı yok. Herhangi bir adres, 1 MIST ödeyerek user alanına istediği adresi yazabilir ve UsageRecordedEvent üretebilir.
Sonuç: indexer / ürün mantığı bu olaya güveniyorsa sahte kullanım kaydı, spam ve kimlik bağlama (user alanı) manipülasyonu mümkündür. “Backend’in operatör cüzdanı kullanması” zincirde zorunlu veya doğrulanabilir değil; güvenlik tamamen zincir dışı imza / filtre ile telafi edilmeye çalışılıyorsa bu, Move tarafında tasarım hatası olarak not edilir.
1.3 Stake / withdraw (eğitici tarafı)
deposit_stake ve withdraw_stake_after_approval adapter.creator == ctx.sender() ile bağlı; bu kısım tutarlı.
Slash tarafında RegistryAdminCap + status == REJECTED + tabloda stake varlığı kontrolü mantıksal olarak uyumlu; ancak reddin meşruiyeti (kim, hangi süreçle reddediyor) Move’da tanımlı değil.
1.4 burn_from_circulation (r3mes_coin)
public(package) — yalnızca aynı paket modülleri çağırabilir; staking_pool slash ile kullanımı kapsülleme açısından doğru.
Özet: Registry/slash capability modeli “tek kap” üzerinde yoğunlaşıyor; reward_pool ise zincir üzerinde neredeyse tamamen açık. İzinsiz çağrılara karşı “kusursuz” denemez.

2. Hardcode, adres ve “ölü kod”
2.1 Kalıcı sabitler (politika = kontrat değişmeden değişmez)
Sabit	Modül	Risk notu
GENESIS_TOTAL_SUPPLY, DECIMALS
r3mes_coin
Tokenomik tek seferde kilitlenir; yanlış parametre mainnet’te geri alınamaz (upgrade gerekir).
MIN_STAKE = 1_000
staking_pool
Piyasa / güvenlik için uygunluk Move içinde yönetilemez.
USAGE_FEE_MIST = 1
reward_pool
Backend ile uyum varsayımı; ücret değişimi için yeniden deploy / upgrade.
Sabit cüzdan adresi Move kaynaklarında yok (iyi).

2.2 Potansiyel “ölü” veya zayıf kullanım
adapter_registry::assert_creator paket içi hiçbir fonksiyon tarafından çağrılmıyor; harici istemci kullanmıyorsa kullanılmayan public API (bakım borcu).
#[test_only] yardımcıları üretim paketinde yer almaz; dead code değil, test artefaktı.
2.3 Ödül havuzu (SUI) çıkışı
RewardPool içinde SUI birikiyor; Move modülünde havuza giren fonları dağıtan veya çeken bir fonksiyon tanımlı değil. Bu, “ölü kod” değil; eksik işlevsellik — fonlar havuzda kilitli kalır (kurtarma için upgrade veya yeni modül gerekir).
3. Teknik borç: upgrade, immutable, durdurma (pause)
3.1 UpgradeCap ve esneklik
Bu kaynaklarda UpgradeCap yönetimi yok; Sui publish sonrası UpgradeCap zincir üstü ayrı bir nesne olarak oluşur. Paket yükseltilebilir mi? sorusunun cevabı Move dosyalarında değil, o nesneyi kimin tuttuğunda (cüzdan, multisig, kayıp mı).
Kodda immutable paket veya “sadece görüntüle” kilidi yok; operasyonel risk yüksek: anahtar kaybı = upgrade imkansız veya çalınması = keyfi upgrade.
3.2 Pause / acil durum
Hiçbir modülde global pause, RewardPool dondurma, registry’yi kilitleme veya record_usage’ı durdurma yok. “Panik butonu” yazılmamış, atlanmış sayılır.
3.3 Hata kodları
Farklı modüllerde aynı sayısal abort kodları (ör. 0, 1) kullanılıyor; istemci / indexer için ayırt edilebilirlik düşük (bakım / gözlem borcu).
4. Sonuç derecelendirmesi (özet)
Alan	Değerlendirme
Trainer stake / withdraw kontrolleri
Makul (sender + durum).
Slash + burn_from_circulation paket içi sınırı
İyi.
Admin cap tekleşmesi
Zayıf (SPOF).
record_usage
Kritik: yetkisiz, sahte user olayı üretimi.
Pause / acil durum
Yok.
Upgrade
Kaynak kodda tanımsız; tamamen operasyonel UpgradeCap yönetimine bağlı.
Havuzdan SUI çıkarma
Tanımsız (kilitli likidite riski).
Denetçi notu: Bu haliyle “kurşun geçirmez” iddiası reward_pool ve operasyonel admin cap modeli için desteklenmez. Mainnet öncesi en azından record_usage için zincir üstü yetkilendirme (ör. dedicated capability, imzalı payload veya güvenilir adres listesi) ve acil durum / fon çıkışı tasarımı ayrı bir güvenlik çalışması konusu olmalıdır.

TAMAMLANDI: packages/sui-contracts dört modülü tarandı; yetki akışları, hardcode’lar, dead API, upgrade/pause durumu analiz edildi; kod yazılmadı.

BAĞIMLILIK: Ürün ve güvenlik ekibi için aksiyon maddeleri (özellikle record_usage ve havuz çıkışı) ayrı tasarlanmalıdır.

ENGEL: YOK (analiz tamamlandı).

SONRAKİ ADIM ÖNERİSİ: Önce record_usage tehdit modeli ve düzeltme seçenekleri için kısa bir ADR; ardından formal veya fuzz test planı (Move + entegrasyon).

---------------------------------------------------------------------------------------

3. Teknik borç (özet)
Prisma

Adapter üzerinde weightsCid / manifestCid için ayrı index yok; internalQa OR ile arıyor — büyük tabloda tam tarama maliyeti.
AiQuery için idempotencyKey unique var; yoğun yazma için partitioning veya arşiv stratejisi yok (dokümante edilmemiş borç).
IndexerCheckpoint bu pakette; indeksleyici ayrı süreç — tutarlılık için operasyonel izleme eksik.
Fastify

@fastify/rate-limit veya eşdeğeri yok — kötüye kullanım ve imza doğrulama maliyeti için genel tıkanma riski.
bodyLimit çok yüksek; multipart ile birleşince DoS yüzeyi geniş.
Async / bellek

Çok sayıda eşzamanlı chat stream’i veya büyük multipart upload tek worker belleğini zorlar; fetch timeout/abort yokluğu asılı istek birikimine yol açabilir.
jobProducer: BullMQ ve liste köprüsü için ayrı Redis bağlantıları; süreç düzgün kapanmazsa bağlantı sızıntısı (özellikle test/tekrarlayan başlatmalarda).
Güvenlik borcu

walletAuth ile korunan uçlar iyi; ancak iç QA uçu ve olası SSRF (AI engine URL env’e güvenilir kaynaktan gelirse) ayrıca değerlendirilmeli.
Kısa yanıt: LPUSH mirroring “kalıcı hasar” mı?
Hayır: Veritabanı şemasına veya Prisma’ya kalıcı bir bozulma yazılmıyor. Risk; çift işleme, iki worker’ın aynı işi farklı varsayımlarla işlemesi ve Redis listesi ile BullMQ durumunun farklılaşması. Kalıcı hasar, iş kuralları idempotent değilse iş mantığı ve maliyet tarafında ortaya çıkar.

TAMAMLANDI: apps/backend-api ve ilgili shared-types / kuyruk tipleri taranarak multipart, AI proxy, Sui operatör akışı, BullMQ+Redis köprüsü, hardcode’lar ve teknik borç maddeleri çıkarıldı; kod değişikliği yapılmadı.

BAĞIMLILIK: Orchestrator / Yönetici: önceliklendirme; Frontend: imza ve multipart sözleşmesi; AI / QA: tek tüketici modeli ve iç webhook gizli anahtarı.

ENGEL: YOK (denetim salt okunur).

SONRAKİ ADIM ÖNERİSİ: Üretimde R3MES_* env zorunluluğu, iç webhook için paylaşılan secret, fetch timeout’ları, rate limit ve CHAT_FEE_MIST/buffer için env veya konfig tablosu — öncelik sırası risk kaydına bağlanmalı.

---------------------------------------------------------------------------------------

1. Bağlantı sağlamlığı (cüzdan ↔ imza ↔ API)
Genel el sıkışması

İmza → HTTP: ensureAuthHeaders() imzayı X-Signature, X-Message, X-Wallet-Address ile taşıyor; chat, studio yükleme, stake/claim bu modelle uyumlu. Sunucunun bu başlıkları ve gövdeyi birlikte doğrulaması frontend dışında bir sözleşme; istemci tarafında “sağlam” sayılır, backend doğrulaması olmadan güvenlik iddiası yok.
Önbellek: İmza TTL’i localStorage ile tutuluyor; süre dolmadan tekrar imza yok. Bu, UX için iyi; sunucu reddederse (imza geçersiz, saat kayması, politik değişiklik) istemcide otomatik forceRefresh yok — kullanıcı hata görür, manuel veya yeni oturum gerekir.
Hata ve gecikme davranışı

500 / !res.ok: Chat akışında streamChatCompletions gövdeyi okuyup Error fırlatıyor; ChatScreen yakalayıp setError ve setMessages(history) ile geri alıyor, streaming finally ile kapanıyor. Tam “çökme” yok, fakat genel bir “sunucu şu an yanıt veremiyor” ayrımı yok (ham metin veya status kodu kullanıcıya göre karmaşık kalabilir).
Timeout: fetch çağrılarında AbortSignal / süre sınırı yok. Tarayıcı veya ağ “asılı” kalırsa UI teorik olarak beklemede kalır; özellikle streaming uzun süre açık kalabilir, iptal butonu veya abort yok.
Streaming sırasında hata: Okuma döngüsünde ağ kopması catch’e düşer; yine kısmi assistant mesajı ve hata metni birlikte görülebilir — bu “zarif” sayılabilir ama yeniden deneme / retry yok.
Ana sayfa pazaryeri: Sunucu bileşeninde fetch hata verirse liste bileşeni hata kutusu gösteriyor; SSG/ISR ile build zamanı backend kapalıysa sayfa “hata durumu” ile statik üretilebilir (kullanıcı yenileyene kadar “kötü” önbellek hissi).
Özet: Bağlantı modeli tutarlı; 500 için çökme yok, ama timeout, iptal, retry ve sunucu reddinde imza yenileme zayıf. UX “kitlenme” riski düşük değil; ağır beklemeler ve uzun stream senaryolarında özellikle.

2. Hardcoded / sabit değerler ve “magic string”
Bilinçli merkezileştirme (lib/env.ts)

NEXT_PUBLIC_BACKEND_URL / NEXT_PUBLIC_AI_ENGINE_URL yoksa http://localhost:3000 ve http://localhost:8000 — bu, geliştirme için documented fallback; üretimde .env zorunlu kabul edilmeli.
Yapılandırma dışı sabitler

package.json: next dev / next start için -p 3001 doğrudan yazılmış; Next varsayılanı 3000 değil — bilinçli ama env ile yönetilmiyor.
lib/api/chat-stream.ts: Varsayılan model "r3mes-bitnet" — backend sözleşmesine göre NEXT_PUBLIC_* veya prop ile taşınabilirdi.
lib/api/wallet-auth-message.ts: Mesaj öneki R3MES Auth: + Date.now() — protokol sabiti; versiyonlama / i18n yok.
UI metinleri: marketplace-list.tsx içinde kullanıcıya gösterilen metinde http://localhost:3000 geçiyor — bu, çalışma zamanı URL’si ile senkron olmayan sabit bir örnek (farklı port/host’ta yanıltıcı).
Tailwind tailwind.config.ts: r3mes.* renk isimleri — tasarım token’ı; sorun değil, ama ürün metinleri / API path’leri ile karıştırılmamalı.
“Sahte token ID”

Kaynakta sabit bir R3MES Move coin type ID görünmüyor; NEXT_PUBLIC_R3MES_COIN_TYPE ile geliyor. metaQuery / balanceQuery için coinType env yokken undefined ile RPC’ye gidiliyor — bu, SDK’nın varsayılan SUI davranışına güvenmek anlamına gelebilir; bu da örtük bir varsayılan (belgeye bağlı).
Özet: Kritik URL’ler çoğunlukla env altında; model adı, imza öneki, marketplace hata metnindeki localhost, dev portu ve varsayılan sembol/metinler hâlâ dağılmış magic string olarak duruyor.

3. Teknik borç (tech debt)
ESLint / build

next.config.mjs: eslint.ignoreDuringBuilds: true — production build’de lint fiilen kapalı; regresyonlar CI’da next lint koşulmadıkça kaçar.
Sürüm uyumsuzluğu: eslint-config-next@14 ile monorepo ESLint 9 birlikte peer uyarıları üretir (daha önce raporlanan durum); flat config / Next 15+ veya ESLint 8 pin ile çözülmeden teknik borç olarak kalır.
Node / paket ekosistemi

Monorepo engines.node: >=20.10.0; @mysten/sui paketinde engines ≥22 olabilir — resmi destek matrisi ile çelişme riski (şu an build geçse bile runtime/destek politikası borcu).
React performans / yeniden render

Chat: Stream sırasında her token’da setMessages tam liste kopyasıyla — O(n) state güncellemesi, uzun cevaplarda gereksiz yeniden render ve ana iş parçacığı yükü.
Framer Motion: Liste/kartlarda layout / animasyon — veri sık güncellenirken maliyet katmanı.
StakeDashboard / AdapterStatusBoard: useEffect + fetch ile makul; stale closure riski düşük ama yenile dışında otomatik refetch yok.
Diğer

test script’i: process.exit(0) — gerçek test yok.
API path’leri (/v1/stake, /v1/chain/stake/...) kodda dağınık — tek OpenAPI client yok; değişiklik maliyeti yüksek.
Güvenlik / gizlilik: .env.local repoda olmamalı (.gitignore ile); denetimde workspace’te görünmüş olabilir — repo politikası borcu.
Kısa sonuç tablosu
Alan	Değerlendirme
Cüzdan + imza + fetch uyumu
Orta–iyi; backend doğrulaması şart
500 / ağ hatası UI
Çoğunlukla yakalanıyor; timeout/abort zayıf
Streaming UX
İptal yok, yüksek re-render
Hardcoded localhost
env fallback + UI metni + dev port
ESLint
Build’de kapalı
Test
Yok
Bu rapor kod yazmadan yapılmış mimari denetimdir; üretim öncesi timeout/abort policy, imza yenileme stratejisi, lint’i CI’da zorunlu kılma ve chat state güncellemesini optimizasyon öncelikli adaylardır.