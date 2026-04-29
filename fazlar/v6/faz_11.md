Repodaki yazılı resmi kaynak (infrastructure/lora-trials/runs/2026-04-14_tr-v1/TRIAL_RECORD.md, fazlar/v6/faz_10.md) ile hizalı yanıt aşağıdadır. Burada benchmark skoru / ACTIVE / REJECTED için sayı veya durum uydurulmuyor — çünkü trial kaydında bu alanlar henüz dolu değil.

Tek cümle (resmi sonuç — repo gerçeği)
tr-v1 için ilk gerçek BitNet LoRA GGUF üretimi ve yerel llama-server doğrulaması tamamlanmıştır; ürün hattındaki gizli benchmark skoru ve terminal status bu repoda henüz kayıtlı değildir — ürün trial’ı (upload → QA → benchmarkScore → verify) tamamlanınca sonuç tek cümleyle TRIAL_RECORD üzerinden sabitlenecektir.

(Kaynak: TRIAL_RECORD.md: “Ürün hattı bu oturumda çalıştırılamadı … upload/QA üretilemedi”; faz_10.md: export + smoke OK, “Sonraki tek adım: Upload / QA turu”.)

Sonuç raporu (istenen format)
Alan	Net ifade
tr-v1 sonucu ne oldu
Üretim tarafı: Başarılı — tr-v1.gguf, general.type=adapter, llama smoke 200 (faz_10). Ürün trial tarafı: Bu repoda tamamlanmış sonuç yok — adapterId / benchmarkScore / status / OFFICIAL_VERIFY_LINE alanları boş; blokaj: Docker/backend kapalı, zincir koşturulamadı (TRIAL_RECORD.md).
Ürün açısından ne anlama geliyor
Zincir ölçülmeden “ilk gerçek ürün trial’ı bitti” denemez: anlam, teknik artefakt hazır, kalite ve yayın kararı ise benchmark + status + verify ile gelecek. ACTIVE veya REJECTED ikisi de anlamlıdır — ama yalnızca bu ölçümler yazıldığında tartışmasız olur.
İkinci tur açılmalı mı
Yeni veri / tr-v2 eğitim turu için değil; önce aynı tr-v1 artefaktı ile ürün hattını tamamlayıp TRIAL_RECORD doldurulmalı. İkinci tur (veri/hipere genişleme), skor + status + verify sonucuna göre açılır.
Şablon: ölçüm tamamlandığında (ekip metni)
Durum	Resmi anlatım (kısa)
ACTIVE
Gizli Türkçe benchmark eşiğini ve ürün politikalarını geçen ilk gerçek üretim adayı; chat/verify ile uyumlu yayınlanabilir adapter.
REJECTED
Üretim artefaktı geçerli olsa da kalite çubuğu altında; sebep ürün skoru (referansla uyum), runtime değil — bir sonraki tur veri/eğitim ekseninde iyileştirme.
Başarı ölçütü / sonraki karar kapısı (hatırlatma)
Başarı (bu tur): Ürün anlamında “tamam” = TRIAL_RECORD içinde ölçülebilir benchmarkScore, terminal status, verify satırı.
Bir sonraki eksen: Bu üçlü sabitlenene kadar tek eksen: altyapı + upload + QA + kayıt; paralel yeni eğitim turu yok.
Özet: Ekip için tartışmasız olan şey şu an üretim + yerel doğrulama OK, ürün benchmark sonucu repoda henüz yok; ACTIVE/REJECTED cümlesi ölçüm girilince yazılmalı.


------------

Bu oturumda yerel API yanıt vermiyor (GET /health bağlantı hatası) ve Postgres’e erişilemiyor (127.0.0.1:5432). Bu yüzden tr-v1.gguf için gerçek adapterId / benchmarkJobId üretilemedi ve pnpm verify:lifecycle-chain çalıştırılamadı. Zinciri sizin makinede (Docker + backend + QA worker) tamamladığınızda aşağıdaki şablonu doldurmanız yeterli.

Upload anında toplanacaklar (tr-v1.gguf → POST /v1/adapters)
Yanıt gövdesinden kopyalayın:

adapterId (veya adapterDbId)
weightsCid
benchmarkJobId
Örnek: {"adapterId":"…","weightsCid":"Qm…","benchmarkJobId":"benchmark-0-Qm…",...}

QA bittikten sonra
GET http://127.0.0.1:3000/v1/adapters/<adapterId>
Buradan benchmarkScore ve status (ACTIVE / REJECTED / PENDING_REVIEW) sabitlenir.

Verify (API ve DB aynı ortam):

cd apps/backend-api
$env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/r3mes"
$env:R3MES_VERIFY_BASE_URL="http://127.0.0.1:3000"
pnpm verify:lifecycle-chain -- --adapter-id <adapterId> --job-id <benchmarkJobId>
Çıktının sonunda OFFICIAL_VERIFY_LINE üretilir; TRIAL_RECORD.md ve ürün kanıt arşivine yapıştırılır.

Sonuç raporu şablonu (siz dolduracaksınız)
Alan	Değer (bu oturumda üretilemedi)
adapterId
Upload yanıtından
benchmarkJobId
Upload yanıtından
receipt oluştu mu
verify çıktısında / DB: QaWebhookReceipt + completedAt
benchmarkScore
GET /v1/adapters/:id
status
Aynı endpoint
verify
PASS veya FAIL (script exit code + satır)
OFFICIAL_VERIFY_LINE
verify stdout son satırı
Başarı kriteri (ne zaman “resmi kapandı” dersiniz?)
OFFICIAL_VERIFY_LINE içinde verify=PASS
status=ACTIVE (ürün ACTIVE adayı için) veya politikada tanımlı REJECTED + yine PASS (zincir kapandı kanıtı)
ACTIVE_CANDIDATE_MINIMUM_PROOF.md §1–§6 ile altı alan tamam
Özet: tr-v1.gguf upload’ı ve QA bu ortamda yok; gerçek sayıları almak için stack’i ayağa kaldırıp upload yanıtını ve ardından yukarıdaki verify komutunu çalıştırın. İsterseniz upload JSON çıktısını (adapterId, weightsCid, benchmarkJobId) buraya yapıştırın; bir sonraki adımda verify satırını birlikte netleştiririz.

