Durum
Bu mesajda BitNet koşusunun adapterId / benchmarkJobId ve çalıştırılacak R3MES_VERIFY_BASE_URL + DATABASE_URL yok; bu yüzden verify:lifecycle-chain çıktısını ve OFFICIAL_VERIFY_LINE satırını burada üretemem. Kimlikler upload yanıtı, Postgres Adapter / QaWebhookReceipt, veya loglardaki benchmarkJobId / qa_webhook_applied ile sabitlenmeli.

Önemli: Koşu REJECTED bittiği için “ürün yeşili” değil; ama backend açısından zincir, internalQa akışında yine terminal REJECTED + receipt completedAt + benchmarkScore ile kapanmış sayılır. verify:lifecycle-chain bunu ACTIVE gibi kabul eder (ACTIVE veya REJECTED terminal).

Komut (tek resmi kaynak)
cd apps/backend-api
set R3MES_VERIFY_BASE_URL=<API>
set DATABASE_URL=<Postgres>
pnpm verify:lifecycle-chain -- --adapter-id <adapterId> --job-id <benchmarkJobId>
Kaydet: === Resmi özet (tek canlı koşu) === + OFFICIAL_VERIFY_LINE:.

Rapor şablonu (çıktıdan doldur)
Alan	Not
adapterId
benchmarkJobId
callback 200 oldu mu
completedAt doluysa handler tamamlanmış sayılır
receipt oluştu mu
completedAt dolu mu
status ne oldu
Sizin koşuda: REJECTED beklenir
score yazıldı mı
Reddedilmiş olsa da webhook gövdesinde skor yazılır
verify PASS / Kısmi / FAIL
Tam kanıt: genelde PASS (terminal + receipt)
backend zinciri resmi olarak kapandı mı
chain=Evet ve verify=PASS
Dokümantasyon
docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md içine BitNet/QVAC için: aynı verify, REJECTED’ın terminal olduğu ve ürün “SUCCESS” ile backend zinciri kapanışının ayrıldığı kısa paragraf eklendi.

