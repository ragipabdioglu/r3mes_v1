Önceki turdaki L2 PASS (verify:lifecycle-chain + QaWebhookReceipt + ACTIVE + benchmarkScore) kanıtı, backend’in model ailesinden bağımsız yaşam döngüsünün çalıştığını gösteriyor. Kod taraması da bunu destekliyor: benchmark kuyruğu yalnızca CID + metadata taşır; chat proxy sadece adapter_cid çözüp R3MES_AI_ENGINE_URL’e iletir; Qwen / BitNet / QVAC adı backend’de zorunlu bir dallanma olarak geçmiyor.

Sorulara kısa cevaplar
Contract değişmeden release güvenli mi?
Evet — public REST sözleşmesi (upload yanıt şeması, adapter listesi, chat çözümü, internal QA webhook) BitNet’e özel bir alan gerektirmiyor; L2 kanıtı bu yüzeyin uçtan uca tutarlı olduğunu doğruluyor. “Varsayılan runtime” değişimi AI engine / worker / operasyon tarafında kalırsa, backend tarafında zorunlu contract revizyonu yok (yalnızca sürümleme / release notu ile ortam matrisini netleştirmek yeterli).

Backend tarafında kalan blocker var mı?
BitNet default kararı için teknik bir backend engeli görünmüyor. Kalan konular genelde ortam ve güvenlik: üretimde R3MES_SKIP_WALLET_AUTH / R3MES_SKIP_CHAT_FEE kapalı, gerçek cüzdan imzası, R3MES_QA_WEBHOOK_SECRET, Postgres/Redis/IPFS, chat için R3MES_AI_ENGINE_URL erişilebilirliği ve (ücret açıksa) Sui operatör yapılandırması. Bunlar runtime flip’ten bağımsız release hazırlığıdır.

Qwen fallback yalnız operasyonel mi, zorunlu mu?
Backend açısından yalnızca operasyonel / dayanıklılık (ve ürün kararı): API, “şu model ailesi yoksa Qwen’e dön” diye zorunlu kılmıyor. Fallback, AI engine veya yönlendirme katmanında (ör. kapasite, uyumluluk, hata) tanımlanır; backend’de Qwen’e özel bir zorunluluk yok.

İstenen format — sonuç raporu
Alan	Değerlendirme
Backend flip’e hazır mı
Evet (sözleşme ve L2 zinciri açısından). Varsayılan inference’ı BitNet/QVAC yapmak, backend release’ini bloklamaz; değişiklik beklentisi AI engine + worker + deploy tarafında.
Contract güvenli mi
Evet. Public yüzey model-bağımsız; L2 PASS, adapter/QA/DB kanıtını sağlıyor. Flip için API şema değişikliği şart değil (INTEGRATION_CONTRACT / semver ile uyum korunur).
Kalan blocker var mı
Backend “BitNet default” için zorunlu kod blocker’ı yok. Pratikte: prod güvenlik/env, AI engine erişimi, isteğe bağlı operasyonel Qwen yedek yolu. Faz 5 501 stake/claim bilinçli sınırı — BitNet ile ilgili değil.
Release için öneri
Backend’i mevcut contract ile release edebilirsiniz; release notlarında şunları sabitleyin: (1) L2 doğrulama komutu ve başarı kriteri, (2) R3MES_AI_ENGINE_URL’in yeni default runtime’a işaret ettiği, (3) QA webhook sırrı ve IPFS/Redis/DB URL’leri, (4) prod’da wallet auth ve ücret bayraklarının kapalı olduğu. Qwen fallback varsa “operasyonel yedek, backend zorunluluğu değil” diye yazın.
“BitNet default olabilir / olamaz” — net cevap
Backend açısından BitNet’in varsayılan runtime olması engellenmez; kanıtlanan zincir (upload → job → QA callback → DB → verify) model etiketinden bağımsız. Olamaz denebilecek tek durum, ürünün AI tarafında BitNet’i üretimde güvenli çalıştıramamanız veya sözleşmeyi bilerek değiştirmeniz olur — bu, REST contract’ın BitNet ile uyumsuz olduğu anlamına gelmez; ayrı bir risk/deployment meselesidir.

Başarı kriteri: Backend tarafında “BitNet default olabilir” evet (contract + L2 ile uyumlu); “backend Qwen fallback’i zorunlu kılar mı?” hayır.

--------

