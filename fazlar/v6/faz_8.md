Aşağıdaki metin ORTAK seviyesinde sadeleştirilmiştir; runbook’taki komut/satır detayları ayrı belgede kalır.

Tek satır (ekip hedefi)
İlk tur: Herkes aynı pin’li BitNet tabanı ve aynı küçük Türkçe eğitim kümesi ile tek LoRA GGUF üretip ≥75 benchmark + uçtan uca QA zinciri kanıtını almak; ikinci tur ancak bu kanıt sabitlendikten sonra veri/alan genişletmek için açılır.

Şablon cümle
İlk turda, benchmark ile aynı türde (kısa Türkçe açıklayıcı) sabit bir küçük eğitim kümesiyle, matristeki pin’li BitNet b1.58 TQ taban GGUF üzerinde eğitilmiş tek üretim LoRA GGUF ve upload sonrası gizli Türkçe benchmark’ta ≥75 skor ile verify:lifecycle-chain uyumlu uçtan uca kanıtı hedefliyoruz.

Sonuç raporu
Alan	İçerik
İlk tur amacı
Tek, tekrarlanabilir üretim hattı doğrulaması: aynı BitNet pin’i + aynı küçük Türkçe veri + aynı eğitim/export disiplini → tek dosya LoRA GGUF + llama-server uyumu + QA kuyruğu + webhook ile sonuç; ekip dağılmadan bir çıktı üzerinden süreci kilitlemek.
Başarı ölçütü
Üretilen adapter (1) gizli benchmark’ta birleşik kalite ≥ eşik (varsayılan 75.0, worker score_threshold), (2) kanon formatta tek LoRA GGUF ve general.type=adapter, (3) hedef ortamda uçtan uca zincir tamam (ör. verify:lifecycle-chain PASS + terminal ACTIVE/REJECTED ile anlamlı kapanış — runbook’taki tanım).
İkinci tur neye göre açılacak
Birinci turda yukarıdaki ölçütler aynı ekip düzeniyle tekrarlanabilir şekilde karşılandığında; ikinci tur veri hacmi / alan etiketi / ince ayar genişletmesi içindir — yeni taban, yeni runtime veya Qwen ara hattı ikinci turun ön koşulu değildir.
Başarı kriteri (netlik)
İlk turun hedefi süreç kanıtı + eşik; ikinci tur ölçek ve çeşitlendirme içindir. Geçiş, “ilk tur metrikleri tutarlı şekilde geçildi” onayından başka bir şeye bağlanmaz; böylece ekip tek eğitim ekseninde kalır.

----------------

Sonuç raporu (istenen format)
Soru	Cevap
Ürün kanıtı için minimum alanlar ne?
adapterId, weightsCid, benchmarkJobId, benchmarkScore, status (ACTIVE aday için ACTIVE), OFFICIAL_VERIFY_LINE — aynı ortamda QaWebhookReceipt tamamlanmış olmalı. BitNet özel koşullar §5’te.
Belge yolu net mi?
Evet. Kanonik dosya: apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md (repo köküne göre). Üstte Kanonik yol + runbook linkleri eklendi; drift giderildi.
İlk eğitim sonrası karar nasıl verilecek?
LORA_CANDIDATE_TRIALS.md §7: Altı alan toplanır → verify=PASS + OFFICIAL_VERIFY_LINE → BitNet 8080 worker log’unda aynı jobId → hepsi tamam ise gerçek ürün ACTIVE adayı; değilse trial notunda başarısız/test.
Yapılan bağlamalar
infrastructure/LORA_CANDIDATE_TRIALS.md: Girişte kanonik ACTIVE_CANDIDATE linki + faz_7; §7 “Runbook sonu” tablosu ve karar cümlesi eklendi; verify satırındaki belirsiz apps/backend-api parantezi netleştirildi.
apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md: Repo yolu + faz_7 / LORA_CANDIDATE_TRIALS §7 çapraz referansları.
fazlar/v6/faz_7.md: Sonunda “Runbook sonu — ürün kanıtı” ile iki belgeye link.
Başarı kriteri: Eğitimden çıkan ilk adapter’ın ürün kanıtına bağlanması tek zincir üzerinden (faz_7 → export/upload → ACTIVE_CANDIDATE + LORA_CANDIDATE_TRIALS §7) artık tek yerden okunuyor.

---------------

Eğitim klasör yapısı nasıl?
Kök: infrastructure/lora-trials/

