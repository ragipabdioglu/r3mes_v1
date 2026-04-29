Veritabanı sorgusu tamamlandı. Özet rapor ve tek cümlelik kök neden aşağıda.

Hangi tr-v1 kayıtları?
adapterId	name	weightsCid	benchmarkJobId (beklenen)	createdAt / updatedAt	Receipt
cmnyr8vtn0002kloc6okg1cqv
tr-v1
QmbwrjB5Vfdm1NofmBZhTPdwi4BHcSgG4A98SNEiwpLFMm
benchmark-0-QmbwrjB5Vfdm1NofmBZhTPdw
2026-04-14T15:06:57.947Z — updatedAt = createdAt
yok
cmnyr9yld0005klociqqk9gl0
tr-v1
(aynı CID)
(aynı jobId)
2026-04-14T15:07:48.193Z — updatedAt = createdAt
yok
İki kayıt da aynı weightsCid ile iki kez upload edilmiş; ikisi de hiç güncellenmemiş (sadece create anı).

Zincir durumu (veriye göre)
Adım	Durum
Upload accepted
Evet — satırlar DB’de, weightsCid dolu.
Job enqueue
Muhtemelen evet — benchmarkJobId formülü jobProducer ile uyumlu (benchmark-0-<cid24>); kayıt yokluğu upload sonrası API logundan doğrulanabilir.
Worker consume / benchmark
Kanıt yok — DB’de ilerleme yok.
POST /v1/internal/qa-result
Gelmemiş — QaWebhookReceipt tablosunda bu jobId için satır yok (receipt: null).
DB status güncellemesi
Olmadı — internalQa yalnızca başarılı callback’te ACTIVE/REJECTED yazar; updatedAt hâlâ upload anı.
Neden hâlâ PENDING_REVIEW? (tek cümle)
QA webhook hiç başarılı işlenmediği için (QaWebhookReceipt yok = POST /v1/internal/qa-result ya hiç çağrılmadı ya da HMAC/404 ile reddedildi); backend status’u yalnızca bu callback ile değiştirir.

Bunu kapatmak için tek sonraki adım
QA worker’ı aynı REDIS_URL / r3mes-benchmark kuyruğu ve BitNet llama ile çalışır durumda doğrula.
Worker env: R3MES_BACKEND_QA_WEBHOOK_URL = çalışan API …/v1/internal/qa-result, R3MES_QA_WEBHOOK_SECRET = backend R3MES_QA_WEBHOOK_SECRET ile aynı.
Worker logunda bu jobId için işlem / post_qa_result / hata satırlarına bak.
Callback geldikten sonra verify:lifecycle-chain ile receipt doğrula.
İsterseniz tekrar upload yerine, tek adapter için manuel doğrulama: job hâlâ kuyruktaysa worker’ı düzeltip aynı jobId ile tamamlanmasını bekleyin; veya yeni bir upload öncesi duplicate tr-v1 kayıtlarını ürün politikasına göre temizleyin.

Teşhis aracı: Aynı sorguyu tekrarlamak için apps/backend-api/scripts/diag-tr-v1-pending.mjs eklendi (DATABASE_URL ile çalıştırın).

Başarı kriteri: “Neden İncelemede?” → Callback DB’ye hiç yazılmadı (receipt yok); bir sonraki eylem worker + webhook secret + URL hizası.



































Kimlikler (DB, tr-v1 isim eşleşmesi)
#	adapterId	weightsCid	benchmarkJobId (enqueue formülü)	createdAt	updatedAt
1
cmnyr8vtn0002kloc6okg1cqv
QmbwrjB5Vfdm1NofmBZhTPdwi4BHcSgG4A98SNEiwpLFMm
benchmark-0-QmbwrjB5Vfdm1NofmBZhTPdw
2026-04-14T15:06:57.947Z
2026-04-14T15:06:57.947Z
2
cmnyr9yld0005klociqqk9gl0
(aynı)
(aynı)
2026-04-14T15:07:48.193Z
2026-04-14T15:07:48.193Z
Aynı dosya iki kez yüklenmiş; beklenen tek benchmarkJobId yukarıdaki.

