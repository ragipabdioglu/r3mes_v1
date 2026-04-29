Sonuç raporu (gerçek LoRA GGUF ile QA worker zinciri)
1) Kullanılan artefact
Alan	Değer
Dosya adı
Qwen2.5-0.5B-Instruct_lora_5892s-ft.Q2_K.gguf (ana E2E indirme); ek doğrulama: lora.Q4_K_M.gguf (taban kuantizasyonuyla aynı isimlendirme)
Kaynak
Hugging Face: RichardErkhov/srikanthChittampally_-_Qwen2.5-0.5B-Instruct_lora_5892s-ft-gguf
GGUF magic
b'GGUF' (ilk 4 bayt) — doğrulandı
İçerik CID (IPFS v0–style, SHA256)
Q2_K: QmVcomVZJ4oPL8g6aTPUpxubCsWHDfFkcaYgAX6ooV1uQS (338 605 120 bayt); Q4_K_M: QmPLE7Bm62tRzhWVDEystpzbsEqt1xH7vupwATepXD8XiY (397 805 632 bayt)
Base model hedefi
README’e göre Qwen2.5-0.5B-Instruct; sizin çalışan sunucu tabanı qwen2.5-0.5b-instruct-q4_k_m.gguf (/v1/models) — mimari olarak uyumlu LoRA seçildi
Not: Yerelde IPFS düğümü yok; R3MES_IPFS_GATEWAY davranışını 127.0.0.1:9080 üzerinde tek dosyayı /ipfs/<cid> ile sunan bir test sunucusuyla taklit ettim. İndirilen baytlar gerçek GGUF; CID’ler dosya içeriğinden türetildi (ağ üzerinde pinlenmiş olması gerekmez).

2) Worker ortamı (hedef değerler)
Değişken	Bu koşuda
R3MES_QA_LLAMA_BASE_URL
http://127.0.0.1:8080
R3MES_IPFS_GATEWAY
http://127.0.0.1:9080 (mock gateway)
R3MES_BACKEND_QA_WEBHOOK_URL
http://127.0.0.1:3001/v1/internal/qa-result (mock alıcı)
R3MES_QA_WEBHOOK_SECRET
Yok (None) — HMAC atlandı
3) Zincir izi (log / davranış)
Aşama	Sonuç
consume
run_benchmark_job ile job işlendi
IPFS download
Başarılı — ~338 MB indirildi (metrics.bytes)
POST /lora-adapters
2xx değil — HTTP 500
Hata gövdesi
{"error":{"code":500,"message":"invalid adapter id","type":"server_error"}}
benchmark / inference
Başlamadı (LoRA kaydı sonrası döngüye girilmedi; samples: 0)
callback
Atıldı — post_qa_result 200; gövde status: "rejected", error: lora_register_failed: ...
status
REJECTED (baraj değil; LoRA aşaması hatası)
4) lora-adapters neden 2xx olmadı? (runtime kabulü)
Canlı sunucuda GET http://127.0.0.1:8080/lora-adapters → [] (boş). Resmi llama-server dokümantasyonuna göre adaptörler öncelikle --lora ile süreç başlarken yüklenir; POST /lora-adapters çoğu senaryoda mevcut slot id’leri için scale ayarlamak içindir (id değerleri GET /lora-adapters ile bilinir). Şu an hiç slot yokken id: 0 ile yapılan istek de 500 invalid adapter id veriyor; bu, LoRA dosyasının kalitesinden çok runtime’da önceden yüklenmiş adaptör olmaması ile uyumlu.

Tek cümle: Tam hata sınıfı: llama-server’da önceden tanımlı LoRA slot’u olmadığı için POST /lora-adapters isteğinin reddedilmesi (invalid adapter id).

5) Lifecycle kanıtlandı mı?
Tam uçtan uca (indir → LoRA 2xx → benchmark → onaylı/red callback) bu koşuda kanıtlanmadı; kırılma kesin: lora-adapters aşaması.
Kısmi kanıt: gerçek GGUF ile indirme + webhook ile reddedilmiş sonuç akışı çalışıyor; ürün hedefi için bir sonraki adım: llama-server’ı aynı LoRA GGUF ile --lora ... ile başlatmak (veya worker’ın, sizin build’in desteklediği şekilde yalnızca mevcut slot id + scale kullanacak biçimde hizalanması).
Ek üretilen dosyalar
C:\Users\rabdi\OneDrive\Masaüstü\R3MES\.e2e-lora\ altında iki GGUF ve run_e2e_worker_job.py (tekrarlanabilir harness). İstemezseniz run_e2e_worker_job.py ve büyük .gguf dosyalarını silebilirsiniz; rapor bu koşumdan bağımsızdır.

------

Bu turda yapılanlar ve senin istediğin rapor formatı aşağıda. Gerçek GGUF + canlı worker akışını bu ortamda çalıştırmadım; zincir kod + vitest + e2e-lifecycle-smoke.mjs düzeltmesi ile hizalandı; canlı doğrulama sende.

Kod / sözleşme
apps/backend-api/src/lib/ggufWeightsValidate.ts

