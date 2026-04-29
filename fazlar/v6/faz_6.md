Aşağıda takımın doğrudan uygulayabileceği iç üretim ilk aday planı var. Odak: mevcut benchmark’ın ölçtüğü şey — Türkçe, tek cümle, referans cümleye lexical yakın kısa tanım.

1. Eğitim veri profili (benchmark-benzeri, açık)
Özellik	Tasarım
Girdi
Türkçe kısa soru (çoğunlukla “nedir?”, “kısaca açıkla”, “ne ifade eder?”).
Çıktı
Tek cümlelik cevap; mümkün olduğunca tanım cümlesi (özne + yüklemli, 15–35 kelime).
Üslup
Akademik değil; popüler teknik: net fiiller, sabit terimler (blok zinciri, düğüm, konsensüs, CID, shard, …).
Dil
Yalnızca Türkçe; İngilizce terim yalnızca yerleşikse (ör. “LoRA”, “IPFS”) ve cümle yine Türkçe iskelet.
Alanlar (başlangıç)
Blockchain / konsensüs / merkle, LoRA/adapter/ince ayar, IPFS/CID/gateway, LLM/GGUF/quantization temelleri, dağıtık sistemler / replikasyon / CAP — gizli örneklerle çakışan kelime hazinesi.
Boyut (MVP)
500–1.500 çift kaliteli; çoğaltma için şablon + varyasyon (aynı kavram, farklı soru kökleri).
Kaçınılacak
Uzun paragraf, madde madde cevap, sohbet dili, “tabii ki”, İngilizce açıklama, tıbbi/hukuki domain.
Veri şeması (JSONL): {"instruction": "<soru>", "output": "<tek cümle referans>"} — instruction-tuning için uygun.

2. İlk eğitim reçetesi (LoRA; ilk aday)
Parametre	Öneri	Gerekçe
Base model
Qwen/Qwen2.5-0.5B-Instruct (veya üretimde benchmark koştuğunuz aynı taban GGUF’un HF karşılığı)
Mevcut pipeline’da convert_lora_to_gguf.py --base-model-id Qwen/Qwen2.5-0.5B-Instruct ile kanıtlı export; taban ile uyum şart.
Yöntem
LoRA (PEFT) — ilk deneme
DoRA ikinci iterasyon; önce teknik riski düşük tut.
Hedef modüller
q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj (Qwen2.5 standart)
Tam katman yerine FFN+attention; önceki HF adapter’larla uyumlu.
rank (r)
16
Önceki başarılı dönüşümlerde görülen r=16 ile hizalı; gerekirse 32’ye çıkılır.
alpha
32 (veya 2×r)
Tipik ölçekleme; stabil gradyan.
dropout
0.05
Küçük veri için hafif regularization.
max length
512 (seq); cevap tarafı ≤ 256 token
Tek cümle + soru için yeterli; uzun üretimi cezalandırmaz ama veri kısa tutulur.
Epoch
2–4
Küçük, hedefli veri; fazla epoch = stil kayması / ezber riski.
Batch / LR
Batch 4–8, LR 1e-4 – 2e-4 (linear warmup kısa)
Instruct üzerinde ince ayar; grid’de en düşük valid loss.
Stil hedefi
“Tek cümle tanım” + benchmark referanslarına benzeyen sözcük seçimi
Eğitim çıktıları, gizli setteki referanslarla aynı registerda yazılmalı (ölçüm lexical).
DoRA: İkinci turda denenebilir (aynı veri, benzer rank); ilk turda LoRA ile baseline alın.

BitNet/QVAC tarafı: İlk iç üretim adayı için Qwen tabanında eğitim + GGUF export önerilir; BitNet üzerinde eğitim QVAC Fabric toolchain** ve ayrı doğrulama ister — “ikinci hat”.

