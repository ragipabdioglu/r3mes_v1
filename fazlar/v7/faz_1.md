Sonuç raporu
Soru	Cevap
Hangi flag eklendi?
R3MES_DEV_BYPASS_QA=1 — yalnızca NODE_ENV=development veya test iken etkin. staging / diğer değerlerde kapalı.
Hangi dosyalar değişti?
apps/backend-api/src/lib/devQaBypass.ts (yeni), apps/backend-api/src/routes/adapters.ts, apps/backend-api/src/app.ts, apps/backend-api/src/skipFlags.test.ts, apps/backend-api/src/devQaBypass.test.ts (yeni), apps/backend-api/.env.example, packages/shared-types/src/payloadTypes.ts, packages/shared-types/src/schemas.ts, packages/shared-types/test/contractRegression.test.ts
Varsayılan akış bozuldu mu?
Hayır. Flag yok veya kapalıyken: önceki gibi PENDING_REVIEW + enqueueBenchmarkJob. Flag açıkken: ACTIVE, benchmarkScore=null, domainTags: ["dev_bypass_qa"], kuyruk çağrılmıyor (worker etkilenmiyor).
Dev’de marketplace + chat yolu
Evet: GET /v1/adapters ACTIVE + domainTags içinde dev_bypass_qa; chat proxy ACTIVE gerektirir — uyumlu. Yanıtta devQaBypassApplied: true. Log: e2eLifecycle: upload_accepted_dev_bypass_qa.
Üretim
NODE_ENV=production + R3MES_DEV_BYPASS_QA=1 → uygulama başlamaz (assertNoInsecureSkipFlagsInProduction).
Teknik notlar

benchmarkJobId bypass modunda sabit: dev-bypass-qa (gerçek kuyruk yok; verify:lifecycle-chain bu job için receipt beklemez — beklenen).
L2 / resmi kanıt: Bu yol ürün QA zincirini atlar; kanonik PASS yalnızca tam worker + webhook ile.
Kullanım: .env içinde R3MES_DEV_BYPASS_QA=1, NODE_ENV=development, ardından normal POST /v1/adapters upload.

-----------

Ne yaptık
r3mes:dev-test (R3MES_DEV_TEST_DOMAIN_TAG) — r3mes-fe-contract.ts içinde; dev/QA’da ACTIVE yapılan test adaptörlerinin domainTags dizisinde bu etiket olmalı (gerçek benchmark onayı gibi görünmesin diye).

isDevTestAdapter — etiket veya isteğe bağlı NEXT_PUBLIC_R3MES_DEV_TEST_ADAPTER_IDS (virgülle ID listesi).

DevTestPill — küçük amber “dev test” rozeti (title: benchmark onayı yok).

Pazaryeri — dev kayıtta isim yanında pill; skor kutusu gri ve Skor — (mor “benchmark” vurgusu yok).

Studio — model satırında aynı pill.

Chat — adaptör ID doluyken GET /v1/adapters/:id ile etiketler okunuyor; dev ise pill + kısa cümle (product-copy: Yerel test kaydı; benchmark onayı yok.).

.env.example — opsiyonel ID listesi dokümante edildi.

Sonuç raporu
Soru	Cevap
Test adapter marketplace’te görünüyor mu?
Evet, backend GET /v1/adapters?status=ACTIVE ile döndüğü sürece (dev bypass ile ACTIVE) listede yer alır. “dev test” rozeti yalnızca domainTags içinde r3mes:dev-test varsa veya ID NEXT_PUBLIC_R3MES_DEV_TEST_ADAPTER_IDS içindeyse çıkar.
Chat seçimi çalışıyor mu?
Evet, mevcut akış aynı: /chat?adapter=<id> (ve varsa cid) ile bağlam taşınır; ekstra kırılma yok.
Kullanıcıyı yanıltacak bir görüntü var mı
Azaltıldı: dev kayıtlarda mor benchmark skoru vurgusu kapatıldı, “dev test” + kısa açıklama var. Backend’in test satırına r3mes:dev-test etiketini yazması (veya yerelde env ile ID vermesi) beklenir; aksi halde kart, gerçek onaylı gibi görünebilir.
Backend notu: Dev bypass ile oluşturulan/güncellenen test adaptöründe domainTags içine r3mes:dev-test eklenmeli (Prisma domainTags alanı). Bu, FE’nin güvenilir şekilde ayırt etmesini sağlar.

-----------

Özet rapor ve yapılan değişiklikler:

Bypass yalnızca local mi?
Benchmark atlama: SKIP_BENCHMARK_QUEUE=1 yalnızca packages/sui-indexer içinde kullanılıyor (eventHandlers.ts → AdapterUploadedEvent sonrası enqueueBenchmarkJob atlanır).