BitNet/QVAC — varsayılan runtime olmaya hazırlık değerlendirmesi
1. Son kanıtların birlikte okunuşu
Kanıt	Ne gösteriyor?
Smoke
QVAC b7349 + HF 1bitLLM-…-tq2_0.gguf + tq2_0-biomed-…-adapter.gguf ile /v1/models, /lora-adapters, /v1/chat/completions çalışıyor.
L2 PASS
Gerçek upload → IPFS CID → Redis → worker → QVAC slot → benchmark → HMAC webhook → DB + receipt zinciri verify-lifecycle-chain PASS ile kapandı.
Negatif
Microsoft ggml-model-i2_s.gguf aynı b7349 build ile yüklenemedi (tensor/gguf uyumsuzluğu). Bu, “BitNet” etiketi altında bile çekirdek artefact’ın sabitlenmediği sürece sürpriz risk taşıdığını gösteriyor.
Tekrar üretilebilirlik: L2, pin’lenmiş ikili + pin’lenmiş base/adapter + aynı IPFS + aynı env ile tekrarlanabilir. Ancak matris henüz tek satırlık “kanon tablo” olarak repoda kilitlemiş değil (ADR’deki hedefle uyumlu: üretim için Linux/Docker + pin’li release önerisi hâlâ geçerli).

2. Sınıflandırma
Sonuç: “kontrollü rollout gerekir” — default runtime için hazır değil; deneysel risk de tamamen bitmiş sayılmaz.

Kategori	Gerekçe
Default’a hazır
❌ — Çekirdek GGUF + ikili + OS kombinasyonu tek bir kanon satırı ve geniş regresyon seti olmadan “her ortamda aynı” iddiası yok.
Kontrollü rollout
✅ — L2 + smoke, belirli pin ile ürün zincirinin çalıştığını kanıtlıyor; default yapılacaksa profil bazlı (ayrı port/env/binary), aşamalı ve geri dönüş (Qwen) ile yapılmalı.
Deneysel risk
⚠️ — Özellikle GGUF/runtime uyumu (Microsoft vs qvac HF), Windows vs Linux ikili farkı, Vulkan/CPU backend varyantları ve operasyonel sürüm kayması.
3. Soru başlıklarına kısa cevaplar
Soru	Cevap
BitNet teknik olarak default olmaya hazır mı?
Hayır (şu an). “Çalışıyor” ile “varsayılan üretim runtime’ı” arasında artefact + ikili + doğrulama disiplini eksikleri var.
Ana risk ne?
Çekirdek GGUF ↔ qvac sürümü uyumsuzluğu ve dağıtım ortamına göre ikili sapması; ikincil olarak bench/kalite (L2’de REJECTED) ürün barajıyla hizalanmadan default yapılırsa kullanıcı deneyimi riski.
Qwen neden tutulmalı?
Geniş doğrulama tabanı, standart quant GGUF + mevcut qvac CPU yolu ile düşük sürpriz, referans lifecycle ve fallback için uygun; BitNet ise hâlâ daha fazla pin ve matris gerektiriyor.
Sonraki teknik adım ne?
(1) Kanon satırı dokümante et: llama-server release etiketi + base GGUF URL/hash + adapter üretim kaynağı + minimum smoke komutu. (2) CI veya tekrarlanabilir script ile aynı L2’yi Linux/Docker’da doğrula. (3) Ürün kararı: “default” yerine “PRIMARY_BITNET” profili + Qwen default veya feature flag.
4. Tek cümle (geçiş kararı)
BitNet/QVAC, L2 ile ürün zincirine bağlanabilir ve kontrollü rollout adayıdır; ancak çekirdek artefact/runtime matrisi tek satırda pin’lenip tekrarlanabilir doğrulanmadan varsayılan üretim runtime’ı yapılmamalı — Qwen referans + fallback olarak kalmalı, BitNet ise açık profil ve sürüm disipliniyle genişletilmeli.

---------

Sonuç raporu
BitNet default profile hazır mı?
Operasyonel plan hazır — “varsayılan flip” tek başına otomatik değil. infrastructure/BITNET_DEFAULT_FLIP.md eklendi: flip sonrası 8080, ASCII base/slot yolları, logs/profile-bitnet-default/, ilgili env anahtarları, release sırası ve §0 Geçiş kapısı ile uyumlu ORTAK karar vurgusu. Kod veya deploy değiştirilmedi.

rollback var mı?
Evet. Aynı belgede §3 tek paragrafta: Qwen dosyalarına dönüş, worker/ai-engine URL ve path’leri, env yedeği, 8080’de tek model, doküman geri yazımı.

operasyonel risk ne?
Belgede tablo: kısmi deploy, çift base/path, Windows/quant uyumsuzluğu, doküman drift — her biri için kısa azaltma.

release sırası ne?
Belgede §2 (6+1 adım): staging doğrulama → env şablonu → deploy llama+worker+ai-engine → L2 duman → gözlem → RUNTIME_PROFILES / README / Qwen doküman rolü güncellemesi.

