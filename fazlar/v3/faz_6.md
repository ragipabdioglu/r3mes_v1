İşte Faz 6 için yapılanlar — yeni workflow yok, kök script sayısı aynı; sadece tek küçük banner + tek checklist dosyası.

Tek cümlelik cevap (ekipte aynı dil)
infrastructure/RELEASE_CHECKLIST.md dosyasının en üstünde sabitlendi:

PR’da ci.yml yeşil ve (merge/tag öncesi) pnpm release:check yeşil ise normal çıkış yapılabilir; sui-contracts / Move bu sürümde değiştiyse ayrıca pnpm release:check:full de yeşil olmalıdır.

GO / NO-GO özeti
release:check ve release:check:full zinciri başarıyla bitince son satırlarda RELEASE GATE: GO banner’ı basılır (infrastructure/scripts/release-gate-banner.mjs — sadece çıktı, test çalıştırmaz).
pnpm validate başarılı olunca: Sinyal (manifest): GO + PR ile aynı adımın ci.yml → Golden path olduğu yazılır.
GitHub Job summary (golden-path): “Release sinyali (bu job)” bölümü — manifest GO/NO-GO, merge öncesi release:check hatırlatması, RELEASE_CHECKLIST.md linki.
Checklist dokümanı
İçerik
Go/No-Go tablosu
PR CI / yerel release:check / release:check:full / smoke.yml rol tablosu
release:check çıktısını okuma (validate → smoke:ts → banner)
Yerel ↔ CI (pip komutları; validate ile hizalı)
E2E — şu an kapı dışı; eklenince bu dosya güncellenene kadar çıkış kuralı tek cümleye dayanır
infrastructure/README.md
En üstte RELEASE_CHECKLIST.md linki.
Teslimat kapısı başarı ölçütü, GO banner ile güncellendi.
Manifest
test-surface.json → _meta.releaseGate.checklist alanı RELEASE_CHECKLIST.md’e işaret ediyor.
Yeni CI adımı veya ek workflow eklenmedi; süre şişmedi.

---------------------------------------------------------------------------------------------

Faz 6 için yapılanlarin özeti: workaround yok, metinler backend/ORTAK ile çelişmeyecek şekilde netleştirildi; imza ve cüzdan kenar durumları tek davranış modeline alındı.

Ürün dili (product-copy.ts)
auth — walletRequired, signCancelled, signFailed (tüm yüzeylerde aynı ton).
Stake pageIntro — “çoğu” kaldırıldı; okuma + deneme sayfası / zincirde kesin işlem ayrımı net.
marketplace.emptyLine — “Henüz…” yerine kısa: “Listede model yok.”
walletBalance — pazaryeri yan kartı için bağlantı ve hata cümleleri merkezde.
İmza / oturum (wallet-auth-user-message.ts + hook)
useR3mesWalletAuth artık auth.walletRequired ile aynı metni fırlatıyor.
userFacingWalletAuthError — cüzdan / iptal / diğer imza hataları için tek çıktı.
isLikelyWalletAuthFailure — akış içi imza benzeri hatalarda sohbette tutarlı mesaj.
Akışlar
Stake / claim / yükleme — Önce ensureAuthHeaders; hata → uyarı tonu + userFacingWalletAuthError. Sonra API; ağ hatası → mevcut mutasyon mesajı.
Sohbet — İmza hatasında: mesaj ve giriş geri alınır, kullanıcı tekrar deneyebilir. Akış hatası davranışı önceki gibi; imza paterni eşleşirse aynı kullanıcı mesajı.
Ödül paneli — Boş özet ve aria-label cümleleri sadeleştirildi (“çoğu kurulumda” kalktı).
HTTP (http-messages.ts)
Ödül GET ve genel “generic” 501 son ekleri daha kesin ifadelerle güncellendi (gereksiz “olabilir” azaltıldı).
Bakiye kartı (r3mes-balance.tsx)
Yükleme: loadingLabel okunaklı boyutta; metinler walletBalance üzerinden.
Dokümantasyon
apps/dApp/docs/ux-journey-checklist.md — Pazaryeri → Chat → Stake → Studio için manuel doğrulama maddeleri (501, ağ, imza iptal, boş liste).
pnpm exec tsc --noEmit ve next build başarılı.

