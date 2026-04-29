Aşağıdaki analiz, repodaki jobProducer.ts, redis_consumer.py, job_runner.py, webhook.py, settings.py, internalQa.ts, docker-compose.storage.yml ve worker README ile tutarlıdır.

1. Mevcut kırık noktalar
Bölüm	Kırılma
Redis tüketimi
loop_list_queue içinde r.blpop(...) try/except dışında. Bağlantı kopması, timeout, ConnectionError → süreç çöküyor; worker yeniden başlatılmazsa kuyruk tüketimi durur.
Webhook
_safe_webhook başarısız olunca yalnızca log; retry yok, yeniden kuyruğa alma yok. İş Redis’ten zaten pop edilmiş; backend PENDING_REVIEW’da kalır.
Kuyruk semantiği
BLPOP = “al ve sil”. Handler veya webhook ortasında crash → iş kaybı (idempotent tekrar yok).
Redis Docker
maxmemory 512mb + allkeys-lru → bellek baskısında herhangi bir anahtar (BullMQ + r3mes-benchmark:jobs listesi dahil) silinebilir. İş, worker görmeden yok olabilir.
İki üretici yolu
Backend enqueueBenchmarkJob: BullMQ Queue.add + varsayılan mirrorJobToListQueue (R3MES_MIRROR_LIST_QUEUE !== "0"). Mirror başarısız / kapalıysa Python worker listeyi boş görür; BullMQ tarafı işlenir ama worker BLPOP ile bağlı değil.
Backend ↔ worker env
REDIS_URL (Node) ve R3MES_REDIS_URL / redis_url (worker pydantic R3MES_ prefix) — aynı host/DB index olmalı; aksi halde iş yanlış Redis’e gider.
Webhook çakışması
internalQa: aynı jobId için in_flight → 503 QA_WEBHOOK_IN_FLIGHT. Tek denemeli httpx POST bu durumda kalıcı başarısızlık olabilir (retry yok).
Çalıştırma modeli
pnpm dev ile worker çocuk süreç; crash → süpervizör yoksa manuel restart gerekir.
Hazırlık kontrolü
Worker başlarken Redis’e bağlanılabilirlik ping’i yok; ilk blpop hata verene kadar “sağlıklı” sanılabilir.
2. Kök nedenler
Dayanıklılık eksikliği (worker): Redis istemcisi from_url ile oluşturuluyor; uzun süreli bloklayıcı komut (BLPOP) sırasında bağlantı kopması uygulama seviyesinde yakalanmıyor → süreç sonlanıyor.
En az bir kez teslimat yok: Webhook başarısı, işin “tamamlanması” için tanımlı değil; en fazla bir kez log var.
Redis bellek politikası: allkeys-lru ile kuyruk anahtarlarının eviklenmesi teorik ve pratik MVP riski (özellikle IPFS + BullMQ + aynı instance).
Köprü mimarisi: Worker yalnızca liste kuyruğunu okuyor; mirror veya REDIS_URL uyumsuzluğu sessizce “iş yok” üretir.
Operasyonel: Production-benzeri restart policy / health / supervision tanımlı değil; geliştirme modeli (turbo) üretim davranışını taklit etmiyor.
3. Yapılması gereken değişiklikler (somut)
Worker (Python)
redis_consumer.loop_list_queue: blpop (ve bağlantı kurulumu) için dış while True + retry; ConnectionError, TimeoutError, redis.ConnectionError yakalanıp exponential backoff ile yeniden bağlanma; isteğe bağlı sınırsız değil max backoff + jitter.
redis.Redis.from_url: health_check_interval, socket_keepalive, retry_on_timeout (redis-py sürümüne uygun) ve gerekirse client_name ile tanılama.
Webhook (post_qa_result / _safe_webhook): Retry (örn. 3–5 deneme, 503/502/429 için backoff); başarısızlıkta yapılandırılabilir dead-letter (dosya, ayrı Redis listesi veya tekrar işlenebilir stream) — job’u “kaybetmemek” için.
İşlem sonrası onay: Mümkünse “webhook başarılı” olana kadar işi idempotent şekilde yeniden denenebilir kılın (ör. Streams + consumer group veya visibility timeout deseni); list + BLPOP tek başına at-least-once sağlamaz.
Başlangıç: main içinde PING + redis_url log’u; başarısızsa exit code ≠ 0 (orchestrator yeniden başlatsın).
Backend (Node)
jobProducer / mirror: mirrorJobToListQueue için try/catch + metrik/log; başarısızsa uyarı veya kuyruğa geri yazma stratejisi; R3MES_MIRROR_LIST_QUEUE production’da kapalı ise worker’ın BullMQ Worker ile uyumlu ikinci bir tüketici olduğunun doğrulanması.
BullMQ / Redis: ioredis için yeniden bağlanma ve ağ kesintisi logları (zaten maxRetriesPerRequest: null BullMQ için uygun; operasyonel dashboard ile uyum).
Altyapı (Redis)
Docker Redis: Kuyruk iş yükü için allkeys-lru ile aynı instance kullanımını gözden geçir — seçenekler: noeviction + yeterli RAM, ayrı Redis (queue-only), veya en azından maxmemory-policy + keyspace ayrımı (queue DB’si için LRU dışı politika mümkün değilse ayrı instance).
Redis persistence: appendonly yes var; yedekleme / restore prosedürü dokümante (MVP için “disk dolunca” riski).
Süreç yönetimi
systemd / Docker Compose / K8s: Worker için restart: unless-stopped veya systemd Restart=always; healthcheck (ör. worker’a küçük HTTP sidecar veya redis-cli ping + süreç varlığı).
Bağımlılık sırası: Backend ve Redis healthy olduktan sonra worker başlasın (depends_on + healthcheck veya init container).
Gözleşim ve gözlemlenebilirlik
Metrikler: Redis’ten pop sayısı, webhook başarı/başarısızlık, yeniden deneme sayısı, iş süresi (Prometheus veya basit log aggregation).
Uyarlar: Worker süreç yok / kuyruk derinliği / Redis bellek kullanımı.
4. Öncelik sırası
Öncelik	Madde	Gerekçe
P0
Redis BLPOP etrafında reconnect + retry döngüsü
Worker’ın düşmesi = tüm akış durur
P0
Webhook retry + (tercihen) başarısız işler için DLQ / yeniden deneme
PENDING’ın en sık “sessiz” nedeni
P0
Redis maxmemory-policy / kuyruk için ayrı instance veya noeviction
İşlerin LRU ile silinmesi
P1
Mirror hata yönetimi + mirror/list/BullMQ tutarlılığı dokümantasyonu
“İş kuyrukta yok” sapması
P1
Worker supervisor + readiness (ping)
Ortam restart’larında otomatik toparlanma
P2
Streams + consumer group veya visibility timeout (list’ten çıkış)
At-least-once ve kayıpsızlığa yaklaşma
P2
internalQa 503 için worker tarafında retry
Yarış durumunda geçici hata
P3
Metrikler/alerting
MVP sonrası operasyonel olgunluk
5. MVP blocker / non-blocker ayrımı
MVP blocker (hedef akış: upload → QA → ACTIVE → chat):

