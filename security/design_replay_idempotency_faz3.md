# Faz 3 — Replay & Idempotency (Minimum Uygulanabilir Tasarım)

**Amaç:** Faz 2’de kapatılan riskleri bozmadan, replay ve webhook tekrarı gibi **orta seviye** riskleri **ölçülü** azaltmak. Yeni ağır güvenlik katmanları değil; ürün akışını kilitlemeyen minimum sözleşme.

---

## 1. Wallet auth — `jti` (nonce) stratejisi

### Uygulama durumu (Faz 5)

- **PostgreSQL** tablosu `WalletAuthJti` (`jti` PK, `expiresAt`, `createdAt`); Redis gerekmez.
- **`R3MES_REQUIRE_WALLET_JTI=1`:** `jti` zorunlu; tek kullanımlık `create` — çakışma → **401** `JTI_REPLAY`. Bayrak kapalıyken **tüketim yok** (mevcut önbellek davranışı korunur).
- **dApp:** `NEXT_PUBLIC_R3MES_REQUIRE_WALLET_JTI=1` ile `jti` + önbellek atlaması.
- Kod: `lib/walletAuth.ts` (`parseOptionalJti`), `lib/walletAuthJti.ts`.
- Operasyon: `security/runbook_abuse_faz5.md`.

### Kapsam dışı

- IP başına ayrı nonce deposu; edge rate limit ile tamamlanır.

---

## 2. Webhook — `POST /v1/internal/qa-result` idempotency

### Uygulama durumu (Faz 4)

- **Uygulandı:** `QaWebhookReceipt` tablosu (`jobId` PK, `bodySha256`, `completedAt`).
- Ham gövde üzerinde **SHA-256**; `claimQaWebhookJob` → başarı sonrası `completeQaWebhookJob`.
- **200** `duplicate: true` — aynı `jobId` + aynı gövde hash + `completedAt` dolu.
- **409** `IDEMPOTENCY_CONFLICT` — aynı `jobId`, farklı gövde hash.
- **503** `QA_WEBHOOK_IN_FLIGHT` — kayıt var, `completedAt` boş (eşzamanlı teslim / yarım kalan iş).
- Hata yollarında `releaseQaWebhookClaim` ile yeniden deneme açılır. Kod: `lib/qaWebhookIdempotency.ts`, `routes/internalQa.ts`.

### Tasarım notları (özet)


| Bileşen     | Uygulama                             |
| ----------- | ------------------------------------ |
| Anahtar     | `jobId` + ham gövde **SHA-256**      |
| Depolama    | PostgreSQL / Prisma (Redis gerekmez) |
| İkinci POST | Yukarıdaki HTTP kodları              |


---

## 3. Rate limit / abuse (operasyonel)

- **Uygulama:** `@fastify/rate-limit` (mevcut), `R3MES_DISABLE_RATE_LIMIT` prod’da kapalı.
- **Edge:** Nginx `limit_req` / WAF kuralları — `security/audit/pentest_report.md` ile uyumlu.
- **Faz 3:** Davranışı **runbook**’ta netleştir (eşikler, alarm); kodda ek katman zorunlu değil.

---

## 4. CI ve regression

- **Tam suite:** `pnpm exec turbo run test` → `@r3mes/backend-api` içinde güvenlik dilimi dahil.
- **Odaklı yeniden koşum (yerel / manuel CI):** `pnpm run test:security-regression` — yalnızca:
  - `skipFlags.test.ts` (prod skip guard),
  - `walletAuth.test.ts` (timing/imza mesajı),
  - `integration.contract.test.ts` (auth yüzeyi sözleşmesi).

GitHub Actions: `.github/workflows/security-regression.yml` — `**workflow_dispatch`** ile hızlı doğrulama; PR başına **ek** yük oluşturmaz (ana `ci.yml` ile çift koşum yok).

---

## 5. Karar özeti


| Konu                | Faz 3 kararı                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| `jti` + Redis       | Tasarım onaylandı; uygulama **backlog** — Redis/bayrak hazır olduğunda. |
| Webhook idempotency | `jobId` ile minimum; Redis veya DB unique.                              |
| Yeni ağır katman    | **Hayır** — mevcut HMAC + skip guard + testler korunur.                 |


---

*Faz 3 — güvenlik / backend koordinasyonu.*