Bu ortamda Qwen runtime veya sizin backend’e bağlanıp gerçek bir ACTIVE geçişini çalıştıramıyorum; doğrulama kod yolu + sözleşme üzerinden yapılabilir. Canlı QA’yı siz tarayıcıda yapınca aynı başlıklarla sonucu işaretlersiniz.

Sonuç raporu (lifecycle yansıması — FE kod doğrulaması)
Soru	Kod / davranış özeti
Studio güncellendi mi?
Evet (backend status ne dönerse): fetchTrainerAdapters → GET /v1/adapters?limit=100, ownerWallet ile süzme, cache: "no-store". Rozet getAdapterStatusKind(status) ile: ACTIVE → Aktif, PENDING_REVIEW → İncelemede, reddedilen statüler → Reddedildi. Liste mount’ta ve «Yenile» ile yeniden yüklenir; otomatik poll yok — status backend’de değiştikten sonra kullanıcı yenilemezse ekran eski kalabilir (bu bir veri bug’ı değil, yenileme beklentisi).
Marketplace doldu mu?
ACTIVE kayıtlar için evet: fetchActiveAdaptersSorted → GET /v1/adapters?status=ACTIVE. Sadece ACTIVE satırlar listelenir. Next.js revalidate: 30 ile pazaryeri en fazla ~30 sn gecikmeli güncellenebilir; ACTIVE yeni oluştuysa kısa süre boş görünebilir.
Chat prefill doğru mu?
Evet: Pazaryeri kartı href="/chat?adapter=<id>" (+ varsa &cid=<ipfsCid>). Chat useSearchParams ile adapter / cid okuyup alanlara yazar; URL değişince useEffect ile güncellenir.
FE ek bug var/yok?
Belirgin mantık hatası yok: ACTIVE olmayan model marketplace’e bilerek alınmıyor; chat parametreleri kartla uyumlu. Dikkat: Studio manuel yenileme, marketplace ISR gecikmesi.
Sizin yapmanız gereken canlı QA (Qwen + backend)
Adapter ACTIVE olduktan sonra Studio’da «Yenile» → rozet Aktif mi?
GET .../v1/adapters?status=ACTIVE ile aynı kayıt var mı? Pazaryerde kart görünüyor mu? (Gerekirse ~30 sn veya tam sayfa yenileme.)
Karta tıkla → Chat’te adaptör kimliği (ve varsa IPFS) dolu mu?
Başarı kriteri: Yukarıdaki üç adım tarayıcıda tutarlıysa, lifecycle sonucu ekranlara FE tarafında eksiksiz yansıyor demektir; tutarsızlık önce API yanıtını, sonra NEXT_PUBLIC_BACKEND_URL ve önbelleği kontrol edin.

------

Canlı sisteme buradan bağlanamıyorum; aşağıdaki adımlar ve tablo sizin ortamınızda doldurulacak. Amaç: Qwen runtime’dan gelen QA sonucunun /v1/internal/qa-result ile gerçekten status + score yazıp yazmadığını kanıtlamak.

1. Önkoşullar
Worker, POST /v1/internal/qa-result adresine (doğru host/port) gidiyor.
R3MES_QA_WEBHOOK_SECRET hem worker hem API’de aynı.
Gövde ham JSON; HMAC aynı bayt dizisi üzerinde (X-QA-HMAC = HMAC-SHA256(secret, rawBody) hex).
jobId ile upload yanıtındaki benchmarkJobId (veya sizin sözleşmenizdeki job id) uyumlu.
2. İzleme sırası
#	Kontrol	Nasıl
1
Callback geldi mi
API access log / backend log’da POST /v1/internal/qa-result satırı
2
HTTP kodu
200 / 4xx / 5xx aynı istek için
3
Receipt
DB: QaWebhookReceipt satırı (jobId), completedAt
4
Adapter
DB: ilgili Adapter.id → status, benchmarkScore, updatedAt
5
Pazaryeri verisi
GET /v1/adapters — status: ACTIVE satırı listeleniyor mu (FE genelde ACTIVE filtreler)
200 + duplicate: Aynı gövde tekrar → duplicate: true; adapter ikinci kez güncellenmez (beklenen).

3. Sonuç raporu (şablon)
Alan	Değer
callback geldi mi
evet / hayır
200 / 4xx / 5xx ne döndü
(ör. 200, 403, 404, 409, 500)
receipt oluştu mu
evet / hayır (QaWebhookReceipt, completedAt dolu mu)
status değişti mi
evet / hayır (ACTIVE veya REJECTED)
benchmarkScore yazıldı mı
evet / hayır (sayı)
backend zinciri temiz mi
evet / hayır (200 + receipt + adapter uyumu)
4. Başarı kriteri (tek cümle)
Runtime sonrası, en az bir gerçek job için callback logda görünür, yanıt 200 (veya idempotent 200 duplicate), QaWebhookReceipt.completedAt dolu, Adapter.status ACTIVE/REJECTED ve benchmarkScore doluysa — backend tarafı bu lifecycle için uçtan uca doğrulanmış sayılır.