Worker’ın Redis kopunca kalıcı çökmesi (P0 reconnect).
Webhook’ın tek denemeli kalması ve sessiz başarısızlık (P0 retry/DLQ).
Redis’in iş anahtarlarını evikleyebilmesi (P0 politika).
Mirror/list/BullMQ uyumsuzluğu (P1).
MVP non-blocker (ana hedefi dağıtmadan sonra):

Tam Observability stack (P3).
K8s HPA, çok replikalı worker (MVP tek kullanıcı yeterliyse).
Streams mimarisine tam geçiş (P2 — iyileştirme).
Sidecar health HTTP (P1’in lüksü).
MVP scope dışı notu:
Çoklu bölge, Redis Cluster, ayrı “QA worker” için ayrı VPC, gelişmiş SLO — MVP’yi “çalışır” yapmaya şart değil; yukarıdaki P0–P1 maddeleri olmadan sahada PENDING ve “kirli” test tekrarlanır.

Özet cümle: Kök nedenler (1) worker’da Redis/blok işlemlerinin yakalanmaması, (2) webhook’un garantisiz olması, (3) Redis’in LRU ile kuyruk kaybı riski ve (4) köprü + süreç gözetimi eksikliği. Somut değişiklik listesi yukarıda; kod değişikliği bu raporda yapılmadı (yalnızca analiz).

----------------

Aşağıdaki denetim, INTEGRATION_CONTRACT.md, packages/shared-types/src/canonical.ts, apps/backend-api/src/lib/chatAdapterResolve.ts, routes/adapters.ts, routes/chatProxy.ts, apps/dApp/lib/ui/r3mes-fe-contract.ts, lib/api/adapters.ts, adapters-trainer.ts, components/chat-screen.tsx ve apps/ai-engine şemalarına dayanır.