Zincir (veriyle)
Adım	Sonuç
Upload / kayıt
Var — iki Adapter satırı, weightsCid dolu, updatedAt = createdAt (upload sonrası başka güncelleme yok).
Benchmark job (beklenen)
Upload sözleşmesine göre benchmark-${onChainId}-${cid[:24]} → benchmark-0-QmbwrjB5Vfdm1NofmBZhTPdw.
Worker işledi mi?
DB’den kanıt yok — adapter satırı hiç güncellenmemiş.
Webhook geldi mi?
Hayır — QaWebhookReceipt içinde bu jobId için satır yok (receipt: null). Başarılı callback olsaydı receipt + Adapter.status güncellenirdi.
Tek cümle: neden hâlâ PENDING_REVIEW?
POST /v1/internal/qa-result hiç başarıyla tamamlanmadığı için (QaWebhookReceipt yok), backend internalQa akışı Adapter satırını güncellemedi; varsayılan PENDING_REVIEW kaldı.

Tek sonraki adım (kapatmak için)
QA worker’ı (Redis kuyruğu + BitNet llama + doğru env) çalışır hale getirip bu job’u işletmek veya kuyruk durumunu doğrulamak: özellikle R3MES_BACKEND_QA_WEBHOOK_URL = çalışan API’nin /v1/internal/qa-result adresi ve R3MES_QA_WEBHOOK_SECRET’in backend ile birebir aynı olması; ardından worker logunda benchmark-0-QmbwrjB5Vfdm1NofmBZhTPdw ve post_qa_result / hata satırlarına bakın.

Tekrar teşhis: apps/backend-api/scripts/diag-tr-v1-pending.mjs (DATABASE_URL ile).

Başarı kriteri: “İncelemede” sorusunun cevabı veri tarafında: callback DB’ye yazılmadı (receipt yok); bir sonraki eylem worker + webhook hizası, tahmin değil.

-----------

Durum net: Çözüm zaten uygulanmış; aşağıda özet ve doğrulama var.

Hangi env eksikti?
isFeeConfigured() için getOperatorKeypair() şart. R3MES_OPERATOR_PRIVATE_KEY tanımlı değilken (yorum satırında) keypair null kalıyor → ücret yolu açıkken 503 CHAT_FEE_NOT_CONFIGURED.
R3MES_PACKAGE_ID ve R3MES_REWARD_POOL_OBJECT_ID .env içinde mevcut; asıl eksik operatör anahtarıydı.

Seçilen çözüm
R3MES_SKIP_CHAT_FEE=1 — apps/backend-api/.env içinde şu an aktif:

R3MES_SKIP_CHAT_FEE=1
Bu, geliştirme/test için önerilen hızlı yol (NODE_ENV=production iken uygulama bu bayraklara izin vermez — app.ts).

503 kapandı mı?
Mantık: R3MES_SKIP_CHAT_FEE=1 iken shouldSkipChatFee() true → ücret bloğu çalışmıyor → bu 503 üretilmez.
Doğrulama: POST /v1/chat/completions entegrasyon testi (fetch mock, R3MES_SKIP_CHAT_FEE stub) 200 döndü; fee kaynaklı 503 yok.
Canlı backend’de görmek için süreç .env ile başlamalı (node --env-file=.env veya eşdeğeri). Backend’i yeniden başlattıysan env yüklüdür.

Chat bir sonraki blokaja kadar nerede “açık”?
Engel	Kod / not
Ücret 503
R3MES_SKIP_CHAT_FEE=1 ile kalktı.
401
İmzalı X-Signature / X-Message / X-Wallet-Address yoksa; yerel test için isteğe bağlı R3MES_SKIP_WALLET_AUTH=1 + R3MES_DEV_WALLET.
400
Adapter çözümü (adapter_cid veya geçerli ACTIVE kayıt).
Upstream
ai-engine (8000) ve gerekirse llama / model — fee değil.
Başarı kriteri: Chat, fee config eksikliği yüzünden 503 ile bloklanmıyor; bir sonraki sınırlar cüzdan, adapter ve ai-engine/llama tarafıdır.