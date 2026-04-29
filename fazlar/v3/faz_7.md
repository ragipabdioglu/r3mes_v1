Faz 7 hedefi için canlı zinciri kanıtlayacak araçlar eklendi; gerçek adapter_cid ve ayakta llama/IPFS ortamı sizde çalıştırıldığında --prove-inference çıktısı ve loglar “gerçek yanıt” kanıtı olacak (burada altyapı olmadığı için canlı koşu yapılmadı).

1. scripts/smoke_ai_engine.py

--prove-inference: Aynı CID ile ardışık 2 non-stream istek; her ikisinde HTTP 200 ve verify_openai_completion_body ile dolu choices[0].message.content (veya text) zorunlu.
Log satırları: assistant_preview, LIVE_PROOF_OK: cache_pattern=... (ideal soğuk önbellek: miss_then_hit; ikisi de önceden ısınmışsa hit_hit).
Tek istek modu: 200 ise assistant_preview + uyarı (şekil uymazsa).
İstek gövdesi: kısa prompt, max_tokens: 64.
Çıkış kodları: 0 OK · 1 health · 2 CID yok · 3 chat HTTP hatası · 4 200 ama completion kanıtı yok · 5 --prove-inference + concurrent≠1.
2. docs/LIVE_SMOKE.md
Desteklenen format tek cümle (LoRA GGUF, lora-adapters ile uyumlu).
Önkoşullar, --prove-inference adımları, başarılı çıktıda ne aranacağı, 3/4 anlamları.
3. README.md + RUNBOOK.md + ADAPTER_CACHE_AND_SWAP.md
README’de adapter formatı net cümle.
Runbook checklist’e canlı kanıt (--prove-inference); çıkış kodları tablosu güncellendi.
LIVE_SMOKE.md linkleri.
4. Testler
verify_openai_completion_body, _cache_pattern için birim testler (tests/test_smoke_script_helpers.py).
Sizin yapmanız gereken (gerçek kanıt):
R3MES_SKIP_LLAMA kapalı, geçerli LoRA CID, gateway erişilir iken:

set R3MES_SMOKE_ADAPTER_CID=<onaylı_cid>
python scripts/smoke_ai_engine.py --prove-inference --json
Beklenen: LIVE_PROOF_OK, JSON_SUMMARY içinde live_proof.completion_verified, loglarda r3mes_inference ile uyumlu süreler.

pytest 23 passed, ruff temiz.

---

Faz 7 — Uçtan uca yaşam döngüsü (backend)
Yeni iş kuralı eklenmedi; tekrarlanabilir kanıt, dokümantasyon ve demo logları eklendi.

1. Dokümantasyon — apps/backend-api/docs/E2E_LIFECYCLE_DEMO.md

