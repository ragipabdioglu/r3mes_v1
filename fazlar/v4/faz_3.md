Kod incelemesine göre Faz 3 doğrulama özeti aşağıda. Canlı backend’e buradan istek atılmadı; davranış mevcut FE kodunun backend sözleşmesiyle uyumuna dayanıyor.

Sonuç raporu (ACTIVE sonrası üç ekran)
Studio güncellendi mi?
Evet, backend status güncellenince FE doğru rozeti gösterir.
fetchTrainerAdapters cache: "no-store" ile çağrılıyor; liste a.status üzerinden getAdapterStatusKind → ACTIVE ise Aktif, REJECTED ise Reddedildi (adapter-status-board.tsx + adapters-trainer.ts).

Dikkat (otomatik yenileme yok): Sayfa açıkken status backend’de değişirse liste kendiliğinden yenilenmez; kullanıcı «Yenile» veya sayfayı/rotayı yenilemeli. Bu, ACTIVE sonrası “hemen görünmedi” şikâyetini polling olmamasından açıklar; yanlış veri üretmez.

Marketplace doldu mu?
ACTIVE kayıtlar için evet — yalnızca status=ACTIVE çekiliyor.
fetchActiveAdaptersSorted → GET /v1/adapters?status=ACTIVE, sonuçlar benchmarkScore ile sıralanı (adapters.ts).

Gecikme: next: { revalidate: 30 } nedeniyle pazaryeri en fazla ~30 sn eski önbelleği gösterebilir; ACTIVE yeni oluştuysa kısa süre boş görünebilir. Tam yenileme veya bir süre sonra tekrar / açmak genelde yeterli.

Chat prefill doğru mu?
Evet. Pazaryeri kartı:
/chat?adapter=<encodeURIComponent(id)> ve varsa &cid=<ipfsCid>.
Chat adapter / cid query’lerini okuyup state’e yazıyor; URL değişince useEffect ile güncelleniyor (chat-screen.tsx).

FE ek bug var / yok?
Hayır — ACTIVE/REJECTED yansıması ve marketplace/chat bağlantısı sözleşmeye uygun.

Operasyonel engeller (workaround değil):

Konu	Açıklama
Marketplace gecikmesi
ISR 30 sn
Studio anlık güncelleme
Otomatik poll yok; «Yenile» veya sayfa yenileme
Yanlış API adresi
NEXT_PUBLIC_BACKEND_URL tüm ekranlarda aynı olmalı
Başarı kriteri (lifecycle → ekran)
Backend lifecycle tamamlanıp kayıt gerçekten ACTIVE ve liste endpoint’leri doğru döndüğünde: FE ACTIVE olmayan modeli göstermez, Studio’da güncel status (yenileme ile) ve Chat’te doğru adapter/cid taşınır. Kullanıcı deneyimindeki tek “boşluk”lar önbellek süresi ve manuel yenileme ihtiyacı ile uyumludur; ek bir UI bug iddiası için önce aynı ortamda GET .../adapters?status=ACTIVE ve trainer listesinin JSON’unu doğrulamak gerekir.

-----

Canlı ortama buradan erişemediğim için ölçüm sonuçlarını ben dolduramam; Faz 3 için runtime açıldıktan sonra uygulanacak doğrulama sırası ve rapor şablonu aşağıda.

1. Ne izlenecek?
Ne	Nerede
QA worker → backend HTTP çağrısı
Worker logları, reverse proxy / API access log
/v1/internal/qa-result yanıtı
Backend log (status code + gövde özeti)
HMAC
İstekte X-QA-HMAC; sunucuda R3MES_QA_WEBHOOK_SECRET ile aynı olmalı
Idempotency
QaWebhookReceipt tablosu (jobId, bodySha256, completedAt)
Adapter güncellemesi
Adapter.status, Adapter.benchmarkScore, updatedAt
Önkoşul: R3MES_QA_WEBHOOK_SECRET hem worker hem API’de tanımlı; runtime/worker gerçekten bu URL’ye POST atıyor olmalı.

2. HTTP sonuçları (backend davranışı)
Kod	Anlam
200 + ok: true
Gövde işlendi; duplicate ise duplicate: true (aynı gövde tekrar)
400
INVALID_BODY — jobId / adapterCid eksik
403
Secret yok, ham gövde yok, X-QA-HMAC yok/yanlış
404
adapterCid ile eşleşen adapter yok
409
IDEMPOTENCY_CONFLICT — aynı jobId farklı gövde
503
QA_WEBHOOK_IN_FLIGHT — aynı job için işlem bitmeden tekrar deneme
500
ONCHAIN_QA_FAILED (zincir tx hatası) veya beklenmeyen hata
Callback hiç gelmiyorsa bu kodlar oluşmaz; sorun önce worker/routing/network tarafında aranır.