1. Contract boşlukları
Boşluk	Açıklama
adapter_cid ile chat
§3.5: DB çözümlemesinde Adapter.status === ACTIVE zorunlu; aynı paragrafta doğrudan adapter_cid verilirse durum kontrolü yapılmaz. MVP akışı “ACTIVE → chat” derken ham CID ile chat bu kuralın dışında kalıyor.
Owner / eğitmen listesi
§3.1’de GET /v1/adapters için yalnızca limit, cursor, status var; ownerWallet veya imzalı cüzdanla filtre tanımlı değil. Studio, tüm adaptörleri çekip istemcide süzüyor (adapters-trainer.ts yorumu: “backend henüz owner query ile filtrelemedi”).
Marketplace vs Studio
Contract’ta “Marketplace” / “Studio” ayrımı yok; yalnızca FE r3mes-fe-contract.ts ve çağrı kalıpları ile örtük (pazaryeri status=ACTIVE, Studio owner süzmesi).
QA sonrası durum eşlemesi
§3.3–3.4 webhook approved/rejected ile Prisma ACTIVE/REJECTED ilişkisi metinde anlatılmış sayılır ama MVP tablosu (tek satır “webhook → status”) §3.5’ten önce ayrı bir “MVP akış özeti” olarak yok.
Chat ücreti / zincir
Chat öncesi recordChatUsageOnChain vb. (§3.5’te ücret bahsi var); MVP’de R3MES_SKIP_CHAT_FEE=1 olmadan ek yapılandırma gerekir — contract’ta “MVP minimum env” tek blokta toplanmamış.
2. Çelişkili / farklı yorumlanabilir kurallar
Konu	Çelişki
ACTIVE zorunluluğu
Ürün dili: “Sohbet yalnızca ACTIVE” (ADAPTER_NOT_ACTIVE). Uygulama: adapter_cid doğrudan gelince ACTIVE kontrolü yok → “ACTIVE görünüm → chat” ile ham CID → chat çelişebilir.
ipfsCid liste vs detay
Liste: türetilmiş ipfsCid = weightsCid ?? manifestCid. Chat çözümlemede önce weightsCid, yoksa manifest — aynı öncelik; ancak manifest-only edge case contract’ta “chat için yeterli mi?” tek cümleyle kilitli değil.
adapter_id adı
§1: adapter_id “eski / çevresel”, tercih adapterDbId. Chat gövdesinde hâlâ adapter_id kabul ediliyor — MVP için “tek isim” kararı dokümanda zayıf.
3. Netleştirilmesi gereken kanonik kararlar
MVP chat girişi: Sadece adapterDbId (path veya gövde) ile mi, yoksa adapter_cid bypass ürünte izinli mi? İzinliyse: güven / listeleme politikası (herkes her CID ile mi?) açık yazılmalı.
Owner listesi: GET /v1/adapters?ownerWallet= veya auth’dan türetilen “benim adaptörlerim” ucu contract + OpenAPI’ye eklenmeli mi, yoksa istemci süzmesi kasıtlı “non-breaking” geçici çözüm mü?
Studio’da görünen statüler: PENDING_REVIEW / REJECTED yalnızca owner board’da mı; anonim kullanıcı GET /v1/adapters/:id ile REJECTED görebilir mi? (şu an detay auth gerektirmiyor olabilir — adapters.ts GET :id kontrol ettim, wallet yok). Bu, gizlilik / ürün kararı.
Marketplace: Yalnız ACTIVE + sıralama benchmark’a göre mü — contract’ta “marketplace varsayılanı” tek cümle yok (FE sabit status=ACTIVE).
4. Doküman / shared-types / test güncelleme önerileri
Öğe	Öneri
INTEGRATION_CONTRACT
§3.5 altına “MVP akışı (wallet → upload → QA → ACTIVE → chat)” kutusu: hangi adımda hangi status, hangi hata kodu.
§3.5
adapter_cid doğrudan kullanımını MVP’de yasak / kısıtlı / operatör-only olarak yeniden sınıflandır veya ACTIVE kontrolünü eşitle (ürün kararı).
§3.1
status atlanırsa tüm statüler döner — bunun Marketplace’te kullanılmaması gerektiği (FE) contract’a bir cümle olarak yazılsın.
Owner listesi
Ya yeni query parametresi + şema + contractRegression.test, ya da “şimdilik FE filtre — bilinen sınırlama” paragrafı.
canonical.ts
Chat için hangi kimlik alanlarının MVP’de kullanılacağı (ör. ChatResolutionFields) kısa JSDoc.
Test
chatAdapterResolve: adapter_cid ile PENDING/REJECTED senaryosu — beklenen davranış ürün kararına göre güncellenir.
5. MVP blocker / non-blocker
Sınıf	Madde
Blocker (MVP bütünlüğü)
Wallet auth → upload → QA → ACTIVE → chat dışında, chat’in adapter_cid ile ACTIVE bypass edebilmesi; ekip “ACTIVE şart”ı farklı yorumlar. Net karar yoksa ürün ve güvenlik riski.
Blocker
Chat’in ücret/zincir olmadan çalışması için SKIP_CHAT_FEE veya tam operatör env — dokümante “MVP minimum” değilse ortam blokaj.
Non-blocker
Backend’de owner query eksikliği — FE süzmesi ile çalışıyor; ölçek/performans öncesi kabul edilebilir.
Non-blocker
Detay endpoint’in herkese açık olması — MVP’de kabul; sonra owner-only detay istenirse breaking tartışması.
Non-blocker
adapter_id vs adapterDbId — çalışır; sadeleştirme ergonomi.
6. Odak sorularına kısa cevaplar
1) Chat için ACTIVE zorunluluğu contract seviyesinde net mi?
Kısmen: DB ID / on-chain ID çözümlemesinde evet; adapter_cid ile hayır (§3.5 açık istisna). MVP için tek yorum gerekiyor.

