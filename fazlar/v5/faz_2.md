Özet: LoRA slot uyumu (llama.cpp / qvac ile)
Runtime modeli (kanıt: tools/server/server-common.cpp parse_lora_request)
POST /lora-adapters gövdesinde yalnızca id ve scale işlenir; path tamamen yok sayılır (JSON’da olsa bile).
LoRA tensörleri süreç başlarken --lora … ile belleğe alınır; GET /lora-adapters bu yüklenmiş listeyi döner.
lora_slot_id=0 varsayımı doğru: tek --lora için slot id 0 (ikinci --lora → 1, …).
Birden fazla --lora varken sadece tek slot göndermek diğerlerini 0 scale yapar; bu yüzden tüm slotların mevcut scale’lerini koruyarak birleşik POST gerekir.
Yapılan kod değişiklikleri
packages/qa-sandbox/worker/r3mes_qa_worker/llama_client.py

GET /lora-adapters → indirilen GGUF’u slot’un dosya yoluna shutil.copy2
POST → [{"id", "scale"}, …] (diğer slotların scale’i korunur)
İsteğe bağlı qa_lora_copy_target: GET’teki path yerine sabit hedef.
job_runner.py + settings.py

R3MES_QA_LORA_COPY_TARGET alanı eklendi.
apps/ai-engine/.../proxy_service.py + settings.py

Aynı akış (GET → kopya → birleşik POST), isteğe bağlı R3MES_LORA_COPY_TARGET_OVERRIDE.
README.md (worker) ve ai-engine testleri (mock artık GET + POST bekliyor).

Operasyonel gereksinim (2xx için)
llama-server en az bir LoRA ile başlamalı, örneğin:

llama-server -m base.gguf --lora C:\path\current_lora.gguf --port 8080
(İsteğe bağlı: --lora-init-without-apply + sonra scale.)

Worker IPFS’ten indirdikten sonra GGUF’u GET /lora-adapters[0].path (veya R3MES_QA_LORA_COPY_TARGET) dosyasının üzerine yazar; ardından POST /lora-adapters ile scale uygular. Dosyayı değiştirdikten sonra mmap/önbellek davranışı ortama göre değişebilir; gerekirse süreç yeniden başlatılır — bu, HTTP sözleşmesinin dışında bir konu.

Testler
packages/qa-sandbox/worker: 5 passed
apps/ai-engine: 23 passed

------

Canlı kanıt için apps/backend-api/scripts/verify-lifecycle-chain.mjs eklendi ve package.json içine verify:lifecycle-chain script’i yazıldı. e2e-lifecycle-smoke.mjs başarılı bitince aynı adapterId / jobId ile bu komutu çalıştırman için tek satırlık bir [kanıt] çıktısı basıyor.

Ne doğruluyor?
Katman	Koşul
API
GET /v1/adapters/:id → 200, status ∈ ACTIVE | REJECTED, benchmarkScore alanı var
DB (DATABASE_URL varsa)
Adapter satırı API ile aynı status
Receipt (--job-id + DATABASE_URL)
QaWebhookReceipt kaydı var ve completedAt dolu → callback akışı tamamlanmış
Kullanım (ilk gerçek başarı / red sonrası)
cd apps/backend-api
set R3MES_VERIFY_BASE_URL=https://senin-api-hostun
set DATABASE_URL=postgresql://...
node scripts/verify-lifecycle-chain.mjs --adapter-id <adapterDbId> --job-id <benchmarkJobId>
Sadece herkese açık API ile hızlı kontrol (DB yok):

set R3MES_VERIFY_BASE_URL=...
node scripts/verify-lifecycle-chain.mjs --adapter-id <adapterDbId>
benchmarkJobId, upload yanıtındaki benchmarkJobId ile aynı olmalı (receipt PK = jobId).

Başarı kriteri eşlemesi
Callback 200: Receipt’te completedAt set → handler completeQaWebhookJob çağırmış (başarılı işlem yolu).
Receipt: --job-id ile DB satırı bulunur.
ACTIVE / REJECTED: API + DB status terminal.
benchmarkScore: API’de alan + DB ile uyum uyarısı (sayısal fark varsa uyarı basılır).
Gerçek ortamda bir kez çalıştırdığında terminalde PASS — API + DB: zincir kanıtlandı görmek, istenen canlı kanıt için yeterli.

-----

Durum (bu oturum)
Başlangıçta: 8000, 9080, Redis ve Postgres kapalıydı (Docker durmuştu). 8080, 3000, 3001 açıktı.

Yapılanlar (yeniden başlatmayı gerektiren yerler):