Önkoşullar (API, IPFS, QA secret, tipik SKIP_* ayarları).
Mermaid sıra diyagramı: upload → QA → ACTIVE → chat.
Log anahtarları: e2eLifecycle (upload_accepted → qa_webhook_applied → chat_proxy_resolved).
pnpm run e2e:lifecycle-smoke ve manuel adımlar.
Başarı: aynı ortamda script’in ardışık iki kez anlamlı şekilde çalışması (dokümanda tanımlı).
2. Smoke script — apps/backend-api/scripts/e2e-lifecycle-smoke.mjs
GET /health → POST /v1/adapters (minimal .safetensors) → POST /v1/internal/qa-result (HMAC) → GET /v1/adapters/:id (ACTIVE) → POST /v1/chat/completions (adapter_db_id).
R3MES_E2E_BASE_URL (varsayılan [http://127.0.0.1:3000](http://127.0.0.1:3000)), R3MES_QA_WEBHOOK_SECRET (sunucu ile aynı).
Chat’te 400 + ADAPTER_RESOLUTION_FAILED varsa çıkış 6 (çözüm hatası).
package.json: "e2e:lifecycle-smoke": "node scripts/e2e-lifecycle-smoke.mjs".
3. Yapılandırılmış loglar (e2eLifecycle)
adapters.ts: upload_accepted — adapterDbId, weightsCid, benchmarkJobId, status.
internalQa.ts: qa_webhook_applied — adapterId, jobId, newStatus, onChainApplied.
chatProxy.ts: chat_proxy_resolved — hasAdapterCid.
4. README + .env.example
README’de Faz 7 bölümü (doc linki, komut, log beklentisi).
.env.example başında Faz 7 smoke notu.
Testler
npx vitest run — 40/40 geçti; entegrasyonda chat_proxy_resolved ve qa_webhook_applied logları görünüyor.
Not: Tam E2E için YAPAY ZEKA motoru, IPFS, DB/Redis ve gerçek QA worker akışı altyapıda ayakta olmalı; script bu ortamda tekrarlanabilir tam zinciri doğrular. AI kapalı olsa bile chat adımında adapter çözümü başarısız olmamalı (ADAPTER_RESOLUTION_FAILED script’te hata sayılır).

---

Faz 7 için MVP’yi sadeleştirdim ve doğrulama adımlarını netleştirdim.

MVP’den çıkarılanlar (gereksiz yüzey)
Lockup takvimi (lockup-explainer.tsx) kaldırıldı: örnek tokenomik tablosu MVP ana yolculuğuna dahil değildi; kullanıcıyı yanlış kesinlik beklentisine sokabiliyordu.
/stake artık yalnızca PageIntro + StakeDashboard — odak: özet / ödül / deneme işlemleri.
Dokümantasyon
apps/dApp/docs/ux-journey-checklist.md Faz 7 MVP’ye göre sadeleştirildi: Pazaryeri → Chat → Stake → Studio + yan kart; gerçek tarayıcıda işaretlenecek kısa maddeler.
Doğrulama
pnpm exec tsc --noEmit ve pnpm exec next build başarılı.
Geliştirme sunucusunda GET /stake 200 (HTTP duman testi).
Yerelde tam MVP turu için: pnpm exec next dev (ör. 3100) açıkken tarayıcıda checklist’i sırayla işaretleyin; backend yoksa pazaryeri/stake veri hataları beklenen; odak metinlerin ve tonların (başarı / boş / 501 / ağ / imza) tutarlı kalması olmalı.

Arka planda bir next dev süreci açık kaldıysa, işiniz bitince o terminalde durdurmanız yeterli.

---

Faz 7 — Özet
Tek giriş noktası
pnpm mvp → pnpm release:check ile aynı (takma ad).
Zincir: validate → smoke:ts → mvp-proof.mjs → release-gate-banner.mjs (yeni orchestrator yok; tek küçük rapor dosyası).
MVP “proof” raporu
infrastructure/scripts/mvp-proof.mjs: Test çalıştırmaz; az önce geçen adımları ürün dilinde özetler (E2E’nin kapıda olmadığı, TS smoke kapsamı, release:check:full ne zaman).
--full: release:check:full sonunda Move dahil metin.
Karar netliği
RELEASE_CHECKLIST.md: “MVP smoke ve release kapısı” tablosu — tarayıcı E2E kapıya bağlı değil; teknik kapı validate + tanımlı smoke; smoke.yml ayrıca üretim benzeri ek doğrulama.
infrastructure/PREREQUISITES.md: Node, pnpm, Python, Docker, Sui — kısa tablo + pip / CI hizası.
Diğer
Makefile: make mvp → pnpm mvp.
infrastructure/README.md: mvp + PREREQUISITES linkleri.
test-surface.json _meta: mvp / mvp-proof metni güncellendi.
CI: Yeni job yok (süre artışı yok).
Başarı ölçütü (ekip için tek yorum)
Yerelde veya sürüm öncesi pnpm mvp yeşil ve PR’da ci.yml yeşil → aynı checklist cümlesi geçerli; Move dokunduysa ek olarak pnpm release:check:full yeşil.

---

Teslim: security/mvp_security_sanity_faz7.md
İçerik özeti:

§1 MVP journey sanity tablosu — Cüzdan bağlama → korumalı işlemler (chat / LoRA) → beklenen 401’ler → jti açıkken ek imza davranışı ve UX notu (ürün kararı için).
§2 Kabul edilen riskler (A1–A6) — Faz 6 ile uyumlu sahip rolü, izleme sinyali, gözden geçirme sıklığı şablonu.
§3 Canlı smoke / demo — sırlar — Operatör anahtarı, webhook secret, DATABASE_URL, NEXT_PUBLIC sınırları, skip bayrakları, iç webhook; kısa checklist.
§4 Kapanış kriterleri — Üç onay maddesi.
§5 İlişkili belgeler — release_checklist_faz6, runbook_abuse_faz5, pentest_report.
Çapraz referanslar:

security/release_checklist_faz6.md sonuna Faz 7 bağlantısı eklendi.
apps/backend-api/README.md içinde Faz 6 bölümüne Faz 7 canlı teyit satırı eklendi (güvenlik notunda zaten vardı).
Başarı kriteri: Checklist tek başına yeterli sayılmıyor; belge açıkça canlı gözlem + sahiplik + demo sırlar üçlüsünü zorunlu kılıyor; “bilinmeyen bilinmez” için §4’teki kutular işaretlenmeli.

---

Faz 7 — ORTAK contract freeze ve canlı doğrulama (tek referans)

- **Kanon:** `docs/api/FAZ3_CONTRACT_GOVERNANCE.md` içindeki **Faz 7** bölümü (freeze korunur; yalnızca gerçek runtime farkında tek tur dörtlü senkron; yeni bilgi yoksa contract’a dokunulmaz).
- **Engel:** Demo sırasında keşfedilen küçük nüanslar için gereksiz contract churn.
- **Drift:** `pnpm contract:drift` (Faz 6 ile aynı minimum).
- **Başarı:** Faz 7 boyunca kanon **istikrarlı**; ölçülen **yeni** wire gerçeği yoksa ORTAK dosyalarında değişiklik yok.

---------------------------------------------------------------------------------------------

Faz 7 — ORTAK (kanon güncellemesi)
Özetinize uygun olarak yeni teori yok; sadece mevcut governance’a Faz 7 disiplini eklendi.

1. docs/api/FAZ3_CONTRACT_GOVERNANCE.md
Başlık Faz 3–7; girişte Faz 7: freeze korunur, yeni kanıtlanmış runtime gerçeği yoksa kanona dokunulmaz.
## Faz 7 — Canlı doğrulama, freeze ve yalnızca gerçek fark eklendi:
Tablo: yeni bilgi yok → dokunma; ölçülebilir wire farkı → tek tur dörtlü; demo nüansı/UX → kanon dışı.
Engel: demo keşfi için gereksiz churn.
Bağımlılık: BACKEND, YAPAY ZEKA, FRONTEND (yansıtıcı güncelleme).
Başarı: kanon istikrarlı; pnpm contract:drift önerisi (Faz 6 ile aynı).
2. docs/api/INTEGRATION_CONTRACT.md §8
Faz 7 — freeze + canlı doğrulama paragrafı: gerçek fark yoksa güncelleme yok; demo nüansı tek başına yetmez.
3. Kök INTEGRATION_CONTRACT.md
Faz 7 tek cümle + governance Faz 7 bölümüne link.
4. packages/shared-types/README.md
Governance satırı Faz 3–7 ve Faz 7 canlı doğrulama kuralına güncellendi.
5. fazlar/v3/faz_7.md
Sona ORTAK contract freeze ve canlı doğrulama bloğu eklendi (tek referans: governance Faz 7).
6. infrastructure/RELEASE_CHECKLIST.md
Bölüm başlığı Faz 6–7; Faz 7 için kısa not (kanıtlanmış fark / churn yok).
Başarı ölçütü (sizin tanımınız): Faz 7 süresince kanon istikrarlı; yalnızca ölçülen gerçek runtime farkı tek PR’da dörtlüyle işlenir; aksi halde ORTAK tarafında gereksiz değişiklik yok.

---------------------------------------------------------------------------------------------

Oluşturulan kabul notu
docs/blockchain/MVP_BLOCKCHAIN_ACCEPTANCE.md — Faz 7 MVP için:

Amaç: Yeni feature değil; zincirin MVP için yeterli olduğunu teyit.
Minimum tablo: adaptör + indexer, stake olayları, UsageRecordedEvent + RPC — ADR-002 / ONCHAIN ile uyumlu.
Kabul: Mevcut Move + indexer/RPC bölüşümü MVP için yeterli; blockchain backlog MVP blocker sayılmaz; MVP doğrulamasında yeni Move kapsamı açılmaz.
Başarı ölçütü: Eksiklik önce entegrasyon / env / ürün dili; “zincir eksik” diye otomatik Move işi açılmaz.
Çapraz referanslar
ONCHAIN_READ_MODEL_AND_EVENTS.md — MVP kabulüne link.
blockchain_architecture.md — referans listesine eklendi.
ADR-002 — §13 ile MVP kabul belgesine bağlandı.
BACKEND/ORTAK için metin ve şema işleri ADR-002 §10’da olduğu gibi zincir engeli olarak işaretlenmedi.