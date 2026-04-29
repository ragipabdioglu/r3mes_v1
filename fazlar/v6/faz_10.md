Sonuç raporu
Gerçek eğitim komutu neydi?
SUBST ile R:\ üzerinden (ASCII yollar) çalıştırıldı; çalışma dizini infrastructure\llama-runtime\win-cpu-x64. Özet satır:

cd /d R:\infrastructure\llama-runtime\win-cpu-x64
llama-finetune-lora.exe --model R:\infrastructure\docker\models\bitnet\1bitLLM-bitnet_b1_58-xl-tq2_0.gguf --file R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\train\tr-conversations-v1.jsonl --assistant-loss-only --output-adapter R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\export\tr-v1.gguf --num-epochs 20 --lora-rank 16 --lora-alpha 32 --lora-modules all -ngl 0 -c 128 -b 128 -ub 128 --flash-attn off --learning-rate 1e-5 --lr-min 1e-8 --lr-scheduler cosine --warmup-ratio 0.1 --checkpoint-save-steps 100 --checkpoint-save-dir R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\train\checkpoints
Tam metin ve açıklama: infrastructure/lora-trials/candidates/2026-04-14_tr-v1/export/EXPORT.md. Log: aynı klasörde train-full.log. İşlem yaklaşık 110 dakika sürdü; çıkış kodu 0.

Çıktı GGUF oluştu mu?
Evet. Boyut: 59 916 992 bayt (~57.1 MiB).

Dosya yolu ne?
Kanonik:
C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\export\tr-v1.gguf
Aynı dosya R:\ SUBST ile:
R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\export\tr-v1.gguf
Checksum: export/tr-v1.gguf.sha256 (SHA256 üretildi).

Adapter doğrulaması geçti mi?
Evet.

llama-cli taban + --lora tr-v1.gguf ile yüklemede stderr: general.type str = adapter, adapter.type str = lora, 338 LoRA tensörü yüklendi.
Boyut, tam model değil; içerik *.lora_a / *.lora_b tensörleri (adapter yapısı).
Smoke geçti mi?
Evet (llama-server, port 8092, R:\ yolları):

Uç nokta	Sonuç
GET /v1/models
200 — model listesinde 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf
GET /lora-adapters
200 — id: 0, path R:\...\export\tr-v1.gguf
POST /v1/chat/completions
200 — object: chat.completion, system_fingerprint: b7349-b73e75af
Sunucu smoke sonrası kapatıldı (taskkill /IM llama-server.exe /F).

Sonraki tek adım ne?
Upload / QA turu: export/tr-v1.gguf + tr-v1.gguf.sha256 ile IPFS/API yükleme, ardından ürün zincirinde worker benchmark ve lifecycle doğrulaması (ARTIFACT_LAYOUT.md checklist).

Not: config/NOTES.md bu koşunun hiperparametreleriyle güncellendi. Eski dry_run.ps1 Unicode yolu yüzünden tabanı açamıyordu; bu koşu R:\ + aynı binary dizininden çalıştırıldı ve başarılı oldu.

-----------------

Sonuç raporu (istenen format)
Soru	Cevap
Upload sonrası hangi alanlar alınacak?
Upload yanıtı: adapterId, weightsCid, benchmarkJobId. QA bittikten sonra API: benchmarkScore, status. Verify çıktısı: OFFICIAL_VERIFY_LINE (tam satır). Hepsi tek yerde: yeni not infrastructure/lora-trials/FIRST_BITNET_UPLOAD_CHECKLIST.md §1.
Verify komutu ne olacak?
apps/backend-api içinde DATABASE_URL + R3MES_VERIFY_BASE_URL ile: pnpm verify:lifecycle-chain -- --adapter-id <adapterId> --job-id <benchmarkJobId> — tam blok: aynı dosya §2 (cmd + PowerShell).
ACTIVE adayı ne zaman deriz?
Altı alan tamam + status=ACTIVE + satırda verify=PASS + export eğitim GGUF + worker BitNet’te aynı jobId — aynı dosya §3 ve ACTIVE_CANDIDATE_MINIMUM_PROOF.md §5–§6.
Trial başarısızsa nasıl sınıflarız?
REJECTED → başarısız ürün trial; verify FAIL / receipt yok → hattı kırık; PENDING uzun → takılı; smoke ACTIVE → test — tablo: FIRST_BITNET_UPLOAD_CHECKLIST.md §4.
Başarı kriteri
Ürün kanıtı tarafı hazır: tek operasyon sayfası + ACTIVE_CANDIDATE_MINIMUM_PROOF.md §6 ile LORA_CANDIDATE_TRIALS.md girişinden link.

