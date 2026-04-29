Tespit (bu makine)
Bulgu	Değer
3000 dinleyen süreç
PID 36472 — node --env-file=.env dist/index.js (tek LISTENING).
Diğer node süreçleri
Çok sayıda (muhtemelen pnpm/turbo/vitest); 3000’i paylaşmıyorlar → API çakışması yok.
Bypass neden kapalıydı?
apps/backend-api/.env içinde R3MES_DEV_BYPASS_QA yoktu; isDevQaBypassEnabled() false → normal upload (PENDING_REVIEW).
Yapılan düzeltme (repo .env)
apps/backend-api/.env içine şunlar eklendi:

NODE_ENV=development
R3MES_DEV_BYPASS_QA=1
Not: Bu dosya .gitignore’da; yalnızca yerel. Mevcut süreç env’i başlangıçta okuduğu için yeniden başlatma şart.

Sonuç raporu (istenen format)
Soru	Cevap
Hangi backend süreci kullanılacak?
PID 36472 — apps/backend-api kökünden node --env-file=.env dist/index.js. Başka bir API’ye giden upload yok (3000 tek).
Bypass aktif mi?
Dosya güncellendi; süreç yeniden başlatılmadıkça hâlâ eski env ile çalışır. Restart sonrası aktif olmalı. Doğrulama: yeni upload’da DB’de domainTags: ["r3mes:dev-test"] ve status: ACTIVE.
Diğer süreçler karışıklık yaratıyor mu?
Hayır — yalnızca bu PID 3000’i dinliyor. Karışıklık yanlış env / restart kaynaklıydı.
Kullanıcı şimdi yüklerse beklenen durum ne?
36472’yi durdurup aynı komutla (cd apps/backend-api → node --env-file=.env dist/index.js veya pnpm dev) yeniden başlattıktan sonra upload → ACTIVE, benchmarkScore=null, domainTags içinde r3mes:dev-test, yanıtta devQaBypassApplied: true.
Tek teknik adım
# 36472'yi durdur (PID değişmiş olabilir — netstat ile doğrula)
Stop-Process -Id 36472 -Force
cd "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\apps\backend-api"
node --env-file=.env dist/index.js
(Önce pnpm run build gerekiyorsa çalıştırın.)

Başarı kriteri: Sonraki upload yalnızca bu sürece gider; tek backend + bypass açık env ile doğrudan ACTIVE olur.

---------------

Özet aşağıda. Ek olarak docs/SINGLE_TEST_RUNTIME.md (tek test süreç matrisi), infrastructure/scripts/check-single-test-runtime.ps1 (port + PID kontrolü; tek PID skaler hatası giderildi) ve LOCAL_DEV.md içine kısa bağlantı eklendi.

Test için gereken süreçler neler?
Süreç	Rol
Docker
Postgres, Redis, Kubo, gateway (pnpm bootstrap)
Tek pnpm dev
backend 3000, dApp 3001, ai-engine 8000, QA worker (port yok)
Tek llama-server (BitNet)
8080, --lora slot (LIVE_RUN.md)
İstemez
İkinci pnpm dev, ikinci backend, L1 mock webhook (3003) ile L2 (3000) karışımı
Hangi portlar canlı?
Bu makinede az önce çalıştırılan betik çıktısı:

3000 — backend (ör. PID 16364)
3001 — dApp
8000 — ai-engine
8080 / 9080 — uyarı: iki farklı PID (25116, 7508); Windows’ta Docker/proxy bazen aynı port için birden fazla dinleyici satırı üretebilir. Gerçekten iki ayrı uygulama mı (ör. iki llama-server) netleştirmek için: Get-Process -Id 25116,7508.
Tek risk kaldı mı?
Süreç çoğaltma: Eski node / ikinci turbo hâlâ ana risk — tek pnpm dev, tek llama.
8080/9080 çift PID: Ortam kaynaklı olabilir; upload öncesi GET http://127.0.0.1:8080/v1/models ve 9080/health ile fiili doğrulama.
Upload son metresi: IPFS add / büyük GGUF / cüzdan — port kontrolü bunu garanti etmez.
Kullanıcı şimdi upload yapabilir mi?
Evet — bu portlar açık ve tek-backend/tek-dev oturumu varsayıldığında upload denemesine geçilebilir. Son karar için:

pwsh -File infrastructure/scripts/check-single-test-runtime.ps1
ve tarayıcıdan veya küçük dosyayla POST /v1/adapters duman testi.

