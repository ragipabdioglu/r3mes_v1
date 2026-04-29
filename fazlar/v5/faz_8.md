Sonuç raporu
Qwen hattı nasıl korunacak?
Golden path ve QWEN_ADAPTER_RUN.md ile aynı düzen: Qwen base + slot ASCII yollar, mümkünse 8080 bu profile ayrılmış kalsın.
Log/kanıt: logs/profile-qwen/ (veya mevcut logs/ düzeni) ile BitNet denemelerinden ayrı dosyalar.
BitNet hattı nasıl izole edilecek?
Ayrı base GGUF dizini (Qwen klasörüne koyma), ayrı llama log dosyaları, gerekiyorsa 8081 üzerinde ikinci llama-server veya zaman çoğullama (önce Qwen sürecini durdur).
ai-engine için BitNet denemelerinde ayrı .env kopyası` veya seanslık env; tek dosyayı üst üste yazmadan.
Hangi env/path ayrımı şart?
R3MES_QA_LLAMA_BASE_URL — worker’ın işaret ettiği llama tabanı (8080 vs 8081).
R3MES_FROZEN_GGUF_LOCAL_PATH / HF — ai-engine donmuş çekirdek (BitNet vs Qwen).
R3MES_QA_LORA_COPY_TARGET ve llama --lora — fiziksel dosya yolu; iki hat için farklı placeholder dosyaları.
Base -m path — Qwen ve BitNet dosyaları aynı dizinde karışmasın.
Geçiş sırasında ana karışıklık riski ne?
İki llama-server’ın aynı porta bağlanma teşebbüsü, güncellenmemiş R3MES_QA_LLAMA_BASE_URL, tek .env üzerine yazarak Qwen/BitNet ayarlarının birbirini ezmesi, Unicode model yolu.
Önerilen çalışma düzeni ne?
Varsayılan: Qwen + 8080 + dokümante env.
BitNet denemesi: Ya süreçleri sırayla değiştir (basit) ya da BitNet’i 8081 + tüm istemcilerde URL güncelle; logları logs/profile-bitnet/.
Detay: infrastructure/RUNTIME_PROFILES.md — infrastructure/README.md içine link eklendi.
Başarı kriteri: BitNet/QVAC denemeleri bu planla Qwen referans hattını kirletmeden yürütülebilir; yeni orchestrator yok, yalnızca profil ve port/path disiplini.

-------

Aşağıdaki değerlendirme, kamuya açık QVAC Fabric / BitNet LoRA materyali (HF blog, Tether duyurusu, qvac-fabric-llm.cpp çizgisi) ile R3MES’teki mevcut worker / llama-server düzeninin dokümantasyonu üzerinden yapıldı; repoda QVAC kaynak kodu derlenmiş halde yok, bu yüzden API sözleşmesi llama.cpp ailesi varsayımıyla hizalanıyor.

QVAC Fabric ne problemi çözüyor?
BitNet b1.58 tabanlı modellerde düşük bellek / kenar cihaz üzerinde LoRA ile ince ayar ve çıkarım (llama.cpp tabanı, TQ1_0 / TQ2_0 ternary GGUF, LoRA ağırlıkları tipik olarak FP16).
Heterojen GPU (Vulkan/Metal vb.) ile CPU ile bit-exact eşleşme iddiası; mobil ve tüketici donanımda eğitim + çıkarım yolu.
R3MES’e hangi parçalar doğrudan oturuyor?
Parça	Uyum
Artefact semantiği (adapterCid / IPFS’ten .gguf indirme)
Aynı: R3MES worker dosyayı indirip diske yazar; içerik BitNet adapter GGUF olabilir.
“Slot” modeli (sunucuda sabit --lora yolu, üzerine kopya, sonra ölçek)
Aynı desen: register_lora_adapter zaten GET /lora-adapters → copy2 → POST ile uyumlu; BitNet build de aynı HTTP davranışını sunuyorsa değişmez.
Benchmark (gizli set → v1/chat/completions → metrik → webhook)
Tamamen bağımsız; taban hangi mimari olursa olsun HTTP OpenAI uyumlu uç varsa aynı.
Profil / izolasyon
Repoda zaten Qwen vs BitNet ayrı track (RUNTIME_PROFILES.md): ayrı port, path, env — QVAC/BitNet için hazır düşünce.
Hangi parçalar uyuşmuyor veya doğrulanmalı?
Konu	Durum
Base GGUF
BitNet Qwen değil; q4_k_m Qwen yolu ile aynı ikili + aynı -m dosyası kullanılamaz. Ayrı base artefact ve doğrulama şart.
Adapter GGUF içeriği
general.type=adapter ve mimari = BitNet (veya fork’un yazdığı meta) olmalı; Qwen için convert_lora_to_gguf ile üretilen adapter BitNet tabanına takılamaz.
Runtime ikili
QVAC, BitNet + Vulkan ile genişletilmiş llama.cpp; R3MES’teki win-x64 paketinin aynı tensor / mimariyi desteklediği tek tek doğrulanmalı (doküman: BitNet daha önce uyumsuzluk nedeniyle ayrılmıştı).
Fine-tune / export
Eğitim QVAC toolchain’de; R3MES yalnızca nihai GGUF + CID bekler — uyum çıktı formatında, eğitim pipeline’ında değil.
Sınıflandırma
Seviye	Gerekçe
Doğrudan uyumlu
İş kuyruğu, IPFS indirme, webhook, benchmark döngüsü, adapter_cid anlamı.
Orta düzey entegrasyon
BitNet’a özel llama-server (veya eşdeğer) build, base/adapter dosya yolları, env profili, LoRA GGUF üretim komutu (QVAC dokümantasyonu / qvac-fabric-llm.cpp), regresyon testi.
Büyük mimari değişiklik
Yalnızca QVAC çıkarımı llama HTTP API’sinden saparsa (farklı uç, farklı LoRA modeli) — public materyalde ana çizgi llama.cpp uzantısı olduğu için beklenti: büyük sapma yok.
“BitNet’e güvenli dönüş mümkün mü?”
Evet, koşullu: Worker ve ürün akışı mimari olarak aynı kalır; risk, doğru BitNet uyumlu runtime ikilisi + doğru BitNet base + BitNet LoRA GGUF üçlüsünün Windows’ta (veya seçilen OS’te) kanıtlanmış şekilde çalışmasıdır. QVAC Fabric tam da bu boşluğu (BitNet + LoRA + llama.cpp ekosistemi) hedefliyor; R3MES tarafında Qwen referans hattını bozmadan ayrı profil + port ile BitNet track’i sürdürmek dokümantasyonla uyumlu.

En güvenli entegrasyon yolu
Qwen profilini mevcut gibi bırak (8080 veya sabitlenmiş port).
BitNet/QVAC profili: ayrı port (ör. 8081), ayrı %TEMP%\... base/adapter dizinleri, ayrı R3MES_QA_LLAMA_BASE_URL.
Resmi QVAC / qvac-fabric-llm.cpp (veya dağıtılan binary) ile llama-server benzeri süreçte /v1/chat/completions + /lora-adapters davranışını tek sayfa test ile kilitle.
Mevcut worker’ı değiştirmeden önce yalnızca ortam + artefact değiştir; gerekirse tek ince ayar: hata mesajlarında mimari adı veya ek health check.
Tek cümlelik entegrasyon maliyeti
Orta düzey: Worker kuyruğu ve HTTP benchmark hattı aynı kalır; maliyet esas olarak BitNet uyumlu QVAC/llama ikilisini ve BitNet tabanlı adapter GGUF üretimini doğrulayıp mevcut profil/env/path disiplinine oturtmaktır — tam yeni mimari değil, runtime + artefact takımı değişimi.

Not: Bu rapor, R3MES kodundaki llama_client / job_runner davranışı ile kamuya açık QVAC açıklamalarının birleştirilmesidir; üretim kararı için hedef QVAC sürümünde /lora-adapters ve OpenAI uyumlu uçların birebir olduğunu bir koşuda doğrulamak gerekir.

-------

Aşağıdaki çıkarım, mevcut INTEGRATION_CONTRACT §3.3–3.5 ve ADR-003 ile hizalıdır.

1. BitNet / QVAC dönüşünde backend public surface değişir mi?
Yol	Sonuç
QVAC Fabric llama-server (BitNet çekirdek GGUF + LoRA GGUF, HTTP /lora-adapters) — ADR’de önerilen
REST/OpenAPI yüzeyi değişmez. Değişen katman: ai-engine / worker / ikili / Docker (operasyon).
Microsoft resmi BitNet (Python/CLI, llama-server ile drop-in değil)
Fastify route şeması zorunlu değişmez; chat/çıkarım köprüsü (ai-engine → upstream) büyük ölçüde yeniden tasarlanır. Ürün kararı: proxy’ye hâlâ tek adapter_cid (IPFS) verilebiliyorsa public contract korunabilir; verilemiyorsa yeni köprü + muhtemelen yeni hata kodları / davranış → contract dokümantasyonu ve bazen wire güncellenir.
Özet: “QVAC = mevcut llama-server ailesi” ise backend public uçları aynı kalır. “Tamamen farklı BitNet entegrasyonu” ise risk çıkarım katmanında; API alan adları yine korunabilir, ama semantik ve hata yüzeyi gözden geçirilir.

2. Yüzey bazında sınıflandırma
Yüzey	Sınıf	Not
POST /v1/adapters
Çoğunlukla: contract aynen + yalnızca operasyon (QVAC yolu)
Gövde hâlâ tek weights → IPFS weightsCid. Sunucu doğrulaması bugün GGUF magic; BitNet LoRA’sı da GGUF ise değişiklik yok.
weightsCid / adapter_cid
Contract aynen korunur
Anlam: “runtime’ın yüklediği primer artefaktın CID’si”. BitNet, çekirdek seçimidir; adapter dosyası kanon olarak yine LoRA GGUF (§3.3.1).
QA webhook
Contract aynen korunur
jobId, adapterCid, status, score — runtime değişse bile backend iş kuralı aynı.
Chat proxy
Contract aynen korunur (QVAC)
Backend yine adapter_cid çözümü + ACTIVE gate; fark ai-engine’in hangi ikiliye proxy yaptığında.
Zorunlu minimal contract ekleri (sadece şu durumlarda):

Adapter artefaktı artık GGUF değil (farklı magic / uzantı) → POST /v1/adapters doğrulama ve §3.3.1 metni güncellenir; istenirse opsiyonel weightsKind gibi alan (breaking riski için semver + dörtlü senkron).
Upstream chat farklı parametre ister → genelde ai-engine içinde kalır; Fastify’de yalnızca yeni 4xx/502 dokümante edilirse minimal.
Büyük contract değişikliği gerekir mi?

QVAC + GGUF LoRA hattı: Hayır.
Resmi BitNet tek başına, mevcut HTTP sözleşmesi yok: Evet, entegrasyon + muhtemelen dokümante edilmiş yeni yüzey veya proxy sözleşmesi (ADR-003 D düşük uyum).
3. Sonuç raporu (istenen format)
Soru	Cevap
Backend yüzeyleri korunabilir mi?
Evet, BitNet/QVAC seçimi qvac llama-server + LoRA GGUF ile kalırsa (/lora-adapters, IPFS CID). Public path/method listesi aynı.
Hangi alanlar etkilenir?
Doğrudan: yok (JSON alan adları). Dolaylı: §3.3.1 açıklama metni (çekirdek BitNet mi Qwen mi — dağıtım notu); upload bayt doğrulaması yalnızca artefakt biçimi değişirse.
Public contract değişir mi?
Hayır (önerilen QVAC yolu). Koşullu evet: farklı dosya biçimi veya Microsoft BitNet köprüsü.
Migration gerekir mi?
Şema: Hayır (CID + Adapter aynı). Veri: Eski CID’ler yeni runtime’da yüklenemiyorsa operasyonel yeniden pin (mevcut §3.3.1 migration notu ile aynı mantık).
Önerilen backend yaklaşımı
Fastify’ı sabit tut; BitNet/QVAC’i ai-engine + worker + ikili sürümü ile sınırla; kanon “tek primer LoRA GGUF CID” kalsın. Alternatif motor (Microsoft BitNet) ayrı ADR + köprü; public REST’i son çare genişlet.
4. Başarı ölçütü (senin cümlenle)
BitNet/QVAC dönüşünün contract etkisi: Önerilen QVAC + GGUF yolunda public lifecycle contract değişmez; yalnızca çalışma zamanı / operasyon değişir. Public surface’in bozulmaması için stratejik koruma: weightsCid / adapter_cid semantiğini “IPFS’teki primer adapter blob” olarak tutmak ve çekirdek/ikili seçimini INTEGRATION_CONTRACT §3.3.1 yorum satırı + ADR-003 ile bağlamak — yeni zorunlu JSON alanı eklemeden.

-------

Canlı BitNet geçişi bu ortamda yok; aşağıdaki çıkarım mevcut R3MES akışına (adapter odaklı Studio / Marketplace / Chat) ve tipik ürün risklerine dayanıyor.

Sonuç raporu
Olası kullanıcı karışıklığı nerede?
Alan	Risk
Studio upload
“Bu GGUF’u hangi motor çalıştırıyor?” — Qwen ile eğitilmiş / infer edilmiş adapter ile BitNet runtime beklentisi karışabilir.
Marketplace
Kartlar yalnızca ACTIVE + isim/skor gösteriyor; hangi inference hattı (Qwen vs BitNet) görünür değilse kullanıcı “aynı kart iki farklı dünyada” sanabilir.
Chat
Adapter-only zaten net; sorun, aynı adaptörün farklı backend runtime’da farklı davranacağı beklentisi (performans/hata) — “bug mı?” sanılması.
Geçiş anı
Eski bookmark / eski marketplace beklentisi: “Dün çalışan adaptör bugün farklı” — teknik değişiklik ile ürün kırılması karışır.
Minimum ürün dili ihtiyacı ne?
Tek cümle sistem bağlamı (isteğe bağlı ama güçlü): Örn. “Çıkarım şu an <X> motor hattı üzerindedir.” — X, ORTAK’ta netleşen resmi ad (Qwen / BitNet).
Adapter uyumu: “Yüklenen adaptörlerin çalışması, o sürümde desteklenen çıkarım hattına bağlıdır.” — Studio veya tek yardım sayfası / doküman linki; kart başına uzun metin şart değil.
Geçiş duyurusu: BitNet canlı olduğunda bir kez görünür: navbar altı şerit, sürüm notu veya ayarlar — “Önceki çıkarım hattından farklılıklar: …” (kısa madde).
Kullanıcı her zaman “hangi base model”ü bilmek zorunda değil; bilmek zorunda olduğu şey: “Şu an hangi hatta koşuyorum ve adaptörüm buna uygun mu?” — bu ikinci soru dokümantasyon + kısa ürün cümlesi ile çözülür.

Hemen UI değişikliği gerekir mi?
Şu an (yalnızca Qwen, BitNet henüz yok): Genelde hayır — erken etiket (“BitNet”) kafa karıştırır.
Çoklu hattın aynı anda yaşadığı ortam (ör. A/B veya ortam bazlı): Evet, minimal — tek satırlık runtime / hat etiketi (ör. üst bilgi veya Studio/Chat’te tekrarlanan ince metin).
Tek hat, BitNet’e kesin geçiş: Evet, geçiş anında — kısa duyuru + gerekirse marketplace/chat’te tek cümle güncelleme; kartlara her kayıt için chip şart değil.
Sadece “not” (doküman / release notes) yeter mi?
Yalnızca iç ekip için evet; son kullanıcı için geçişte UI’da en az bir görünür ipucu (şerit veya bir satır) önerilir; yoksa “plansız” hissi artar.

Geçiş sonrası hangi ekran kritik?
Öncelik	Ekran	Neden
1
Studio upload
Yanlış format / uyumsuz beklenti burada doğar.
2
Chat
“Çalışmıyor” şikâyetinin ilk yeri; hat–runtime ilişkisi burada hissedilir.
3
Marketplace
Kartların “aynı ürün mü?” algısı; gerekirse global şerit veya sürüm etiketi yeter.
Başarı kriteri
BitNet’e dönüş planlanıyorsa: (1) runtime’ı nerede göstereceğiniz, (2) adapter uyumunun nerede anlatılacağı ve (3) geçiş duyurusunun nerede tek sefer görüneceği önceden netleşir; böylece yüzey plansız ve kafa karıştırıcı olmaz. Şimdilik kod değişikliği şart değil — ORTAK karar ve canlı kesim tarihi netleşince yukarıdaki minimum dil tek seferde uygulanır.

-------

Özet aşağıda. Yapılan değişiklikler: infrastructure/RUNTIME_PROFILES.md içine §0 Resmi hat vs deneysel hat (governance tablosu, geçiş kapısı, Qwen statüsü) ve docs/api/INTEGRATION_CONTRACT.md §3.3.2 altına RUNTIME_PROFILES §0 için tek paragraflık çapraz referans (kanon genişletilmeden).

Sonuç raporu (istenen format)
Soru	Cevap
Resmi mevcut hat ne?
Qwen tabanlı referans profil — ORTAK için varsayılan teknik yol: golden path, QWEN_ADAPTER_RUN.md, tercihen llama 8080. Ürün sözleşmesi yine “uyumlu base GGUF + LoRA GGUF” (§3.3.1); Qwen zorunlu tek marka değil, ama “bugün hangi hatla geliştiriyoruz?” sorusunun cevabı budur.
Deneysel hat ne?
BitNet + QVAC (llama-server/qvac yolu, BitNet GGUF) — geri dönüş / transition adayı; spike ve ikili/OS kararı ADR-003 ile. Microsoft resmi BitNet (Python/CLI) ayrı yüzey, mevcut proxy modelinde drop-in değil.
Geçiş kapısı ne?
Bilinçli ORTAK/ürün kararı + ADR veya eşdeğer “default runtime = BitNet/qvac” kaydı; tekrarlanabilir hedef ortam (tercihen Linux/Docker); isteğe bağlı güçlü kanıt: uçtan uca lifecycle SUCCESS (ör. GGUF_LIFECYCLE_PROOF_FAZ6 veya halefi — FAILED iken “resmi hat değişti” denmez); RUNTIME_PROFILES / README / release checklist ile operasyonel hizalama.
Kanona şu an dokunmak gerekir mi?
Hayır — §3.3.1–3.3.2 artefakt/wire aynı; eklenenler yalnızca dağıtım disiplini için çapraz referans ve “§3 genişletilmez” cümlesi.
Tek kaynak (takım sorusu): infrastructure/RUNTIME_PROFILES.md §0. Kanon: INTEGRATION_CONTRACT §3.3.2 (yeni paragraf RUNTIME_PROFILES’a işaret ediyor).