2) adapter_id / adapterDbId / adapter_cid sadeleştirme?
MVP için öneri: istemcide tercih adapterDbId + adapter_cid (CID); adapter_id alias olarak bir tabloda sabitlensin; ham adapter_cid politikası netleşmeden sadeleştirme yarım kalır.

3) FE / BE / AI engine uyumsuzlukları?

BE: çözümlemede ACTIVE; ham CID’de değil.
AI engine: her zaman adapter_cid zorunlu (şema).
FE: id veya cid gönderebiliyor → ACTIVE garantisi en zayıf halka: doğrudan cid.
4) Owner listesi contract’ta olmalı mı?
MVP işlevsel olarak şart değil (FE hack); contract tutarlılığı ve ölçek için ya parametre ya da “bilinçli istemci süzmesi” paragrafı şart.

5) Marketplace vs Studio durum kuralları net mi?
FE’de net (MARKETPLACE_ADAPTER_QUERY_STATUS, trainer süzmesi); API/INTEGRATION_CONTRACT’ta “Marketplace = ACTIVE” ve “Studio board = owner + tüm statü” olarak yazılı değil — çelişki riski düşük, dokümantasyon riski yüksek.

Hedef özet: Takımları hizalamak için minimum net karar: adapter_cid ile chat MVP’de ya (A) yasaklanır / kaldırılır ya da (B) açıkça “ACTIVE bypass” olarak kabul edilir ve gerekçesi yazılır; ikinci olarak owner listesi için sunucu filtresi veya istemci süzmesi tek cümleyle kanon olur.

-----------

Aşağıdaki analiz, özellikle chatAdapterResolve.ts, chatProxy.ts, chat-stream.ts, chat-screen.tsx, gguf_adapter.py, job_runner.py ve proxy_service.py ile hizalıdır.

MVP akışı (referans)
wallet auth → upload → QA → ACTIVE → chat

1) adapter_cid ile AI engine — ACTIVE kuralı ile çelişki var mı?
Kısmen evet; ürün kuralı tam uygulanmıyor.

Backend resolveAdapterCidForChatProxy içinde adapter_id / adapter_db_id / on_chain_adapter_id ile çözümlemede status === ACTIVE zorunlu 1.
adapter_cid doğrudan gövdede varsa kod hemen dönüyor; Prisma çağrısı yok, ACTIVE / sahiplik / DB doğrulaması yok (birim testi bunu açıkça sabitliyor: passes through when adapter_cid set → findFirst çağrılmıyor).
Kritik ek: dApp, pazardan gelirken hem adapter hem cid query ile geliyorsa chat-stream.ts ikisini birden gönderiyor. Çözümleyicide önce adapter_cid kontrol edildiği için, marketplace’te yalnızca ACTIVE listelense bile sunucu tarafında ACTIVE zorunluluğu atlanıyor; kullanıcı veya istemci adapter_cid ile oynayarak (veya sadece cid ile) DB durumundan bağımsız sohbet açma yoluna düşebilir.

AI engine yalnızca adapter_cid + IPFS’ten indirme yapar; ürün durumu bilmez — bu tasarım olarak doğru, fakat güvenilirlik sınırı backend’de olmalıdır.

Özet: “Sadece ACTIVE ile chat” hedefi tam değil; adapter_cid önceliği MVP ürün kuralını zayıflatıyor.

2) QA worker + runtime + llama hot-swap — MVP için yeterince sağlam mı?
Çalışır ama “sağlam” için operasyonel koşullar sıkı; tek parça eksikte kırılgan.

