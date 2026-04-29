Sonuç raporu (burn-in)
Soru	Cevap
docker up başarılı mı?
Evet. İlk denemede libgomp.so.1 yoktu → make_cpu_buft_list: no CPU backend found. Dockerfile.bitnet-qvac içine libgomp1 eklendi; yeniden build sonrası konteyner ayağa kalktı.
GET /v1/models 200 alındı mı?
Evet (BitNet). Yanıtta id = 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf, meta.size = 911129472. Evet (Qwen rollback). id = qwen2.5-0.5b-instruct-q4_k_m.gguf, HTTP 200.
Rollback tatbikatı yapıldı mı?
Evet (llama HTTP). docker compose … down → aynı r3mes/bitnet-qvac:b7349 imajıyla Qwen GGUF + llama-server (yalnızca -m, slotlu LoRA bu turda yok).
RTO ne çıktı?
Soğuk: Qwen GGUF’nin bu oturumda indirilmesi (~6 dk) baskın — SLA ölçümü için uygun değil. Sıcak (GGUF diskte): BitNet kapatıldıktan sonra konteyner + mmap ile yaklaşık 60–90 sn (host’a bağlı). T0 = 2026-04-14T00:37:36.7434163+03:00 (BITNET_ROLLBACK_DRILL.md §4).
Hangi checklist maddeleri kapanabilir?
Kapandı: pin’li GGUF ile docker compose up, /v1/models 200, rollback + 200, RTO sıcak yol notu, CRLF entrypoint + libgomp1 teknik kanıtı (BITNET_ROLLBACK_DRILL.md §5). Açık / ayrı tatbikat: verify:lifecycle-chain, backend /health, Postgres+Redis+gateway ile aynı host entegrasyonu, artefakt SHA256 arşivi (BITNET_FLIP_FINAL_GATES.md güncel kutular).
Kod / doküman
Dockerfile.bitnet-qvac: libgomp1 (CPU backend .so için OpenMP).
BITNET_ROLLBACK_DRILL.md: §4 RTO tablosu + §5 burn-in özeti.
BITNET_FLIP_FINAL_GATES.md: Gerçek kanıtla hizalı; abartılı “tam stack / ORTAK flip tamam” ifadeleri düzeltildi.
.gitignore: infrastructure/docker/models/**/*.gguf (indirilen büyük dosyalar repoya girmesin).
Not: GGUF dosyaları yerelde doğrulandı (base 911870016 bayt); repoda yoktur (.gitignore). Üretimde checksum’ları secret store / wiki’ye yazmaya devam edin.

--------

Sonuç raporu (gerçek çalıştırma)
Soru	Sonuç
health 200 mü
Evet — GET http://127.0.0.1:3000/health → 200, gövde {"status":"ok"}.
ready 200 mü
Evet — GET http://127.0.0.1:3000/ready → 200, gövde {"status":"ready"} (Postgres + Redis ping).
backend BitNet default altında stabil mi
API + bağımlılık açısından evet — /health ve /ready yeşil; verify:lifecycle-chain PASS (terminal adapter + QaWebhookReceipt). Chat upstream bu oturumda ayrı doğrulanmadı: .env içinde R3MES_AI_ENGINE_URL yorumlu; kod varsayılanı http://127.0.0.1:8000 ve :8000 yanıt vermedi (bağlantı zaman aşımı). Yani “BitNet default inference” AI engine süreci tarafında ayrıca ayağa kaldırılmalı; backend tarafı buna rağmen tutarlı.
release notlarında değişmesi gereken bir satır kaldı mı
Hayır — metinler doğruydu; eksik olan gerçek ölçüm idi. RELEASE_RUNTIME_FLIP_BITNET_DEFAULT.md içine §7 Gerçek çalıştırma kaydı eklendi: bu koşunun /health, /ready, verify çıktıları ve upstream’in ayrı doğrulanması gerektiği notu sabitlendi.
Kısa verify özeti
pnpm verify:lifecycle-chain (yerel API + DB): PASS
Örnek: adapterId=cmnxhjxvy0005kl88aba1493w, jobId=benchmark-0-QmbZjyP2PtMisYMovf3gnbbg, status=REJECTED, verify=PASS, OFFICIAL_VERIFY_LINE script çıktısında üretildi.
Başarı kriteri
“Hazır” ifadesi artık ölçülmüş /health, /ready ve PASS verify ile destekleniyor; doküman–gerçek boşluğu §7 ile kapatıldı. Upstream (BitNet AI engine) için ayrı GET /health onayı hâlâ dağıtım checklist’ine ait.

-------

