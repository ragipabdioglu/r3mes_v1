Aşağıdaki reçete Qwen prototipini bilinçli olarak dışarıda bırakır; hedef, pin’li BITNET_QVAC_PRODUCTION_MATRIX.md ile uyumlu BitNet b1.58 TQ2 tabanı ve QVAC çıkarım ikilisidir.

1. BitNet için eğitim zinciri (toolchain)
Katman	Ne kullanılır
Resmi eğitim hattı
QVAC Fabric BitNet LoRA — Tether’in açıkladığı çerçeve: llama.cpp türevi + BitNet b1.58 üzerinde donmuş ternary taban, FP16 LoRA (HF blog: LoRA Fine-Tuning BitNet b1.58 LLMs via QVAC Fabric).
İkili / ortam
Eğitim için dağıtılan paketler: qvac-rnd-fabric-llm-bitnet (blog/duyurularla uyumlu). Üretim doğrulaması için çıkarım yine qvac-fabric-llm.cpp release b7349 ile yapılmalı (matrisle aynı aile).
OS
ADR çizgisiyle uyumlu: Linux (Ubuntu) veya QVAC’ın desteklediği GPU ortamı — Windows üzerinde eğitim mümkün olsa da tekrarlanabilirlik için ilk tur Linux + pin’li binary önerilir.
Taban ağırlıklar
Matristeki tam model dosyası çıkarım içindir; eğitim tarafında QVAC dokümantasyonunun istediği BitNet HF checkpoint / aynı model ailesi kullanılmalı (ör. 1bitLLM-bitnet_b1_58-xl-tq2_0 ile aynı TQ2 / aynı mimari hattı — sapma = yeni spike).
Özet cümle: Eğitim QVAC BitNet LoRA toolchain; çıkarım/doğrulama pin’li b7349 llama-server + HF qvac/fabric-llm-bitnet-finetune tabanıyla kilitlenir.

2. LoRA mı DoRA mı — ilk tur?
Seçim	Öneri
İlk tur
LoRA — QVAC BitNet duyularında ve blogda LoRA açıkça tarifli; rank/alpha örnekleri (ör. rank 8, alpha 16) referans alınabilir.
DoRA
İkinci tur — dokümantasyon ve BitNet üzerinde daha az kanıt; ilk üretim riskini artırır.
3. Türkçe veri profili (BitNet hedefiyle bağ)
Benchmark ile aynı mantık: Türkçe kısa soru → tek cümlelik teknik/popüler tanım; lexical overlap için cevaplar sıkı tanım cümlesi (özne + yüklem, sabit terimler).

Öğe	BitNet hedefi için not
Biçim
JSONL: instruction / output (veya QVAC eğitim script’inin beklediği chat şablonu).
Uzunluk
Tek cümle; 15–35 kelime hedefi (benchmark referanslarıyla uyumlu ölçek).
Alanlar
Blockchain, konsensüs, IPFS/CID, LoRA/adapter, GGUF, dağıtık sistemler — gizli setle kelime hazinesi örtüşmesi.
Boyut (MVP)
500–1.500 çift; kalite > miktar.
Kaçınılacak
Uzun paragraf, İngilizce cevap, dar tıbbi domain, “sohbet” üslubu — BitNet’i değil metriği düşürür.
BitNet’e özel ek: Veri İngilizce ise küçük model + benchmark Türkçe → ACTIVE ihtimali düşer; veri dili = Türkçe şart.

4. İlk eğitim reçetesi (somut)
Parametre	Öneri (başlangıç)
Görev
Masked loss yalnızca asistan cevabında (blogdaki instruction tuning ile uyumlu).
LoRA rank
8 (blog referansı); stabil değilse 16 ikinci grid.
LoRA alpha
16 (rank 8 ile tipik); rank 16 ise 32.
Epoch
1–3 (küçük veri; aşırı eğitim üslup kayması).
Seq length
Blog: 512 token (uyumlu kısa cevap + soru).
Öğrenme oranı
QVAC örnekleri / README ile hizalı grid (tipik 1e-4 mertebesi başlangıç).
Stil hedefi: Model, benchmark’taki referanslara benzeyen kısa Türkçe tanım üretsin; amaç “genel chat kalitesi” değil, ROUGE/BLEU dostu tek cümle.