Bileşen	Güçlü yön	Zayıf / MVP riski
Worker
Aynı CID ile IPFS’ten GGUF indirme, LoRA kaydı, benchmark, webhook (job_runner.py)
Gateway timeout, llama slot/404, sıralı hot-swap (_lora_lock)
llama
Dokümante slot + POST /lora-adapters
--lora yoksa veya path uyumsuzsa chat/worker patlar (LIVE_RUN)
AI engine proxy
İndir → kopyala → ölçek
GGUF içerik doğrulaması yok (sadece dosya)
Sonuç: Mimari MVP için yeterli; dayanıklılık çoğunlukla doğru env + tek llama süreci + doğru base ile sağlanıyor, kod içinde tam otomatik kurtarma yok.

3) Aynı GGUF’un QA ve chat’te güvenilir tüketilmesi
İçerik adresleme aynı mantık: evet (aynı CID → aynı nesne).

QA: download_ipfs_artifact(gateway, cid, …) — HTTP gateway /ipfs/{cid} 2.
Chat: ensure_adapter_gguf — gateway üzerinden CID ile indirme 3.
Olası tutarsızlıklar (operasyonel, protokol değil):

Farklı R3MES_IPFS_GATEWAY_URL / worker gateway vs AI engine gateway → farklı host, aynı CID ile genelde aynı içerik; yanlış yapılandırmada erişim hatası.
Önbellek: AI engine dosyayı {cid}.gguf olarak önbelleğe alır; CID değişmeden dosya güncellenemez (IPFS immutable) — tutarlı.
Upload doğrulaması (GGUF sihri, uzantı) sadece backend upload’ta; QA/chat tekrar doğrulamaz — bozuk dosya IPFS’e bir kez yanlış pinlendiyse iki tarafta da aynı şekilde bozulur.
Sonuç: “Aynı artefakt” CID semantiğiyle doğru; kalite upload + QA skoru ile sınırlı, inference katmanında ikinci bir GGUF şeması yok.

4) Doğrulamalar: AI engine vs backend
Konu	Backend (uygun)	AI engine (uygun)
Wallet auth, ücret, ACTIVE (id ile)
Evet
Hayır (trust internal network)
Upload’ta GGUF erken doğrulama
Evet (INTEGRATION_CONTRACT §3.3.1)
Hayır (tekrarlamaya gerek yok; isterseniz opsiyonel sanity)
adapter_cid ile ACTIVE / DB tutarlılığı
Şu an eksik (bkz. §1)
İstemezsiniz; backend düzeltmeli
IPFS erişilebilirliği
İsteğe bağlı health
İndirme + timeout + anlamlı 502/503
LoRA slot / hot-swap
Hayır
Evet (mevcut)
Chat şablonu / stop
İstemci veya upstream
llama-server; dApp stop göndermiyor
Net sınır: Ürün kuralları (ACTIVE, sahip, ücret) → backend; dosyayı indirip llama’ya bağlamak → AI engine. Bugün ACTIVE’in adapter_cid yolunda backend’de tam uygulanmaması sınır hatasıdır.