--------------

Yapılan iş: repo içinde tek runbook eklendi ve üç yere kısa bağlantı kondu.

Yeni dosya: infrastructure/lora-trials/FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md

Bağlantılar: LORA_CANDIDATE_TRIALS.md, FIRST_BITNET_UPLOAD_CHECKLIST.md, infrastructure/README.md.

Sonuç raporu (şablon + sabitler)
Soru	Cevap (runbook’a göre)
Ortam stabil miydi?
Trial sırasında doldurulacak. Önkoşul: Postgres, Redis, gateway 9080, backend 3000, BitNet llama seçilen portta GET /v1/models 200, worker gerçek webhook (L2, mock 3003 değil) — ayrıntı runbook §1–2.
Path / env doğru muydu?
BitNet port = worker R3MES_QA_LLAMA_BASE_URL portu (yalnız BitNet → genelde 8080; Qwen+BitNet yan yana → BitNet 8081, worker 8081). R3MES_BACKEND_QA_WEBHOOK_URL=http://127.0.0.1:3000/v1/internal/qa-result (deploy’da gerçek API kökü). R3MES_QA_LORA_COPY_TARGET = llama-server --lora ile aynı ASCII dosya. Webhook secret worker/backend ile aynı.
Checksum kapısı geçti mi?
Upload öncesi: export/tr-v1.gguf ↔ tr-v1.gguf.sha256 byte eşleşmesi + dosya yalnızca candidates/<trial_id>/export/ — ARTIFACT_LAYOUT.md §6.
Loglar eksiksiz mi?
Minimum: BitNet stderr/stdout, R3MES_QA_WORKER_LOG_FILE ile worker logu, verify:lifecycle-chain çıktısı; backend’de qa_webhook_applied izi. Önerilen kök: logs/profile-bitnet-l2/ veya logs/profile-bitnet-first-product-trial/ — runbook §4.
Başarı kriteri
İlk gerçek trial için port/webhook/slot tek sayfada sabitlendi; path/env hatası “belirsiz” kalmamalı — tartışma ürün skoru / eşik tarafında kalmalı. Çalışma anı doğrulaması runbook’taki kontrol tablolarıyla yapılır; ben sizin makinenizde süreç çalıştırmadım, bu yüzden “stabil miydi” satırı trial sonrası ekibin dolduracağı §5 şablon ile kapanır.

-------------------

Sonuç raporu
Upload başarılı mı?
Hayır. Bu ortamda Docker Desktop çalışmıyor (dockerDesktopLinuxEngine pipe yok), pnpm bootstrap ile Postgres / Redis / IPFS ayağa kaldırılamadı. 127.0.0.1:3000 üzerinde backend yok; POST /v1/adapters çağrısı ECONNREFUSED ile düşüyor. Bu yüzden ürün hattına gerçek yükleme yapılamadı.

adapterId ne?
Üretilemedi — upload tamamlanmadı.

weightsCid ne?
Üretilemedi.

benchmarkJobId ne?
Üretilemedi.

Terminal status ne?
Yok — kuyruk/worker/QA çalışmadı; adapter kaydı oluşmadı. ACTIVE / REJECTED aşamasına gelinemedi.

Teknik hata var mı?
Evet. Özet:

Kontrol	Sonuç
docker compose (Postgres + storage)
Docker API’ye bağlanılamıyor
127.0.0.1:3000/health
Bağlantı yok
127.0.0.1:5432, 6379
Kapalı
Tam zincir için ayrıca backend + QA worker + BitNet llama-server (slot --lora) ve tutarlı .env (ör. R3MES_QA_WEBHOOK_SECRET, geliştirmede R3MES_SKIP_WALLET_AUTH + R3MES_DEV_WALLET) gerekir; bkz. LIVE_RUN.md, FIRST_BITNET_UPLOAD_CHECKLIST.md.

Bir sonraki tek adım ne?
Docker Desktop’ı başlatın.
Repo kökünde: pnpm bootstrap (Postgres + Kubo + Redis + migrate).
apps/backend-api içinde .env ile API’yi açın; @r3mes/qa-worker ve LIVE_RUN.md ile uyumlu BitNet llama sürecini çalıştırın.
Export GGUF’u yüklemek için eklenen komutu kullanın (geliştirmede sunucuda R3MES_SKIP_WALLET_AUTH=1 + R3MES_DEV_WALLET):
cd apps/backend-api
$env:R3MES_E2E_BASE_URL="http://127.0.0.1:3000"
pnpm upload:export-gguf -- "R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\export\tr-v1.gguf"
Yanıttaki adapterId, weightsCid, benchmarkJobId değerlerini TRIAL_RECORD.md içine işleyin; QA bitince pnpm verify:lifecycle-chain -- --adapter-id … --job-id … ile OFFICIAL_VERIFY_LINE ekleyin.
Eklenen dosya: apps/backend-api/scripts/upload-export-gguf.mjs ve package.json içinde upload:export-gguf script’i — tekrarlanabilir gerçek GGUF upload için. Güncellenen: infrastructure/lora-trials/runs/2026-04-14_tr-v1/TRIAL_RECORD.md (blokaj notu + adımlar).