5. Export + doğrulama adımları
Eğitim çıktısı: QVAC/PEFT çıktı dizini (ör. adapter_model.safetensors + config) — BitNet tabanıyla uyumlu olduğundan emin olun (aynı mimari checkpoint).
GGUF adapter: QVAC / llama.cpp fork dokümantasyonundaki LoRA → GGUF adımı (BitNet mimarisi için Qwen convert_lora_to_gguf yolu otomatik uyumlu olmayabilir; resmi dönüştürücü veya QVAC tarafında belirtilen script kullanılmalı).
Çıkarım doğrulaması (zorunlu):
llama-server b7349, -m = matris base 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf, --lora = üretilen adapter.gguf, --lora-init-without-apply.
GET /v1/models, GET /lora-adapters, POST /v1/chat/completions 200.
GGUF meta: gguf ile general.type = adapter (ve BitNet mimarisi alanları); yükleme hatası = export zinciri uyumsuz.
Ürün zinciri: IPFS → worker slot → benchmark (mevcut L2 düzeni).
Kritik: Microsoft ggml-model-i2_s.gguf bu b7349 ile yüklenemiyor — matris dışı; adapter üretimi de aynı TQ2 / qvac HF hattına bağlı kalmalı.

6. İlk aday neden “doğru aday”?
Hedef uyumu: Veri ve stil doğrudan benchmark metriğine (Türkçe, kısa, lexical) kilitli.
Runtime uyumu: Taban + ikili + adapter formatı tek matris üzerinden tanımlı; sürpriz dosya sınıfı yok.
Risk sırası: Önce LoRA + kanıtlı export; DoRA ve farklı base sonraya.
Sonuç raporu (istenen format)
Soru	Cevap
BitNet için eğitim zinciri ne?
QVAC Fabric BitNet LoRA eğitimi (qvac-rnd-fabric-llm-bitnet / ilgili release) + TQ2 BitNet taban checkpoint; çıkarım doğrulaması qvac-fabric-llm.cpp b7349 + matris base GGUF.
İlk veri profili ne?
Türkçe kısa soru → tek cümle teknik tanım; blockchain, LoRA, IPFS, model/GGUF temelleri, dağıtık sistemler; 500–1.5k çift MVP.
İlk eğitim reçetesi ne?
LoRA, rank 8 (veya 16), alpha 16 (veya 32), kısa epoch, seq 512, masked assistant loss; stil = kısa Türkçe tanım.
Export + doğrulama adımları ne?
QVAC/llama BitNet için belgelenmiş LoRA→GGUF; b7349 ile yükleme + HTTP smoke; general.type=adapter; ardından mevcut worker/L2 akışı.
İlk aday neden doğru aday?
Benchmark’a kasıtlı hizalı veri + pin’li BitNet/QVAC yığını; Qwen kısayoluna girmeden üretim hedefiyle aynı hat.
Başarı kriteri: Takım, yukarıdaki toolchain + veri + reçete + export/doğrulama ile BitNet üzerinde ilk iç üretim adapter turunu başlatabilir; LoRA→GGUF için mutlaka QVAC / o release’in resmi dönüşüm yolunu kullanmalı (genel Qwen convert_lora_to_gguf BitNet mimarisi için varsayılan doğru yol olmayabilir).

--------------

BitNet üretim trial akışı nasıl işleyecek?
trial_id — YYYY-MM-DD_etiket → infrastructure/lora-trials/candidates/<trial_id>/ ve COMPARISON.md ilk sütun.
train/ — Sadece eğitim; checkpoint/log upload veya ürün testine bağlanmaz.
export/ — Tek LoRA GGUF + checksum; canonical kaynak.
Checksum — export/*.sha256 ile dosya bütünlüğü; upload öncesi doğrulanır.
run/ (isteğe bağlı) — export dosyasının kopyası ile yerel BitNet smoke; upload kaynağı değil.
Upload kapısı — Yalnızca export/<adapter_etiketi>.gguf → POST /v1/adapters.
Test hattı (ürün) — Upload sonrası QA/benchmark (worker + BitNet runtime).
verify + runs/.../TRIAL_RECORD.md + COMPARISON satırı.
Ayrıntı: LORA_CANDIDATE_TRIALS.md (üstteki “kapı sırası” + §0), klasör şeması: candidates/README.md.

Hangi dosyalar tutulacak?
Ne	Nerede
Küçük config / EXPORT.md / checksum metni
candidates/<trial_id>/config, export/
(İsteğe bağlı) smoke notu
run/*.txt, run/README.md
Ürün kanıtı
runs/<trial_id>/TRIAL_RECORD.md, verify çıktısı
Karşılaştırma
COMPARISON.md
Büyük GGUF / checkpoint
Repo dışı arşiv; .gitignore ile uyumlu
Hangi noktada upload/test başlatılacak?
Kapı	Olay
Upload başlar
export/ içindeki GGUF için SHA256 doğrulandıktan sonra — train/ ve run/ yolları kullanılmaz.
Ürün test hattı (QA/benchmark)
POST /v1/adapters yanıtı alındıktan sonra (kuyruk + worker + BitNet runtime).
verify:lifecycle-chain
Terminal durum + receipt için upload sonrası, adapterId / jobId bilinince.
Başarı kriteri: İlk BitNet iç üretim adapter’ı train ≠ export ≠ run disipliniyle, yalnızca export/ üzerinden dağılmadan test hattına girer.

Yapılan güncellemeler: candidates/README.md (run/ + tablo), LORA_CANDIDATE_TRIALS.md (BitNet üretim kapı sırası, tabloya run/), TRIAL_RECORD.template.md, .gitignore (run/**/*.gguf).