5) Runtime’da kullanıcıyı etkileyen başlıca failure mode’lar
IPFS/gateway: indirme zaman aşımı, 502 — chat “ağ / upstream” hatası.
llama kapalı veya slot yok: 502/503, “LoRA yok” sınıfı mesajlar.
Sıralı kilit (_lora_lock): yoğunluk gecikmesi; tek kullanıcı MVP’sinde nadiren, çok kullanıcıda kuyruk hissi.
Yanlış base model / mimari uyumsuz LoRA: teknik olarak yüklenebilir, çıktı çöplük; ürün hatası gibi görünür, kod “başarılı HTTP” döner.
Chat ücreti / operatör Sui: 402/503 4.
adapter_cid ile ACTIVE atlatma: PENDING/reddedilmiş veya başkasının CID’si ile deneme — beklenmedik içerik (ürün kuralı ihlali).
İstenen çıktı formatı
AI katmanındaki mevcut sorunlar
adapter_cid önceliği ile ACTIVE kontrolünün sıklıkla atlanması (özellikle dApp hem adapter_id hem cid gönderince).
AI engine’de GGUF semantik doğrulama yok (bilinçli tekrar yok; risk upload’a bağlı).
dApp → backend → llama zincirinde stop/şablon tarafında ürün tutarlılığı zayıf (önceki analizlerle uyumlu).
Backend ile sınırların yanlış çizildiği yerler
ACTIVE: adapter_cid “pass-through” ürün kuralını deliyor; çözüm backend’de (cid’yi DB ile eşleştir veya adapter_id önceliği / her zaman status kontrolü).
Güven güveni: AI engine’e “iç ağda güvenilir istek” varsayımı var; backend filtresi tam değilse engine masum şekilde yanlış LoRA yükler.
Runtime / worker riskleri
Tek llama süreci + global kilit: ölçek ve hata yalıtımı sınırlı.
Worker ve chat aynı llama’yı paylaşırsa sıra/bekleme.
Gateway/IPFS tek nokta.
Yapılması gereken değişiklikler (öncelik sırasıyla — özet)
Backend: adapter_cid ile gelen isteklerde weightsCid + ACTIVE doğrulaması (veya adapter_id önce çözülsün, cid yalnızca doğrulama için).
dApp: Mümkünse yalnız adapter_id göndermek veya backend düzeltildikten sonra mevcut gövdeyi kullanmak.
Ops: llama --lora, ortak gateway URL, izleme.
İsteğe bağlı: AI engine’de hafif GGUF magic kontrolü (defans derinliği).
Test / kanıt planı
Birim: adapter_cid + ACTIVE olmayan DB kaydı → 400 beklenir (şu an çoğu senaryoda yok).
Entegrasyon: marketplace URL’si ile (adapter+cid) ve sadece cid ile davranış farkı.
E2E: Upload → QA webhook → ACTIVE → chat tek script veya manuel verify lifecycle.
MVP blocker / non-blocker
Öğe	Sınıf
adapter_cid ile ACTIVE atlanması (ürün kuralı + güven sınırı)
Blocker (MVP “sadece ACTIVE chat” iddiası için)
AI engine’de ekstra GGUF parse
Non-blocker (backend upload zaten doğruluyor)
_lora_lock / tek llama
Non-blocker (küçük MVP trafiği için)
dApp stop eksikliği
Non-blocker kalite; ürün hissiyatını etkiler
IPFS/llama operasyonel ayakta
Blocker (zincir çalışmaz)
Net hedefe uyum: AI katmanını sade ve güvenilir yapmak için MVP’de asıl düzeltme backend çözümleme sırası ve ACTIVE doğrulaması; AI engine CID ile dosya getir + llama rolünde kalmaya devam edebilir — ürün kuralları backend’de tamamlanmalı.

------------------

Aşağıdaki değerlendirme, internalQa (QA webhook’un zincir + DB güncellemesi), user route’larındaki 501 bilinçli yüzey, chatProxy / suiOperator davranışı ve daha önce görülen record_usage / OperatorCap uyumu üzerine kuruludur.

MVP için zorunlu blockchain parçaları
Dar MVP tanımı: wallet auth → adapter yükleme → QA → UI’da ACTIVE → chat

Parça	Gerekçe
Kullanıcı kimliği (wallet auth)
Zincir şart değil; imza doğrulama backend’de.
Adapter kaydı için zincir
Şart değil, eğer ürün “MVP’de DB’de ACTIVE yeter” diyorsa. Yükleme akışı indexer’dan onChainAdapterId / onChainObjectId üretmiyorsa QA canChain === false olur ve yine de DB ACTIVE yazılır (internalQa.ts).
QA → on-chain apply
Kodda koşullu: onChainObjectId + onChainAdapterId + operatör anahtarı + paket + admin cap varken zincir çağrılır; yoksa atlanır, DB yine güncellenir. Bu MVP akışı için zorunlu değil.
Chat
Zincir şart değil; R3MES_SKIP_CHAT_FEE=1 ile sohbet ücreti TX’i tamamen devre dışı bırakılabilir.
Indexer
Tam zincir + olaylarla tutarlı read model isteniyorsa gerekli; saf DB MVP’sinde opsiyonel.
Özet: Bu MVP hattında bloklayıcı tek “zincir” parçası, ürünün “adaptör gerçekten zincirde kayıtlı olsun” demesi halinde adapter publish + indexerdır. Sadece “ACTIVE + chat” ise minimum zincir sıfıra yakın seçilebilir (yalnız DB + QA webhook).

