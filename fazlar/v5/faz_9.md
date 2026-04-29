Bu turda kod / UI değişikliği yapılmadı; aşağıdaki notlar BitNet smoke’u geçtikten sonra veya geçiş adayı netleşince kullanılmak üzere hazırlanmıştır.

Sonuç raporu
Hemen UI işi gerekir mi?
Hayır. BitNet henüz resmi hat değil; smoke sonucu ve ORTAK karar gelmeden yüzeyde değişiklik açmak gereksiz iş riski taşır.

Geçişte kritik ekranlar hangileri?
Sıra	Ekran	Gerekçe
1
Studio (upload)
Format / uyumsuzluk beklentisi burada oluşur.
2
Chat
“Çalışmıyor / farklı davranıyor” algısı burada belirir.
3
Marketplace
Aynı kartların “hangi hatta” olduğu net değilse kafa karışır; global küçük ipucu yeterli olabilir.
Minimum kullanıcı dili ne olur? (geçiş kesinleşince)
Tek satır bağlam: “Çıkarım şu an <resmi hat adı> üzerindedir.” (veya eşdeğeri kısa cümle).
Uyum: “Adaptörlerin çalışması, o sürümde desteklenen çıkarım hattına bağlıdır.” — tercihen Studio veya tek yardım bağlantısı.
Geçiş anı: Kısa duyuru (şerit veya sürüm notu): önceki hat ile fark tek paragraf.
Başarı kriteri
Smoke geçene ve geçiş resmileşene kadar panik yok, erken UI yok; yukarıdaki üç ekran ve üç cümlelik çerçeve, karar anında minimum müdahale planı olarak yeterli.

----------

İşte özet.

Toplanan kanıt (YZ + altyapı + backend)
Kaynak	Bulgu
Repo
Arşivlenmiş QVAC/BitNet smoke PASS/FAIL kaydı yok (log, tarih, operatör).
Altyapı
QVAC_SMOKE_PROFILE.md izolasyon + komut şablonu tanımlı; sonuç bölümü yoktu → §6 şablonu eklendi.
Backend / entegrasyon
e2e_test_report.md: build/vitest/pytest yeşil; Docker yok → tam stack yok.
GGUF lifecycle
GGUF_LIFECYCLE_PROOF_FAZ6.md: canlı zincir FAILED (ortam).
AI engine
Canlı çıkarım LIVE_SMOKE.md ayrı prosedür; QVAC smoke ile özdeş değil.
Tek cümle: QVAC smoke bu repoda ölçülüp işlenmemiş; statüyü kanıta dayalı yükseltmek mümkün değil.

Yapılan dokümantasyon güncellemesi
infrastructure/RUNTIME_PROFILES.md §0 — Yeni alt bölüm: “QVAC smoke sonucu → BitNet statüsü” (karar cümlesi, tablo, sonraki kapı).
infrastructure/QVAC_SMOKE_PROFILE.md §6 — Gelecek koşular için sonuç kayıt tablosu (tarih, ortam, geçti/kısmi/başarısız, kanıt).
INTEGRATION_CONTRACT: Değişiklik yok.

Sonuç raporu (istenen format)
Soru	Cevap
Smoke sonucu ne?
Ölçülmedi / sonuç işlenmedi — geçti / kısmi / başarısız için tek kaynakta veri yok; prosedür hazır, kanıt arşivi yok.
BitNet hattı hangi statüde?
Deneysel (geri dönüş adayı). Smoke kanıtı olmadığı için “güçlü geçiş adayı” veya “uygun değil” denmez; elendi de denmez — kanıt bekleniyor.
Qwen hattı korunuyor mu?
Evet — resmi referans runtime yolu değişmedi.
Kanona şimdi dokunmak gerekir mi?
Hayır.
Bir sonraki karar kapısı ne?
(1) İzole profilde QVAC smoke koşturup §6 + RUNTIME_PROFILES güncelle. (2) İstenirse ADR-003 ile Linux/Docker qvac tekrarlanabilirliği. (3) Ürün “resmi BitNet” için §0 geçiş kapısı + isteğe bağlı BitNet profilinde lifecycle SUCCESS.
Tek adres: infrastructure/RUNTIME_PROFILES.md — “BitNet şimdi ne durumda?” → deneysel; QVAC smoke statüyü bu turda yükseltmedi.

