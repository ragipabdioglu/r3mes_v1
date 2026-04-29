Aşağıdaki analiz repodaki worker koduna ve tipik llama.cpp / llama-server lora-adapters davranışına dayanır; sizin 400 yanıt gövdesini bu ortamda göremiyorum — tam teknik nedeni kilitlemek için llama’nın döndürdüğü gövde veya aynı isteği curl ile tekrarlamak şart.

1. Worker şu an 400’ün içeriğini kaydetmiyor
register_lora_adapter (llama_client.py) yalnızca r.raise_for_status() kullanıyor; lora_register_failed: {e} webhook’unda genelde httpx özet metni gider, response body otomatik yazılmaz.

İzolasyon: Aynı POST’u elle yapın (worker logundan tam path, id, scale):

POST http://127.0.0.1:8080/lora-adapters
Content-Type: application/json
{"id":0,"path":"<worker'ın kullandığı tam Windows yolu>","scale":1.0}
Dönen 400 gövdesi = llama’nın resmi hata mesajı (çoğu zaman teknik nedeni netleştirir).

2. 400’ü sınıflandırma (Faz 7 hedefi)
Sınıf	Tipik neden	Nasıl ayırt edilir
A — Yanlış dosya türü
Magic GGUF değil; bozuk/truncated indirme
İlk 4–32 bayt: GGUF başlığı; GGUF string
B — GGUF ama LoRA adaptörü değil
Tek dosya tam model GGUF; lora-adapters çoğu build’de LoRA adapter dosyası bekler
Hata metni “not a lora” / “invalid adapter” benzeri; üretim pipeline’ı “full” vs “adapter”
C — Path / süreç görünürlüğü (Windows)
llama-server süreci, worker’ın yazdığı temp path’i okuyamıyor (farklı kullanıcı, sandbox, veya Docker içi llama ↔ host path)
Path C:\Users\... iken llama Docker’da ise dosya orada yok → sık 4xx
D — Unicode / path
Çok nadir; path’te sorunlu karakter
Aynı dosyayı ASCII kısa path’e kopyalayıp tekrar
E — Base / LoRA uyumsuzluğu
LoRA GGUF, yüklenen base Qwen mimarisi ile eşleşmiyor (ör. farklı boyut, yanlış export)
llama stderr veya 400 body’de mimari/tensor uyarısı
Sizin senaryoda (Qwen 8080 + gerçek job + 400): En sık B veya E (yanlış “GGUF” varyantı / base ile uyumsuz LoRA export); bir sonraki sırada C (path, özellikle llama Docker’da ise).

3. Artefact doğrulama (örnek dosya)
Magic: Dosya başında GGUF (ve sürüm alanları) var mı?
Üretim: Export komutu explicit LoRA adapter GGUF mu (tam checkpoint değil)?
Eşleşme: Bu LoRA, 8080’de açık olan base Qwen GGUF ile aynı family / rank / projeksiyon beklentisine uygun mu? (Üretici dokümantasyonu / qvac notları.)
Worker IPFS’ten indirdiği dosya birebir aynı baytlar; isim .gguf olsa da içerik safetensors değilse bile yanlış GGUF alt türü 400 üretebilir.

4. Benchmark / callback’e geçiş şartı
POST /lora-adapters → 2xx
Sonra worker döngüde chat_completion_text çalışır; ardından webhook
400 varken benchmark başlamaz; callback ancak erken ret webhook’u (lora_register_failed) ile — başarılı skor callback’i değil.

5. Sonuç raporu (doldurun)
Soru	Kayıt
Kullanılan artefact neydi?
CID, dosya adı, export komutu / kaynak
400’ün tam hata nedeni ne?
llama HTTP yanıt gövdesi (curl ile alınan) — tek cümle
Runtime hangi LoRA varyantını kabul ediyor?
qvac/llama sürüm notu + 400 body’ye dayalı özet
Benchmark aşamasına geçildi mi?
Evet/Hayır
Callback üretildi mi?
Hangi tür: rejected + lora_register_failed mi, yoksa tamamlanmış skor webhook’u mu?
Kalan kök neden ne?
Örn. “base ile uyumsuz LoRA export” / “Docker path”
6. Başarı kriteri (Faz 7)
Kapalı: 400’ün llama’dan gelen gövdesi ile teknik neden net (yanlış tür / uyumsuz LoRA / path).
İlerleme: Aynı base ile üretici tarafından onaylı bir LoRA adapter GGUF ile lora-adapters 2xx → worker benchmark → webhook (ve mümkünse ACTIVE/REJECTED).
Özet cümle: Worker tarafında bug “400’ü loglamıyor” olabilir; asıl neden neredeyse her zaman llama-server’ın döndürdüğü 400 gövdesi ve dosyanın gerçekten o base için üretilmiş LoRA adapter GGUF olması — bunu curl + magic + export kaynağı ile doğrulayın; Windows’ta llama ile worker aynı makinede ve dosyaya erişebiliyor mu kontrolünü unutmayın.

