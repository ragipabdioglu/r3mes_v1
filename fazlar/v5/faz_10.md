BitNet (QVAC) profili — tam lifecycle özeti
Sabitlenen profil
Alan	Değer
Runtime
qvac-fabric-llm.cpp b7349 (llama-b7349-bin-win-cpu-x64.zip)
Base GGUF
qvac/fabric-llm-bitnet-finetune → 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf
Adapter GGUF
Aynı repo → tq2_0-biomed-trained-adapter.gguf
Slot path
%TEMP%\qvac-bitnet-smoke\models\bitnet_slot0.gguf
Job
benchmarkJobId = r3mes-bitnet-lifecycle-20260413-001, weightsCid = QmBitNetTq2BiomedAdapterLifecycle1
Zincir (gerçek worker kodu)
Download: Mock gateway http://127.0.0.1:9082/ipfs/... → 29 970 080 bayt (adapter ile aynı).
Slot overwrite: İndirilen dosya bitnet_slot0.gguf üzerine kopyalandı.
LoRA apply: GET + POST /lora-adapters (register_lora_adapter) — teknik hata yok.
Benchmark: Gizli 3 örnek, chat → skor ~0.49.
Callback: POST http://127.0.0.1:3003/v1/internal/qa-result → HTTP 200.
İstenen formatta özet
Soru	Cevap
BitNet base
1bitLLM-bitnet_b1_58-xl-tq2_0.gguf (TQ2, qvac HF)
Adapter
tq2_0-biomed-trained-adapter.gguf
LoRA apply geçti mi?
Evet (error yok; lora_register_failed yok)
Benchmark tamamlandı mı?
Evet (3 örnek, metrikler dolu)
Callback atıldı mı?
Evet (callback_http_ok: true)
ACTIVE / REJECTED
Worker approved/rejected → rejected → rapor dilinde REJECTED (ACTIVE = approved)
Hata türü
error: null → teknik değil; kalite (eşik 75.0 altında, skor ~0.49)
BitNet lifecycle kanıtlandı mı?
Evet — indirme → slot → LoRA POST → benchmark → webhook ile uçtan uca terminal sonuç; kanıt dosyası: C:\Users\rabdi\AppData\Local\Temp\r3mes_bitnet_lifecycle_evidence.json
Kod
Tekrarlanabilir koşu: .e2e-lora/run_e2e_bitnet_lifecycle_job.py (önce llama-server’ı 8090’da BitNet profiliyle başlatın).

Not: Kuyruk (Redis) kullanılmadı; aynı run_benchmark_job() gövdesi doğrudan çağrıldı — Qwen resmi koşularıyla aynı kanıt modeli.

--------

