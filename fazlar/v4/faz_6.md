Bu ortamda gerçek bir GGUF dosyasını IPFS’e pinleyip worker’ı çalıştıramıyorum; aşağıdaki metin Faz 6’yı sizin makinede tamamlamak için prosedür + rapor şablonu + hata sınıflarıdır. Kod değişikliği içermez.

1. Artefact seçimi (gerçek LoRA GGUF)
Alan	Ne yapın
Kaynak
Qwen base modelinizle uyumlu, llama.cpp’nin lora-adapters ile yükleyebildiği tek dosyalık LoRA GGUF (ör. llama-export-lora / resmi export pipeline’ınız).
CID
ipfs add veya ipfs files cp ile pin → CID not edin.
Magic / tür
GGUF: genelde GGUF başlığı (dosya başında); emin olmak için: gateway’den ilk birkaç KB veya file / hex dump.
Ürün üzerinden
POST /v1/adapters artık metinde llama.cpp uyumlu LoRA GGUF bekliyor; weights alanına gerçek .gguf dosyasını koyun — böylece weightsCid = benchmark job CID’si aynı blob olur.
Dikkat: e2e-lifecycle-smoke.mjs içindeki sahte minimal blob (PK… ile e2e-smoke.gguf adı) gerçek LoRA değil; Faz 6 kanıtı için kullanmayın (worker’da lora register veya benchmark kırılır veya anlamsız sonuç üretir).

