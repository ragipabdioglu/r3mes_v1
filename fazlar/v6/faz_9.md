Aşağıdaki özet, b7349 ile aynı commit’teki (b73e75af) llama-finetune-lora ve common_opt_sft_dataset_init kaynağı ile doğrulandı; examples/training/README.md ile de tutarlı.

Veri şeması doğru mu?
Evet — mevcut tr-conversations-v1.jsonl şeması bu sürüm için uygun.

--assistant-loss-only açıkken araç, satır satır JSON okuyor ve yalnızca şu koşulu sağlayan satırları yüklüyor: kök nesnede messages anahtarı var ve dizi. Her mesajda role ve content (string) bekleniyor; system / user / assistant rolleri destekleniyor (manuel ChatML birleştirme veya model gömülü şablonu ile).

Upstream examples/training/README.md ifadesi: “json format just like huggingface with role and content for each role” — sizin dosyadaki messages dizisi tam bu kalıba uyuyor.

Dosyayı değiştirmeniz gerekmiyor.

Değilse / ne zaman düzeltilmeli?
messages yoksa veya satır geçerli JSON değilse satır yok sayılır.
Mesajda role / content eksikse o mesaj atlanır; hepsi eksikse örnek boşa düşer.
--assistant-loss-only olmadan aynı dosyayı verirseniz, araç veriyi “düz metin / next-token” modunda işlemeye çalışır; messages JSONL için yanlış mod olur → mutlaka --assistant-loss-only kullanın.
Kabul edilen en küçük geçerli örnek (tek satır):