----------------

Özet aşağıda. Dokümanda yapılan güncellemeler:

infrastructure/lora-trials/ARTIFACT_LAYOUT.md — §2.5 (Unicode riski, ASCII kök, SUBST, 8.3); §6 upload listesine Windows maddesi eklendi (numaralar 1–6).
infrastructure/LORA_CANDIDATE_TRIALS.md — Girişe Windows + §2.5/§6 referansı.
infrastructure/lora-trials/candidates/2026-04-14_tr-v1/export/README.md — “Windows: nereye yazılır, path riski” alt başlığı.
infrastructure/lora-trials/FIRST_BITNET_UPLOAD_CHECKLIST.md — Export öncesi §2.5/§6 işaretçisi.
infrastructure/README.md — “Windows (kısa)” tek maddede LoRA + ARTIFACT_LAYOUT §2.5.
Windows path kuralı ne?
Unicode segment riski: Masaüstü, OneDrive altı vb. yollar bazı eğitim/export araçlarında kırılmaya yol açar; dry-run’da görülen kök neden bu.
Uygulama: (1) Repoyu C:\dev\R3MES gibi yalnız ASCII bir köke almak, (2) uzun Unicode yolu SUBST R: ... ile ASCII sürücü harfine bağlamak, (3) gerektiğinde dir /x ile 8.3 kısa yol kullanmak.
Semantik: Repo şeması değişmez; dosyaların mantıksal yeri yine candidates/<trial_id>/export/.
Export klasörü ne?
Tek yazım ve upload kaynağı: infrastructure/lora-trials/candidates/<trial_id>/export/
Beklenen: <adapter_etiketi>.gguf, aynı kökte .sha256, EXPORT.md (mevcut trial README ile uyumlu).
Upload öncesi checksum kapısı ne?
export/ altındaki .gguf ile .sha256 / Get-FileHash çıktısının byte düzeyinde eşleşmesi (§6 maddesi 2).
Ek (Windows): Eğitimin Unicode yüzünden kırılmadan bittiğinin teyidi (§6 yeni madde 3 — §2.5’e bağlı).
Tekrar eden risk kaldı mı?
Aynı makinede hâlâ OneDrive\...\Masaüstü\R3MES üzerinde çalışıp araçlara düz Unicode mutlak yol verirseniz risk tekrarlanabilir; doküman bunu bilinçli seçim olarak işaret ediyor.
Kalan operasyonel risk: Yeni araç zinciri veya WSL/Linux farklı davranışı — mitigasyon: ASCII kök veya SUBST alışkanlığı.
Başarı kriteri: Runbook’ta §2.5 + §6 ile hem path hem checksum kapıları net; ekip aynı hatayı “bilinmeyen” saymaz.

------------

Resmi cümle
İlk gerçek eğitim turunda tek hedef, dry-run’ı aşarak pin’li BitNet tabanı üzerinde gerçek LoRA GGUF export edip ürün hattında skor, durum ve verify ile kanıtlanmış bir adapter’ın ACTIVE (veya anlamlı terminal reddi) ile kapanmasıdır.

Başarı ne sayılacak (tek satır)
Üretilen gerçek LoRA GGUF, upload → QA sonrası benchmarkScore/status ile ölçülebilir sonuç ve hedef ortamda verify:lifecycle-chain tanımına uygun PASS üretir (ACTIVE veya reddedilmiş olsa da zincir kanıtı tamam).

Bir sonraki karar kapısı ne
Sonraki tur yalnızca bu turun çıktılarına göre açılır: kayıtlı skor, adapter status (ACTIVE / REJECTED / bekleyen) ve verify sonucu birlikte değerlendirilir; yeni veri, alan veya hiperparametre genişletmesi bu çıktılar sabitlenmeden başlamaz.

Özet tablo
Alan	Net ifade
İlk gerçek tur amacı
Gerçek export + ürün kanıtı; amaç ACTIVE için gerçek adapter.
Başarı ölçütü
Ölçülebilir skor/status + verify PASS (zincir tamam).
Sonraki karar kapısı
Yalnızca bu üçlünün sonucuna bağlı ikinci tur / ölçekleme kararı.

-------------------