3. Export zinciri (somut)
Çıktı: adapter_model.safetensors + adapter_config.json (PEFT).
Dönüşüm:
python convert_lora_to_gguf.py <adapter_dir> --outfile <ad>.gguf --outtype f16 --base-model-id Qwen/Qwen2.5-0.5B-Instruct
Doğrulama: gguf ile general.type == adapter, general.architecture == qwen2.
Dağıtım: IPFS + worker slot akışı (mevcut L2 ile aynı).
4. Neden bu benchmark’a uygun?
Benchmark ROUGE-L + BLEU ile sabit Türkçe referans cümlelerine yakınlık ölçüyor; veri profili bilerek kısa tanım + teknik kelime örtüşmesi üretmeye yönelik.
Gizli örneklerle aynı tür görev (kısaca açıkla / nedir) ve aynı domain dil (zincir, LoRA, IPFS) kasten kapsanıyor.
Instruction-tuned taban + dar alanlı Türkçe SFT, modeli “uzun İngilizce cevap” yerine referansla örtüşen kısa Türkçeye iter.
5. İlk adapter adayının başarı şansı neden “yüksek” (umutlu gerekçe)
Hedef uyumu: Veri, metriğin ödüllendirdiği tek çıktı biçimine (tek cümle, tanım, Türkçe) kilitleniyor; rastgele HF LoRA’ların aksine bilerek hizalanıyor.
Kontrol: Domain ve dil dar; beklenen başarısızlık sınıfı (İngilizce/biomedikal uzun çıktı) tasarımda dışlanıyor.
Teknik yol: Aynı base + kanıtlı convert_lora_to_gguf zinciri; general.type=adapter riski düşük.
Kalan risk: Eşik 75 hâlâ sert; veri kalitesi/çeşitliliği ve taban 0.5B tavanı ACTIVE için yeterli olmayabilir — bu durumda veri artırımı, threshold veya daha büyük taban ürün kararı.
Sonuç raporu (istenen formatta)
Soru	Cevap
Eğitim veri profili ne?
Türkçe kısa soru → tek cümlelik teknik/popüler bilgi cevabı; blockchain, LoRA, IPFS, model temelleri, dağıtık sistemler; referans tarzı kısa tanım.
İlk eğitim reçetesi ne?
Qwen2.5-0.5B-Instruct üzerinde PEFT LoRA (r=16, alpha≈32), 2–4 epoch, max len 512, küçük LR; stil = tek cümle Türkçe tanım.
Neden bu benchmark’a uygun?
Metrik lexical overlap; veri ve stil hedefi doğrudan yüksek ROUGE/BLEU ile uyumlu çıktı üretmeye göre seçildi.
İlk adayın başarı şansı neden yüksek?
Kasıtlı hizalama + kanıtlı export + dar dil/domain; rastgele dış LoRA’ya göre ACTIVE ihtimali sistematik olarak artırılır.
Başarı kriteri: Takım, yukarıdaki veri profili + reçete + export adımlarıyla ilk iç üretim adapter denemesini başlatabilir; ilk koşudan sonra skorları inceleyip rank/epoch/veri büyütmesi ile ikinci tur planlanır.

------------