-------

Bu oturumda QVAC smoke’un ham çıktısı (log, JSON_SUMMARY, exit code) paylaşılmadı; repoda da sizin son koşunuza ait arşivlenmiş smoke çıktısı görünmüyor. Bu yüzden “canlı smoke ile kesin teyit”ü tek başına burada veremem; aşağıdaki tablo hipotezi nasıl doğrular / çürütürsünüz + repo kanonu ile kapanıyor.

Smoke’un teyit etmesi gerekenler (backend contract açısından)
Soru	Korunuyor sayılır eğer…	Hipotezi zayıflatır eğer…
POST /v1/chat/completions (Fastify → ai-engine) semantiği
İstek gövdesi yine adapter_cid + OpenAI-uyumlu mesajlar; 200 ve anlamlı choices[]
ai-engine/proxy farklı gövde veya sabit 4xx/502 (çözüm/hatı sınıfı değişir)
/lora-adapters ↔ worker
qa-worker / benchmark hattı aynı HTTP desenini kullanıyor (CID → disk → POST); llama logunda kayıt başarılı
LoRA yükleme uçları farklı path/method veya worker’ın beklediği sözleşme kırıldı
Public REST
Path ve alan adları aynı; sadece env/port/ikili değişir
Yeni zorunlu alan veya yeni HTTP yüzey gerekir (INTEGRATION_CONTRACT güncellemesi)
Sonuç raporu (şablon — smoke çıktısıyla doldurulur)
Alan	Bu turda (çıktı olmadan)
contract korunabiliyor mu
Kuvvetle muhtemel evet, qvac llama-server + LoRA GGUF + mevcut HTTP uçları varsayımıyla — ADR-003, QVAC_SMOKE_PROFILE, INTEGRATION_CONTRACT §3.3.1–§3.5** ile uyumlu. Kesin evet için smoke’ta chat 200 + LoRA kaydı başarılı kanıtı gerekir.
riskli yüzey var mı
Çıkarım katmanı: ikili sürümü, BitNet base/adapter Uyumsuzluğu, farklı port/path — Fastify REST değil. Public risk: QVAC’ın /v1/chat/completions veya /lora-adapters ile llama.cpp ailesinden sapması (dokümante edilmemiş API farkı).
minimal değişiklik gerekir mi
Backend Fastify: Genelde hayır (sadece env/profil). Gerekirse: INTEGRATION_CONTRACT §3.3.1’de “çekirdek BitNet/QVAC” cümlesi, upload magic yalnızca artefakt biçimi değişirse.
QVAC geçişi backend açısından gerçekçi mi
Evet, aynı llama-server HTTP modeli + adapter_cid = IPFS LoRA GGUF korunursa; faz_8.md notu: birebir uç doğrulaması tek koşuda yapılmalı.
Tek cümle (başarı kriteri)
QVAC smoke’u llama-server benzeri süreçte /lora-adapters + OpenAI uyumlu chat ile 200 ve üretken yanıt gösterirse → public REST sözleşmesi değişmeden kalabilir; backend tarafında iş operasyonel profil (port, env, ikili) ile kalır.

Sonraki adım: Smoke çıktısını (veya logs/profile-qvac-smoke/ + smoke_ai_engine.py --prove-inference özetini) buraya yapıştırırsan, yukarıdaki tabloyu PASS / FAIL ile satır satır kapatırım.

--------

Sonuç raporu
Qwen hattı korundu mu?
Evet — tanım olarak. Repoda Qwen resmi referans; BitNet/QVAC deneysel (RUNTIME_PROFILES.md §0). Bu turda sadece belge eklendi; mevcut dosyalara kalıcı BitNet env yazılmadı. Canlı doğrulama: Bu ortamda 8080 şu an yanıt vermiyor; Qwen’in ayakta olduğunu doğrulamak için curl http://127.0.0.1:8080/v1/models (Qwen llama çalışırken) kullanın.

BitNet smoke izole mi?
Evet — operatör checklist ile. infrastructure/QVAC_SMOKE_PROFILE.md: 8081, ayrı base path, ayrı placeholder, logs/profile-qvac-smoke/, smoke sırasında worker için geçici 8081 URL; kalıcı .env üzerine BitNet yazılmaması açıkça yazıldı. Yan yana (8080 Qwen + 8081 smoke) veya zaman çoğullama seçenekleri net.