Docker — postgres + storage (Redis, IPFS, 9080 gateway) up -d ile kaldırıldı.
8000 — infrastructure/scripts/run-ai-engine-dev.ps1 ile ai-engine ayrı pencerede başlatıldı (önceki oturumda kapanmıştı).
Şu an doğrulama (HTTP 200 + altyapı):

Uç	Sonuç
8080 /v1/models
200
8000 /health
200
3000 /health
200
3001 dApp
200
9080 /health
200
Redis
PONG
Postgres
accepting connections
Başarı kriteri: Bu anlık ölçümde ortam uygulama katmanı hataları üretmiyor; altyapı kaynaklı sahte “servis yok” hatası beklenmez.

Seans boyunca: Docker Desktop’ı kapatmayın; ai-engine penceresini kapatmayın (8000 düşer). pnpm bootstrap veya compose down ile stack’i düşürmeyin. Gerekirse tekrar kontrol: pwsh -File infrastructure/scripts/faz7-debug-session.ps1.

-------

Özet:

Yapılanlar
product-copy.ts — chat:
Üst bilgi: adaptör zorunluluğu ürün kapsamı olarak net; taban model sohbetinin olmadığı açık.
İki ayrı boş durum: emptyThreadNoAdapter (adaptör yokken) / emptyThread (adaptör varken). Böylece “adaptör seçiliyken…” metni adaptör yokken gösterilmiyordu; bu çelişki giderildi.
pageIntro.chat aynı çizgide güncellendi.
chat-screen.tsx:
hasAdapterContext ile boş alan doğru metni seçiyor.
Adaptör eksik bilgisi amber uyarı yerine bilgilendirici violet/zinc kutu (hata sandığı hissini azaltır).
Gönder pasifken title ile kısa gerekçe (workaround değil, erişilebilirlik).
Başarı kriteri
Kullanıcı kasıtlı kapsam ile bozukluk arasında ayrım yapabilir: sohbetin adaptöre bağlı olması ürün tanımı; gönderin pasif olması “eksik adaptör” ile uyumlu; metinler birbirini çelmiyor.

-------

Yapılanlar
1. docs/api/INTEGRATION_CONTRACT.md §3.5.1
Başlık: bug değil vurgusu.
“Chat neden base modelle (LoRA’sız) çalışmıyor?” için tek paragraflık tek kaynak cevap (ürün + teknik).
Özet tablo: teknik / ürün / destek triage / gelecek breaking.
2. §6 drift tablosu
Aynı soru için satır: §3.5.1 — adapter-only ürün kararı; bug değil.
3. apps/ai-engine/README.md
Ürün notu + §3.5.1 linki; triage’ın bug sanmaması için.
4. Kök INTEGRATION_CONTRACT.md
Girişte soru → §3.5.1 (feature-gap, bug değil).
Başarı ölçütü: “Chat neden base modelle çalışmıyor?” cevabı docs/api/INTEGRATION_CONTRACT.md §3.5.1; teknik contract ile uyumlu, ürün kararı ayrı net.

-------

Yapılanlar
infrastructure/README.md
Tek golden path: Başlık “Yerel golden path (tek düzen)”; tüm servisler bir runtime matrisi tablosunda (5432, 6379, 9080, 8080, 8000, 3000, 3001).
Yerel hardcode / varsayılan: Kısa tablo — hangi portun package.json/script’te sabit olduğu, QA worker’ın varsayılan 8080 URL’si, ai-engine HF varsayılanının BitNet track’e ait olduğu, R3MES_SKIP_LLAMA anlamı. “Prod adresi değil, yerel mutabakat” net yazıldı.
BitNet ayrı track: Ayrı alt başlık; golden path’e zorunlu değil; Windows/Qwen doğrulama cümlesi sadeleştirildi.
Windows: Dört madde (ASCII GGUF, win-x64, ai-engine run-ai-engine-dev.ps1, pnpm.cmd).
Sağlık + log: Tablolar kısaltıldı; tekrar yok.
Kök README.md
Uzun port listesi kaldırıldı; tek link + “Docker ne yapar” tek cümle.
Başarı kriteri: Yeni gelen biri önce infrastructure/README.md → Yerel golden path ile “hangi servis ne yapıyor?” sorusunu tek yerden çözebilir; BitNet ile karışmaz.

------