3. Veritabanı kontrolleri
QaWebhookReceipt (ilgili jobId):

Satır yok → Bu job için callback backend’e hiç ulaşmamış veya farklı jobId kullanılıyor.
completedAt null (ve uzun süre öyle) → İş yarım kalmış / hata sonrası release senaryosu (log gerekir).
completedAt dolu → Idempotency tamamlanmış; DB güncellemesi de commit edilmiş olmalı.
Adapter (ilgili id veya weightsCid):

status: ACTIVE veya REJECTED (webhook status: approved / değil).
benchmarkScore: webhook’taki score ile uyumlu (Decimal).
updatedAt: callback zamanına yakın.
4. Sonuç raporu (doldurulacak şablon)
Alan	Değer
callback geldi mi
evet/hayır (log veya DB receipt)
HMAC/idempotency geçti mi
evet/hayır (403/409 yok; receipt uygun)
status güncellendi mi
evet/hayır (ACTIVE/REJECTED)
benchmarkScore yazıldı mı
evet/hayır (sayısal değer)
backend tarafı temiz mi
evet/hayır (200 + receipt + adapter uyumlu mu)
Tek cümle başarı kriteri: Runtime sonrası en az bir gerçek job için 200 + QaWebhookReceipt.completedAt dolu + Adapter.status ACTIVE veya REJECTED + benchmarkScore dolu ise backend zinciri bu uçta doğrulanmış sayılır.

5. Sınırlar (engel notu)
Runtime/worker kapalıyken sadece handler’ı denemek yanıltıcıdır; önce uçtan uç POST’un API’ye ulaştığını doğrulayın.
Callback üretilmeden backend’i bloklu saymak doğru değil; önce worker ve ağ yolu kontrol edilir.
İsterseniz bir sonraki mesajda tek bir jobId veya adapterDbId + gözlemlediğiniz HTTP status verin; tabloyu birlikte yorumlayalım (yine canlı DB’ye ben bağlanamam).

------

Aşağıdaki özet, repodaki kod/sözleşme ve bu oturumda yapılan komut çıktılarına dayanıyor; host’ta llama-server ikilisi kurulu değil — 8080’i ben başlatmadım (binary yok).

1. llama binary / başlatma yolu
Kaynak	Bulgu
ai-engine (llama_bootstrap.py)
settings.llama_server_bin (varsayılan llama-server) → Popen([bin, "-m", gguf, "--port", port], …)
Varsayılan env (settings.py)
R3MES_LLAMA_SERVER_BIN yok; alan adı llama_server_bin → ortamda tipik olarak R3MES_LLAMA_SERVER_BIN (pydantic R3MES_ öneki)
Dockerfile.ai-engine
qvac-fabric llama-bin-ubuntu-x64.zip → /usr/local/bin/llama-server ( Linux/Ubuntu )
Windows host
Get-Command llama-server → bulunamadı; repoda Windows ikilisi yok
Sonuç: Yerel Windows’ta hazır bir llama-server yolu yok; üretim benzeri yol Docker içindeki Dockerfile.ai-engine veya kullanıcının manuel kurduğu (PATH’e koyduğu) ikili.

2. Base model (GGUF) erişilebilirliği
Kontrol	Bulgu
apps/ai-engine altında *.gguf
0 dosya (repo içinde donmuş model yok)
Kod beklentisi
R3MES_FROZEN_GGUF_LOCAL_PATH veya R3MES_FROZEN_CORE_CID veya varsayılan R3MES_FROZEN_CORE_HF_URL (HF’den ggml-model-i2_s.gguf)
.env.example
R3MES_SKIP_LLAMA=1 — llama subprocess başlatılmıyor
Sonuç: Yerel dosya kanıtı yok; gerçek çalışma için ya HF/CID ile ilk indirme ya da R3MES_FROZEN_GGUF_LOCAL_PATH ile mevcut bir GGUF yolu gerekir.

3. Port 8080
Servis	Host portu	Çakışma
Storage gateway
9080 → konteyner 8080
8080 host’ta IPFS gateway için değil (tasarım gereği llama’dan ayrılmış)
llama-server (hedef)
127.0.0.1:8080
Worker varsayılanı R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080 ile uyumlu
Önceki oturumda Test-NetConnection 127.0.0.1:8080 → False idi; dinleyen süreç yok (şu an da binary olmadan başlatılmadı).

