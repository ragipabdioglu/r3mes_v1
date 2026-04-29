# R3MES — Güvenlik ve ilişkili yüzey: MVP öncesi derinlemesine analiz raporu

**Tür:** Statik kod, mimari ve dokümantasyon incelemesi (canlı pentest / prod log analizi **dahil değil**).  
**Kapsam:** `security/**`, `apps/backend-api` (auth, iç webhook, chat proxy, rate limit, CORS), `apps/dApp` cüzdan auth akışı, `apps/ai-engine` güven sınırı (backend ile ilişki), CI güvenlik sinyalleri.  
**Amaç:** MVP’nin **çalışmasını**, **güvenli şekilde çalışmasını** veya **operasyonel olarak sürdürülebilir olmasını** tehdit eden unsurları sınıflandırmak.

**Önem derecesi özeti:** **B** = MVP’yi doğrudan bloklayabilir veya yanlış dağıtımda kritik açık; **O** = MVP çalışır ama ürün/güvenlik borcu; **D** = dokümantasyon / süreç / ileri faz.

---

## 1. Değerlendirme kriterleri (etiket sözlüğü)

| Etiket | Anlamı |
|--------|--------|
| **EKSİK** | Tasarımda veya belgede beklenen koruma/ süreç yok |
| **YANLIŞ/KIRILGAN** | Çalışır görünür ama tehdit modelinde zayıf veya tutarsız |
| **YOK** | Hiç uygulanmamış (ör. otomatik sır taraması, WAF kodu) |
| **DOC-ONLY** | Raporda önerilmiş, kodda karşılığı yok veya kısmi |
| **TUTARSIZ** | Farklı belgeler veya env ile çelişen beklenti |
| **BAKIM** | Uzun vadede tablo/şişme / operasyonel borç |

---

## 2. Özet matris (öncelik × tür)

| ID | Başlık | Tür | Önem | MVP etkisi |
|----|--------|-----|------|------------|
| G1 | AI Engine doğrudan erişim (FastAPI, `/v1/chat/completions` auth yok) | EKSİK + mimari | **B** | Backend atlanırsa ücret/wallet koruması yok |
| G2 | CORS izin listesi yalnızca localhost; staging/prod origin yok | EKSİK | **B** | Gerçek domain’de tarayıcı istekleri kırılabilir |
| G3 | `R3MES_REQUIRE_WALLET_JTI` / dApp eşlemesi kapalı varsayılan | DOC-ONLY / TUTARSIZ | **O** | Replay riski “checklist ile kapatıldı” sanılırken fiilen açık kalır |
| G4 | Rate limit çoklu instance’da bellek içi; edge yoksa tutarsız | EKSİK (kabul riski A2) | **O** | Ölçekte abuse / DDoS yüzeyi |
| G5 | Pentest raporu: Nginx WAF, NeMo guardrails — uygulanmamış | DOC-ONLY | **D** | MVP fonksiyonel; güvenlik derinliği yok |
| G6 | `WalletAuthJti` / `QaWebhookReceipt` için otomatik temizlik job’u yok | BAKIM | **O** | Uzun süreli DB şişmesi |
| G7 | İç webhook IP kısıtı kodda değil; yalnızca runbook | EKSİK | **O** | Yanlış ağda HMAC sızdırılırsa risk |
| G8 | Chat ücreti: zincir TX sonra upstream; kısmi başarısızlık | YANLIŞ/KIRILGAN | **O** | Operatör maliyeti + kullanıcı deneyimi |
| G9 | Güvenlik belgeleri çoğul; tek “kanonik güvenlik SSoT” yok | TUTARSIZ | **D** | Ekip yanlış belgeye güvenir |
| G10 | CI’da sır sızıntısı taraması / `gitleaks` benzeri yok | YOK | **O** | Repo’ya anahtar kaçması riski süreçsel |
| G11 | Uçtan uca tarayıcı güvenlik testi release kapısında değil (`mvp-proof` açıkça söylüyor) | EKSİK | **O** | Regresyon gözden kaçabilir |
| G12 | Inference tarafında (Python) wallet doğrulaması yok — tasarım gereği backend’e güven | EKSİK (sınır) | **B** | Ağ segmentasyonu şart; belgelenmeli |

---

## 3. Bloklayıcı ve yüksek risk detayı

### G1 — Inference servisi güven sınırı

- **Durum:** `apps/ai-engine` `POST /v1/chat/completions` doğrudan kimlik doğrulaması yapmıyor; `uvicorn` varsayılanı `0.0.0.0` ile dinleme.
- **Risk:** Backend atlanarak veya yanlışlıkla internete açılırsa, **wallet auth, chat ücreti ve abuse sınırları tamamen devre dışı**.
- **MVP için anlam:** MVP, **AI Engine’in yalnızca güvenilir ağda (localhost / private VPC)** ve **yalnızca backend’den** erişilebilir olduğu varsayımına dayanır; bu **kodla enforce edilmiyor**, operasyonel zorunluluk.
- **Sınıflandırma:** EKSİK (network-level policy belge + uygulama ayrımı).