Ertelenebilecek parçalar
Parça	Neden ertelenebilir
QA sonrası on-chain approve/reject
canChain false iken zaten yapılmıyor; tutarlılık riski ürün kararıyla yönetilir (aşağıda).
Chat fee → record_usage
Feature flag: R3MES_SKIP_CHAT_FEE=1. Ayrıca OperatorCap ile PTB uyumu çözülene kadar üretimde zorunlu tutmak riskli.
Stake / rewards POST (501)
Bilinçli 501; MVP akışında chat hattını kesmez.
reward_pool indexer
ADR-002 ile RPC yeterli sayıldı; MVP için ek şart değil.
GET rewards / stake özetleri
Okuma uçları var; zincir verisi yoksa boş/placeholder olabilir, ana akışı bloklamaz.
Off-chain / on-chain tutarlılık riskleri
Risk	Açıklama
Çift gerçek (split brain)
DB ACTIVE, zincirde adaptör hâlâ Pending (QA zincirsiz, upload zincirli veya tersi). Başka bir istemci veya gelecekte zincir okuyan özellik farklı durum görür.
QA zincir başarısız → 500
canChain === true iken applyQaResultOnChain hata verirse webhook 500, DB güncellenmez — MVP’de “yarı yapılandırılmış zincir” en tehlikeli köşe: ne tam off-chain ne tam on-chain.
Indexer gecikmesi
Stake/slash ile ilgili senaryolarda zincir ve DB ayrışabilir (dar MVP chat için genelde ikincil).
record_usage uyumsuzluğu
Ücret açıksa: Move OperatorCap isterken backend’in eski PTB’si TX başarısızlığı — kullanıcı chat’i göremeyebilir veya ücret yolu kırık olur (flag ile maskelenebilir).
Ürün beklentisi açısından net karar önerileri
“Tek gerçek kaynak” seçin:

A) MVP’de kaynak DB + QA webhook (zincir süs/opsiyon) → on-chain QA ve chat fee’yi kapalı veya zorunlu tutmayın.
B) “Adaptör ve durum zincirde doğrulanabilir olsun” → upload + indexer + her zaman canChain yolunun yeşil kalması (env, operatör, başarısızlıkta net ürün mesajı).
Chat fee: MVP’de varsayılan kapalı veya sadece staging; açılacaksa önce Move ABI ↔ backend PTB uyumu üretim checklist’ine alınsın.

501 POST stake/claim: Dokümantasyonda “bilinçli yüzey” olarak kalsın; MVP wallet → adapter → QA → ACTIVE → chat ile çakışmıyor — kullanıcıya “bu sürümde sunucu stake/claim yapmıyor” netliği yeterli.

ACTIVE etiketi: UI’da “On-chain doğrulandı” gibi iddia yoksa veya zincir yoksa “Listede aktif (MVP)” gibi dil kullanın; zincirle iddia varsa indexer/on-chain okuma şart.

Sorularınıza doğrudan yanıt
QA on-chain apply MVP’de gerekli mi?
Kod olarak hayır — canChain false ise atlanıyor. Ürün olarak “zincirde de ACTIVE olsun” diyorsanız evet; sadece uygulama içi ACTIVE ise sonraya bırakılabilir.

Chat fee on-chain MVP için zorunlu mu?
Hayır; flag ile ertelenebilir. Ücret açık ve PTB hatalıysa bloklayıcı olur.

Stake / rewards claim 501 MVP’yi etkiler mi?
Verilen akış için genelde hayır (POST’lar bilinçli 501). Stake/rewards ekranı aynı demoda gösteriliyorsa beklenti yönetimi gerekir, chat’i kilitlemez.

Off-chain ACTIVE vs on-chain ACTIVE uyumsuzluğu riski?
Orta–yüksek, tam olarak ne zaman zincir yazıldığı / yazılmadığı net değilse. Tek kaynak DB seçildiyse risk kontrollü (sadece ürün dili tutarlı olsun).

MVP release için minimum zincir gereksinimi nedir?

Minimum (maksimum gevşek): Sui cüzdan auth + DB tabanlı adapter/QA/ACTIVE + chat, chat fee kapalı.
Minimum (zincir iddialı): Yayınlanmış paket + doğru env + indexer + (tercihen) QA’nın zinciri başarıyla güncellemesi + chat fee için çalışan PTB veya fee kapalı.
MVP blocker / non-blocker
Öğe	Blocker mı? (bu akış için)
Wallet auth
Non-blocker (zincir değil)
Adapter zincir upload + indexer
Bloklayıcı yalnızca “zincir kayıtlı adaptör” MVP şartıysa
QA on-chain apply
Non-blocker (kod izin veriyor); bloklayıcı yarım yapılandırılmış zincir + canChain true + sürekli TX hatası
Chat
Non-blocker (fee kapalıysa veya fee yolu sağlamsa)
Chat on-chain fee açık + bozuk PTB
Bloklayıcı (ücret zorunluysa)
POST stake / rewards 501
Non-blocker (bu MVP hattı için)
Off-chain/on-chain ACTIVE uyumsuzluğu
Ürün riski; tek başına deploy’u durdurmaz, yanlış beklenti yaratırsa demo kalitesini düşürür
Hedefe uyum: MVP’yi gereksiz zincire bağlamamak için pratik çizgi: DB + QA ile ACTIVE + chat, zincir ya tam (env + indexer + güvenilir QA TX) ya hiç; ara “canChain true ama sık fail” durumu en büyük operasyonel ve beklenti riskidir.