---------------------------------------------------------------------------------------------

Faz 6 — Release öncesi denetim (yeni iş kuralı yok)
Runtime’da davranış değişikliği yok; vitest 40/40 geçti.

1. docs/api/openapi.contract.yaml (0.2.0)
GET + POST aynı /v1/adapters altında birleştirildi (YAML’de ikinci paths: /v1/adapters GET’i ezmiyordu; düzeltildi).
Eklenen path’ler: /health, /ready, /v1/version, /v1/adapters/{id}, /v1/chat/completions.
Bileşenler: ApiErrorBody, LoRAUploadAcceptedResponse.
Liste / LoRA / chat / stake / claim / QA webhook için gerçek HTTP + hata kodları dokümante edildi (QA: 400, 403, 404, 409, 500, 503).
2. docs/api/INTEGRATION_CONTRACT.md
Girişte OpenAPI alt kümesi referansı ve öncelik sırası: çelişkide önce bu belge, sonra YAML.
3. apps/backend-api/README.md
Dörtlü hizalama tablosu (ORTAK + runtime + OpenAPI + testler).
Faz 6: dörtlü zincir, ApiErrorBody vs 501 gövdesi, hata kodu envanteri tablosu, üretim / geliştirme / CI ortam özeti.
Üst bölümdeki “üçlü” ifadesi dörtlü olacak şekilde güncellendi.
4. apps/backend-api/.env.example
İlk satırda README’deki Faz 6 ortam matrisine işaret.
Başarı ölçütü: Kanon (INTEGRATION_CONTRACT) → Zod → OpenAPI → testler aynı hikâyeyi anlatıyor; backend’de ekstra “yarım feature” eklenmedi.

---------------------------------------------------------------------------------------------

Teslim: security/release_checklist_faz6.md
İçerik:

Release checklist — üretim için zorunlu maddeler (skip, rate limit, migrate, sırlar, iç webhook ağı).
Zorunlu kombinasyon tablosu — R3MES_REQUIRE_WALLET_JTI ↔ NEXT_PUBLIC_R3MES_REQUIRE_WALLET_JTI eşlemesi; uyumsuzluğun sonucu açıkça yazıldı.
Kapatılan riskler — Faz 3–5’e kısa referans tablosu.
Kabul edilen riskler (A1–A6) — ID, etki, azaltma/izleme, tipik sahip (Ürün / BACKEND / Altyapı); teorik sıfır risk hedefi yok.
Uç auth snapshot tablosu — mevcut backend rotaları için son kontrol sorusu ile.
Abuse sırası (3 adım) — ölç → uygulama ayarları → edge.
Güncellenen referanslar
Dosya	Değişiklik
security/runbook_abuse_faz5.md
§3 kısaltıldı; Faz 6 checklist’e yönlendirme
apps/backend-api/README.md
Faz 6 bölümüne + güvenlik notuna release_checklist_faz6.md linki
apps/backend-api/.env.example
Üst satırda checklist yolu
security/audit_wallet_chat_internal.md
§5’e release kapısı notu
Başarı kriteri: Release sırasında güvenlik tarafı tek belgede toplanıyor: kapatılan (referans) vs kabul edilen (A1–A6) ayrı; gri alan kalmaması için checklist ve uç tablosu birlikte kullanılıyor.


---------------------------------------------------------------------------------------------

Faz 6 için observability katmanı eklenmedi; smoke aracı ve runbook, ekip teşhisi için netleştirildi.