Başarı kriteri: Matris docs/SINGLE_TEST_RUNTIME.md ile sabitlendi; betik yanlış PID gösterimini düzeltti; bir sonraki test için referans tek kaynak bu dosya + tek süreç disiplini.

----------------

Kod özeti (doğrulama)
Pazaryeri: isDevTestAdapter → r3mes:dev-test / eski dev_bypass_qa / NEXT_PUBLIC_R3MES_DEV_TEST_ADAPTER_IDS ile dev test pill’i; dev kartında skor kutusu gri ve Skor —.
Taşıma: Kart linki /chat?adapter=<id> (+ varsa cid), useSearchParams ile adapterId state’e yazılıyor; gönderimde adapterId API’ye gidiyor.
Chat: Aynı adapterId için GET /v1/adapters/:id → domainTags ile dev test satırı (pill + kısa metin).
Yeni dev bypass upload → backend domainTags: ["r3mes:dev-test"] (hizalı) → FE bu akışta tutarlı.

Sonuç raporu
Soru	Cevap
FE yeni test adapter için hazır mı?
Evet. Yeni upload, tag ile listelenince ayırt edilir; pazaryerinden tıklanınca doğru adapter query’si chat’e taşınır ve istek o ID ile gider.
Karışıklık riski var mı?
Kısmen. Eski ACTIVE ama dev tag’i olmayan kayıtlar “normal” kart gibi (mor skor kutusu, pill yok) görünür; kullanıcı yanlışlıkla onları seçebilir. FE, benchmark/onay kalitesini tahmin edemez; ayrım dev pill ve isim/IPFS ile yapılır.
Kullanıcıya ne söylemek gerekir?
Kısa rehber: (1) Pazaryerde “dev test” rozetli karta tıklayın; bu yeni LoRA test akışıdır. (2) Eski/şüpheli ACTIVE kayıtlar rozetsiz görünebilir; güvenilir test için rozetli satırı kullanın. (3) Chat’te üstte dev test uyarısı yoksa seçilen ID, dev test değildir — gerekirse Studio’dan doğru adapter adını / ID’yi kontrol edin. (4) İsteğe bağlı: yerelde karışıklığı azaltmak için eski test adapter’ları DB’de DEPRECATED yapmak veya NEXT_PUBLIC_R3MES_DEV_TEST_ADAPTER_IDS ile yeni ID’yi sabitlemek (yalnızca dev).
Başarı: Yeni test upload sonrası kullanıcı, dev test rozetli karttan girerse doğru adapter bağlamıyla chat’e geçer; yanlış eski ACTIVE’a düşme riski kart seçimine bağlıdır, FE tarafında ek zorunlu engel yoktur (ürün kararı: eski kayıtları temizlemek veya backend’de durum güncellemek).

-----------------

Resmi test cümlesi
Bu turda amaç benchmark veya kalite skoru değil; kirlenmiş yüzeyi bir kenara bırakıp tek backend, tek upload ve tek chat denemesiyle uçtan uca temiz bir sohbet kanıtı almaktır.

Sonuç raporu
Alan	Net ifade
Bu turun amacı
Tek temiz chat testi: aynı ortamda bir API tabanı, bir adapter yükleme, bir anlamlı POST /v1/chat/completions (veya eşdeğer) denemesi — önceki denemelerin kalıntıları, çoklu konfig veya paralel süreçler bu turun dışında tutulur.
Başarı ne sayılacak
Tek ölçüt: Bu minimal düzende chat isteği başarılı tamamlanır (beklenen HTTP ve anlamlı completion gövdesi); benchmark skoru, ACTIVE/REJECTED veya eşik bu turun başarı tanımına girmez.
Test sonrası iki olası sonuç
(1) Chat OK: Sorun büyük olasılıkla kirli test yüzeyi / birikmiş durum / yanlış konfig idi; sonraki turda benchmark veya kaliteye güvenle dönülebilir. (2) Chat hâlâ FAIL: Sorun minimal zincirde (backend, çözümleme, engine, llama, LoRA yolu) kalır; önce bunu düzeltmeden benchmark turu anlamlı değildir.
Bir sonraki karar kapısı ne
Yalnızca bu tek temiz chat testinin sonucuna bağlı:

Başarılıysa → sonraki tur: benchmark / skor / ürün kararı eksenine geçiş.
Başarısızsa → sonraki tur: aynı minimal hat üzerinde kök neden (altyapı + çözümleme); yeni veri veya yeni eğitim turu açılmaz.
Başarı kriteri (ekip)
Bu turda yalnızca “tek backend + tek upload + tek chat” odaklanır; benchmark, çoklu deneme veya ürün onayı kapsam dışıdır.