Sonuç raporu
BitNet koşusu izole mi?
Evet — belgelendi. infrastructure/BITNET_LIFECYCLE_RUN.md içinde sabitler: 8081, ayrı base dizin (…\r3mes-bitnet-lifecycle\), ayrı placeholder, logs/profile-bitnet-lifecycle/, worker için seanslık R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8081 ve R3MES_QA_WORKER_LOG_FILE; kalıcı apps/*/.env üzerine yazmama kuralı tekrarlandı.

Qwen hattı korunuyor mu?
Evet — tanım olarak. 8080 ve Qwen dizinleri BitNet tablosundan ayrı; ezilme kontrolü §2’de. Bu turda kod/env dosyası değiştirilmedi; yalnızca dokümantasyon + infrastructure/README.md linki.

loglar ayrı tutuldu mu?
Evet — şema olarak. BitNet lifecycle logları logs/profile-bitnet-lifecycle/ altında; Qwen ile aynı dosya/klasör kullanılmıyor. Worker/llama dosya adları belgede.

tekrar üretilebilir mi?
Evet. Aynı port, path şablonları ve geri dönüş adımları (QVAC_SMOKE_PROFILE.md §4 ile uyumlu) ile koşu yeniden kurulabilir. Kanıt şablonu: docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md.

Başarı kriteri: BitNet lifecycle denemesi bu izole profile göre Qwen referans hattını bozmadan tekrarlanabilir; giriş: infrastructure/README.md → BitNet lifecycle koşusu.

--------

Bu oturumda BitNet koşusuna ait adapterId / benchmarkJobId ve erişilebilir R3MES_VERIFY_BASE_URL + DATABASE_URL verilmediği için verify:lifecycle-chain burada çalıştırılıp sonuç üretilemedi. BitNet hattı da backend’de aynı tablolar ve aynı webhook ile işlendiği için doğrulama Qwen ile aynı komuttur; fark yalnızca worker/runtime tarafındadır.

Yapman gereken (resmi kanıt)
cd apps/backend-api
set R3MES_VERIFY_BASE_URL=<API tabanı>
set DATABASE_URL=<bu ortamın Postgres’i>
pnpm verify:lifecycle-chain -- --adapter-id <BitNet adapterId> --job-id <benchmarkJobId>
Çıktıda özellikle === Resmi özet (tek canlı koşu) === ve OFFICIAL_VERIFY_LINE: satırını arşivle.

Tam kanıt için --job-id + DATABASE_URL şart; yoksa sonuç Kısmi kalır.

Rapor şablonu (komut çıktısından doldur)
Alan	Değer
callback 200 oldu mu
Resmi özet / OFFICIAL_VERIFY_LINE (callback200=Evet vb.)
receipt oluştu mu
receipt=Evet
status ne oldu
ACTIVE veya REJECTED
score yazıldı mı
score=Evet
verify PASS / FAIL / Kısmi
verify=PASS / Kısmi veya betik nonzero → FAIL
BitNet hattı backend’de resmi kapandı mı
verify=PASS ve chain=Evet ise evet (terminal status + receipt + score)
Özet: BitNet için “resmi backend kanıtı” = bu komutun PASS çıktısı + aynı jobId ile logda qa_webhook_applied. Kimlikleri ve ortamı paylaşırsan, çıktıyı birlikte yorumlayabilirim; sırları (tam production URL/DB) yazmadan yerel örnekle de yetinebilirsin.

--------

Özet aşağıda. Kanıt: GGUF_LIFECYCLE_PROOF_FAZ6.md hâlâ FAILED; BitNet’e özel SUCCESS yok.

Yapılan güncellemeler
infrastructure/RUNTIME_PROFILES.md

Ana tabloda BitNet satırı: Faz 6 FAILED + resmi “güçlü geçiş adayı” = lifecycle SUCCESS + ORTAK kapıları ile yükseltilir.
Yeni § “Faz 6 lifecycle sonucu → BitNet/QVAC statüsü” (lifecycle baskın; smoke alt başlıkta kalıyor).
Özet bölümünde lifecycle maddesi eklendi.
docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md

BitNet/QVAC runtime profili — lifecycle sonucu alt başlığı + “Mevcut durum” tablosuna BitNet/QVAC — FAILED satırı.
INTEGRATION_CONTRACT: Değişiklik yok.

Sonuç raporu (istenen format)
Soru	Cevap
BitNet hattı durumu ne?
Resmi ORTAK statü: deneysel (geri dönüş adayı). Faz 6 lifecycle başarılı sayılmıyor; resmi geçiş adayı / ürün varsayılanı değil. Stratejide “güçlü aday” dili ile tablo statüsü aynı değil — yükseltme SUCCESS + kapılar ile.
Qwen hattı durumu ne?
Resmi referans runtime yolu — aynı; öncelik Qwen.
Resmi geçiş kararı verilir mi?
Hayır — lifecycle kanıtı buna yetmez (FAILED).
Kanona dokunmak gerekir mi?
Hayır.
Sonraki tek karar kapısı ne?
Tam stack ile lifecycle yeniden koşup GGUF_LIFECYCLE_PROOF_FAZ6 içinde BitNet profili için SUCCESS (veya net kısmi) + RUNTIME_PROFILES § “Geçiş kapısı” maddeleri; isteğe bağlı QVAC smoke §6.
Takım sorusu: “Şimdi Qwen’de mi kalıyoruz, BitNet’e mi yaklaştık?” → Geliştirme ve referans yol Qwen’de; BitNet’e resmi anlamda yaklaşım ölçülmedi — lifecycle kanıtı FAILED, ürün geçişi açılmadı.

-------

Bu turda aktif UI geliştirme yok; aşağıdakiler yalnızca BitNet lifecycle başarılı olur ve geçiş adayı resmileşirse planlama notu olarak kullanılmalıdır.

Sonuç raporu
Şimdi UI işi gerekir mi?
Hayır. Resmi varsayılan hat ve lifecycle sonucu netleşmeden yüzeyde iş açılmamalı; erken metin/etiket eklemek gereksiz risk.

Geçişte kritik ekranlar hangileri?
Öncelik	Ekran	Neden
1
Studio
Yükleme / uyumluluk beklentisi burada oluşur.
2
Chat
Davranış ve “çalışmıyor” algısı burada görülür.
3
Marketplace
Kartların hangi hatla ilişkili olduğu belirsiz kalırsa karışıklık artar; genelde küresel kısa ipucu yeterli.
(ACTIVE/REJECTED kendisi hat seçimi değil; hangi inference hattının prod’da olduğu ORTAK/altyapı kararıyla birlikte düşünülür.)

Minimum kullanıcı dili ne olur? (geçiş iletişimi için)
Tek satır: Aktif çıkarım hattının resmi adı (ör. BitNet), kullanıcıya “şu an hangi dünyadayım?” sorusunu kapatır.
Kısa uyum cümlesi: Adaptörlerin çalışmasının desteklenen hatta bağlı olduğu (Studio veya tek yardım linki).
Geçiş anı: Kısa duyuru (şerit veya sürüm notu): önceki hat ile fark, tek paragraf.
Başarı kriteri
BitNet lifecycle başarılı ve geçiş adayı resmi olmadan ürün yüzeyinde gereksiz veya erken iş açılmaz; yukarıdaki üç ekran + üç cümlelik çerçeve, karar sonrası minimum müdahale planı olarak yeterli.