Smoke script (scripts/smoke_ai_engine.py)
Çıkış kodları: 0 tamam · 1 health hatası · 2 CID yok (chat yok) · 3 health tamam, chat başarısız (ai-engine/yan zincir ayrımı).
--health-only: Sadece GET /health (CID gerekmez; liveness tarzı).
--json: Son satırda JSON_SUMMARY: {...} — ok, triage, triage_hint, tek istekte diagnostic_headers, eşzamanlıda lock_wait_ms min/max, lock_serialization_observed.
next_check: Hata gövdesinde stage için kısa yönlendirme (gateway / lora-adapters / upstream / llama süreci).
--request-id / R3MES_SMOKE_REQUEST_ID: X-Request-ID ile log eşlemesi.
Eşzamanlı koşu: Her satırda stage; başarılı yükte lock farkı için bilgi satırı; JSON’da özet.
Hata düzeltmesi: json.JSONDecodeError (önceden yanlış json.JSONDecode kullanılıyordu).
Runbook (docs/RUNBOOK.md)
5 maddelik release checklist (smoke, --json, isteğe bağlı --concurrent 5).
Backend vs ai-engine gövdesi: detail (ai-engine triage) ile error/message (backend) tablosu — chatProxy ham iletim notu.
Smoke çıkış kodları ve --json kısaca açıklandı.
Test
tests/test_smoke_script_helpers.py: _detail_triage import ile birim testi (HTTP yok).
README
Smoke bayrakları ve çıkış kodlarına kısa referans.
pytest 20 passed, ruff temiz.

---------------------------------------------------------------------------------------------

Faz 6 — ORTAK koruyucu rol (kanon)
Yaptıklarımız:

1. docs/api/FAZ3_CONTRACT_GOVERNANCE.md
Başlık Faz 3–6 olacak şekilde güncellendi.
Faz 6 — ORTAK koruyucu rol, stabil contract ve freeze bölümü eklendi: yeni teori yok; gerçek değişiklik varsa tek tur dörtlü senkron; değişiklik yoksa stabil contract (ORTAK ek PR üretmez).
Engel: Son dakika tek artefakt “küçük düzenleme”.
Release öncesi drift: pnpm contract:drift.
Freeze checklist (3 madde) ve başarı ölçütü yazıldı.
2. docs/api/INTEGRATION_CONTRACT.md §8
Faz 6 — stabil contract paragrafı: dokunulmadıysa yüzey değişmemiş sayılır; gerçek farkta dörtlü senkron.
3. Komutlar
packages/shared-types/package.json: "contract:drift": "pnpm run build && pnpm run test".
Kök package.json: "contract:drift": "pnpm --filter @r3mes/shared-types run contract:drift".
pnpm contract:drift kökte başarıyla çalıştı (build + 11 regression testi).
4. Referanslar
Kök INTEGRATION_CONTRACT.md: Faz 6 + pnpm contract:drift.
packages/shared-types/README.md: Faz 6 drift satırı.
fazlar/v3/faz_6.md: Kısa ORTAK / freeze bloğu (tek kanon: governance).
infrastructure/RELEASE_CHECKLIST.md: ORTAK contract drift (Faz 6) — tag/release öncesi pnpm contract:drift zorunluluğu.
Başarı ölçütü (sizin tanımınız)
Hedef	Nasıl korunuyor
Release adayı süresince contract yüzeyi sabit
Freeze bölümü + “ORTAK dosyalarında gereksiz churn yok” + checklist
Drift taraması
pnpm contract:drift (tipler + Zod + regression)
“Küçük düzenleme” ile contract oynamaması
Engelde açık; tek artefakt PR’ı governance’de reddedilmiş sayılır
BACKEND / FRONTEND / ALTYAPI davranışı değiştiğinde ORTAK yine yalnızca gerçeği dörtlüyle işler; Faz 6’da ek teori üretilmez.

---------------------------------------------------------------------------------------------

Faz 6 — İlk gerçek GGUF lifecycle kanıtı (tek kaynak)

- **Belge:** [docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md](../../docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md)
- **Kanon:** [INTEGRATION_CONTRACT §3.3.1](../../docs/api/INTEGRATION_CONTRACT.md) — kanıt SUCCESS ve kanon uyumluysa ek JSON contract gerekmez; yeni ölçülen wire farkı varsa önce bu dosyada kayıt, sonra ORTAK dörtlü.