---------------------------

Özet: MVP chat için adapter_cid artık veritabanında weightsCid / manifestCid ile eşleşen ve ACTIVE olan bir kayda bağlanmak zorunda; ham CID ile atlama kalktı. adapter_id / on_chain_adapter_id çözümünde sahip filtresi kaldırıldı; böylece pazaryerinden başkasının ACTIVE adaptörüyle sohbet edilebilir. GET /v1/me/adapters ile stüdyo listesi sunucu tarafında sahibe göre filtreleniyor.

Kritik backend sorunları (giderilen)
Konu	Önce	Sonra
adapter_cid ile chat
Gövdeye dokunulmadan AI engine’e gidiyordu → PENDING / bilinmeyen CID ile inference mümkündü
DB’de eşleşen satır ACTIVE değilse 400 ADAPTER_NOT_ACTIVE; kayıt yoksa 400 ADAPTER_RESOLUTION_FAILED
adapter_id + adapter_cid birlikte
CID önce işlendi, tutarsızlık denetlenmiyordu
Aynı istekte hem id hem cid varsa çakışma → 400 ADAPTER_RESOLUTION_CONFLICT
Eğitmen listesi
Tüm adaptörler çekilip istemcide ownerWallet ile süzülüyordu
GET /v1/me/adapters + imza başlıkları; sunucu yalnızca doğrulanmış cüzdanın kayıtlarını döner
Güvenlik / ürün ihlalleri (MVP açısından)
Ürün ihlali (düzeltildi): “Sadece ACTIVE ile chat” kuralı, doğrudan CID ile deliniyordu.
Güvenilir olmayan liste: Public GET /v1/adapters ile owner süzme, güvenlik iddiası taşımaz; stüdyo akışı /v1/me/adapters ile hizalandı.
Kalan sınır: Chat, yine de IPFS’e pinlenmiş bir GGUF CID’sine dayanıyor; DB’de ACTIVE olsa bile bu, “içerik denetimi” değil, yaşam döngüsü durumu kontrolüdür (MVP kapsamı).
Yapılan kod değişiklikleri
apps/backend-api/src/lib/chatAdapterResolve.ts — CID yolu için DB lookup + ACTIVE; id/on-chain için findUnique, owner şartsız (pazaryeri).
apps/backend-api/src/routes/chatProxy.ts — resolveAdapterCidForChatProxy({ body }) (artık wallet gerekmez).
apps/backend-api/src/routes/adapters.ts — listAdaptersHandler + GET /v1/me/adapters (walletAuthPreHandler).
apps/backend-api/src/chatAdapterResolve.test.ts / integration.contract.test.ts — yeni senaryolar.
apps/dApp/lib/api/adapters-trainer.ts + adapter-status-board.tsx — /v1/me/adapters ve imzalı istek.
docs/api/INTEGRATION_CONTRACT.md — §3.1b, §3.5 güncellendi.
docs/api/openapi.contract.yaml — /v1/me/adapters eklendi; bozuk tekrar blok temizlendi.
Contract / şema
shared-types Zod şeması: AdapterListResponse aynı; yeni uç aynı gövdeyi döndürüyor.
Yeni hata kodu: ADAPTER_RESOLUTION_CONFLICT (metin tabanlı error alanı; mevcut ApiErrorBody ile uyumlu).
INTEGRATION_CONTRACT / OpenAPI: senkron güncellendi.
Test planı
Çalıştırıldı: pnpm run build + tüm vitest (apps/backend-api) — 61 test geçti.
Manuel: R3MES_SKIP_WALLET_AUTH=1 ile POST /v1/chat/completions gövde { "adapter_cid": "<pending veya sahte CID>", "messages": [...] } → 400.
Manuel: İmzalı GET /v1/me/adapters → yalnızca kendi adaptörleri; pazaryeri GET /v1/adapters?status=ACTIVE değişmedi.
MVP blocker / non-blocker
Durum	Madde
Blocker (çözüldü)
CID ile ACTIVE bypass
Blocker (çözüldü)
Stüdyo owner listesinin istemci süzmesine güvenilmesi
Non-blocker
İki farklı adaptörün teorik olarak aynı manifest CID’sine bağlanması (findFirst); üretimde nadir
Non-blocker
GET /v1/adapters/:id hâlâ herkese açık detay (ayrı sertleştirme isterse sonraki iterasyon)
Not: QA yaşam döngüsü (PENDING_REVIEW → kuyruk → POST /v1/internal/qa-result → ACTIVE/REJECTED) mevcut internalQa + adapters upload akışıyla uyumlu; bu değişiklikte ek durum geçişi gerekmedi.