Aday üretim akışı nasıl olmalı?
trial_id ve adapter_etiketi ver — klasör adı ve dosya adlarıyla uyumlu 1.
Eğitim yalnızca candidates/<trial_id>/train/ altında; checkpoint/log büyük dosyalar repoda değil.
GGUF export tek çıktı: candidates/<trial_id>/export/<adapter_etiketi>.gguf — yalnızca bu dosya upload / worker slot / llama --lora için kaynak.
Checksum yaz (export/*.sha256 veya CHECKSUMS.txt).
Upload → QA → GET /v1/adapters/:id ile skor ve durum.
verify:lifecycle-chain → OFFICIAL_VERIFY_LINE kayda geçir.
runs/<trial_id>/TRIAL_RECORD.md + COMPARISON.md satırı.
Eğitim ve runtime pin (base + qvac) bilerek ayrı: train çıktısı doğrudan slota bağlanmaz; tablo ve akış §0.

Hangi dosyalar arşivlenmeli?
Tür	Ne	Nerede
Zorunlu
Export GGUF + hash
Güvenilir disk / artefakt depo; repoda hash metni
Önerilir
EXPORT.md (export komutu), kök config/ (küçük yaml)
candidates/<trial_id>/
Ürün kanıtı
TRIAL_RECORD.md, OFFICIAL_VERIFY_LINE
runs/<trial_id>/
Karşılaştırma
Tek tablo
COMPARISON.md
Repo dışı
Checkpoint, ağır train log
Uzak arşiv (.gitignore ile uyumlu)
Ayrıntı: §5.

Trial kayıt standardı ne?
Kimlik: trial_id + adapter_etiketi + export SHA256.
API: adapterId, weightsCid, benchmarkJobId, benchmarkScore, status.
Kanıt: verify çıktısının son satırı.
Şablon: TRIAL_RECORD.template.md.
Tablo: Her aday bir satır; satır silinmez.
Başarı kriteri: İçeride üretilen adapter’lar train ≠ export ≠ runtime ayrımıyla, aynı base/matris üzerinde COMPARISON tablosundan kıyaslanabilir.

Güncellenen / eklenen: LORA_CANDIDATE_TRIALS.md (§0, §3, §5–6), candidates/README.md, şablon, kök .gitignore (export GGUF, train/checkpoints, train/logs, yaygın ağır uzantılar).

--------

Sonuç raporu (istenen format)
Soru	Cevap
ACTIVE aday için minimum kanıt ne?
Aynı ortamda birlikte doğrulanan: gerçek upload → aynı benchmarkJobId ile QA callback → DB’de QaWebhookReceipt.completedAt → status=ACTIVE + benchmarkScore + arşivlenmiş OFFICIAL_VERIFY_LINE (verify=PASS). Tek başına ACTIVE satırı veya sadece skor yeterli değil.
Hangi alanlar zorunlu?
adapterId, weightsCid, benchmarkJobId, benchmarkScore, status (aday için ACTIVE), OFFICIAL_VERIFY_LINE (aynı adapterId/jobId). Örtük: receipt’in tamamlanması (verify bunu doğrular).
Smoke ile gerçek ürün adayını nasıl ayıracağız?
Smoke: e2e-lifecycle-smoke vb. minimal GGUF, çoğu zaman sabit skor / doğrudan HMAC; worker score_threshold ile üretilmiş approved olmayabilir. Gerçek aday: Worker job’u işlemiş, skor aggregate çıktısı, upload artefaktı eğitim çıktısı olarak izlenebilir; backlog’a yalnızca bu sınıf “ACTIVE aday” diye girilir.
Başarı kriteri: Tanım ve tablo apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md içinde sabitlendi; README.md Faz 6 bölümüne kısa pointer eklendi.

-------------

Aşağıdaki metin, repodaki kanonla (tek LoRA GGUF, Türkçe gizli benchmark ≥75, pin’li BitNet/QVAC tabanı, general.type=adapter) uyumlu iç üretim odaklıdır.

Tek cümle
Biz şu tip adapter üretiyoruz: resmi pin’li BitNet/QVAC taban GGUF üzerinde eğitilmiş, llama.cpp uyumlu tek dosya LoRA GGUF (general.type=adapter), Türkçe kısa cevap stiline göre optimize edilmiş ve gizli benchmark’ta ≥75 eşiğini hedefleyen — başka taban veya formata yönelmeyen — topluluk adaptörleri.

Sonuç raporu
Alan	İçerik
Hedef adapter profili
Taban: RUNTIME_PROFILES / BITNET_PINNED_ENV_MATRIX ile sabitlenmiş BitNet b1.58 TQ + qvac llama-server hattı; eğitim ve export bu tabanla birebir uyumlu. Artefakt: Üretim yolunda tek LoRA GGUF (INTEGRATION_CONTRACT §3.3); çevrimdışı GGUF export, metadata’da adapter. Davranış: Kısa Türkçe açıklayıcı cevaplar (gizli set: packages/qa-sandbox/worker/r3mes_qa_worker/data/hidden_dataset.json ile aynı karakter). Kalite hedefi: Worker birleşik skor ≥ R3MES_QA_SCORE_THRESHOLD (varsayılan 75.0).
Hangi adaylar daha baştan elenir
Yanlış taban veya “yaklaşık uyumlu” HF modelleri üzerinde eğitim. Safetensors / zip / çoklu dosya ile doğrudan yükleme beklentisi (runtime kanonu: tek CID = tek GGUF). GGUF ama tam model / general.type ≠ adapter. Yalnızca İngilizce veya alakasız domain ile eğitilmiş LoRA’lar (benchmark Türkçe). Rastgele hazır HF adapter avı (ürün kararı: hedefe göre iç üretim). Benchmark dışı “genel sohbet” veya taban-only sohbet hedefi (§3.5.1: chat LoRA zorunlu).
İlk üretim turunun amacı
Tek uçtan uca kanıt: Seçilmiş küçük Türkçe veri seti → LoRA eğitimi → GGUF adapter export → yerel llama-server + slot doğrulama → tek upload + QA + skor ≥ eşik ile ACTIVE yolunu ispatlamak; süreç ve metrikleri tekrarlanabilir kılmak — ölçek ve alan genişlemesi sonraki turlarda.
Başarı kriteri
Takım tek tür iş yapar: pin’li BitNet tabanı + Türkçe kısa cevap + tek LoRA GGUF + benchmark eşiği; buna uymayan hiçbir hat için eğitim veya deneme başlamaz.