env/path karışıklığı yaşandı mı?
Hayır. Yeni orchestrator yok; yalnızca dokümantasyon + infrastructure/README.md içine link. Kod/env dosyası değiştirilmedi.

test tekrar üretilebilir mi?
Evet. Aynı smoke’u tekrarlamak için QVAC_SMOKE_PROFILE.md §1–§4; genel profil için RUNTIME_PROFILES.md.

Başarı kriteri: QVAC smoke, bu düzenle Qwen referans yolunu kirletmeden planlanabilir; geri dönüş adımları §4’te. İlgili giriş: infrastructure/README.md → QVAC smoke linki.

-------

Smoke sonucu (gerçek koşu)
Sabitlenen bileşenler
Bileşen	Seçim
Runtime
qvac-fabric-llm.cpp release b7349, llama-b7349-bin-win-cpu-x64.zip → llama-server.exe + yanı DLL’ler (%TEMP%\qvac-bitnet-smoke\extract\)
Base GGUF (çalışan)
HF qvac/fabric-llm-bitnet-finetune → 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf (~912 MB, TQ2)
Adapter GGUF
Aynı repo → tq2_0-biomed-trained-adapter.gguf (~30 MB), slot dosyası: bitnet_slot0.gguf (--lora + --lora-init-without-apply)
Smoke kontrolleri
Kontrol	Sonuç
Süreç açılıyor mu
Evet (CPU backend, model yüklendi)
GET /v1/models
200 (model listesi)
GET /lora-adapters
200 — slot id:0, path, scale: 1.0
POST /v1/chat/completions
200 — token üretimi (log’da POST ... 200)
POST /lora-adapters
200 — gövde {"success":true}; ardından GET ile scale 0.5 görüldü
Adapter apply
Evet — ölçek POST ile güncellendi (R3MES’teki register_lora_adapter ile aynı HTTP sözleşmesi)
Kırılan nokta (sınıf)
ADR’de örneklenen HF microsoft/bitnet-b1.58-2B-4T-gguf / ggml-model-i2_s.gguf bu b7349 Windows CPU ikilisiyle yüklenemedi:

Log: tensor ... has ... elements per row, not a multiple of block size (0) / failed to read tensor info
Sınıf: gguf_tensor_format_incompatible_with_runtime (eski/uyumsuz quant tensör düzeni; IQ4_NL_4_4 ile ilgili mesaj).
Yani “Microsoft donmuş çekirdek + bu qvac build” çifti bu ortamda doğrulanmadı; qvac’ın kendi Hugging Face’teki TQ2 tam modeli ile smoke başarılı.

R3MES worker modeliyle uyum
Evet, aynı davranış modeli: llama-server üzerinden

GET /lora-adapters → slot path (worker’ın indirdiği GGUF’u buraya kopyalaması),
POST /lora-adapters → id + scale (JSON dizi),
POST /v1/chat/completions → OpenAI uyumlu sohbet,
R3MES’teki register_lora_adapter + chat_completion_text akışıyla uyumlu gözlemlendi.

Şartlar / farklar:

Base GGUF kaynağı pin’lenmeli: microsoft/.../ggml-model-i2_s.gguf bu build’de çalışmadı; üretim/spike için qvac ile uyumlu bir çekirdek dosyası veya uyumlu qvac sürümü seçilmeli.
Port / profil: R3MES dokümanındaki gibi BitNet denemesi ayrı port (burada 8090) ile Qwen’den izole edilmeli.
Health: /health bu koşuda ayrıca denenmedi (boş çıktı); kanıt v1/models + lora-adapters + chat ile verildi.
Tek cümle (maliyet / gerçekçilik)
QVAC llama-server b7349 ile BitNet TQ2 (qvac HF tam modeli) + LoRA adapter smoke’u başarılı; R3MES worker HTTP beklentisiyle örtüşüyor, ancak ADR’deki Microsoft ggml-model-i2_s.gguf bu ikiliyle bu makinede yüklenemedi — BitNet’e “güvenli dönüş” için önce çekirdek GGUF + qvac sürümü matrisinin pin’lenmesi şart.