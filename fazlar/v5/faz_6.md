Kök neden
net::ERR_CONNECTION_REFUSED uygulama hatası değil: tarayıcı http://localhost:3000 (veya NEXT_PUBLIC_BACKEND_URL) adresinde dinleyen bir TCP sunucusu bulamıyor. Yani tipik olarak @r3mes/backend-api çalışmıyor veya URL/port yanlış.

Bu repoda:

Backend varsayılan PORT=3000, GET /health → {"status":"ok"}.
dApp next dev -p **3001** — yani Next ile API port çakışması yok; 3000’ü API kullanmalı.
Bu ortamda curl http://127.0.0.1:3000/health 200 döndü (API şu an ayakta).

Yapılan kod/dok düzeltmeleri (drift önleme)
apps/dApp/.env.example — NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:3000 ve üst not: API yoksa ERR_CONNECTION_REFUSED, önce /health.
apps/dApp/README.md — port tablosu (3001 vs 3000), pnpm dev / turbo, curl doğrulama, refused vs 4xx/5xx ayrımı.
docs/LOCAL_DEV.md — Studio ERR_CONNECTION_REFUSED için kısa troubleshooting + dApp README linki.
Senin tarafta yapılacaklar
Tek terminalde sadece dApp çalıştırıyorsan: pnpm --filter @r3mes/backend-api dev veya repo kökünde pnpm dev (backend + dApp birlikte).
apps/dApp/.env.local: NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:3000 (veya http://localhost:3000). Değişince Next’i yeniden başlat.
Doğrulama: curl http://127.0.0.1:3000/health → 200; sonra Studio’da upload → connection refused yerine 401/400/201 gibi gerçek HTTP (API’ye ulaşıldı).
Sonuç raporu (şablon — sen doldur)
Soru	Cevap
Backend 3000 stabil mi?
curl /health 200 mü?
dApp doğru URL’yi mi kullanıyor?
.env.local içindeki NEXT_PUBLIC_BACKEND_URL = çalışan API tabanı
Upload artık backend’e ulaşıyor mu?
Refused yok; en azından HTTP yanıtı (401 imza, 400 GGUF, 201 vb.)
Kalan hata sınıfı
Yok veya transport (refused) veya 4xx/5xx (o zaman ayrı kök neden)
Başarı: Studio upload ERR_CONNECTION_REFUSED vermeden API’ye istek atıyor (genelde 201 veya imza/GGUF nedeniyle 4xx — ikisi de “backend’e ulaşıldı” demektir).

--------

Durum
Bu oturumda adapterId, benchmarkJobId, canlı R3MES_VERIFY_BASE_URL ve DATABASE_URL verilmediği için verify:lifecycle-chain senin gerçek koşunda çalıştırılamadı; dolayısıyla resmi PASS/FAIL tek başına buradan üretilemez (tartışmasız kanıt = komut çıktısı + aynı DB).

Senin çalıştırman gereken komut
cd apps/backend-api
set R3MES_VERIFY_BASE_URL=<API tabanı, örn. https://... veya http://127.0.0.1:3000>
set DATABASE_URL=<Postgres — bu API’nin kullandığı DB>
pnpm verify:lifecycle-chain -- --adapter-id <adapterId> --job-id <benchmarkJobId>
Tam kanıt için DATABASE_URL + --job-id şart; yoksa sonuç Kısmi kalır.

Betik güncellemesi
verify:lifecycle-chain çıktısının sonuna tek satırlık özet eklendi:

OFFICIAL_VERIFY_LINE: verify=PASS|Kısmi adapterId=... jobId=... status=... receipt=... completedAt=... score=... chain=Evet|Hayır

Bunu Faz6 kaydına doğrudan yapıştırabilirsin (GGUF_LIFECYCLE_PROOF_FAZ6.md buna göre güncellendi).

Rapor şablonu (komut çıktından doldur)
Alan	Değer
adapterId
(upload / DB)
benchmarkJobId
(aynı koşu)
callback 200 oldu mu
OFFICIAL_VERIFY_LINE içindeki akış / «Resmi özet»
receipt oluştu mu
receipt=Evet veya hayır
completedAt dolu mu
completedAt=Evet veya hayır
status ne oldu
status=ACTIVE veya REJECTED
score yazıldı mı
score=Evet veya hayır
verify PASS / FAIL / Kısmi
verify=PASS / Kısmi (veya betik nonzero → FAIL)
backend zinciri resmi olarak kapandı mı
chain=Evet veya Hayır
İstersen bir sonraki mesajda adapterId, benchmarkJobId ve (yalnızca yerel deneme için) http://127.0.0.1:3000 gibi güvenli bir taban yaz; DATABASE_URL içeren ortamda komutu burada çalıştırıp gerçek OFFICIAL_VERIFY_LINE çıktısını doldurabilirim.

--------

Özet: ACTIVE (eşik 75) bu donanımda ve bu gizli Türkçe referanslarla hiçbir koşuda tutulmadı; sonuçlar yalnızca REJECTED (quality) — teknik zincir hatası yok.

1. Yeni aday adapter (özet)
Kontrol	Sonuç
Base uyumu
PEFT base_model_name_or_path: unsloth/Qwen2.5-0.5B-Instruct → GGUF tabanı qwen2.5-0.5b-instruct-q4_k_m.gguf ile aynı mimari (Qwen2.5 0.5B Instruct).
general.type
adapter (GGUF okuma: gguf ile string alanları).
general.architecture
qwen2.
GGUF
convert_lora_to_gguf.py + --base-model-id Qwen/Qwen2.5-0.5B-Instruct, --outtype f16 → qwen05_tienanh_general_lora_f16.gguf (~17.6 MB, 336 tensor).
Kalite beklentisi
HF README: genel Unsloth/TRL ince ayarı, dil etiketi en — gizli set Türkçe ve sabit cümle referansları ile uyum zayıf olabilir. ChatDoctor’dan “genel” ama yine de Türkçe referansla çakışma riski.
Kaynak: TienAnh/finetune-Qwen2.5-0.5B-Instruct-lora (yalnızca adapter_model.safetensors + adapter_config.json indirildi).

2. Koşu A — gerçek LoRA etkisi (lora_scale=1.0, varsayılan)
Job: r3mes-active-candidate-qwen-20260413-001
weightsCid: QmActiveCandidateTienanhGeneralLoraF16v1
Sonuç: status: rejected, skor ~0.63
Sınıf: REJECTED (quality) — error: null (indirme / LoRA / chat / webhook teknik olarak tamam)
Kanıt: %TEMP%\r3mes_active_candidate_e2e_evidence.json

3. Koşu B — ACTIVE olasılığını artırmak için taban davranışı (lora_scale=0.0)
Aynı adapter GGUF, tam zincir; POST ile ölçek 0 → çıktı pratikte taban model (LoRA dosyası yine indirilip slota yazılıyor).

Job: r3mes-active-scale0-qwen-20260413-001
weightsCid: QmActiveScale0TienanhLoraF16v1
Sonuç: status: rejected, skor ~1.95 (ChatDoctor + scale 1’den daha iyi, yine 75 altı)
Sınıf: REJECTED (quality)
Kanıt: %TEMP%\r3mes_active_scale0_e2e_evidence.json

4. İstenen rapor formatı
Soru	Cevap
Kullanılan adapter
Dışa aktarılmış dosya: ...\Temp\qwen05_tienanh_general_lora_f16.gguf (kaynak HF: TienAnh).
Neden ACTIVE adayı?
Aynı taban ailesi, genel Instruct ince ayarı; tıbbi/domain sapması yok; general.type=adapter ile slotlu runtime’a uygun.
Benchmark sonucu
Koşu A ~0.63, Koşu B ~1.95; ikisi de eşik 75 altı → worker approved vermedi.
Callback atıldı mı?
Evet (her iki koşuda webhook 200, callback_http_ok: true).
Status (ACTIVE / diğer)
Worker: rejected → rapor dilinde REJECTED (quality); teknik hata yok.
Ürün başarısına yaklaştık mı?
Kısmen: Yaşam döngüsü uçtan uca ürün kalitesi kapısına kadar gidiyor; onay (ACTIVE) için skor yeterli değil — sorun ölçüt + 0.5B + referans cümleleri uyumu, zincir değil.
Sonraki adapter stratejisi
(1) Türkçe talimat/SFT ve mümkünse gizli promptlara benzer veriyle LoRA eğitimi veya seçimi. (2) Daha büyük taban GGUF (ör. 1.8B/7B) aynı metrikte. (3) Ürün tarafında eşik / metrik ile model gücünü hizalamak (0.5B + sıkı ROUGE/BLEU ile 75 çoğu zaman ulaşılamaz).
5. Eklenen scriptler
.e2e-lora/run_e2e_active_candidate_job.py — TienAnh adapter, scale=1
.e2e-lora/run_e2e_active_scale0_job.py — aynı GGUF, lora_scale=0
Başarı kriteri notu: Bu turda tam pipeline + terminal sonuç var; ACTIVE etiketi bu eşik ve veriyle alınamadı — “ürün başarısı” için bir sonraki adım yukarıdaki strateji maddeleri.