Repoda kalıcı değil: Gerçek değerler .env / .env.local içinde tutulmalı; kök .gitignore (.env, .env.*, !.env.example) bunları commit etmez.
Örnek şablon: packages/sui-indexer/.env.example içinde varsayılan SKIP_BENCHMARK_QUEUE=0 ve “yalnızca yerel / prod’da tanımlama” notları güncellendi.
Üretim kilidi (yeni): cli.ts başında NODE_ENV=production iken SKIP_BENCHMARK_QUEUE=1 ise süreç çıkıyor — backend’deki R3MES_SKIP_* üretim korumasıyla aynı mantık.
Diğer dev bayrakları (R3MES_SKIP_CHAT_FEE, R3MES_SKIP_WALLET_AUTH, …) zaten apps/backend-api/src/app.ts içinde üretimde yasaklanıyor; dokümanda “yalnızca yerel” diye geçiyor (RELEASE_RUNTIME_FLIP_BITNET_DEFAULT.md, E2E_LIFECYCLE_DEMO.md).

Süreçler doğru env ile mi kalktı?
Bu oturumda süreç çalıştırılmadı; beklenen yerel matris (dokümantasyonla uyumlu):

Süreç	Port / kanal	Not
backend-api
3000
R3MES_SKIP_* → .env (gitignore)
dApp
3001
apps/dApp/.env.local → NEXT_PUBLIC_BACKEND_URL → 3000
ai-engine
8000
R3MES_LLAMA_INTERNAL_PORT / proxy → 8080
BitNet / llama
8080
Ayrı süreç; worker R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080
sui-indexer
—
SKIP_BENCHMARK_QUEUE yalnızca indexer .env
docs/LOCAL_DEV.md servis tablosuna sui-indexer + SKIP_BENCHMARK_QUEUE satırı eklendi; packages/sui-indexer/README.md içinde tablo ve kurallar yazıldı.

Test bitince kapatmak kolay mı?
Tek bayrak: SKIP_BENCHMARK_QUEUE=0 yap veya satırı sil → indexer’ı yeniden başlat.
Dosya izolasyonu: .env / .env.local silinince veya repoya hiç işlenmeyince “kalıcı kirlenme” olmaz.
Üretim: NODE_ENV=production + SKIP_BENCHMARK_QUEUE=1 artık indexer başlamıyor — yanlış deploy riski azaltıldı.
Değiştirilen dosyalar
packages/sui-indexer/src/cli.ts — üretim + SKIP_BENCHMARK_QUEUE=1 kontrolü
packages/sui-indexer/.env.example — uyarı metinleri
packages/sui-indexer/README.md — “Yerel geliştirme” bölümü
docs/LOCAL_DEV.md — indexer satırı
Başarı kriteri: Benchmark bypass yalnızca yerel env dosyalarında yaşar; prod’da açılırsa indexer durur; dokümanda staging/prod için “açık bırak” önerisi yok.

----------------

Kod taraması şart değil; bu metin ürün politikası / tanı testi tanımı. Aşağıdaki ifadeler repodaki ayrım ile uyumludur: üretimde chat ACTIVE adapter ister 1; benchmark ayrı ölçüm.

“Bu bypass testinin anlamı nedir?” (tek cümle)
Benchmark eşiğini veya QA onayını geçici olarak devre dışı bırakıp yalnızca “adapter yüklüyken gerçekten chat/runtime zinciri mesaj üretebiliyor mu?” sorusunu yanıtlamak içindir; ürün onayı, kalite kararı veya ACTIVE sayılmaz.

Sonuç raporu
Alan	Net ifade
Test amacı
Tanı: adapter_cid → AI engine / llama-server → yanıt zincirinin benchmark skorundan bağımsız çalışıp çalışmadığını görmek. Amaç benchmark’ı “çözmek” veya eşiği delmek değil; sadece entegrasyon yüzeyi (çözümleme, proxy, LoRA yükleme, HTTP) doğrulaması.
Başarı neyi kanıtlar
Kullanıcı arayüzü veya doğrudan API ile gerçek mesajlaşma akışı (uygun dev ayarıyla) 200 ve anlamlı completion üretiyorsa: runtime + chat çözümleme + inference hattı bu adapter CID’si için işliyor demektir; o zaman aynı adapter’da görülen sorunlar öncelikle benchmark / eğitim kalitesi / eşik tarafında aranır.
Başarısızlık neyi işaret eder
Aynı koşulda chat de düşüyorsa (çözümleme, yetkilendirme, ücret, AI URL, llama-server, LoRA yolu vb.): sorun yalnızca skor değil; backend–engine–llama / adapter çözümleme hattında ek teknik problem vardır — önce bunu gidermek gerekir.
Testin sınırları (net)
Ürün kararı değildir — ACTIVE, slash, ödeme, listeleme politikası bu testle verilmez.
Benchmark’ı geçmiş sayılmaz — gizli set ve eşik hâlâ ürün kalitesinin kaynağıdır.
Yalnızca dev / kontrollü ortam — prod kullanıcıya “bypass ile açık chat” vaadi olarak yorumlanmamalı.
Başarı kriteri (ekip için)
Takım şunu ayırır: Bypass = entegrasyon tanısı; Ürün = benchmark + status + verify. İkisi karıştırılmaz.