4. ai-engine vs worker — aynı runtime beklentisi mi?
ai-engine	QA worker
Hedef
http://127.0.0.1:{R3MES_LLAMA_INTERNAL_PORT} (varsayılan 8080)
R3MES_QA_LLAMA_BASE_URL (varsayılan http://127.0.0.1:8080)
SKIP_LLAMA
R3MES_SKIP_LLAMA=1 → llama subprocess yok
Okunmuyor; worker doğrudan HTTP ile llama’ya gider
IPFS
R3MES_IPFS_GATEWAY (varsayılan 9080)
R3MES_IPFS_GATEWAY (varsayılan 9080)
Sonuç: Aynı port sözleşmesi (8080 llama, 9080 gateway) tutarlı; fakat SKIP_LLAMA=1 sadece ai-engine’i kilitler, worker hâlâ 8080’de gerçek bir llama-server bekler.

5. Birlikte stabil servisler (bu oturumda)
docker compose ps: Postgres healthy, Redis + IPFS + gateway healthy.
8080 için süreç yok → llama hattı eksik.

Rapor (istenen format)
Soru	Cevap
llama binary/path hazır mı?
Hayır (Windows’ta PATH’te yok; repoda yalnızca Linux Dockerfile indirme yolu var).
Base model erişilebilir mi?
Repoda yerel GGUF yok; çalışma zamanı için indirme veya R3MES_FROZEN_GGUF_LOCAL_PATH gerekir.
8080 ayakta mı?
Hayır (dinleyen süreç yok).
Env uyumu var mı?
Port/URL sözleşmesi uyumlu (8080 + 9080); worker R3MES_QA_LLAMA_BASE_URL ↔ ai-engine R3MES_LLAMA_INTERNAL_PORT. Uyumsuzluk: ai-engine SKIP_LLAMA=1 iken worker yine 8080 llama bekler — ikisi birlikte “tam pipeline” için SKIP kapatılmalı + llama ayrıca ayakta olmalı.
Kalan altyapı blocker var mı?
Evet — P0: llama-server ikilisi + donmuş GGUF + 8080 olmadan QA worker’ın canlı skor üretimi tamamlanmaz. Redis/Postgres/IPFS bu oturumda blocker değil.
Başarı kriteri
QA worker’ın kullanacağı runtime ortamı gerçekten hazır olsun → Şu an hazır değil: 8080’de llama-server yok, yerel GGUF yok, Windows’ta llama-server binary yok.

Tek cümle (özet)
Gateway 9080 ve depolama hattı ayakta olsa da, llama-server ikilisi ve donmuş GGUF olmadan 8080 açılmıyor; bu yüzden QA worker’ın gerçek inference zinciri tamamlanmıyor ve lifecycle için ana blocker hâlâ llama runtime’ıdır.

Kullanıcı için sonraki en doğru adım
Windows: qvac-fabric / llama.cpp release ile Windows uyumlu llama-server ikilisini indirip PATH’e koyun veya R3MES_LLAMA_SERVER_BIN ile tam yol verin.
BitNet GGUF’u indirin veya R3MES_FROZEN_GGUF_LOCAL_PATH gösterin; R3MES_SKIP_LLAMA=0 yapın.
llama-server -m … --port 8080 (ve gerekiyorsa --lora-init-without-apply) ile süreci başlatın; ardından R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080 ile worker’ı doğrulayın.
Alternatif: Linux’ta Dockerfile.ai-engine ile imajı kullanıp aynı ağ/port sözleşmesini orada tamamlamak.

-------

Aşağıdaki rapor kod okuması + bu makinede 127.0.0.1:8080 için yapılan tek deneme (PowerShell) ile desteklenir. Canlı job/worker loglarını sizin ortamınızda çalıştırmadım; “callback üretildi mi” gibi maddeler için orada log/API kanıtı gerekir.

1. Worker’ın kullandığı llama uç noktası
Ayar	Ortam değişkeni	Varsayılan
qa_llama_base_url
R3MES_QA_LLAMA_BASE_URL
http://127.0.0.1:8080
Kaynak: packages/qa-sandbox/worker/r3mes_qa_worker/settings.py (env_prefix="R3MES_").

Beklenen: llama-server (veya uyumlu sunucu) bu taban URL’de HTTP ile /lora-adapters ve /v1/chat/completions sunar.

ai-engine ile ilişki: llama_bootstrap.py içinde llama_public_base = http://{llama_internal_host}:{llama_internal_port} (varsayılan host 127.0.0.1, port 8080). Yani worker’ın hedefi ile ai-engine’in llama adresi aynı porta hizalanmış (aynı süreç olmalı).

2. R3MES_SKIP_LLAMA=1 (ai-engine .env)
bootstrap_llama içinde skip_llama ise llama-server subprocess başlatılmaz; sadece uyarı loglanır.

Sonuç: ai-engine’i bu ayarla çalıştırmak, 8080’de llama-server getirmez.
Worker yine 8080’de hazır bir llama bekler; ai-engine /health yeşil olsa bile bu tek başına gerçek LLM runtime demek değildir.

3. Bu ortamda 8080 kontrolü
Invoke-WebRequest http://127.0.0.1:8080/v1/models (3 sn):

Bağlantı reddedildi (hedef dinlemiyor).
Yani şu an llama 8080 ayakta değil (kanıt: bağlantı reddi).

4. Llama’yı bu adreste ayağa kaldırma (operasyonel özet)
Seçenek A – ai-engine üzerinden (tek süreç):

apps/ai-engine/.env: R3MES_SKIP_LLAMA=0
Donmuş base GGUF: R3MES_FROZEN_CORE_CID / R3MES_FROZEN_CORE_HF_URL veya R3MES_FROZEN_GGUF_LOCAL_PATH
R3MES_LLAMA_INTERNAL_PORT=8080 (varsayılan zaten 8080)
llama-server binary PATH’te (R3MES_LLAMA_SERVER_BIN gerekirse)
ai-engine’i başlat → start_llama_server 8080’i dinler
Seçenek B – elle: llama-server -m <base.gguf> --port 8080 (+ ürününüzde kullanılan lora bayrakları, örn. --lora-init-without-apply).

Worker’ın R3MES_QA_LLAMA_BASE_URL değeri, bu sürecin aynı host/port’una işaret etmeli.

5. Worker zinciri (doğrulama sırası)
Sıra: queue consume → IPFS download (.gguf dosya adı) → POST .../lora-adapters → benchmark chat_completion_text → post_qa_result webhook.

Artefakt: llama.cpp uyumlu LoRA GGUF; aksi halde tipik kırılma lora register veya tamamlama aşamasında.

6. İstenen formatta sonuç raporu
Soru	Bu oturumdaki durum
llama 8080 ayakta mı?
Hayır — 127.0.0.1:8080 bağlantı reddi.
base model yüklendi mi?
Burada doğrulanamadı — llama süreci yok; SKIP_LLAMA=1 ile ai-engine da başlatmıyor.
worker job tüketti mi?
Bu oturumda ölçülmedi; önceki faz loglarında consume kanıtı yoktu.
benchmark başladı mı?
8080 yoksa hayır; worker download/lora sonrası chat’e gelir, llama yoksa orada düşer.
callback üretildi mi?
Kanıt yok — job tamamlanınca veya erken hata webhook’larında backend loglarına bakılmalı.
artefact format uyumu
Kod beklentisi: LoRA GGUF; bu örnek dosya için binary inceleme yapılmadı — uyum dosya içeriği + llama ile sahada doğrulanmalı.
kök neden kapandı mı?
Kısmen: Ana blokaj 8080’de çalışan llama-server yok; buna ek SKIP_LLAMA=1 → ai-engine’in llama başlatmaması. Callback ancak job bu aşamaları geçince anlamlıdır.
7. Başarı kriteri ile hizalama
ACTIVE / REJECTED için backend’de webhook’ın /v1/internal/qa-result ile işlenmesi ve Prisma’da adapter güncellenmesi gerekir.
Önce 8080 + base model + worker ile benchmark’ın tamamlanması (logda Job ... → approved/rejected veya webhook gövdesi) kanıtlanmalı.
/health (ai-engine veya gateway) tek başına bu başarıyı ispat etmez.
8. Öncelik (Faz 3)
P0: llama-server’ı 8080’de (veya R3MES_QA_LLAMA_BASE_URL’in gösterdiği adreste) gerçekten çalışır hale getir; base GGUF ile açıldığını /v1/models veya eşdeğer ile doğrula.
P1: R3MES_SKIP_LLAMA=0 + donmuş model yoluyla ai-engine’den başlatma veya bağımsız llama-server süreci.
P2: Worker’ı çalıştır, tek job ile download → lora → benchmark → callback log zincirini yakala.
P3: Yüklenen artefaktın GGUF LoRA olduğunu ürün/onay tarafında doğrula.
Bu rapor, kök nedenin “runtime yok” olarak netleşmesi açısından Faz 3 hedefiyle uyumludur; callback ve ACTIVE/REJECTED için bir sonraki adım çalışan llama + başarılı job kanıtıdır.