2. Worker + altyapı hizası (özet)
Değişken	Değer
R3MES_QA_LLAMA_BASE_URL
http://127.0.0.1:8080 (Qwen llama-server)
R3MES_IPFS_GATEWAY
Gateway (ör. http://127.0.0.1:9080) — worker indirmesi bu URL üzerinden
REDIS_URL
Backend ile aynı
R3MES_BACKEND_QA_WEBHOOK_URL
http://127.0.0.1:3000/v1/internal/qa-result (veya gerçek PORT)
R3MES_QA_WEBHOOK_SECRET
Backend R3MES_QA_WEBHOOK_SECRET ile aynı (403 olmaması için zorunlu)
Worker’ı bu env ile, Redis ayıkken, 8080 Qwen ayıkken başlatın.

3. Tek gerçek job — izlenecek kanıt
Sıra: consume → download → lora register → benchmark → callback → Prisma status.

Adım	Nerede kanıt
consume
Worker stdout: JSON parse sonrası run_benchmark_job girişi; veya exception yok.
download
nbytes > 0; hata yoksa ipfs_download_failed webhook’u yok.
lora register
lora_register_failed yok; llama log / HTTP 2xx.
benchmark
Job <id> → approved/rejected log satırı veya döngüde exception.
callback
Worker: post_qa_result başarı; backend log: qa_webhook_applied.
status
GET /v1/adapters/:id → ACTIVE veya REJECTED, benchmarkScore dolu.
Kırılırsa webhook gövdesinde veya worker logunda error: alanına bakın (ipfs_download_failed, lora_register_failed, vb.).

4. Hata sınıfları (Faz 6)
Sınıf	Belirti
download / gateway
ipfs_download_failed: ...
lora_register / format
lora_register_failed: ... (HTTP 4xx/5xx, GGUF uyumsuzluğu)
benchmark / inference
Exception Benchmark job işlenemedi veya chat HTTP hatası
callback
QA webhook çağrısı başarısız veya backend 403 (HMAC) / 404 (adapter bulunamadı)
5. Sonuç raporu — doldurulacak şablon
Soru	Kayıt
Kullanılan artefact
Dosya adı, üretim kaynağı, CID, magic/not (GGUF doğrulandı mı)
LoRA register oldu mu?
Evet/Hayır + kısa kanıt
Benchmark tamamlandı mı?
Evet/Hayır + skor veya hata
Callback atıldı mı?
Evet/Hayır + HTTP kodu
Status değişti mi?
PENDING_REVIEW → ACTIVE / REJECTED / değişmedi
Başarısızsa tam hata sınıfı
Yukarıdaki dört sınıftan biri + tam mesaj
Lifecycle kanıtlandı mı?
Evet: ACTIVE/REJECTED + callback; Hayır: takıldığı adım
6. Başarı kriteri
Başarılı: En az bir gerçek LoRA GGUF job’u webhook kabulü ve Prisma’da ACTIVE veya REJECTED ile biter.
Kısmi başarı (Faz 6 için yeterli): Aynı job’da tam kırılma adımı ve hata sınıfı log + webhook ile kanıtlanır.
Özet: Artefact kanonu LoRA GGUF; bunu gerçekten IPFS + kuyruğa taşıyıp worker’ı çalıştırdığınızda raporu doldurmanız Faz 6’nın kapanış kanıtıdır. Bu sohbette sizin CID’niz ve log çıktınız olmadığı için tabloyu siz tamamlamalısınız.

-------

Faz 6 — Sonuç raporu
tüm servisler ayakta mı?
Evet (bu oturumda doğrulandı).

Bileşen	Durum
Postgres
docker compose → r3mes-postgres healthy, pg_isready kabul ediyor
Redis
r3mes-redis-cache healthy, redis-cli PING → PONG
IPFS + gateway
r3mes-ipfs + r3mes-storage-gateway healthy, GET http://127.0.0.1:9080/health → healthy
llama-server (Qwen)
8080 dinliyor, GET /v1/models → 200
backend (Fastify)
3000 dinliyor, GET /health → {"status":"ok"}
worker
Arka planda çalışıyor; Redis’e bağlandı ve kuyruğu dinliyor
pnpm db:migrate ile bekleyen Prisma migration’ları da uygulandı.

runtime stabil mi?
Evet: Qwen GGUF + infrastructure/llama-runtime/win-x64/llama-server.exe ile 8080 üzerinde OpenAI uyumlu uçlar yanıt veriyor; ek çökme gözlenmedi.

worker logları kaydedildi mi?
Evet. R3MES_QA_WORKER_LOG_FILE ile logs\faz6-qa-worker.log oluşturuldu; içinde başlangıç satırları ve sonraki işlem logları var (UTF-8).

test ortamı güvenilir miydi?
Altyapı açısından evet: Sağlık kontrolleri (8080, 9080, Redis, Postgres, backend) tutarlı.
Dikkat: Worker açılır açılmaz kuyruktaki bir işi işledi; LoRA kaydı 400 (/lora-adapters — Qwen/teknik uyum) ve webhook 403 görüldü. Bunlar servislerin düşmesi değil; kuyruk içeriği / LoRA–runtime uyumu / webhook gizli anahtarı ile ilgili uygulama katmanı davranışı. Saf “altyapı gürültüsü” için lifecycle denemesinden önce kuyruğu temizlemek veya webhook/HMAC ayarını doğrulamak iyi olur.

altyapı kaynaklı ek blocker var mı?
Hayır: Docker, ağ portları, DB, Redis, gateway ve llama HTTP katmanı bu kontrollerde blocker üretmedi.
Not: Windows’ta pnpm ile arka plan süreçleri için pnpm.cmd kullanmak gerekebilir (pnpm doğrudan Win32 exe değil). Backend logları: backend-faz6-stdout.log / backend-faz6-stderr.log; llama: llama-server-faz6-stdout.log / llama-server-faz6-stderr.log.

Başarı kriteriyle özet: Ortam, lifecycle denemesi için gerekli servisleri aynı anda ayakta tutuyor ve test öncesi sağlık kontrolleri geçiyor; worker logları dosyada kalıcı. Kuyruktan gelen 400/403 satırları, altyapı yerine iş yükü ve yapılandırma tarafını işaret eder; istersen bir sonraki adımda sadece o kısmı (boş kuyruk, QA_WEBHOOK_SECRET, LoRA uyumu) netleştirebiliriz.

--------

Canlı ortama buradan bağlanamıyorum; aşağıdaki tabloyu siz dolduracaksınız. GGUF burada yalnızca “artefact/worker tarafı doğru” anlamında; /v1/internal/qa-result gövdesi yine JSON (jobId, adapterCid, status, score, …) — backend handler dosya formatını ayırt etmez, CID + jobId + HMAC ile çalışır.

Doğrulama sırası
#	Ne	Nasıl
1
Callback geldi mi
API / reverse proxy log: POST /v1/internal/qa-result
2
HTTP + hata sınıfı
200 / 400 / 403 / 404 / 409 / 500 / 503 (önceki Faz özetlerindeki tabloyla eşle)
3
Receipt
QaWebhookReceipt: jobId, bodySha256, completedAt dolu mu
4
Adapter
status → ACTIVE veya REJECTED; benchmarkScore dolu; updatedAt güncel
5
Zincir temiz mi
200 (veya idempotent 200 + duplicate) + receipt tamamlandı + adapter satırı uyumlu
Önkoşul: body.adapterCid = DB’deki weightsCid veya manifestCid ile aynı string; jobId worker ile anlaşılan id ile uyumlu.

Sonuç raporu (şablon)
Alan	Değer
callback geldi mi
evet / hayır
200 / 4xx / 5xx ne döndü
receipt oluştu mu
evet / hayır (completedAt?)
status değişti mi
evet / hayır (ACTIVE / REJECTED)
benchmarkScore yazıldı mı
evet / hayır
backend zinciri temiz mi
evet / hayır
Başarı kriteri (tek cümle)
İlk gerçek GGUF denemesinde, ilgili job için POST /v1/internal/qa-result → 200, QaWebhookReceipt.completedAt dolu, Adapter.status ve benchmarkScore güncellenmiş ise backend callback zinciri bu uçta uçtan uca doğrulanmış sayılır.

Not: Sorun “GGUF” ise genelde worker/benchmark katmanında görünür; callback hiç yoksa veya 404 (CID eşleşmesi yok) ise önce gönderilen adapterCid ile DB’deki weightsCid eşleşmesini kontrol edin.

-----


Bu ortamda canlı adapter lifecycle (test kaydını ACTIVE/REJECTED yapma, tarayıcıda Studio / Marketplace / Chat) çalıştırılamıyor; doğrulama sizin tarafta yapılmalı. Aşağıdaki rapor, FE kodunun bu akışa göre neyi garanti ettiğini ve manuel QA’da neye bakacağınızı özetler.

Sonuç raporu şablonu (Faz 6 — canlı doldurulacak)
Soru	Kod tarafı (beklenen)	Canlı doğrulama notu
Studio güncellendi mi?
GET /v1/adapters?limit=100 + ownerWallet süzmesi, cache: "no-store". status → rozet (ACTIVE = Aktif, reddedilenler = Reddedildi, diğer = İncelemede).
Status backend’de değiştikten sonra Studio’da «Yenile» veya sayfayı yenileyin; otomatik poll yok.
Marketplace doldu mu?
Yalnızca GET /v1/adapters?status=ACTIVE. Kartlar benchmark sıralı.
ACTIVE olduktan sonra kart için tam sayfa yenileme veya bir süre bekleyin (ISR ~30 sn gecikme olabilir).
Chat prefill doğru mu?
Kart linki: /chat?adapter=<id> (+ varsa &cid=...). Chat URL’den okur.
Karta tıklayınca alanların dolu olduğunu kontrol edin.
FE ek bug var/yok
Mantık önceki turlarla uyumlu; ek bug iddiası için önce API yanıtlarını doğrulayın.
Tutarsızlıkta: NEXT_PUBLIC_BACKEND_URL, aynı id/status/ipfsCid JSON’u.
Sizin yapacağınız 4 adım (özet)
Test adapter’ında status ACTIVE veya REJECTED olduktan sonra Studio → Yenile → rozet beklenenle aynı mı?
ACTIVE ise / → marketplace’te kart var mı? (Gerekirse yenile / kısa bekleme.)
Karttan Chat → adapter ve varsa cid doğru mu?
Tabloyu Evet/Hayır ve kısa gözlemle doldurun.
Başarı kriteri
İlk gerçek lifecycle sonucunun eksiksiz yansıması için: backend’in liste endpoint’lerinde kayıt gerçekten güncellenmiş olmalı; FE bu veriyi filtrelemeden uydurmuyor. Sorun devam ederse önce API çıktısı, sonra önbellek / yenileme; FE’ye ikincil bakılır.


------

Sonuç raporu (Faz 6 — ilk gerçek GGUF lifecycle kanıtı)
Kanona yansıması gereken bir şey var mı?
Hayır (şu an). Artefact kanonu zaten §3.3.1 ile sabit; canlı kanıt dosyası yeni wire / JSON şeması getirmiyor. İlk başarılı koşu, kanonu doğrulayan operasyon kaydı olarak yeterli; ek dörtlü senkron yalnızca kanıtta ölçülen gerçek davranış §3.3.1’den farklı çıkarsa gerekir (FAZ3 governance, Faz 7 kuralı).

Varsa ne?
Yapılanlar: Tek kaynak belge ve bağlantılar eklendi — dağınık Slack/PR kanıtı yerine sabitlenecek yer.

Dosya	İçerik
docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md
Başarı koşulu (tek cümle), minimum kanıt tablosu, SUCCESS / FAILURE şablonları, kanona yansıma kuralları, durum PENDING (ilk canlı koşu buraya işlenecek).
docs/api/INTEGRATION_CONTRACT.md §6
Drift tablosuna bu belgeye tek kaynak satırı.
docs/api/FAZ3_CONTRACT_GOVERNANCE.md
Faz 6 bölümüne kanıt dosyası referansı.
infrastructure/RELEASE_CHECKLIST.md
AI sürümü için kanıt özeti okuma notu.
apps/backend-api/README.md, fazlar/v3/faz_6.md, INTEGRATION_CONTRACT.md (kök)
Keşif bağlantıları.
Başarı notu / failure note
Tür	Durum
Başarı notu
Henüz doldurulmadı — ekip ilk SUCCESS koşusunu GGUF_LIFECYCLE_PROOF_FAZ6.md içindeki “Sonuç kaydı” + “Başarı notu” bölümlerine yazacak.
Failure note
Henüz yok — başarısızlıkta aynı dosyada “Failure notu” + kök neden sınıfı; kanona aykırılık iddiası varsa önce burada, sonra ORTAK süreci.
Başarı koşulu (belgede sabitlenen tek cümle): Aynı LoRA GGUF CID’si ile upload → kuyruk → QA (lora-adapters) → webhook → chat çözümü zincirinden en az biri ölçülebilir şekilde tamamlanır ve davranış §3.3.1 ile uyumlu doğrulanır.

Başarı ölçütünüz: Canlı kanıt artık dağınık kalmıyor; tek kaynak docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md. İlk gerçek koşu sonrası yalnızca bu dosyayı SUCCESS veya FAILED ile güncellemeniz yeterli.Sonuç raporu (Faz 6 — ilk gerçek GGUF lifecycle kanıtı)
Kanona yansıması gereken bir şey var mı?
Hayır (şu an). Artefact kanonu zaten §3.3.1 ile sabit; canlı kanıt dosyası yeni wire / JSON şeması getirmiyor. İlk başarılı koşu, kanonu doğrulayan operasyon kaydı olarak yeterli; ek dörtlü senkron yalnızca kanıtta ölçülen gerçek davranış §3.3.1’den farklı çıkarsa gerekir (FAZ3 governance, Faz 7 kuralı).

Varsa ne?
Yapılanlar: Tek kaynak belge ve bağlantılar eklendi — dağınık Slack/PR kanıtı yerine sabitlenecek yer.

Dosya	İçerik
docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md
Başarı koşulu (tek cümle), minimum kanıt tablosu, SUCCESS / FAILURE şablonları, kanona yansıma kuralları, durum PENDING (ilk canlı koşu buraya işlenecek).
docs/api/INTEGRATION_CONTRACT.md §6
Drift tablosuna bu belgeye tek kaynak satırı.
docs/api/FAZ3_CONTRACT_GOVERNANCE.md
Faz 6 bölümüne kanıt dosyası referansı.
infrastructure/RELEASE_CHECKLIST.md
AI sürümü için kanıt özeti okuma notu.
apps/backend-api/README.md, fazlar/v3/faz_6.md, INTEGRATION_CONTRACT.md (kök)
Keşif bağlantıları.
Başarı notu / failure note
Tür	Durum
Başarı notu
Henüz doldurulmadı — ekip ilk SUCCESS koşusunu GGUF_LIFECYCLE_PROOF_FAZ6.md içindeki “Sonuç kaydı” + “Başarı notu” bölümlerine yazacak.
Failure note
Henüz yok — başarısızlıkta aynı dosyada “Failure notu” + kök neden sınıfı; kanona aykırılık iddiası varsa önce burada, sonra ORTAK süreci.
Başarı koşulu (belgede sabitlenen tek cümle): Aynı LoRA GGUF CID’si ile upload → kuyruk → QA (lora-adapters) → webhook → chat çözümü zincirinden en az biri ölçülebilir şekilde tamamlanır ve davranış §3.3.1 ile uyumlu doğrulanır.

Başarı ölçütünüz: Canlı kanıt artık dağınık kalmıyor; tek kaynak docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md. İlk gerçek koşu sonrası yalnızca bu dosyayı SUCCESS veya FAILED ile güncellemeniz yeterli.