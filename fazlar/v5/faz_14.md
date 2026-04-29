Özet: infrastructure/RUNTIME_PROFILES.md tek kaynak olarak güncellendi — BitNet yönü onaylı + hedef varsayılan, tam üretim flip yalnızca rollout gate’leri kapanınca; Qwen açıkça fallback/referans.

Ne değişti
Başlık / giriş — “tam default oldu” yerine hedef + rollout dili.
«Resmi ORTAK kararı» — Üç katman:
Onaylanan yön (stratejik) — BitNet/QVAC hedef yığın; “her ortamda şimdiden tek varsayılan” değil.
Kanıt kapıları (L2) — tablo (kapandı).
Rollout gates (production flip) — R1–R4 özet + BITNET_DEFAULT_FLIP.md’e gönderme; stable anchor {#rollout-gates-production-flip}.
Tek cümle (başarı kriteri) — Belgenin üstünde: BitNet yönü onaylı; hedef varsayılan BitNet/QVAC; canlı üretimde tam flip yalnızca rollout gate’leri kapanınca.
§0 tablo — Stratejik hedef vs canlı üretim tam flip ayrı satırlar.
§1 / §5 / Faz 6 alt özet — “varsayılan üretim” ifadeleri hedef veya rollout ile yumuşatıldı.
INTEGRATION_CONTRACT §3.3.2 — Hedef vs rollout ayrımı; Qwen fallback.
RELEASE_CHECKLIST — Flip öncesi/sonrası notu.
BITNET_DEFAULT_FLIP.md — Karar metniyle hizalı giriş paragrafı.
Kapanan netlik: BitNet hedef varsayılandır; üretim flip’i rollout gate’leri kapanınca tamamlanır; Qwen fallback/referans.

---------

Yapılan iş
Yeni dosya: infrastructure/BITNET_FLIP_FINAL_GATES.md

Üç kapı operasyonel checklist olarak ayrıldı:

Kapı 1 — Pin’li runtime matrisi
Tek tablo şablonu (ikili build id, artifact hash, GGUF hash, port, worker/ai-engine env), staging doğrulama, Qwen pin’lerinin ayrı tutulması — tümü [ ] maddeleriyle.

Kapı 2 — Linux/Docker tekrar üretilebilirlik
Etiketli Dockerfile/Compose, docker compose / build, konteyner içi GET /v1/models, ASCII volume, mevcut compose ile uyum, kabaca kurulum süresi — checkbox’lar.

Kapı 3 — Rollback tatbiki
Tarih/sorumlu, staging’de aç/kapat, BITNET_DEFAULT_FLIP.md §3 sırası, rollback sonrası health/verify, RTO notu, kısa öğrenme — checkbox’lar.

Sonunda üç kapı birlikte onay tablosu + imza satırı.

Bağlantılar: BITNET_DEFAULT_FLIP.md sonuna referans eklendi; infrastructure/README.md içine “Flip son üç kapı” linki kondu.

Başarı kriteri: Üç bölümdeki kutular işaretlendiğinde ekip “artık flip yapabiliriz” (üretim onayı ayrı) diyebilecek somut bir liste ortaya çıktı.

---------

Oluşturulan belge
infrastructure/BITNET_QVAC_PRODUCTION_MATRIX.md — içinde:

Tek satırlık kanon (aşağıda aynısı)
Binary: qvac-fabric-llm.cpp release b7349, llama-b7349-bin-win-cpu-x64.zip / llama-b7349-bin-ubuntu-x64.zip — doğrudan indir linkleri
Base GGUF: qvac/fabric-llm-bitnet-finetune / 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf (~912 MB) + chat model adı
Adapter: TQ2 uyumlu LoRA GGUF; örnek pin tq2_0-biomed-trained-adapter.gguf (~30 MB)
Yasaklı: microsoft/.../ggml-model-i2_s.gguf + b7349 (kanıtlı uyumsuzluk)
Smoke: PowerShell + minimum GET/POST listesi
L2: BITNET_L2_STACK.md ile referans
BITNET_L2_STACK.md başına bu dosyaya tek satırlık link eklendi.

Tek satırlık üretim matrisi (belgedeki kanon)
qvac-fabric-llm.cpp@b7349 + llama-b7349-bin-<OS>-<arch>.zip | HF:qvac/fabric-llm-bitnet-finetune/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf (~912MB) | LoRA: aynı org’dan TQ2 adapter GGUF (örn. tq2_0-biomed-trained-adapter.gguf ~30MB) | ASLA: microsoft/bitnet-b1.58-2B-4T-gguf/ggml-model-i2_s.gguf + bu b7349 ikilisi
Bu satır, “yanlış BitNet dosyası” riskini tek satırda sınırlar; matris dışı her şey belgede yeni spike olarak işaretlenir.

-------------

Doğrulama özeti
Kontrol	Sonuç
apps/backend-api içinde Qwen/BitNet/QVAC zorunlu dallanması
Yok (yalnızca genel “llama.cpp uyumlu GGUF” ve yorum satırları).
BenchmarkJobPayload / QA webhook
Model adı taşınmıyor — CID + kimlik + skor.
Chat proxy
Tek upstream: R3MES_AI_ENGINE_URL — varsayılan inference burada seçilir, backend’de değil.
Ek backend riski (BitNet default)
Tanımlanmadı — flip operasyonel URL + worker + AI engine ile sınırlı.
Qwen fallback
Backend’de zorunlu değil; yalnızca operasyonel (AI engine / yönlendirme).
Başarı kriteri: Release notu + production env matrisi repo içinde hazır.

Eklenen dosyalar / güncellemeler
apps/backend-api/docs/RELEASE_RUNTIME_FLIP_BITNET_DEFAULT.md

Teknik doğrulama tablosu
Kopyalanabilir production release notu şablonu
Env matrisi: zorunlu / cüzdan / dev-smoke / isteğe bağlı
Özet: flip’e hazırlık, Qwen’in operasyonel kalması, ek backend riski yok
apps/backend-api/README.md

Ortam matrisinden hemen sonra bu dokümana kısa pointer
apps/backend-api/.env.example

R3MES_AI_ENGINE_URL satırına tek cümlelik flip notu + doc linki
Sizin için tek satırlık özet
Backend açısından BitNet default güvenli kabul edilebilir; ek kod/sözleşme riski yok; Qwen fallback yalnızca operasyonel; production flip için release metni ve env matrisi RELEASE_RUNTIME_FLIP_BITNET_DEFAULT.md içinde.

-----------

Yapılan
Tek kaynaklı ürün dili: lib/ui/product-copy.ts içinde BITNET_DEFAULT_RUNTIME_PUBLIC_LINE eklendi:

Varsayılan çıkarım hattı BitNet (QVAC) üzerindedir.

Teknik terim yok, kısa ve net; üç girişte zaten kullanılan InferenceRuntimeHint ile uyumlu.
Görünürlük: Yine de yalnızca NEXT_PUBLIC_INFERENCE_RUNTIME_CONTEXT doldurulunca; şimdilik prod’da env boş kalırsa ekstra UI yok.
Flip günü işi: Dağıtım ortamında bu sabiti tek satır olarak kopyalayıp şu env’e vermek yeterli:

NEXT_PUBLIC_INFERENCE_RUNTIME_CONTEXT=Varsayılan çıkarım hattı BitNet (QVAC) üzerindedir.

env.ts JSDoc, InferenceRuntimeHint yorumu ve .env.example bu sabite ve aynı metne işaret edecek şekilde güncellendi. tsc --noEmit temiz.

ORTAK metni farklı bir cümle isterse yalnızca BITNET_DEFAULT_RUNTIME_PUBLIC_LINE ve .env.example örneğini güncellemeniz yeterli; kod değişikliği başka yerde gerekmez.