-------

403’ün tam sebebi backend’de qaHmacPreHandler içinde dönen message alanıyla bire bir eşlenir; canlı yanıt gövdesine bakmanız yeterli.

1. 403 → neden eşlemesi (kod)
message (JSON gövde)	Kök neden
R3MES_QA_WEBHOOK_SECRET yapılandırılmamış
API sürecinde R3MES_QA_WEBHOOK_SECRET yok/boş
Ham gövde eksik
rawBody boş: proxy gövdeyi tüketti, yanlış path, veya aşağıdaki path tuzağı
X-QA-HMAC başlığı zorunlu
X-QA-HMAC header yok
Geçersiz HMAC
Secret veya HMAC’in hesaplandığı bayt dizisi backend ile aynı değil
Geçersiz HMAC biçimi
Header hex değil / parse edilemiyor
Ham gövde yakalama yalnızca tam path için:

    const url = request.raw.url?.split("?")[0] ?? "";
    if (request.method !== "POST" || url !== "/v1/internal/qa-result") {
Trailing slash (/v1/internal/qa-result/) ile istek atılırsa bu koşul sağlanmaz → rawBody set edilmez → çoğunlukla Ham gövde eksik (403).

HMAC: createHmac('sha256', secret).update(raw).digest('hex') — raw = isteğin tam gövde baytları (JSON’un bire bir serileşmesi; boşluk/satır farkı HMAC’i değiştirir).

2. Doğrulama adımları (Faz 7)
Secret hizası: Worker ve backend .env içinde R3MES_QA_WEBHOOK_SECRET aynı string (görünmez boşluk için trim() backend’de var; yine de kopyala-yapıştır hatası sık).
URL: POST https://<api>/v1/internal/qa-result — sonda / yok (veya sunucu redirect’i ham gövdeyi bozuyorsa proxy loguna bakın).
Header: X-QA-HMAC: <64 hex karakter> (HMAC-SHA256, ham gövde üzerinden).
Gövde: Worker’ın HMAC hesapladığı byte dizisi ile HTTP’de giden body aynı olmalı (pretty JSON vs JSON.stringify farkı = Geçersiz HMAC).
Başarılı yanıtta: 200 + handler; idempotent tekrarda 200 + duplicate: true mümkün.
3. Sonuç raporu (şablon)
Alan	Değer
403’ün tam sebebi
(Yanıttaki message yukarıdaki tablodan)
Secret hizası doğru mu
evet / hayır
HMAC doğrulaması geçti mi
evet / hayır
callback 200 oldu mu
evet / hayır (veya duplicate 200)
receipt oluştu mu
QaWebhookReceipt + completedAt
status/score yazıldı mı
Adapter.status, benchmarkScore
4. Başarı kriteri
403 yanıtındaki message ile kök nedeni düzeltip tekrar deneyince 200 (veya aynı gövdeyle duplicate 200), ardından receipt + adapter güncellemesi görülüyorsa, callback zinciri 403’ten çıkmış kabul edilir.

Not: Idempotency 403 değil; çakışmada 409, işlem sürerken 503 döner — 403 yalnızca HMAC / secret / ham gövde / path katmanındadır.

------

Faz 7 — Sonuç raporu
servisler stabil miydi?
Evet. Bu kontrol anında tümü geçti: llama 8080 (GET /v1/models), gateway 9080 (/health), backend 3000 (GET /health → status: ok), Redis (PONG), Postgres (pg_isready → accepting). Docker konteynerleri healthy görünüyordu.
(İlk PowerShell denemesinde H takma adı Get-History ile çakıştığı için sağlık satırları yanlış göründü; düzeltilmiş kontrolde hepsi OK.)

loglar eksiksiz toplandı mı?
Önceki Faz 6 oturumundan kalan dosyalar mevcut ve okunabilir: logs\faz6-qa-worker.log, backend-faz6-stdout.log / backend-faz6-stderr.log, llama-server-faz6-stderr.log (stdout boş; çıktı stderr’e düşmüş, bu normal).
Yeni: Tek denemede tekrarlanabilir salt okunur sağlık + log yolu özeti için infrastructure\scripts\faz7-debug-session.ps1 eklendi — servis başlatmaz/yeniden başlatmaz, sadece durum ve önerilen log yollarını yazar. LoRA/webhook debug’unu bir kez daha koşarken worker için R3MES_QA_WORKER_LOG_FILE ile örneğin logs\faz7-qa-worker.log kullanman yeterli.

ortam kaynaklı yeni blocker çıktı mı?
Hayır. Bu fazda ek Docker/port/servis kesintisi veya zorunlu restart ihtiyacı yoktu; yalnızca tanı için okuma yapan bir betik eklendi.

Başarı kriteri: Uygulama katmanındaki LoRA (400) ve webhook (403) gibi olaylar servis gürültüsü olmadan mevcut dosya loglarından ve backend/llama akışlarından izlenebilir; Faz 7 betiği aynı düzeni bir sonraki tek denemede tekrar üretmek için kullanılabilir.

pwsh -File infrastructure/scripts/faz7-debug-session.ps1

-------

Canlı ortam ve blocker’lar sizde çözüldükten sonra yapılacak kontrol için kısa özet:

Faz 7 — Sonuç yansıması raporu (doldurma şablonu)
Soru	Beklenen (FE kodu)	Sizin doğrulamanız
Studio güncellendi mi?
Trainer listesi: GET /v1/adapters?limit=100, ownerWallet ile süzme; rozet status alanından. Otomatik yenileme yok — «Yenile» veya sayfa yenileme.
Callback/status DB’ye yazıldıktan sonra Studio’da rozet ACTIVE / REJECTED / İncelemede ile uyumlu mu?
Marketplace doldu mu?
Sadece GET /v1/adapters?status=ACTIVE. ~30 sn ISR gecikmesi olabilir.
ACTIVE kayıt için kart görünüyor mu? Gerekirse tam yenileme veya kısa bekleme.
Chat prefill doğru mu?
Kart: /chat?adapter=<id> (+ varsa &cid=<ipfsCid>).
Tıklayınca alanlar doğru mu?
FE ek bug var/yok
Önceki fazlarda mantık tutarlı; tutarsızlıkta önce API ve URL.
Uyumsuzluk varsa: aynı NEXT_PUBLIC_BACKEND_URL, response gövdesi, id/status/ipfsCid.
Sonraki adım (sırayla)
Blocker’lar (callback + status yazımı) tamam olduktan sonra Studio’da durumu kontrol edin.
ACTIVE ise marketplace’te kartı arayın.
Karttan Chat’e geçip adapter / cid doğrulayın.
Yukarıdaki tabloyu Evet/Hayır + kısa not ile kapatın.
Başarı kriteri
İlk gerçek lifecycle sonucu backend’de görünür görünmez, aynı veri Studio → (ACTIVE ise) Marketplace → Chat zincirinde FE tarafında uydurma olmadan yansır; burada ek bir FE geliştirmesi gerekmez — sorun kalırsa önce veri ve önbellek, sonra yenileme zamanlaması kontrol edilir.

-----

Sonuç raporu (Faz 7 — ORTAK: lora register / webhook sonrası)
Kanona etkisi var mı?
Çoğu Faz 7 senaryosu için hayır. Artefact ve API matrisi zaten §3.3.1 ve §3.3–§3.4 ile tanımlı; “lora register” veya “webhook” tarafındaki tipik işler uygulama/konfig (env, sıra, HMAC, port, retry, worker/llama ayakta değil, yanlış CID içeriği vb.) ise bunlar kanon değiştirmez — sadece sistemin yazılı sözleşmeyi doğru uygulamasıdır.

Evet ancak şu durumda: Çözümden sonra ölçülen davranış, mevcut INTEGRATION_CONTRACT / OpenAPI / Zod ile çelişen yeni bir wire gerçeği ise (ör. yeni zorunlu alan, değişen HTTP anlamı, adapterCid veya webhook gövdesinin farklı yorumlanması). O zaman minimal kanon + dörtlü senkron gerekir.

Varsa ne?
Minimal güncelleme: Yalnızca çelişen tek yüzey (ör. §3.4 webhook veya §3.5 chat) + §7 breaking/non-breaking tek cümle + dörtlü.
Öneri: Önce docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md içinde “ölçülen fark” notu; kanon PR’ı buna referansla.
Operasyon notuna mı, contract’a mı?
Tür	Nereye
Operasyonel düzeltme (çoğu Faz 7)
Operasyon kanıt dosyası (GGUF_LIFECYCLE_PROOF_FAZ6.md — Faz 7 bölümü eklendi) veya backend/ai-engine runbook, env notu.
Kanon düzeltmesi (yeni semantik wire)
Contract (INTEGRATION_CONTRACT + shared-types + OpenAPI + regression) — tek tur.
Dosyaya eklenen bölüm: “Faz 7 — Çözüm sonrası ORTAK değerlendirmesi” — ayrım tablosu + kısa PR öncesi kontrol listesi; Faz 7 çözümünün gereksiz contract churn üretmemesi başarı ölçütüyle uyumlu.

Özet cümle: Bug fix kanonu uyguluyorsa → sadece operasyon notu. Kanon yanlış/eksik çıktıysa → minimal contract; aksi halde churn yok.