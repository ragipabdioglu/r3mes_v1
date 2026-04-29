# Faz 7 — MVP güvenlik sanity (release sonrası teyit)

**Amaç:** Checklist’e güvenip **canlı akış gözlemini atlamamak**; gerçek MVP user journey’de auth ve abuse davranışının **tekrar teyidi**; “bilinmeyen bilinmez” bırakmamak.

**Önkoşul:** `security/release_checklist_faz6.md` tamamlandı.

---

## 1. MVP kullanıcı yolculuğu — güvenlik sanity (elle)

Aşağıdaki adımlar **staging veya kısıtlı üretim** üzerinde, gerçek cüzdan ile yapılır; sonuçlar kısa not olarak işlenir.


| #   | Adım                                            | Beklenen güvenlik davranışı                                                                                                                            | UX gözlemi (not)                                                                  |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | dApp’e gir, cüzdan bağla                        | —                                                                                                                                                      | —                                                                                 |
| 2   | İlk korumalı işlem (ör. chat veya LoRA yükleme) | Cüzdan imza istemi; `X-Message` JSON geçerli                                                                                                           | İmza sayısı kabul edilebilir mi?                                                  |
| 3   | Aynı oturumda ikinci korumalı işlem             | `**R3MES_REQUIRE_WALLET_JTI=1` + dApp eşlemesi açıksa:** her seferinde yeni imza (önbellek kapalı) — **bilinçli**; kapalıysa önbellek ile daha az imza | Kullanıcı yoruluyor mu? Gerekirse ürün kararı (TTL, sadece kritik işlemlerde jti) |
| 4   | İmzasız veya süresi dolmuş mesajla API          | **401** / `AUTH_EXPIRED` veya `INVALID_SIGNATURE`                                                                                                      | —                                                                                 |
| 5   | Aynı `jti` ile ikinci istek (zorunlu modda)     | **401** `JTI_REPLAY`                                                                                                                                   | Tek seferlik akış net mi?                                                         |


**Başarı kriteri:** Tablo dolduruldu; auth tekrarı (imza sayısı) **ürün tarafından gözlemlendi** ve gerekirse backlog’a yazıldı (güvenlik hatası değil, UX kararı olabilir).

---

## 2. Kabul edilen riskler — sahiplik ve izleme (Faz 6 §3 genişletmesi)


| ID  | Sahip (rol) | İzleme sinyali                                                        | Gözden geçirme               |
| --- | ----------- | --------------------------------------------------------------------- | ---------------------------- |
| A1  | Ürün        | Hukum / gizlilik talepleri; isteğe bağlı metrik: public GET hit oranı | Çeyrek veya major öncesi     |
| A2  | Altyapı     | 429 oranı instance başına; LB dağılımı                                | Deploy sonrası + ölçeklemede |
| A3  | BACKEND     | `ONCHAIN_QA_FAILED`, DB hata logları; QA webhook retry kuyruğu        | Haftalık veya olay bazlı     |
| A4  | Ürün        | Operatör SUI bakiye / chat maliyet dashboard                          | Sprint planı                 |
| A5  | Altyapı     | Health check başarısızlığı; synthetic probe                           | Sürekli                      |
| A6  | Altyapı     | Edge WAF logları; büyük trafik anomalisi                              | Çeyrek                       |


*Sahip:* somut kişi veya takım adı ürün içinde atanmalı; bu tablo **şablon**dur.

---

## 3. Canlı smoke / demo — sırlar ve yapılandırma (kırmızı çizgi)

Release veya demo öncesi **son bir kez** kontrol edilir:

- Repo ve dağıtım artefaktlarında `**R3MES_OPERATOR_PRIVATE_KEY`**, `**R3MES_QA_WEBHOOK_SECRET**`, `**DATABASE_URL` şifreleri** düz metin **yok** (`.env` commit edilmemiş; CI sırları secret store).
- Tarayıcıya sızan env: yalnızca `**NEXT_PUBLIC_*`** — ve bunlar **genel adres / ağ kimliği** seviyesinde; gerçek sırlar `NEXT_PUBLIC` altında **yok**.
- Demo URL’de **query’de** veya client bundle’da test anahtarı / webhook secret **yok** (DevTools Network ile spot check).
- Üretim/staging’de `**R3MES_SKIP_WALLET_AUTH`**, `**R3MES_SKIP_CHAT_FEE**` kapalı (veya demo için ayrı ortam etiketi net).
- İç webhook URL’i halka açık demoda **kapalı** veya HMAC olmadan erişilemez.

**Başarı kriteri:** Yukarıdaki maddeler işaretlendi; “son dakika .env yapıştırma” ile açık secret riski **bilinçli olarak sıfırlandı**.

---

## 4. Bilinmeyen bilinmez kalmasın (kapanış)

- Faz 6’daki **kabul edilen riskler** bu belgede **sahip + sinyal** ile güncellendi.
- MVP journey tablosu (§1) en az bir ortamda **dolduruldu**.
- Demo/smoke sırlar kontrolü (§3) **pass**.

---

## 5. İlişkili belgeler


| Belge                                | Rol                        |
| ------------------------------------ | -------------------------- |
| `security/release_checklist_faz6.md` | Release öncesi kapı        |
| `security/runbook_abuse_faz5.md`     | Env ve abuse kısa referans |
| `security/audit/pentest_report.md`   | Edge / WAF derinliği       |


---

*Faz 7 — checklist yerine geçmez; onu **canlı davranışla doğrular**.*