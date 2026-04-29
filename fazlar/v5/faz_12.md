Gerçek Fastify + Postgres zinciri bu oturumda koşturuldu: önceki 3000 süreci (cüzdan imzası zorunluydu) durduruldu; yerine R3MES_SKIP_WALLET_AUTH=1, R3MES_DEV_WALLET, R3MES_QA_WEBHOOK_SECRET=test-secret-for-hmac, IPFS_API_URL, DATABASE_URL, REDIS_URL ile backend yeniden açıldı. Ardından e2e-lifecycle-smoke.mjs ile gerçek POST /v1/adapters → gerçek POST /v1/internal/qa-result (HMAC) → DB doğrulaması yapıldı.

Not (BitNet profili): Upload’ta kullanılan dosya, sözleşmeyi geçen minimal GGUF (e2e-smoke.gguf); backend tarafında BitNet/QVAC ile aynı uçlar ve tablolar kullanılıyor. Tam BitNet ağırlık dosyası ile tekrarlamak için yalnızca weights alanına o GGUF’u koymanız yeterli; benchmarkJobId / receipt akışı değişmez. İsterseniz bir sonraki adımda gerçek BitNet GGUF yolunu da aynı komutlarla bağlarız.

Sonuç raporu (istenen formatta)
Alan	Değer
adapterId
cmnxhgvz00002kl889yy6fna1
weightsCid
QmZwiXTNbYBWVccnRyKmveaBJQphnozabzbbnXtuEMfeR7
benchmarkJobId
benchmark-0-QmZwiXTNbYBWVccnRyKmveaB
Callback 200 oldu mu
Evet ({"ok":true,...}; verify script: completedAt ile uyumlu)
Receipt oluştu mu
Evet (QaWebhookReceipt satırı var)
completedAt dolu mu
Evet (2026-04-13T17:45:29.167Z)
status ne oldu
ACTIVE
score yazıldı mı
Evet (benchmarkScore: 88.5)
verify PASS / Kısmi / FAIL
PASS
BitNet L2 (backend zinciri) kapandı mı
Evet — upload → gerçek callback uç → DB → pnpm verify:lifecycle-chain PASS
Sabitlenmiş ortam (bu koşu):

R3MES_VERIFY_BASE_URL = http://127.0.0.1:3000
DATABASE_URL = postgresql://postgres:postgres@127.0.0.1:5432/r3mes
Resmi satır:

OFFICIAL_VERIFY_LINE: verify=PASS adapterId=cmnxhgvz00002kl889yy6fna1 jobId=benchmark-0-QmZwiXTNbYBWVccnRyKmveaB status=ACTIVE receipt=Evet completedAt=Evet score=Evet chain=Evet

Yan not: POST /v1/chat/completions bu koşuda 500 (fetch failed) — AI engine ayakta değil; L2 adapter + QA + verify için gerekli değil.

Tekrar üretmek için: .env içine (geliştirme) R3MES_SKIP_WALLET_AUTH, R3MES_DEV_WALLET, R3MES_QA_WEBHOOK_SECRET ve IPFS_API_URL ekleyip pnpm e2e:lifecycle-smoke ve ardından pnpm verify:lifecycle-chain -- --adapter-id … --job-id … kullanın.

-----------

BitNet / QVAC — L2 (gerçek backend) özeti
Sabitlenen profil
Alan	Değer
Runtime
qvac-fabric-llm.cpp b7349 (llama-server win-cpu-x64)
Base GGUF
1bitLLM-bitnet_b1_58-xl-tq2_0.gguf (qvac/fabric-llm-bitnet-finetune)
Adapter GGUF
tq2_0-biomed-trained-adapter.gguf (upload ile IPFS’e gitti)
Slot
%TEMP%\qvac-bitnet-smoke\models\bitnet_slot0.gguf
Webhook
http://127.0.0.1:3000/v1/internal/qa-result (artık mock değil)
HMAC
apps/backend-api/.env içine R3MES_QA_WEBHOOK_SECRET="r3mes-dev-qa-hmac-secret" eklendi; backend bu secret ile yeniden başlatıldı
Upload sonrası gerçek kimlikler
Alan	Değer
weightsCid
QmbZjyP2PtMisYMovf3gnbbgxyTQLPN59BtYsb3MS383Fz
adapterId (DB)
cmnxhjxvy0005kl88aba1493w
benchmarkJobId
benchmark-0-QmbZjyP2PtMisYMovf3gnbbg
Zincir (gerçek)
POST /v1/adapters — weights IPFS’e yazıldı, kuyruğa job basıldı.
Worker — IPFS’ten indirme → slot üzerine kopya → GET/POST /lora-adapters → 3× chat → POST /v1/internal/qa-result → HTTP 200.
Backend — Adapter.status=REJECTED, benchmarkScore≈0.6442, QaWebhookReceipt satırı completedAt dolu.
Sorularınıza yanıt
Soru	Cevap
BitNet base
1bitLLM-bitnet_b1_58-xl-tq2_0.gguf
Adapter
Yüklemede kullanılan: tq2_0-biomed-trained-adapter.gguf → yukarıdaki weightsCid
Callback gerçek backend’e gitti mi?
Evet — log: POST .../qa-result 200
Sonuç ACTIVE mi REJECTED mi?
REJECTED (API + DB)
Teknik hata var mı?
Bu job için yok (error yok; red kalite/eşik). Kuyrukta ikinci eski job için webhook 409 (idempotent / çift işleme) — BitNet koşusuyla aynı job değil.
BACKEND verify hazır mı?
Evet — PASS
verify-lifecycle-chain.mjs çıktısı:

verify: PASS
OFFICIAL_VERIFY_LINE: verify=PASS adapterId=cmnxhjxvy0005kl88aba1493w jobId=benchmark-0-QmbZjyP2PtMisYMovf3gnbbg status=REJECTED receipt=Evet completedAt=Evet score=Evet chain=Evet
Tek cümle (olgunluk + verify)
BitNet/QVAC hattı, gerçek upload → Redis → worker → QVAC llama-server → HMAC’li webhook → DB + verify-lifecycle-chain PASS ile L2 ürün zincirinde kapandı; terminal durum REJECTED, teknik lifecycle tamam.

--------

Sonuç raporu (BitNet L2 tam stack)
servisler stabil miydi?
Bu kontrol anında evet (çekirdek altyapı + API): 5432 / 6379 / 9080 / 3000 TCP açık. BitNet llama (8081) ve worker bu ölçümde doğrulanmadı; L2 için ikisinin de ayrıca çalışır durumda olması gerekir 1.

BitNet L2 ortamı gerçek ürün koşusuna uygun muydu?
Belge olarak evet. Yeni infrastructure/BITNET_L2_STACK.md: L1 mock 3003 vs L2 gerçek http://127.0.0.1:3000/v1/internal/qa-result, R3MES_BACKEND_QA_WEBHOOK_URL, HMAC secret, verify:lifecycle-chain + aynı DATABASE_URL, tam stack tablosu. BITNET_LIFECYCLE_RUN.md içine L2 referansı eklendi; infrastructure/README.md bağlantısı güncellendi.

Qwen hattı korundu mu?
Evet — tasarım gereği: BitNet llama 8081, Qwen 8080; ayrı log kökü logs/profile-bitnet-l2/; kalıcı apps/*/.env üzerine yazmama kuralı tekrarlandı.

loglar ve kanıtlar ayrı tutuldu mu?
Evet — şema olarak: L2 için önerilen klasör logs/profile-bitnet-l2/ (worker, llama, verify çıktısı); Qwen loglarıyla karışmıyor.

altyapı gürültüsü oldu mu?
Hayır. Yalnızca dokümantasyon ve README linki; kod/env değişikliği yok.

Başarı kriteri: BitNet L2, bu belgeye göre mock webhook olmadan tekrarlanabilir; verify R3MES_VERIFY_BASE_URL + DATABASE_URL backend ile aynı olduğunda anlamlıdır.

----------

Özet: faz_12.md içindeki gerçek upload + verify:lifecycle-chain PASS ve OFFICIAL_VERIFY_LINE kanıtları GGUF_LIFECYCLE_PROOF_FAZ6.md ve RUNTIME_PROFILES.md içine işlendi.

Sonuç raporu (istenen format)
Soru	Cevap
BitNet hattı statüsü ne?
Resmi geçiş adayı (L2 — ürün zinciri kanıtlı) — gerçek Fastify webhook + Postgres + verify=PASS; kanonik satır: OFFICIAL_VERIFY_LINE: verify=PASS adapterId=cmnxhjxvy0005kl88aba1493w jobId=benchmark-0-QmbZjyP2PtMisYMovf3gnbbg status=REJECTED receipt=Evet completedAt=Evet score=Evet chain=Evet (GGUF dosyası).
Qwen hattı statüsü ne?
Resmi referans teknik yol / golden path — değişmedi; varsayılan üretim runtime hâlâ Qwen üzerinden anlatılır.
Resmi geçiş kararı verilir mi?
Varsayılan üretim/runtime = BitNet için hayır (ayrı ORTAK/ADR kararı gerekir). L2 ürün zinciri için evet — kanıt tamam; “her ortamda varsayılan BitNet” için § “Geçiş kapısı” (1) beklenir.
Kanona dokunmak gerekir mi?
Hayır — INTEGRATION_CONTRACT güncellenmedi.
Sonraki tek karar kapısı ne?
Varsayılan runtime profile = BitNet/qvac (ADR + README + release) — RUNTIME_PROFILES § Geçiş kapısı maddeleri (1)–(4).
Kanonik tek cümle (GGUF_LIFECYCLE_PROOF_FAZ6.md başında): gerçek upload, POST /v1/internal/qa-result, DB receipt ve pnpm verify:lifecycle-chain → verify=PASS ile BitNet/QVAC L2 ürün zinciri doğrulandı; terminal ACTIVE veya REJECTED kabul edilir.

Tek adres: infrastructure/RUNTIME_PROFILES.md §0 ve “Faz 6 lifecycle + verify”.

---------

Bu turda aktif geliştirme yok; notlar yalnızca L2 sonucu (ör. PASS) ve ORTAK kararı geldikten sonra ürün iletişimini planlamak içindir.

Sonuç raporu
Şimdi UI işi gerekir mi?
Hayır. L2 sonucu olmadan yüzeyde iş açılmamalı.

L2 / statü sonrası kritik ekranlar (olası etki)
Öncelik	Ekran	Neden
1
Studio
Yükleme ve uyumluluk beklentisi burada yoğunlaşır.
2
Chat
Çıkarım davranışı ve kullanıcı algısı burada belirir.
3
Marketplace
Listelenen modellerin ürün bağlamı net değilse burada karışıklık artar.
Minimum kullanıcı dili (iletişim gerektiğinde)
Tek satır: Aktif hat / ürün durumunun resmi özeti.
Kısa uyum: Adaptörlerin desteklenen çıkarım ortamına bağlı olduğu.
Duyuru: L2 PASS veya resmi statü değişikliği kullanıcıyı etkiliyorsa kısa bilgilendirme (şerit, sürüm notu veya yardım linki).
Başarı kriteri
L2 sonucu olmadan gereksiz UI işi açılmaz; yukarıdaki üç ekran + kısa dil çerçevesi, sonuç sonrası minimum müdahale planı olarak yeterli not niteliğindedir.