Özet
Eklenen tek giriş
docs/LOCAL_DEV.md — kısa servis haritası, tek golden path kuralı, yerel sabitler (start-all / env), BitNet = ayrı track (ADR-003), Windows için infrastructure/README’ye yönlendirme.
Bağlantılar
Kök README.md üstüne ve “hangi süreç ne?” satırına LOCAL_DEV önceliği.
infrastructure/README.md girişine “kısa özet → LOCAL_DEV” satırı.
Drift
INTEGRATION_CONTRACT.md §6 — yerel port/servis için LOCAL_DEV; API matrisi orada değil.
Başarı ölçütü
Yeni biri önce docs/LOCAL_DEV.md ile “hangi servis ne yapıyor?” ve portları görür; detay, health, log ve Windows notları infrastructure/README.md içinde kalır. BitNet yalnızca ADR-003 + kısa hatırlatma ile ayrı track; golden path’e zorunlu marka olarak gömülmez.

----

Ne yaptık
apps/dApp/lib/ui/r3mes-fe-contract.ts (tek kaynak)

Üstte JSDoc: GGUF tek primer artefakt, safetensors / sunucu dönüşümü varsayılmaz; pazaryeri yalnızca ACTIVE; chat adaptör veya CID zorunlu.
STUDIO_WEIGHT_EXTENSION, isStudioWeightFilename, STUDIO_FILE_INPUT_ACCEPT, STUDIO_MULTIPART_FIELD_WEIGHTS — uzantı / accept / multipart alan adı buradan; başka dosyada tekrar .gguf veya "weights" yazılmıyor.
MARKETPLACE_ADAPTER_QUERY_STATUS — marketplace isteği bu sabitle.
studioUpload metinleri burada; product-copy artık bunu re-export ediyor (eski import’lar çalışır).
CHAT_REQUIRES_ADAPTER_OR_CID — ürün kuralı için sembolik sabit (arama / dokümantasyon).
Güncellenen tüketiciler

adapters.ts: status= artık MARKETPLACE_ADAPTER_QUERY_STATUS (string "ACTIVE" dağılması yok).
studio-upload-panel.tsx: isStudioWeightFilename, STUDIO_FILE_INPUT_ACCEPT, STUDIO_MULTIPART_FIELD_WEIGHTS kullanıyor.
Drift’e karşı
GGUF / accept / partition tek yerde; safetensors tekrar eklemek için bu dosyayı (ve ORTAK’ı) güncellemek gerekir.
ACTIVE vs Studio lifecycle üst bilgi + marketplace sorgusu aynı modülde birlikte anılıyor.
Başarı kriteri: Format ve lifecycle semantiği r3mes-fe-contract.ts üzerinden sabitlendi; bulanıklaşma için önce bu dosyaya bakılır.

-------

Özet: Drift’i kanon + kod + kalıcı kural ile sabitledim; GGUF dışı beklenti, çoklu artefact ve “henüz onaylanmamış modelle sohbet” senaryoları netleşti.

1. Kalıcı rehber (Cursor)
.cursor/rules/r3mes-adapter-lifecycle.mdc — her oturumda uygulanır: INTEGRATION_CONTRACT tek kaynak, GGUF/tek weights, zip/safetensors eğitim metninin üretimle karıştırılmaması, pazaryeri ACTIVE, chat için ACTIVE zorunluluğu.

2. FE: tek primer artefact (ürün dili + davranış)
studio-upload-panel.tsx: tek File, multipart’ta tek weights alanı; multiple kaldırıldı; sürüklenen çoklu dosyada son geçerli GGUF seçilir.
r3mes-fe-contract.ts: metinler “tam olarak bir GGUF”, “ikinci weights yok” olacak şekilde güncellendi; fileListLabel buna göre.
3. Backend: ACTIVE olmayan adaptörle chat (beklenti netliği)
chatAdapterResolve.ts: adapter_db_id / on_chain_adapter_id ile çözümde Adapter.status === ACTIVE değilse 400 ADAPTER_NOT_ACTIVE (PENDING için açıklayıcı mesaj).
Doğrudan adapter_cid ile gelen istek eskisi gibi (durum kontrolü yok; INTEGRATION_CONTRACT’ta not düştüm).
4. Kanon dokümantasyon
docs/api/INTEGRATION_CONTRACT.md §3.5: chat çözümünde ACTIVE şartı, ADAPTER_NOT_ACTIVE, doğrudan CID istisnası.
5. Testler
chatAdapterResolve.test.ts + integration.contract.test.ts güncellendi; yeni senaryo: PENDING → ADAPTER_NOT_ACTIVE.
Sonuç: Format/lifecycle semantiği hem belgede hem FE sözleşmesinde hem backend’de hizalı; pazaryeri zaten ACTIVE ile sınırlı, chat de DB üzerinden seçimde aynı çizgiye çekildi — PENDING model “pazar + sohbet hazır” beklentisine karışmaz.