### G2 — CORS

- **Durum:** `app.ts` içinde izinli origin’ler sabit localhost listesi; ortam değişkeni ile genişletme yok.
- **Risk:** Staging veya demo gerçek domain üzerindeyken tarayıcı **CORS** veya credentials ile ilgili sessiz hatalar.
- **Sınıflandırma:** EKSİK (MVP “canlı demo” senaryosu için).

### G12 — Güven sınırı tekil mi?

- G1 ile birlikte: **Güvenlik kontrolü backend’de konsolide**; bu doğru bir desen ancak **dağıtım şeması hatalıysa** MVP güvenliği çöker.

---

## 4. Orta öncelik (MVP çalışır; borç / kabul edilmiş risk)

### G3 — jti ve replay

- **Durum:** `R3MES_REQUIRE_WALLET_JTI` kapalıyken replay koruması DB’de tüketilmez; açık önerilir.
- **TUTARSIZ:** Release checklist “önerilen kombinasyon” der; varsayılan ortamda kapalı kalırsa güvenlik iddiası zayıflar.

### G4 — Rate limit

- **Durum:** `@fastify/rate-limit` varsayılanı çoklu replikada paylaşımlı değil (Faz 6 A2).
- **MVP:** Tek instance ile demo yeterli; çoklu pod’da limit illüzyonu.

### G6 — Veritabanı bakımı

- `WalletAuthJti` ve idempotency tabloları için **otomatik TTL temizliği** kodda yok; runbook’da opsiyonel SQL.

### G7 — İç webhook

- HMAC güçlü; **kaynak IP** kısıtı uygulama katmanında yok — tamamen altyapı.

### G8 — Chat ücret sırası

- Zincir kaydı başarılı, AI yanıtı başarısız senaryosu; operasyonel ve ekonomik tutarsızlık (önceden belgelendi).

### G10 — CI güvenlik araçları

- `pnpm audit` moderate var; **sır taraması**, **SAST** yok — süreç boşluğu.

### G11 — E2E güvenlik gözlemi

- `mvp-proof.mjs` açıkça browser E2E’yi release kapısına bağlamıyor; Faz 7 sanity manuel kalıyor.

---

## 5. Düşük öncelik / dokümantasyon ve strateji

### G5 — Pentest önerileri

- NeMo, Nginx `limit_req`, WAF: **çoğu DOC-ONLY**; MVP “minimum çalışan ürün” için şart değil, **genişletme fazı**.

### G9 — Belge parçalanması

- `threat_model_qa.md`, `pentest_report.md`, `audit_wallet_chat_internal.md`, `release_checklist_faz6.md`, `mvp_security_sanity_faz7.md`, `runbook_abuse_faz5.md`, `design_replay_idempotency_faz3.md` — hepsi değerli fakat **tek indeks** (ör. `security/README.md`) yoksa yeni üye yanlış belgeyle başlar.

---

## 6. “Hiç yapılmamış / yanlış sanılan” maddeler (net)

| Madde | Açıklama |
|-------|----------|
| AI Engine’de wallet doğrulaması | **Kasıtlı olarak yok**; yanlışlıkla “eksik feature” değil, **sınır tasarımı** — risk G1/G12. |
| Otomatik WAF / guardrails | **Yok** (DOC-ONLY öneriler). |
| Dağıtımda zorunlu network policy-as-code | Repoda **görünmüyor** (Terraform vb. opsiyonel). |

---

## 7. Sonuç — MVP için pratik okuma

1. **MVP’yi teknik olarak en çok tehdit edenler:** (a) **AI Engine’in dış dünyaya açık kalması**, (b) **CORS’un gerçek origin ile uyumsuzluğu**, (c) **backend’i atlatan herhangi bir client yolu** — hepsi **dağıtım ve ağ katmanında** çözülmeden “güvenlik paketi tamam” denemez.

2. **Kod içi güçlü taraflar (özet):** Skip flag prod guard; QA webhook HMAC + idempotency; wallet imzası ve isteğe bağlı jti; rate limit kancası; güvenlik regresyon test komutu.

3. **“Senior” değerlendirme:** Proje, **güvenli varsayılanlar** ve **iyi dokümante edilmiş risk kabul tabloları** ile ilerliyor; MVP’nin **zayıf halkası operasyonel sınır** (ağ segmentasyonu, CORS, sırların canlıda sızması) — bunlar **checklist ile kapanmaz**, **ortam ve süreç** ister.

---

## 8. Önerilen takip (rapor dışı — yönetim kararı)

- Tek sayfalık **güvenlik SSoT indeksi** (`security/README.md` veya eşdeğeri).
- Staging/prod için **CORS ve network diyagramı** onayı.
- AI Engine erişiminin **yalnızca backend** ile sınırlandığına dair **altyapı onayı** (MVP go/no-go).

---

*Rapor tarihi: proje snapshot’ına göre derlenmiştir; canlı ortam doğrulaması ayrıdır.*