İlk 4 bayt GGUF, dosya adı .gguf (boş ad → weights.gguf varsayımı ile uyumlu).
Net 400 kodları: WEIGHTS_TOO_SMALL, INVALID_GGUF_MAGIC, WEIGHTS_FILENAME_GGUF.
apps/backend-api/src/routes/adapters.ts

weightFiles.length > 1 → 400 MULTIPLE_WEIGHTS_NOT_ALLOWED (tek primer artefact; “sessizce ilk dosya” kaldırıldı).
IPFS öncesi GGUF doğrulaması.
scripts/e2e-lifecycle-smoke.mjs

Eski ZIP imzası (PK…) yerine GGUF sihri ile minimal buffer; upload doğrulamasından geçer.
docs/api/INTEGRATION_CONTRACT.md

Form: tek weights, çoklu weights reddi.
Yukarıdaki 400 kodları listelendi.
Kısa zincir özeti: weightsCid → benchmarkJobId → callback jobId + adapterCid ≡ weightsCid → receipt / status / score.
openapi.contract.yaml

POST açıklaması tek dosya + GGUF ile güncellendi.
src/lib/ggufWeightsValidate.test.ts

Birim testleri.
Rapor (şablon)
Soru	Cevap
Callback 200 oldu mu?
Otomatik testlerde evet (internalQa.test.ts: 200 ve duplicate 200). Canlı GGUF denemesi bu ortamda koşturulmadı.
Receipt oluştu mu?
Testlerde evet (qaWebhookReceipt.create / update mock’ları).
status / score yazıldı mı?
Evet: internalQa içinde Adapter.status + benchmarkScore güncelleniyor (approved → ACTIVE).
Upload contract daha dürüst mü?
Evet: magic + uzantı + çoklu dosya reddi; yanlış içerik erken 400 ile dönüyor.
Tek primer artefact davranışı net mi?
Evet: çoklu weights artık 400; tek dosya; kanon INTEGRATION_CONTRACT §3.3 ile uyumlu.
Backend zinciri kapandı mı?
Kod yolu kapalı: upload → weightsCid / benchmarkJobId → callback HMAC → receipt → adapter. Uçtan uca gerçek job için: API+DB+Redis+IPFS+secret ile e2e-lifecycle-smoke.mjs çalıştırıp loglarda upload_accepted → qa_webhook_applied doğrula.
Notlar
Benchmark worker hâlâ minimal 32 baytlık “GGUF” ile gerçek inference yapamaz; bu beklenen — smoke sadece REST + webhook zincirini test eder. Tam GGUF ile worker davranışı ayrı doğrulama.
Chat’e dokunulmadı (base-model fallback yok).
Gerçek denemede callback 403 görürsen response message alanını kullanarak sınıflandır (önceki tablo: secret, ham gövde, header, HMAC); path normalizasyonu zaten qaHmac’te.

------

Sonuç raporu (Faz — golden path belgeleme)
golden path belgeye işlendi mi?
Evet. infrastructure/README.md içine “Yerel golden path (çalışma düzeni)” bölümü eklendi: Docker kapsamı, uygulama süreçleri, env özeti, Qwen’un geçici doğrulama runtime’ı olduğu, Windows notları, health matrisi ve log/debug akışı. Kök README.md port özetine llama 8080 ve bu belgeye tek satırlık bağlantı eklendi.

port/env matrisi net mi?
Evet. Tablolar: altyapı (5432, 6379, 9080, …) ve uygulama (3000 / 3001 / 8000 / 8080) ayrı; R3MES_SKIP_LLAMA, R3MES_QA_LLAMA_BASE_URL, R3MES_QA_WORKER_LOG_FILE kısaca işlendi.

Windows notları net mi?
Evet: ASCII GGUF yolu, win-x64 binary konumu, start-all.sh EXIT trap / Ctrl+C ile ai-engine’in kapanması, run-ai-engine-dev.ps1, pnpm.cmd ipucu.

debug/log akışı tekrarlanabilir mi?
Evet: Hangi log dosyası ne için, faz7-debug-session.ps1 referansı, worker dosya logu env’i, aynı denemede logları koruma notu yazıldı.

kalan altyapı kafa karışıklığı var mı?
Kasıtlı olarak sadeleştirildi: “Docker her şeyi açar” yanılgısı metinde açıkça çözüldü. BitNet bu golden path’e geri çekilmedi; yeni orchestrator veya iş mantığı değişikliği yok.

Başarı kriteri: Ekip infrastructure/README.md → Yerel golden path bölümünden servis/port düzenini tek yerden okuyup aynı şekilde ayağa kaldırabilir.

------

Yapılan kod değişikliklerinin özeti ve istenen rapor formatı aşağıda.