------------

Sonuç raporu (istenen format)
Soru	Cevap
Gerçek ACTIVE aday için minimum kanıt ne?
Aynı gerçek upload → BitNet profilinde QA worker job’u → Fastify POST /v1/internal/qa-result → DB’de QaWebhookReceipt.completedAt + status=ACTIVE + benchmarkScore + arşivlenmiş OFFICIAL_VERIFY_LINE (verify=PASS). Altı alan (aşağıda) birlikte ve BitNet llama üzerinde koşmuş job ile uyumlu olmalı.
Hangi alanlar zorunlu?
adapterId, weightsCid, benchmarkJobId, benchmarkScore, status (ACTIVE), OFFICIAL_VERIFY_LINE — BitNet için de aynı liste; ek ürün koşulu: weightsCid = eğitim çıktısı GGUF, benchmark = BitNet llama + worker eşiği (≥75 varsayılan) ile üretilmiş approved.
Trial sonrası karar nasıl verilecek?
Tek akış: (1) Altı alan tam mı? (2) verify:lifecycle-chain PASS + satır arşivi? (3) ACTIVE mı? (4) Worker log/env’de aynı jobId ile BitNet llama işlendi mi? (5) Artefakt gerçek üretim mi? — Hepsi evet → gerçek ACTIVE aday; herhangi bir hayır → test, mock L1, yanlış profil veya başarısız trial.
Başarı kriteri: BitNet üretim adapter’ı için özel bölüm apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md §5 altında sabitlendi; ilk kayıt geldiğinde bu kontrol listesi ile aday / değil ayrımı tek seferde yapılabilir.

---------------

Tek cümle
Biz artık doğrudan şu tip BitNet adapter üretiyoruz: pin’li BitNet b1.58 TQ taban GGUF + qvac llama-server hattına uyumlu, tek dosya LoRA GGUF (general.type=adapter), Türkçe kısa cevap benchmark’ına göre kalibre edilmiş ve ≥75 eşiğini hedefleyen üretim (prototip/Qwen ara tabanı yok) adaptörler.

Sonuç raporu
Alan	İçerik
Resmi hedef adapter profili
Runtime: RUNTIME_PROFILES — resmi varsayılan = BitNet/QVAC. Sabitler: BITNET_PINNED_ENV_MATRIX / BITNET_QVAC_PRODUCTION_MATRIX ile uyumlu base GGUF + ikili + slot0 yolu. Artefakt: INTEGRATION_CONTRACT §3.3 — tek LoRA GGUF, IPFS’te tek CID. Kalite: packages/qa-sandbox/.../hidden_dataset.json ile aynı mantıkta Türkçe gizli benchmark; eşik ≥ varsayılan 75.0 (score_threshold). Kapsam: Qwen veya “önce küçük taban” denemesi değil; doğrudan BitNet üretim adapter’ı.
Hangi yollar elendi
Qwen (veya başka GGUF tabanı) üzerinde prototip LoRA eğitimi ve sonra “taşıma” beklentisi. BitNet dışı base ile paralel “karşılaştırma için” üretim hatları. Safetensors / zip ile doğrudan üretim yükleme (çevrimdışı GGUF adapter zorunlu). Hazır HF adapter avı BitNet pin’i olmadan. Taban-only veya LoRA’sız sohbet hedefi (ürün: adapter zorunlu). İngilizce-ağırlıklı veya benchmark dışı domain ile “genel” eğitim.
İlk üretim turunun amacı
Tek tekrarlanabilir uçtan uca zincir: seçilmiş küçük Türkçe veri → BitNet tabanında LoRA eğitimi → tek LoRA GGUF export → pin’li llama-server + lora-adapters doğrulama → upload → QA → skor ≥ eşik ile ACTIVE yolunu kanıtlamak; süreç sabitlendikten sonra veri/alan genişletilir.
Başarı kriteri
Tüm ekip tek hedefe kilitlenir: BitNet pin’li üretim LoRA GGUF + Türkçe benchmark + tek dosya kanon; ara prototip, alternatif taban veya Qwen hattı bu turun kapsamı dışıdır ve zaman ayrılmaz.

---

## Runbook sonu — ürün kanıtı (eğitim → export → upload ile aynı zincir)

İlk iç üretim adapter upload edildikten sonra toplanacak **minimum alanlar** ve **OFFICIAL_VERIFY_LINE** için tek kaynak: [`apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md`](../../apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md) (§5 BitNet). Trial klasörü ve `COMPARISON.md` ile hizalama: [`infrastructure/LORA_CANDIDATE_TRIALS.md`](../../infrastructure/LORA_CANDIDATE_TRIALS.md) §7.