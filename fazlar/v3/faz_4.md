İşlem tamam: ADR-002 Taslak → Kabul olacak şekilde güncellendi; karar tablosu dolduruldu; tek paragraflık “claim nedir?” tanımı (Bölüm 0) hem ürün hem teknik dilde sabitlendi; isteğe bağlı gelecek Move değişikliği için etki analizi şablonu (Bölüm 7) eklendi.

Öne çıkan kararlar

Konu	Karar
“Claim”
Zincirde böyle bir entry yok; UI/API’de tek başına “Claim” kullanılmaz; anlamlar Bölüm 0 ve §3 ile adlandırılır.
reward_pool indexer
Faz 4’te hayır; ihtiyaç halinde ADR-003.
Özet veri
Stake: indexer → Prisma; kullanım ücreti (SUI) toplamları: RPC (suiRewards).
Yeni Move
Faz 4’te zorunlu değil; gerekiyorsa ayrı ADR + Bölüm 7 şablonu.
Başarı kriteri (Bölüm 0): Aynı paragraf hem “kullanıcıya stake iadesi / operatör SUI akışı” ayrımını hem de “genel claim yok” teknik gerçeğini tek cümlede birleştiriyor.

Güncellenen linkler: ONCHAIN_READ_MODEL_AND_EVENTS.md ve blockchain_architecture.md içinde ADR-002 Kabul olarak işaretlendi.

Not: “Benchmark skoru zincire yazılsın mı” gibi konular Backlog olarak bırakıldı; zincir kaynak gerçeğini iptal etmez. BACKEND/ORTAK’ın yapması kalan iş: stub veya metinlerin Bölüm 0 ile hizalanması (route mantığı değişmeden).

---------------------------------------------------------------------------------------

Faz 4 özeti
1. ORTAK şema (@r3mes/shared-types)
NotImplementedOnChainRestResponseSchema + parseNotImplementedOnChainRestResponse / safeParseNotImplementedOnChainRestResponse eklendi (schemas.ts).
contractRegression.test.ts: geçerli stake 501 gövdesi + yanlış surface reddi.
2. Runtime guard (seçici, uydurma alan yok)
GET /v1/adapters: Yanıt safeParseAdapterListResponse; başarısızsa 500 + CONTRACT_INVARIANT_VIOLATION.
POST /v1/adapters (LoRA): LoRAUploadAcceptedResponseSchema.safeParse; başarısızsa aynı 500.
onChainRestSurface: 501 gövdeleri finalizeNotImplementedBody ile şemaya uyuyor; sapma olursa throw (sessiz drift yok).
3. Belge hizası
docs/api/INTEGRATION_CONTRACT.md §3.6: 501’nin BLOCKCHAIN kararına kadar bilinçli yüzey olduğu; gerçekleştirme veya kalıcı 501’nin semver + belge + şema ile yönetileceği; backend’in ikinci iş kuralı merkezi olmayacağı yazıldı.
apps/backend-api/README.md: “Üçlü hizalama” tablosu (README / runtime Zod / testler), güvenlik notu, hangi uçların doğrulandığı.
4. Testler (happy + failure)
Liste ve her iki 501 yanıtı parseAdapterListResponse / parseNotImplementedOnChainRestResponse ile doğrulanıyor.
Yeni: POST /v1/chat/completions — adapter kaydı CID’siz → 400 ADAPTER_RESOLUTION_FAILED, fetch çağrılmıyor.
5. Komut
packages/shared-types: 10 test geçti.
apps/backend-api: 29 test geçti.
Stake/claim için gerçek zincir akışı hâlâ BLOCKCHAIN kararına bağlı; şu an davranış 501 + şema doğrulaması ile README, INTEGRATION_CONTRACT ve testlerde aynı hikâyeyi anlatıyor.

---------------------------------------------------------------------------------------

Yapılanlar (ORTAK / Faz 4 bakım)
docs/api/INTEGRATION_CONTRACT.md: §3.6’da stake/claim için BLOCKCHAIN + BACKEND karar notu → sonra tek tur güncelleme kuralı netleştirildi; 501 yüzeyi karar öncesi bilinçli durum olarak kaldı. §7’ye Faz 4 izleme tablosu (stake/claim özelinde breaking / non-breaking örnekleri) eklendi. §8 sonuna Faz 4 “yeni teori yok” notu eklendi.
docs/api/FAZ3_CONTRACT_GOVERNANCE.md: Başlık Faz 3–4 olacak şekilde güncellendi; dört artefakat (markdown → Zod/shared-types → OpenAPI → regression test) aynı PR kuralı yazıldı; stake/claim ve ara sözleşme üretmeme maddeleri eklendi; breaking tablosunun §7’de tutulması (ayrı drift dosyası yok) belirtildi.
fazlar/v3/faz_4_contract_maintenance.md: Faz 4 özet pointer’ı.
INTEGRATION_CONTRACT.md (kök) ve packages/shared-types/README.md: Faz 4 / governance referansları güncellendi.
Kod / Zod / OpenAPI / test: Bu turda değiştirilmedi (stake/claim için yeni alan veya şema yok; karar sonrası tek PR’da güncellenecek).

