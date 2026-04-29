# Faz 5 — Rate limit, abuse ve wallet `jti` (operasyon runbook)

Kısa referans: **kod** + **ortam** değişkenleri. Ağır WAF / bot yönetimi bu belgenin dışında kalır (edge/Nginx).

---

## 1. `@fastify/rate-limit` (global)


| Env                        | Anlam                                              | Üretim önerisi                                                                             |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `R3MES_DISABLE_RATE_LIMIT` | `1` ise limit kapalı                               | **Açık tutmayın** (yalnızca yerel/debug).                                                  |
| `R3MES_RATE_LIMIT_MAX`     | Pencere başına istek üst sınırı (varsayılan `100`) | Trafik profiline göre 60–300 arası; API anahtarı tier’ları ayrı rota ile genişletilebilir. |
| `R3MES_RATE_LIMIT_WINDOW`  | Pencere (örn. `1 minute`, `15 seconds`)            | `1 minute` makul başlangıç.                                                                |


**Not:** Limit tüm uçlara uygulanır; `/health` dahil. Sağlık kontrolü için ayrı rota veya edge’de health için muafiyet düşünün.

---

## 2. Wallet auth `jti` (replay)


| Env                        | Anlam                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `R3MES_REQUIRE_WALLET_JTI` | `1` ise imzalı JSON’da **`jti` zorunlu** ve sunucu tek kullanımlık kayıt yazar (`WalletAuthJti`).            |
| (yok veya `0`)             | `jti` tüketilmez; imza önbelleği / mevcut istemci akışı korunur.                                           |

**dApp eşlemesi:** `NEXT_PUBLIC_R3MES_REQUIRE_WALLET_JTI=1` — mesaja `jti` (UUID) eklenir; bu modda **önbellek atlanır** (`useR3mesWalletAuth`). Backend ile aynı anda açılmalıdır.

**Üretim:** Backend + istemci bayrakları birlikte `1` önerilir.

**Hata kodları:** `JTI_REQUIRED`, `INVALID_JTI`, `JTI_REPLAY`.

**Bakım:** `WalletAuthJti.expiresAt` üzerinde zamanla eski satırlar birikir; periyodik `DELETE WHERE "expiresAt" < now() - interval '7 days'` (opsiyonel job).

---

## 3. Abuse tepki sırası (özet)

1. **Ölç** — log / hız / anormal hacim.
2. **Uygulama** — rate limit açık; skip kapalı; prod’da wallet `jti` çifti (backend + dApp) açık.
3. **Edge** — Gerekirse Nginx / WAF; ayrıntı: `security/audit/pentest_report.md`.

Release checklist ve kabul edilen riskler: **`security/release_checklist_faz6.md`**.

---

## 4. Yeni uçlar için kontrol listesi

- Mutasyon / ödeme / zincir köprüsü: `walletAuthPreHandler` veya HMAC / iç secret.
- Salt okunur public liste: kasıtlı mı, hassas alan sızdırıyor mu?
- Rate limit bu uç için yeterli mi (anonim ise daha sıkı)?

---

*Faz 5 — BACKEND / ALTYAPI hizası. Faz 6 release kapısı: `release_checklist_faz6.md`.*