Yapılanlar
studio-upload-panel.tsx: Sadece .gguf dosyaları ağırlık olarak alınıyor; accept → .gguf + manifest için .json; yardım ve doğrulama metinleri studioUpload üzerinden.
product-copy.ts: studioUpload (tek kaynaklı dropzone + doğrulama), pageIntro.studio / journey.modelUploadEntry GGUF ile uyumlu; chat.adapterOnlyNote + emptyThread güncellendi.
chat-screen.tsx: Adaptör alanlarının altında chat.adapterOnlyNote (genel taban model sohbeti yok).
Multipart: FormData alan adı weights olduğu gibi bırakıldı (API sözleşmesi); yalnızca dosya uzantısı/filtre değişti.
Sonuç raporu
Soru	Cevap
Upload UX doğru mu?
Evet: Tek cümlelik gerçek — yalnızca llama.cpp uyumlu LoRA GGUF (.gguf); sunucuda Safetensors → GGUF dönüşümü yok; isteğe bağlı manifest. Seçici ve partitionFiles ile uyumlu.
Yanlış beklenti kaldırıldı mı?
Evet: Safetensors vurgusu ve .safetensors kabulü kaldırıldı; boş gönderimde net GGUF mesajı.
Chat adapter-only dili net mi?
Evet: Üstte adapterOnlyNote + güncellenmiş pageIntro.chat / emptyThread — taban model sohbeti olmadığı açık; ekstra fallback yok.
Studio / Marketplace / Chat yansıması korundu mu?
Evet: AdapterStatusBoard, fetchActiveAdaptersSorted, chat query (adapter / cid) ve kart linkleri değiştirilmedi; yalnızca yükleme formatı ve sohbet metinleri güncellendi.
FE ek bug var mı?
Bilinen yok (tsc temiz). Not: Backend hâlâ yalnızca safetensors bekliyorsa uyumsuzluk backend/ORTAK tarafında giderilmeli; FE multipart alan adını bilerek değiştirmedim.
Başarı kriteri
Kullanıcı hangi dosyanın desteklendiğini (GGUF LoRA) ve sohbetin neden adaptör istediğini ürün dilinden doğru okuyabilir; base-model chat eklenmedi, backend gerçekliği gizlenmedi, geçici workaround yok.

Doğrulama: Backend’in POST /v1/adapters ile .gguf içeriğini weights alanında kabul ettiğinden emin olun; aksi halde ORTAK/API tarafını güncellemek gerekir.

-------

Sonuç raporu (ORTAK — belge hizalama turu)
Kanonda güncelleme gerekir mı?
Evet — yalnızca açıklayıcı / netleştirici metin (yeni wire veya Zod alanı yok; gereksiz churn yok). Üretim davranışı zaten kodda vardı; bu tur semantik tek kaynak için yazıldı.

Eklenen / güçlendirilen kanon:

Bölüm	İçerik
§3.3.2
Eğitim/paketleme (Faz 0 zip/safetensors) ↔ runtime/QA/chat (tek LoRA GGUF) tablosu; zip ile runtime’ın karıştırılmaması.
§3.5.1
Adapter-only chat = ürün kararı / feature-gap; taban sohbet yok; 400 “bug” değil; ileri taban sohbet → breaking + dörtlü.
§6 drift
docs/ai_architecture.md, docs/backend_architecture.md için kanon uyarıları.
§7
§3.3.2 + §3.5.1 için non-breaking satırı (metin netliği).
Kök INTEGRATION_CONTRACT.md girişine §3.3.2 ve §3.5.1 işaretçisi eklendi.

Eski belge drift’i nerede?
Alan	Sorun	Ne yaptık
docs/ai_architecture.md
Zip/safetensors eğitim akışı üretim GGUF ile aynı sanılıyordu
Üstte kanon uyarısı; §3–5 başlıklarına “eğitim/taslak” notu; üretim yolu §3.3.1’e bağlandı.
docs/backend_architecture.md
Diyagram “BitNet + LoRA” tek çizgide
Düğüm metni “GGUF çekirdek + LoRA — BitNet referans olabilir”.
docs/infrastructure_architecture.md
“BitNet + LoRA” kısaca
GGUF çekirdek + LoRA, BitNet opsiyonel.
docs/api/openapi.contract.yaml
Chat adapter_cid zorunluluğu belirsiz
Açıklamaya §3.5.1 ve adapter-only vurgusu.
Operasyon notu mu, contract notu mu?
Contract (INTEGRATION_CONTRACT): İki dünya + adapter-only chat — tek cevap kaynağı.
Operasyon / spike: BitNet vs Qwen / ikili seçimi ADR-003 ve §3.3.2 son cümlesi; ayrı track olarak kalır.
BitNet / Qwen ayrımı netleşti mi?
Evet (kanon dilinde): Ürün sözleşmesi “LLM çekirdeği GGUF + LoRA GGUF”; BitNet zorunluluğu yok. Qwen veya başka taban, doğrulama/dağıtım seçimidir; OS/ikili için ADR-003. Faz 0 metinleri BitNet’e kilitli ürün gibi okunmamalı.

Başarı ölçütü: “Hangi format destekli?”, “hangi runtime hedef?”, “chat neden adapter istiyor?” soruları INTEGRATION_CONTRACT §3.3.1–§3.3.2 ve §3.5.1 üzerinden tek yerden yanıtlanabilir; pnpm contract:drift yeşil (paylaşılan tiplerde değişiklik yok).