Bağımlılık (BLOCKCHAIN / BACKEND)
Stake/claim’in kanona işlenmesi, resmi ürün kararı ve isteğe bağlı docs/adr/ notuna bağlı; ORTAK yalnızca karar sonrası dörtlü güncellemeyi uygular.

Engel
YOK — yeni ara sözleşme veya paralel kanon tanımlanmadı.

Sonraki adım
BLOCKCHAIN + BACKEND stake/claim kararını yazdıktan sonra ORTAK: INTEGRATION_CONTRACT §3.6 + shared-types + openapi.contract.yaml + contractRegression.test.ts tek PR ile hizalar.

Başarı kriteri: Tek kanonik contract yüzeyi (markdown + tipler + Zod + OpenAPI + test) çelişkisiz kalır.

---------------------------------------------------------------------------------------

Faz 4 için yaptıklarımın özeti: yeni tolerans / sahte alan yok; mesajlar tek sözlükten geliyor ve 501 / ağ / boş durum aynı ürün dilinde.

Merkez
lib/ui/http-messages.ts — userFacingHttpMessage(status, body, context) ile generic | stake | chat | upload son ekleri; userFacingFetchFailure genişletildi (marketplace, studio); userFacingMutationFailure (stake / claim / upload) eklendi.
lib/ui/product-copy.ts — Sayfa girişleri (pageIntro), cüzdan cümleleri, sohbet rolleri / boş durum / ağ hatası, mutationCompleted, backendUrlHint.
Davranış
lib/api/chat-stream.ts — HTTP hata gövdesi artık userFacingHttpMessage(..., "chat") ile dönüyor (501’de stake metni karışmıyor).
chat-screen.tsx — Ağ hatalarında Failed to fetch vb. chat.networkError ile; diğerleri backend mesajı veya chat.streamFallback; etiketler Türkçe; walletConnectForChat.
Stake — Toast başarı: mutationCompleted; hata/501: stake bağlamı; catch: userFacingMutationFailure (ham Error.message karışıklığı kalktı).
Marketplace / studio listeleri — Catch’te sabit userFacingFetchFailure + backendUrlHint (ham exception metni kaldırıldı).
Studio yükleme — Hata: upload bağlamı; catch: userFacingMutationFailure("upload"); başarı metninde PENDING_REVIEW kullanıcıya düz yazıyla anlatılıyor.
Sayfalar — page.tsx, stake, studio, chat: pageIntro ile ürün dili; endpoint / Prisma / ROUGE ifadeleri kaldırıldı. Chat’te başlık PageIntro’da, ChatScreen içindeki çift başlık silindi.
Metin sadeleştirme
Ödül / stake kartlarında görünür teknik alan adları azaltıldı (title ile geliştirici ipucu korunuyor).
Adaptör satırında ham status metni kaldırıldı (rozet yeterli).
pnpm exec tsc --noEmit ve next build başarılı (build sırasında backend yoksa ECONNREFUSED logu önceki gibi beklenen).

Sonraki adım (backend gelince): userFacingHttpMessage içinde 2xx sonrası gerçek stake/claim yanıtına göre yalnızca mutationCompleted yerine net “işlem zincire yazıldı” vb. cümle eklemek; API şekli ORTAK paketten geldiğinde tek yerden güncellenir.

---------------------------------------------------------------------------------------------------------

Faz 4 — Kapatılan risk: webhook jobId idempotency (üretime uygun)
Seçim: Wallet jti yerine iç webhook — istemci değişmez, yalnızca sunucu + DB; Redis şart değil.

Davranış
Ham gövde üzerinde SHA-256; claimQaWebhookJob(jobId, hash) ile atomik talep.
Başarılı işten sonra completedAt set edilir.
200 + duplicate: true — aynı jobId + aynı gövde, iş tamamlanmış.
409 IDEMPOTENCY_CONFLICT — aynı jobId, farklı gövde.
503 QA_WEBHOOK_IN_FLIGHT — kayıt var, completedAt boş (paralel veya yarım iş).
Hata sonrası releaseQaWebhookClaim ile kayıt silinir; güvenli yeniden deneme.
Dosyalar
Dosya	Amaç
prisma/schema.prisma + migrations/20260409120000_qa_webhook_idempotency/
QaWebhookReceipt
src/lib/qaWebhookIdempotency.ts
claim / complete / release + hash
src/routes/internalQa.ts
Akış entegrasyonu
src/qaWebhookIdempotency.test.ts, src/internalQa.test.ts
Birim + rota testleri
package.json test:security-regression
Yeni testler dahil
security/design_replay_idempotency_faz3.md, security/audit_wallet_chat_internal.md
Güncellendi
apps/backend-api/README.md
Migrate notu
Deploy: pnpm db:migrate (veya eşdeğeri) ile yeni tablo uygulanmalı.