5. Marketplace notu
Backend listesi PENDING_REVIEW kayıtlarını da döndürebilir; “pazaryeri boş” çoğu zaman istemci yalnızca ACTIVE gösteriyor demektir. Veri hazırlığı = status === ACTIVE ve liste endpoint’inde görünürlük; bunu DB + GET /v1/adapters ile teyit edin.

Not: BitNet / Qwen model ayrımı backend’de yok; backend yalnızca webhook gövdesindeki status, score, adapterCid / jobId ile çalışır. Sorun worker veya HMAC’teyse HTTP kodu ve log bunu gösterir; canlı ölçüm olmadan “backend temiz/kirli” demek mümkün değil.

--------

Aşağıdaki metin kod değişikliği içermez; repo içi gerçekleri ve Qwen + worker hizalaması için doğrulama listesi + hata sınıfları + rapor şablonu verir.

1. Worker ortamı (Qwen @ 8080)
Değişken	Beklenen	Kaynak
R3MES_QA_LLAMA_BASE_URL
http://127.0.0.1:8080
r3mes_qa_worker.settings.qa_llama_base_url — worker’ın /lora-adapters ve /v1/chat/completions çağrıları buraya gider.
R3MES_IPFS_GATEWAY
Çalışan gateway (ör. http://127.0.0.1:9080)
download_ipfs_artifact → GET {gateway}/ipfs/{cid}
R3MES_BACKEND_QA_WEBHOOK_URL
http://localhost:3000/v1/internal/qa-result (veya backend’in gerçek PORT’u)
backend_qa_webhook_url — 3000 ile apps/backend-api PORT uyumlu olmalı.
R3MES_QA_WEBHOOK_SECRET
Backend’deki R3MES_QA_WEBHOOK_SECRET ile aynı string
Worker post_qa_result içinde canonical JSON (sort_keys=True, separators=(",", ":")) üzerinden HMAC-SHA256 → X-QA-HMAC. Backend qaHmac.ts ham gövdeyi doğrular. Sır farklıysa callback 403.
REDIS_URL
Backend’deki REDIS_URL ile aynı
redis://127.0.0.1:6379 vb.
Çalışma dizini
Worker .env için pydantic_settings env_file=".env" — işletimde worker’ın cwd’sinde .env yoksa sadece süreç ortamı kullanılır.
Windows’ta .env’i worker’ı başlattığınız dizine koyun veya env’i sistem/servis olarak verin.
Qwen doğrulaması (runtime): Invoke-WebRequest / curl ile http://127.0.0.1:8080/v1/models veya bilinen bir health; gerçek token üretimi için kısa chat/completions (siz zaten aldığınızı söylediniz).

R3MES_SKIP_LLAMA (ai-engine): QA worker’ı doğrudan etkilemez; ai-engine ayrı süreç. Bu turda base Qwen kullanıyorsunuz; worker yalnızca R3MES_QA_LLAMA_BASE_URL ile hizalanmalı.

2. Ürün hattı ile kritik uyarı (artefact)
POST /v1/adapters multipart akışı şu an en az bir .safetensors istiyor ve weightsCid olarak IPFS’e bunu yazıyor; enqueueBenchmarkJob bu CID’yi kullanıyor.

QA worker ise indirilen dosyayı {cid}.gguf diye kaydedip POST .../lora-adapters ile llama.cpp LoRA GGUF yükler gibi kullanıyor.

Sonuç: Stüdyo yüklemesi safetensors ise, lora register / inference aşamasında kırılma “artefact format” sınıfına girer — Qwen ayakta olsa bile GGUF bekleyen runtime ile uyumsuz olabilir.

Faz 4–5’i “gerçek adapter” ile kanıtlamak için pratikte şunlardan biri gerekir:

IPFS’te gerçekten LoRA GGUF içeren bir CID ile job (ör. manuel LPUSH veya ürününüzde GGUF yükleme yolu), veya
Upload/benchmark hattının safetensors → GGUF dönüşümü (şu anki kodda yok).
Aksi halde zincir runtime’ta değil, artefact’ta takılır; bunu logda lora_register_failed: ... veya llama stderr ile görürsünüz.

3. İzlenecek zincir ve log imzaları
Adım	Kanıt (worker log)	Hata sınıfı
consume
Liste/stream’den JSON job; BenchmarkJobPayload parse
queue — Redis/bridge
IPFS download
download_ipfs_artifact başarılı; byte sayısı
download / gateway — ipfs_download_failed webhook
lora register
POST {base}/lora-adapters 2xx
lora_register — lora_register_failed webhook; sık: format/path
benchmark
chat_completion_text döngüsü; score_single
runtime / inference — HTTP 4xx/5xx veya boş cevap
callback
post_qa_result 2xx; backend log qa_webhook_applied
callback — 403 HMAC, 404 adapter, 500 on-chain
Backend: R3MES_QA_WEBHOOK_SECRET yoksa endpoint 403 — callback asla kabul edilmez.

4. Adapter durumu (PENDING_REVIEW → ACTIVE / REJECTED)
internalQa.ts: Webhook 200 ve idempotency OK ise Prisma’da benchmarkScore ve status (ACTIVE / REJECTED) güncellenir.

Callback gelmezse veya 4xx/5xx ise adapter PENDING_REVIEW’de kalır (sizin gözlemle uyumlu).

5. Sonuç raporu — şablon (siz doldurun)
Soru	Sonuç / kanıt
Worker job aldı mı?
Örn. log: Job ... veya Liste job hatası yok; Redis’ten payload işlendi.
Download tamamlandı mı?
Byte > 0; veya ipfs_download_failed yok.
LoRA register oldu mu?
lora-adapters 2xx; veya lora_register_failed metni.
Benchmark tamamlandı mı?
Job ... → approved/rejected log satırı; veya inference exception.
Callback atıldı mı?
Worker: post_qa_result başarılı; backend: e2eLifecycle: qa_webhook_applied veya 403/404 gövdesi.
Adapter status değişti mi?
DB/API: ACTIVE veya REJECTED; değilse PENDING_REVIEW.
Kök neden kaldı mı?
Örn. “HMAC eksik”, “safetensors/GGUF uyumsuzluğu”, “8080 kapalı” vb.
6. Başarı kriteri ile hizalama
En az bir gerçek adapter için uçtan uca sonuç: webhook kabulü + Prisma’da ACTIVE veya REJECTED.
Bunun için aynı anda: Qwen 8080, Redis, doğru IPFS CID içeriği (LoRA GGUF), backend + aynı R3MES_QA_WEBHOOK_SECRET, doğru webhook URL.
BitNet / ggml-model-i2_s.gguf bu hedef için zorunlu değil; sizin seçtiğiniz Qwen base GGUF + uyumlu LoRA artefaktı yeterli.

Özet kök neden ihtimali (sırayla):

Webhook secret / URL uyumsuzluğu → callback yok → status takılı.
Upload CID safetensors → lora/benchmark kırılır.
8080 / gateway → download öncesi veya sonra kırılır.
Bu şablonu tek gerçek job koşusunda doldurduğunuzda Faz 4–5 “kanıt” raporu olarak kullanılabilir.

-------

Teslim: BitNet compatibility spike karar notu
Dosya: docs/adr/ADR-003-bitnet-runtime-compatibility-spike.md

İçerik özeti
Bölüm	Ne
Kapsam
Ayrı track; ürün lifecycle’ını bloklamaz; yalnızca çıkarım/runtime/OS.
Karşılaştırma
qvac-fabric llama-server (mevcut R3MES yolu), Linux/Docker, Windows qvac release, Microsoft resmi BitNet — her biri için R3MES uyumu tek cümlede.
Karar matrisi
Tekrarlanabilirlik, mevcut ai-engine uyumu, LoRA+HTTP, ops riski, Windows ergonomisi.
Öneri
Üretim/doğrulama: Linux + Docker + qvac (golden path). Windows: önce Docker/WSL2 ile B ile aynı imaj; native Windows ikinci planda, sürüm sabitlenir. Resmi MS BitNet şu an birincil seçim değil (HTTP llama-server sözleşmesiyle drop-in değil; ayrı köprü gerekir).
Riskler
qvac API drift, OS farkları — mitigasyon tablosu.
Dış linkler
microsoft/BitNet, tetherto/qvac-fabric-llm.cpp Releases, HF GGUF.
Keşif bağlantısı
docs/ai_architecture.md girişine, bu spike’a giden tek satır eklendi (Faz 0 belgesi ile çelişmeden).

Başarı ölçütü
BitNet için ayrı, net, omurgadan bağımsız tek karar belgesi.
Öneri, mevcut FastAPI → llama-server → GGUF + LoRA hot-swap mimarisini koruyarak en az mimari değişiklik yönünde sabitlendi.
İstersen bir sonraki adımda spike’ı kapatmak için hedef qvac release etiketi + tek onaylı OS matrisi satırını ADR §6’ya birlikte doldurabilirsiniz (şu an placeholder olarak bırakıldı).