Başarı kriteri: BitNet’e geçiş plansız tek hamle değil; bu plan + rollback + sıra ile kontrollü ve geri dönüşlü. Giriş: infrastructure/README.md → Varsayılan runtime’a kontrollü geçiş.

--------

Yapılanlarin özeti:

Yapılan güncellemeler
infrastructure/RUNTIME_PROFILES.md

Yeni bölüm: «Resmi ORTAK kararı — varsayılan runtime (BitNet/QVAC)» — karar metni, yürürlük 2026-04-13, varsayılan BitNet/QVAC, Qwen = fallback + referans doğrulama, geçiş şartları.
§0 tablosu buna göre güncellendi (varsayılan = BitNet; Qwen = fallback).
Geçiş kapısı → kapandı tablosu + Qwen rolü (geçiş sonrası).
§5 önerilen düzen: önce BitNet, Qwen ikinci.
Faz 6 alt bölümü ve özet maddeler uyumlu hale getirildi.
docs/api/INTEGRATION_CONTRACT.md §3.3.2

Varsayılan runtime: BitNet/QVAC; Qwen: fallback/referans — RUNTIME_PROFILES’a gönderme.
infrastructure/RELEASE_CHECKLIST.md

Varsayılan inference runtime için kısa not + RUNTIME_PROFILES linki.
infrastructure/BITNET_DEFAULT_FLIP.md

Üst paragraf: resmi kararın RUNTIME_PROFILES’ta olduğu; dosyanın operasyon/rollback rehberi olduğu belirtildi.
Sonuç raporu (istenen format)
Soru	Cevap
Resmi runtime kararı ne?
Varsayılan üretim / golden path = BitNet + QVAC (llama-server + BitNet TQ GGUF); teknik kanıt: GGUF_LIFECYCLE_PROOF_FAZ6.md L2, faz_12.md. Tam metin: RUNTIME_PROFILES.md «Resmi ORTAK kararı».
Qwen rolü ne?
Resmi fallback ve referans doğrulama — varsayılan değil; hızlı iterasyon, uyumsuz ortamlar, karşılaştırma; QWEN_ADAPTER_RUN.md, izolasyon §2–§3.
Kanona dokunmak gerekir mi?
Evet, sınırlı — INTEGRATION_CONTRACT §3.3.2’de varsayılan dağıtım önceliği cümlesi güncellendi; §3.3.1 artefakt aynı (LoRA GGUF + çekirdek GGUF).
Release için tek karar cümlesi ne?
«Varsayılan inference runtime ORTAK kararıyla BitNet/QVAC’tır; Qwen fallback/referans’tır — RUNTIME_PROFILES yürürlük 2026-04-13; release notları ve örnek env’ler bu öncelikle uyumlu olmalıdır.» (RELEASE_CHECKLIST ilk blokta da özetlendi.)
Geçiş tarihi / kapı: Yürürlük 2026-04-13 (repo). Kapı maddeleri RUNTIME_PROFILES içinde kapandı olarak işlendi; sonraki operasyon üretim pin (Linux/Docker imaj, ADR-003) ve README/LOCAL_DEV metinlerinin BitNet varsayılanına çekilmesi (ayrı PR’lar).

Tek adres: infrastructure/RUNTIME_PROFILES.md — «Şu an hangi runtime resmi?» → BitNet/QVAC varsayılan; Qwen fallback.

---------

Özet:

Şimdi UI değişikliği gerekir mi?
Evet, ama minimal: Tek bir opsiyonel env (NEXT_PUBLIC_INFERENCE_RUNTIME_CONTEXT) ile üç giriş ekranında tek satır gösteriliyor. Env boşsa hiçbir ek UI yok — erken taahhüt yok.

Hangi ekran kritik?
Pazaryeri (/), Studio (/studio), Chat (/chat) — runtime kararı kullanıcıya bu üç akışın başında en çok anlam ifade eder; hepsinde aynı PageIntro altında InferenceRuntimeHint.

Minimum kullanıcı dili ne olur?
ORTAK metni netleşince deploy’da tek cümle set edilir, örnek:

NEXT_PUBLIC_INFERENCE_RUNTIME_CONTEXT=Varsayılan çıkarım: BitNet/QVAC (ORTAK).

Boş bırakıldığında kullanıcıda sessiz flip kalır; doldurulduğunda küçük, net, plansız değil bir bilgi satırı görünür.

Teknik: getOptionalInferenceRuntimePublicLine() + InferenceRuntimeHint (apps/dApp/components/inference-runtime-hint.tsx), .env.example güncellendi. pnpm exec tsc --noEmit başarılı.