Kalan backlog: Wallet jti (replay), rate-limit operasyonel netleştirme, nadir zincir OK / DB hata reconcilation — dokümante edildi, bu PR kapsamı dışında.

Başarı kriteri: Faz 3’te “tasarlandı” olan webhook idempotency maddesi artık kod + test + migration ile uygulandı.

---------------------------------------------------------------------------------------------------------

Faz 4 kapsamında contract’a dokunulmadı; operasyonel davranışı kanıtlayan testler ve hafif dokümantasyon güncellemesi eklendi.

Yeni testler
tests/test_http_download_retries.py

max_rounds dolana kadar tekrarlayan başarısız denemeler → son ConnectError yükselir.
İlk round’da ConnectError, ikincisinde başarı → dosya yazılır ve SHA döner (retry stratejisi somut).
tests/test_proxy_operational.py (httpx.MockTransport, gerçek llama/IPFS yok)

test_lora_lock_serializes_critical_section: İki eşzamanlı istekte ensure_adapter_gguf içi eşzamanlı derinlik ≤ 1 (global lock).
test_second_request_nonzero_lock_wait_headers: Biri blokdayken diğeri bekler; X-R3MES-Lock-Wait-Ms biri ~0, diğeri anlamlı şekilde yüksek.
test_adapter_download_error_triage: ConnectError → stage=adapter_download, category=artifact_fetch, cause=transport.
test_lora_hot_swap_http_error_triage: lora-adapters 400 → lora_hot_swap, cause=http_status, upstream_status=400.
test_upstream_completion_error_triage: chat 503 → upstream_completion, cause=http_status.
test_non_stream_success_headers_consistent: X-R3MES-* başlıkları ve resolve_ms ile uyum.
test_stream_response_has_stable_diagnostic_headers: stream’de sabit X-R3MES-Inference-Stage / Diagnostics; cache başlığı yok (tasarım gereği).
Teknik not: Modül genelindeki _lora_lock farklı event loop’lara yapışmaması için her testte asyncio.Lock() ile yenileniyor (_fresh_lora_lock). httpx.AsyncClient yaması gerçek sınıfı kullanarak özyinelemeyi önlüyor.

Araç / yapılandırma
pyproject.toml: pytest-asyncio>=0.24, asyncio_mode = auto (dev).
Dokümantasyon
docs/ADAPTER_CACHE_AND_SWAP.md: “Operasyonel testler" tablosu.
README.md: Smoke test dosyalarına tek satır referans.
python -m pytest tests/ -q → 16 passed, ruff temiz.

---------------------------------------------------------------------------------------------------------

İşte Faz 4 için yaptığım net güncellemeler (yeni script dosyası yok, yalnızca mevcut golden-path.mjs + manifest + README).

golden-path.mjs — daha karar verilebilir çıktı
Üst özet: UYUMLU / DRIFT, X/Y paket, gerçek test ve bilinçli skip sayıları tek bakışta.
Tablo: durum sütunu (ok | DRIFT) — drift hangi pakette net görünüyor.
Drift / manifest hataları: Her kayıt için MANIFEST_EKSIK, YÜZEY_DRIFT, MANIFEST_FAZLA kodu, göreli dosya yolu ve numaralı “Ne yapmalı?” maddeleri (somut düzeltme cümlesi).
Runner uyarıları: Yüzey doğru ama runner etiketi farklıysa ayrı blok (çıkış kodu 0, uyarı metni).
--json: Tek JSON çıktısı (ok, issueCount, issues, packages, …) — güvenlik/CI gate veya başka araçlar için.
GitHub Actions: GITHUB_STEP_SUMMARY varsa markdown özet + paket tablosu + sorun listesi + parite <details> — PR’da Summary sekmesinde drift okunur.
Başarılı koşuda kısa yerel ↔ CI parite hatırlatması (aynı pip / Sui satırları).
test-surface.json
_meta.whenToEdit / ciHook: Manifesti ne zaman güncellemeniz gerektiği ve CI’nın bunu nasıl yakaladığı (tek satırlık rehber).
infrastructure/README.md
Çıktının ne anlama geldiği, --json, drift tablosu, Job summary davranışı eklendi.
Başarı ölçütü: Bir paket drift ettiğinde konsolda DRIFT + numaralı aksiyon listesi görünür; CI’da aynı bilgi Job summary’de de tekrarlanır — ek script katmanı yok.