{"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
Dry-run komutu (kısa)
Amaç: zinciri doğrulamak (şema + şablon + bir epoch). Çalışma dizini: llama-b7349-*.zip içinden çıkan klasör ( llama-finetune-lora ile aynı ortam).

Not: b7349 finetune-lora.cpp içinde doğrulama ayrımı yaklaşık %5 sabit; tek satırlık dosyada eğitim payı 0’a düşüp “Training split is empty” hatası verebilir. En az 2 satır veya sizdeki gibi tüm dosya (24 satır) kullanın.

Linux / bash (önerilen üretim hattı):

./llama-finetune-lora \
  -m ./models/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf \
  -f ./train/tr-conversations-v1.jsonl \
  --assistant-loss-only \
  --output-adapter ./out/r3mes-bitnet-tr-dry.gguf \
  --num-epochs 1 \
  --lora-rank 16 --lora-alpha 32 \
  -ngl 999 -c 128 -b 8 -ub 8 \
  --flash-attn off \
  --checkpoint-save-steps 0
-f yolunu gerçek konuma çevirin, örneğin:

./infrastructure/lora-trials/candidates/2026-04-14_tr-v1/train/tr-conversations-v1.jsonl

Windows (CPU zip, göreli yol örneği):

.\llama-finetune-lora.exe `
  -m "C:\path\to\1bitLLM-bitnet_b1_58-xl-tq2_0.gguf" `
  -f "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\train\tr-conversations-v1.jsonl" `
  --assistant-loss-only `
  --output-adapter ".\out\r3mes-bitnet-tr-dry.gguf" `
  --num-epochs 1 `
  --lora-rank 16 --lora-alpha 32 `
  -ngl 0 -c 128 -b 8 -ub 8 `
  --flash-attn off `
  --checkpoint-save-steps 0
Gerçek ilk eğitim komutu (öneri)
qvac-rnd-fabric-llm-bitnet README’deki “Advanced LoRA + instruction” çizgisiyle hizalı; veri yolu ve çıktı adını kendi ağacınıza göre güncelleyin:


./llama-finetune-lora \
  -m ./models/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf \
  -f ./train/tr-conversations-v1.jsonl \
  --assistant-loss-only \
  --output-adapter ./out/r3mes-bitnet-tr-lora-v1.gguf \
  --lora-modules "all" \
  -ngl 999 -c 128 -b 128 -ub 128 \
  --flash-attn off \
  --learning-rate 1e-5 --lr-min 1e-8 \
  --lr-scheduler cosine --warmup-ratio 0.1 \
  --num-epochs 20 \
  --checkpoint-save-steps 100 --checkpoint-save-dir "./lora_checkpoints"
İhtiyaç halinde (modelin gömülü Jinja’sı beklediğiniz ChatML ile uyuşmuyorsa) upstream’in desteklediği --chat-template ile HF uyumlu bir şablon dosyası eklenebilir.

İlk koşu için kalan tek kritik risk (tek nokta)
Donanım ve katman seçimi: BitNet XL tabanı + LoRA eğitimi için VRAM / -ngl (veya CPU’da süre) ilk gerçek koşuda en sık kırılma noktasıdır; OOM veya aşırı yavaşlama olursa -c, -b/-ub, --lora-rank ve -ngl ile aynı komut içinde düşürmek gerekir.

(Teknik not: SFT tarafında şablon, ChatML dışı bir çıktı üretirse logda “no assistant spans” uyarıları görülebilir; bu durumda --chat-template veya log takibi devreye girer — ama sizin user/assistant sohbeti ve upstream’in ChatML yedek yolu tipik senaryoda yeterlidir.)

Sonuç: Veri şeması doğru; messages + role/content b7349 kodunda açıkça destekleniyor; ek dönüşüm şart değil. Yukarıdaki dry-run ve tam eğitim komutları, takımın bugün net bir ilk BitNet eğitim satırı çalıştırması için yeterli netlikte.

-----------------

Özet rapor aşağıda. Ek olarak runs/2026-04-14_tr-v1/TRIAL_RECORD.md için upload öncesi bir şablon stub eklendi ve candidates/.../README.md içine klasör haritası işlendi.

Trial klasörü yeterli mi?
Evet. 2026-04-14_tr-v1 altında şu yapı net ve tutarlı:

config/NOTES.md
train/ (README.md + tr-conversations-v1.jsonl)
export/README.md
run/README.md
runs/2026-04-14_tr-v1/ (README.md + TRIAL_RECORD.md stub)
Kök README.md artık bu ayrımı tabloyla özetliyor ve ARTIFACT_LAYOUT.md’ye bağlıyor.

Eksik küçük dosyalar neler?
Eğitim başlamadan zorunlu ek dosya kalmadı (notlar ve README’ler yerinde).

Hâlâ “iş akışıyla doldurulacak” maddeler:

Ne	Ne zaman
config/NOTES.md içindeki hiperparametre tablosu
Eğitim planı netleşince
export/tr-v1.gguf, tr-v1.gguf.sha256, EXPORT.md
Eğitim bittikten sonra
runs/2026-04-14_tr-v1/TRIAL_RECORD.md içeriği
Upload / verify sonrası (şu an sadece “upload öncesi” stub)
İsteğe bağlı runs/.../snippets/
Gerekirse
Eğitim sonrası export nereye yazılacak?
Tek yazım yeri:
infrastructure/lora-trials/candidates/2026-04-14_tr-v1/export/

Beklenen isimler (export/README.md ile uyumlu): tr-v1.gguf, tr-v1.gguf.sha256, EXPORT.md. Büyük checkpoint’ler train/checkpoints/ vb. repo dışı / .gitignore kapsamında kalır.

Upload öncesi kontrol noktası ne?
Dosya seti: export/ altında GGUF + .sha256 + EXPORT.md var mı?
Bütünlük: sha256sum (veya eşdeğeri) ile checksum dosyası ile dosya eşleşiyor mu?
Etiket: Adapter adı / tr-v1 ile config/NOTES.md ve EXPORT.md tutarlı mı?
Kaynak: Sadece export/ — run/ veya train/ yüklenmez.
Ayrıntılı liste için repo içi referans: infrastructure/lora-trials/ARTIFACT_LAYOUT.md §6.

Başarı kriteri: İlk eğitim turu açıldığında train / export / run / runs ayrımı dosya düzeyinde net; büyük artefaktlar repo dışı, küçük kanıt ve dokümantasyon repo içinde tek yerlerde tanımlı.

----------------

Sonuç raporu (istenen format)
Soru	Cevap
İlk trial sonrası tek kontrol listesi ne?
Altı madde: adapterId, weightsCid, benchmarkJobId, benchmarkScore, status, OFFICIAL_VERIFY_LINE (verify=PASS). Tek tablo: ACTIVE_CANDIDATE_MINIMUM_PROOF.md §6.
ACTIVE adayı ne zaman deriz?
Altı alan dolu ve status=ACTIVE ve OFFICIAL_VERIFY_LINE içinde verify=PASS ve kaynak export eğitim GGUF’u ve worker aynı benchmarkJobId ile BitNet llama’da koşmuş. Eksik / REJECTED / smoke → ürün ACTIVE adayı değil.
TRIAL_RECORD için eksik alan var mı?
Giderildi. Şablona “İlk trial — ürün kanıtı (minimum 6 alan)” bölümü eklendi; final status notu netleştirildi; OFFICIAL_VERIFY_LINE için örnek satır şekli verildi. Kanonla çapraz link: ACTIVE_CANDIDATE §6 ↔ TRIAL_RECORD.template.md.
Başarı kriteri
İlk eğitim turundan çıkan adapter için karar yolu: §6 tablosu + TRIAL_RECORD şablonu üst bloğu — tartışma için ek alan gerekmiyor; COMPARISON.md satırı aynı altı alanla uyumlu kalır.

--------------

Resmi ilk trial cümlesi
İlk trial’da ekip, hazır küçük Türkçe veri seti ve BitNet runbook ile aynı pin’li taban üzerinde tek üretim LoRA GGUF çıkarıp uçtan uca QA + gizli Türkçe benchmark akışında kanıtlayacak; başka yön veya ara taban yok.

Başarı ne sayılacak
Tek, runbook’a uygun BitNet LoRA GGUF (kanon: tek dosya, adapter tipi).
Gizli benchmark’ta birleşik skor ≥ worker eşiği (varsayılan 75.0).
Uçtan uca zincir tamam (upload → kuyruk → QA webhook → anlamlı terminal durum; hedef ortamda verify:lifecycle-chain PASS tanımı runbook’taki gibi).
İkinci tur neye bağlı
İkinci tur, yalnızca bu ilk trial’da yukarıdaki başarı ölçütü tekrarlanabilir biçimde (aynı runbook + aynı veri/disiplinle) karşılandığında açılır; amaç veri/alan/ince ayar genişletmek — yeni taban veya paralel deneme hattı değil.

Özet tablo
Alan	Net ifade
İlk trial amacı
Aynı veri + aynı BitNet runbook ile tek hat üzerinde uçtan uca kanıt.
Başarı ölçütü
Eşik + kanon artefakt + uçtan uca zincir (yukarıda).
İkinci tur açılış koşulu
Birinci tur başarısının sabitlendiği onayı; sonra ölçekleme.