candidates/<trial_id>/config/ — küçük hiperparam / yaml-json (repo içi).
candidates/<trial_id>/train/ — eğitim çalışma alanı: checkpoints/, logs/ (büyük içerik repo dışı, .gitignore ile uyumlu).
candidates/<trial_id>/export/ — tek canonical GGUF + checksum + EXPORT.md.
candidates/<trial_id>/run/ — isteğe bağlı BitNet smoke (export kopyası + kısa metin).
runs/<trial_id>/ — upload/verify sonrası TRIAL_RECORD.md + snippets/.
Tam ağaç ve tablolar: infrastructure/lora-trials/ARTIFACT_LAYOUT.md.
Kısa özet: candidates/README.md.

Hangi dosyalar zorunlu?
Zorunlu	Açıklama
candidates/<trial_id>/export/<adapter_etiketi>.gguf
Yükleme için kaynak (diskte; repoda değil).
export/*.sha256 (veya eşdeğer)
Upload öncesi bütünlük.
Aynı trial_id ile runs/<trial_id>/TRIAL_RECORD.md
Upload sonrası ürün kaydı.
COMPARISON.md satırı
Karşılaştırma.
Şiddetle önerilir: export/EXPORT.md, config/* küçük dosyalar.

Hangi dosyalar arşivlik?
Uzun süreli / büyük: train/checkpoints/*, ham eğitim logları, export/*.gguf kopyası — artefakt deposu veya uzak arşiv (checksum ile eşleşmeli).
Hafif “iz” (repo veya wiki): .sha256, EXPORT.md, config/*, TRIAL_RECORD.md, COMPARISON.md — yeniden deneme ve denetim için.
Upload öncesi kontrol noktası ne?
Tek kapı: Yükleme yalnızca candidates/<trial_id>/export/<adapter_etiketi>.gguf ile; önce checksum doğrulaması.

Checklist (madde madde): ARTIFACT_LAYOUT.md §6 — yol doğruluğu, SHA256 eşleşmesi, etiket tutarlılığı, matris uyumu, isteğe bağlı run/ drift kontrolü.

Eklenen / güncellenen: ARTIFACT_LAYOUT.md (yeni), candidates/README.md (sadeleştirildi, trial/ alt klasörü kaldırıldı; kayıt tek yerde runs/), LORA_CANDIDATE_TRIALS.md (şema referansı), TRIAL_RECORD.template.md, infrastructure/README.md.

Başarı kriteri: İlk eğitim turunda train / export / run / runs ayrımı sabit; büyük artefakt repo dışı, küçük kanıt repo içi — dosya tarafı dağılmadan ilerler.

---------------

Aşağıdaki runbook, qvac-rnd-fabric-llm-bitnet README’deki resmi akışa ve repodaki BITNET_QVAC_PRODUCTION_MATRIX.md pin’ine dayanır. Kaynak kod ve ikililer tetherto/qvac-fabric-llm.cpp.

1) Eğitim toolchain (kesin)
Alan	Değer
Repo (dokümantasyon + örnek veri)
tetherto/qvac-rnd-fabric-llm-bitnet
Kaynak + release ikilileri
tetherto/qvac-fabric-llm.cpp — Releases
Pin (üretim matrisi ile aynı aile)
b7349
Eğitim binary (zip içinden)
llama-finetune-lora (README: What’s Included)
Ortam
Linux (önerilen): llama-b7349-bin-ubuntu-x64.zip veya Vulkan: llama-b7349-bin-ubuntu-vulkan-x64.zip. Windows: llama-b7349-bin-win-cpu-x64.zip / win-vulkan-x64.zip — eğitim süresi ve GPU için README’deki tabloya bakın.
2) Giriş veri formatı
README’de iki örnek var:

Mod	Dosya	Not
Temel
train.jsonl
Satır başına öğrenme örneği (upstream örnek: evaluations/biomedqa_data/train.jsonl — alanlar text, question, …).
Instruction (önerilen)
conversations.jsonl
--assistant-loss-only ile “instruction tuning”.
R3MES hedefi için: Türkçe kısa soru + tek cümle cevap üretip, upstream’in beklediği sohbet / JSONL şemasına oturtun. Şema sürüme göre değişebileceği için ilk adım:

./llama-finetune-lora --help
(pin’li dizinde, aynı release’ten llama-finetune-lora).

3) Base / çıktı yolları
Rol	Yol (örnek)
Base GGUF (matris)
models/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf — HF: qvac/fabric-llm-bitnet-finetune / 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf
Eğitim verisi
data/tr-qa-benchmark-v1.jsonl (veya conversations.jsonl)
Çıktı adapter
out/r3mes-bitnet-tr-lora-v1.gguf
README’de çıktı doğrudan .gguf adapter (--output-adapter); ayrı bir “safetensors → GGUF” dönüşümü zorunlu değil (QVAC llama-finetune-lora bu dosyayı üretir).

4) Eğitim komutu (şablon — matris + Türkçe instruction)
Temel çizgi (README’deki “Advanced LoRA with instruction-tuning” ile aynı yapı; dosya ve epoch’ları kendi verinize göre sıkılaştırın):

# Çalışma dizini: qvac release zip açılmış klasör (llama-finetune-lora bu dizinde veya PATH'te)
# Linux örneği:
export LD_LIBRARY_PATH="${LD_LIBRARY_PATH}:$(pwd)"
./llama-finetune-lora \
  -m models/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf \
  -f data/tr-conversations-v1.jsonl \
  --output-adapter out/r3mes-bitnet-tr-lora-v1.gguf \
  --assistant-loss-only \
  -ngl 999 \
  -c 512 \
  -b 128 \
  -ub 128 \
  --flash-attn off \
  --learning-rate 1e-5 \
  --lr-min 1e-8 \
  --lr-scheduler cosine \
  --warmup-ratio 0.1 \
  --num-epochs 8 \
  --lora-modules "all"
Notlar:

-m mutlaka matristeki TQ2 XL dosyası ile aynı aile olmalı.
-c, -b, -ub, --num-epochs: README’deki “Basic” örnekte -c 128 vardı; Türkçe tek cümle için 512 üst sınır makul; batch’leri GPU belleğine göre düşürün.
İlk denemede epoch 4–8 aralığı makul; aşırı epoch üslup kaydırabilir.
Windows (PowerShell): aynı argümanlar; llama-finetune-lora.exe, LD_LIBRARY_PATH yerine DLL’lerin bulunduğu dizinden çalıştırma (zip yapısına göre).

5) “Export” adımı
Durum	Aksiyon
Normal
Ek export yok — --output-adapter …gguf dosyası doğrudan LoRA GGUF.
İsteğe bağlı
Checkpoint’ten devam: README’deki --resume-from / --checkpoint-save-dir.
Harici convert_lora_to_gguf.py (Qwen hattı) BitNet mimarisi için bu runbook’un parçası değildir.

6) GGUF adapter doğrulama (somut)
A) Dosya meta (Python gguf):

python -c "import gguf; r=gguf.GGUFReader('out/r3mes-bitnet-tr-lora-v1.gguf'); print('type', bytes(r.fields['general.type'].parts[-1]).decode() if hasattr(r.fields['general.type'].parts[-1],'tobytes') else r.fields['general.type'])"
(BitiNet alan adları sürüme göre değişebilir; pratikte general.type → adapter beklenir.)

B) Çıkarım (üretim matrisi ile aynı ikili):

./llama-server \
  -m models/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf \
  --lora out/r3mes-bitnet-tr-lora-v1.gguf \
  --lora-init-without-apply \
  --port 8090
Ardından:

GET  http://127.0.0.1:8090/v1/models
GET  http://127.0.0.1:8090/lora-adapters
POST http://127.0.0.1:8090/v1/chat/completions  (model: 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf)
Hepsi 200 ve slot listesi dolu olmalı 1.

C) Ürün zinciri: IPFS → worker → benchmark (mevcut L2).

7) Sonuç raporu (istenen format)
Soru	Cevap
Eğitim toolchain ne?
qvac-fabric-llm.cpp release zip (b7349) içindeki llama-finetune-lora + matristeki TQ2 base GGUF.
Veri formatı ne?
Önce llama-finetune-lora --help; instruction için README’deki conversations.jsonl + --assistant-loss-only hattı; içerik: Türkçe kısa soru / tek cümle cevap (benchmark’a uygun).
Eğitim komutu ne?
Yukarıdaki llama-finetune-lora örneği (-m matris base, -f veri, --output-adapter …gguf, --assistant-loss-only, LoRA/epoch/LR).
Export komutu ne?
Yok — --output-adapter doğrudan adapter GGUF üretir.
GGUF doğrulaması nasıl?
gguf ile meta + llama-server (b7349) ile HTTP smoke; ardından R3MES worker/L2.
İlk deneme için eksik kalan tek şey ne?
Türkçe eğitim JSONL’inin, pin’li llama-finetune-lora sürümünün beklediği şemaya bire bir uyarlanması (şema için --help + küçük dry-run şart).
Başarı kriteri: Takım; b7349 zip → llama-finetune-lora → matris base → Türkçe conversations/train jsonl → --output-adapter …gguf → llama-server doğrulaması zincirini aynı sırayla çalıştırabilir. Eksik tek belirsizlik genelde veri JSONL şemasıdır; bunu yardım çıktısı + tek örnek satırla kapatın.