Özet: BitNet hattı için resmi kanıt = yukarıdaki komutun PASS çıktısı + OFFICIAL_VERIFY_LINE. Kimlikleri paylaşırsan (veya sadece yerel http://127.0.0.1:3000 + DB ile), çıktıyı birlikte yorumlayabilirim.

-------

Aşağıdaki özet, eldeki yerel lifecycle kanıt dosyası (r3mes_bitnet_lifecycle_evidence.json) ve repodaki resmi doğrulama aracı (apps/backend-api/scripts/verify-lifecycle-chain.mjs) tanımına dayanıyor. Bu ortamda canlı backend’e verify script’i çalıştırılmadı; çelişki yok — sadece kanıt katmanı farklı.

1. BitNet lifecycle — teknik başarı seviyesi
Katman	Kanıt	Bu turda
A — Worker + QVAC runtime
IPFS (mock) → indirme → slot üzerine yazma → GET/POST /lora-adapters → gizli set benchmark → webhook gövdesi
Tamamlandı
B — Backend sözleşmesi
POST /v1/internal/qa-result gerçek API’ye gidip DB’de Adapter + QaWebhookReceipt güncellenir
Bu koşuda yok (webhook yerel 3003 mock sunucusuna gitti)
C — Resmi verify
GET /v1/adapters/:id terminal ACTIVE/REJECTED + istenirse DB receipt + verify-lifecycle-chain.mjs PASS
Çalıştırılmadı (upload + gerçek adapterId yok)
BitNet hattı teknik olarak neyi kanıtladı: A katmanında entegrasyon testi olgunluğu — R3MES worker mantığı, QVAC llama-server ve BitNet TQ2 base + adapter GGUF ile uçtan uca terminal sonuç (REJECTED) üretilebiliyor.

2. REJECTED — kalite mi, teknik mi?
Kalite. Kanıtta job_result.error null; lora_register_failed / ipfs_download_failed yok. Red, gizli benchmark skoru (~0.49) eşik 75 altında.

3. Verify ile eşleştirme ve çelişki
Soru	Cevap
Verify sonucu geldi mi?
Bu ortamda hayır; backend’e bağlı verify-lifecycle-chain.mjs çıktısı yok.
Çelişki var mı?
Hayır. Mock webhook, Fastify’ın qa_webhook_applied / DB receipt yolunu tetiklemez; verify henüz uygulanabilir veri üretmez.
Aynı job backend’e gelseydi?
Beklenti: status: REJECTED, benchmarkScore ≈ 0.49 ile API/DB tutarlı olur (upload’daki jobId / weightsCid eşleşmesi şart).
4. BitNet hattı — teknik olgunluk seviyesi
Seviye	Tanım
Şu an
L1 — Worker + QVAC BitNet doğrulandı (yerel kanıt JSON + terminal REJECTED).
Eksik (resmileşme)
L2 — Ürün zinciri = gerçek upload → kuyruk → worker → gerçek POST /v1/internal/qa-result → verify PASS.
5. Sonraki teknik adım
BitNet profili için ayrı env: R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8090, doğru qa_model_name, slot path.
Gerçek benchmark job’u: Redis’ten worker + backend_qa_webhook_url = çalışan backend POST /v1/internal/qa-result.
Upload yanıtındaki adapterId + benchmarkJobId ile:
R3MES_VERIFY_BASE_URL=... DATABASE_URL=... node scripts/verify-lifecycle-chain.mjs --adapter-id <id> --job-id <benchmarkJobId>
PASS çıktısı = BitNet hattı L2 resmi kanıt.
Tek cümle (olgunluk + verify)
BitNet/QVAC hattı worker–runtime–terminal QA açısından kanıtlandı, ancak backend verify PASS alınmadan ürün “resmi lifecycle kapalı” sayılmaz — tam resmileşme için aynı job’un gerçek webhook + verify-lifecycle-chain.mjs ile doğrulanması gerekiyor.

-------

Özet: Backend verify:lifecycle-chain çıktısı repoda yok; faz_11.md L1 tamam, L2 eksik. Buna göre tek kaynak güncellendi.

Yapılan güncellemeler
infrastructure/RUNTIME_PROFILES.md — Ana tabloda BitNet satırı L1/L2 ile yeniden yazıldı; “Faz 6 lifecycle + verify” bölümü verify + Faz 6 bağlayıcılığına göre netleştirildi; özet madde işleri güncellendi.
docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md — BitNet alt kaydında L1 vs L2 ve RUNTIME_PROFILES çapraz referansı.
INTEGRATION_CONTRACT: Dokunulmadı.

Sonuç raporu (istenen format)
Soru	Cevap
BitNet hattı statüsü ne?
Güçlü geçiş adayı (teknik — L1) — faz_11.md: worker + QVAC BitNet + terminal QA kanıtı. Resmi geçiş adayı (ürün/runtime) değil — L2 (gerçek webhook + verify:lifecycle-chain PASS + GGUF’a işlenmiş kanıt) tamamlanmadı; kanonik Faz 6 hâlâ FAILED.
Qwen hattı statüsü ne?
Resmi referans runtime yolu — aynı; öncelik ve varsayılan geliştirme hattı.
Resmi geçiş kararı verilir mi?
Hayır — L2 + § “Geçiş kapısı” yok.
Kanona dokunmak gerekir mi?
Hayır.
Sonraki tek karar kapısı ne?
L2: Çalışan backend’e gerçek POST /v1/internal/qa-result + pnpm verify:lifecycle-chain -- --adapter-id … --job-id … PASS + OFFICIAL_VERIFY_LINE ve «Resmi özet» bloğunu GGUF_LIFECYCLE_PROOF_FAZ6.md içine yapıştır; sonra ORTAK ürün/runtime kararı.
Tek cevap adresi: infrastructure/RUNTIME_PROFILES.md §0 ve “Faz 6 lifecycle + verify” alt başlığı.

Takım sorusu: “BitNet şimdi resmi olarak nerede?” → Teknik ORTAK statü: güçlü geçiş adayı (L1). Kanonik lifecycle + backend verify (L2) kapısı açık değil — resmi ürün/runtime geçişi için yeterli değil; Qwen referans olarak kalır.

-------

Sonuç raporu (BitNet verify ortamı)
servisler stabil miydi?
Evet — bu kontrol anında altyapı ve API uçları tutarlı. Docker konteynerleri healthy; Redis PONG; Postgres accepting connections; gateway 9080 ve backend 3000 /health → 200.
llama 8080 / 8081: Yanıt yok (süreç başlatılmamış). Bu, compose hatası değil; verify-lifecycle-chain.mjs doğrudan llama gerektirmez (R3MES_VERIFY_BASE_URL + DATABASE_URL).

verify güvenilir miydi?
API + DB doğrulaması için evet: Backend ve DB ayakta; zincir script’inin önkoşulları karşılanıyor. Tam kanıt için DATABASE_URL ve upload’dan gelen --adapter-id / --job-id gerekir (script dokümantasyonu).
Llama / worker içeren uçtan uca doğrulama yapılacaksa 8080 veya 8081’de llama-server ve gerekirse worker ayrıca başlatılmalı — aksi halde eksik olan runtime, altyapı “gürültüsü” değil, bilinçsiz eksik bileşen olur.

altyapı kaynaklı gürültü oldu mu?
Hayır. Önce gateway kapalıydı; storage + postgres compose ile kalktı; ölçümler tutarlı.

Kanıt dosyası: logs/bitnet-verify-sessions/evidence_2026-04-13_202134.txt

Başarı kriteri: Resmi verify-lifecycle-chain sonucu, bu ortamda Postgres/Redis/gateway/backend açıkken altyapı şüphesi üretmez; llama kapalıysa yalnızca runtime kapsamı dışı uyarısı yapılır, altyapı tartışması değil.

-------

Bu turda aktif UI geliştirme yok; aşağıdakiler yalnızca ORTAK’tan resmi BitNet statüsü / verify sonucu geldikten sonra iletişim planı için not niteliğindedir.

Sonuç raporu
Şimdi UI işi gerekir mi?
Hayır. Resmi statü ve ürün kararı netleşmeden yüzeyde değişiklik açılmamalı.

Statü değişirse kritik ekranlar hangileri?
Öncelik	Ekran	Neden
1
Studio
Yükleme ve uyumluluk beklentisi burada şekillenir.
2
Chat
Çıkarım davranışı ve kullanıcı geri bildirimi burada yoğunlaşır.
3
Marketplace
Listelenen modellerin hangi ürün bağlamında olduğu net değilse burada karışıklık artar.
Minimum kullanıcı dili ne olur? (statü / resmi hat netleşince)
Tek satır: Aktif çıkarım hattının resmi adı veya durumu (“şu an …”).
Kısa uyum notu: Adaptörlerin desteklenen hattın gereksinimlerine bağlı olduğu.
Geçiş / duyuru: Statü değişikliği kullanıcıyı etkiliyorsa kısa bir bilgilendirme (şerit, sürüm notu veya yardım linki).
Başarı kriteri
Resmi BitNet statüsü ve ORTAK kararı gelmeden gereksiz UI işi açılmaz; yukarıdaki üç ekran + kısa dil çerçevesi, karar sonrası minimum müdahale için yeterli plan notudur.