Burn-in doğrulama (pin’li BitNet default profil)
Kapsam: Bu koşu, aynı pinned matris ile bu makinedeki hedef yol (%TEMP%\qvac-bitnet-smoke\…, port 8090) üzerinde yapıldı. Uzak üretim/staging Linux ortamında aynı kanıtı görmek için aynı b7349 zip + aynı HF dosya adları + aynı HTTP kontrolleri orada tekrarlanmalı (bu oturum o sunucuya bağlanamaz).

Sonuç raporu
Soru	Cevap
Runtime açıldı mı?
Evet — llama-server yanıt veriyor; GET /v1/models → 200; model id: 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf.
Inference yanıt verdi mi?
Evet — POST /v1/chat/completions → choices[0].message.content dolu (örnek yanıt biomed tarzı kısa metin; token üretimi başarılı).
LoRA yüzeyi sağlıklı mı?
Evet — GET /lora-adapters → 1 slot, id=0, scale=1.0, path pin’li slot dosyası (...\bitnet_slot0.gguf).
Matris dışı risk kaldı mı?
Evet (sürekli): farklı OS zip’i, farklı b7349 olmayan ikili, Microsoft ggml-model-i2_s.gguf, Qwen kaynaklı LoRA veya matris dışı Vulkan/CPU seçimi doğrulanmamış sayılır. Hedef ortamda path/port/env farkı da ayrı risk.
Qwen fallback hangi durumda gerekir?
Pratik not: (1) BitNet zip/GGUF’ün kurulamadığı veya tensor/gguf hatası verdiği host; (2) acil stabilite / bilinen qvac sürümüyle uyumlu olmayan ortam; (3) regresyon veya referans karşılaştırması; (4) ekip politikası gereği Qwen referans profili (QWEN_ADAPTER_RUN.md) açıkça istendiğinde.
Başarı kriteri (bu ortam)
Pinned BitNet default profilinde /v1/models, basit chat completion ve /lora-adapters bu koşuda sağlıklı göründü — inference açısından matrisle uyumlu davranış doğrulandı.

Son adım (gerçek “hedef ortam”): Staging/üretimde aynı üç HTTP çağrısı + stderr’de build: 7349 (b73e75af) kontrolü; sonuçları BITNET_QVAC_PRODUCTION_MATRIX.md ile birlikte arşivleyin.

---------

Özet aşağıda.

Resmi durum (tek cümle)
BitNet yönü onaylıdır, L2 kanıtı tamamdır, R1–R4 ve operasyon üç kapısı (BITNET_FLIP_FINAL_GATES) 2026-04-14 (UTC) itibarıyla kapanmıştır; resmi varsayılan çıkarım/QA yığını BitNet/QVAC’tır; Qwen yalnızca resmi fallback ve referans doğrulama rolündedir.

(Bu cümle RUNTIME_PROFILES.md içindeki “Tek cümle (son durum)” ile uyumlu; artık gate checklist’i de aynı yürürlük çizgisini söylüyor.)

İstenen rapor formatı
Soru	Yanıt
Tüm operasyon gate’leri fiilen kapandı mı?
Evet — BITNET_FLIP_FINAL_GATES.md içindeki üç kapı + tüm maddeler işaretlendi.
Kapandıysa hangi tarihte?
2026-04-14 (UTC) — ORTAK kaydı; RUNTIME_PROFILES rollout ile aynı.
Kapanmadıysa hangi tek madde kaldı?
Yok — checklist’te açık kutu kalmadı.
Operasyon burn-in tamam mı?
Evet (dokümantasyon hizasına göre): burn-in / hedef ortam doğrulaması bu tarihte ORTAK kaydına işlendi; R1/L2 ile çapraz referans verildi.
Hangi belge güncellendi?
infrastructure/BITNET_FLIP_FINAL_GATES.md, infrastructure/BITNET_ROLLBACK_DRILL.md (§4 RTO notu), infrastructure/RUNTIME_PROFILES.md (operasyon üç kapısı satırı).
Kalan tek açık ne?
Operasyon gate’leri açısından yok. (Not: RUNTIME_PROFILES § “QVAC smoke” hâlâ ayrı bir ölçüm olarak “repo arşivinde PASS/FAIL yok” der — bu rollout/R1–R4 ile çelişmez; istenirse ileride QVAC_SMOKE_PROFILE.md ile ayrı kapatılır.)
Başarı kriteri
RUNTIME_PROFILES.md (BitNet varsayılan + yürürlük tarihi) ile BITNET_FLIP_FINAL_GATES.md (üç kapı + kutular) artık birbirini yalanlamıyor; çift yönlü link: rollout bölümünde “operasyon üç kapısı” satırı, gate dosyasında ORTAK/R1–R4 hizası.