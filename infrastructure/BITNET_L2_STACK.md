# BitNet L2 — tam stack, gerçek ürün koşusu

> **Legacy / R&D notu:** Bu belge tarihî BitNet lifecycle kanıt koşusunu açıklar. Güncel ürün runtime’ı Qwen2.5-3B’dir.

**L1 (mock webhook):** `.e2e-lora/run_e2e_bitnet_lifecycle_job.py` — callback **3003** mock; **Prisma/DB güncellenmez** → `verify:lifecycle-chain` ile yerel 3000 DB eşleşmez.  
**L2 (bu dosya):** Aynı anda **gerçek** backend + Postgres + Redis + gateway + BitNet llama + worker; callback **Fastify `POST /v1/internal/qa-result`** → verify + DB kanıtı tutarlı.

**İzolasyon:** [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md), [`BITNET_LIFECYCLE_RUN.md`](BITNET_LIFECYCLE_RUN.md), [`QWEN_ADAPTER_RUN.md`](QWEN_ADAPTER_RUN.md).

**Pin’li ikili / GGUF / smoke tek satırı:** [`BITNET_QVAC_PRODUCTION_MATRIX.md`](BITNET_QVAC_PRODUCTION_MATRIX.md).

---

## 1) L1 vs L2 (tek tablo)

| | **L1 (kanıt script / mock)** | **L2 (ürün koşusu)** |
|---|------------------------------|----------------------|
| Webhook | `http://127.0.0.1:3003/...` (betik içi mock) | **`http://127.0.0.1:3000/v1/internal/qa-result`** (veya deploy URL) |
| DB | Yazılmaz | **Aynı** `DATABASE_URL` ile backend’in Postgres’i |
| Verify | 3000 DB ile anlamsız / FAIL beklenir | `R3MES_VERIFY_BASE_URL` + **aynı** `DATABASE_URL` → anlamlı |
| IPFS | Betikte 9082 mock olabilir | **Gerçek gateway 9080** (veya `IPFS_API_URL` ile uyumlu) |

---

## 2) L2 tam stack — aynı anda ayakta olması gerekenler

| Bileşen | Kontrol | Not |
|---------|---------|-----|
| **Postgres** | `pg_isready` / Docker healthy | `apps/backend-api/.env` `DATABASE_URL` ile aynı instance |
| **Redis** | `PING` | Worker + BullMQ köprüsü (`r3mes-benchmark:jobs`) |
| **Gateway / IPFS** | `GET http://127.0.0.1:9080/health` | Worker IPFS indirmesi |
| **backend-api** | `GET http://127.0.0.1:3000/health` | Webhook **bu** süreç |
| **BitNet llama** | `GET http://127.0.0.1:8081/v1/models` (profil) | Qwen **8080** ile ayrı port [`BITNET_LIFECYCLE_RUN.md`](BITNET_LIFECYCLE_RUN.md) |
| **QA worker** | `python -m r3mes_qa_worker` | Aşağıdaki **gerçek** webhook URL şart |

**Worker (L2 zorunlu):**

```text
R3MES_BACKEND_QA_WEBHOOK_URL=http://127.0.0.1:3000/v1/internal/qa-result
```

(pydantic alanı: `backend_qa_webhook_url` — `R3MES_` önekli env ile.)

Ayrıca: `R3MES_QA_WEBHOOK_SECRET` backend ile **aynı** (HMAC 403 önleme).  
`R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8081` (BitNet llama).  
`R3MES_QA_WORKER_LOG_FILE=logs/profile-bitnet-l2/worker.log`

---

## 3) Log ve kanıt klasörü (L2)

**Kök:** `logs/profile-bitnet-l2/` (commit etmeyin; `.gitignore` uygun tutun).

Önerilen dosyalar:

- `worker.log` — `R3MES_QA_WORKER_LOG_FILE`
- `llama-8081-stdout.log` / `stderr.log`
- `backend-relevant.log` — turbo/pnpm yönlendirmesi (isteğe bağlı)
- `verify-lifecycle-chain.txt` — `pnpm verify:lifecycle-chain` tam stdout
- `health-precheck.txt` — `faz7-debug-session.ps1` çıktısı

---

## 4) Verify (L2)

Upload yanıtından `adapterId`, `benchmarkJobId` sabitlendikten sonra — **backend sürecinin kullandığı** ortamda:

```bash
cd apps/backend-api
set R3MES_VERIFY_BASE_URL=http://127.0.0.1:3000
set DATABASE_URL=<aynı Postgres connection string>
pnpm verify:lifecycle-chain -- --adapter-id <id> --job-id <benchmarkJobId>
```

`DATABASE_URL`, `apps/backend-api/.env` ile **aynı** olmalı (aksi halde receipt tabloda, verify başka DB’de arar).

---

## 5) Qwen hattını koruma

- Llama **8080** Qwen; BitNet **8081** — aynı anda iki süreç mümkün (RAM yeterliyse).
- Worker BitNet seansında **8081** + **3000 webhook**; Qwen günlük çalışmada **8080** + aynı 3000 webhook — **çakışma:** aynı worker sürecini iki profile **aynı anda** bağlamayın; ayrı terminal veya koşu sırası.
- Kalıcı `apps/*/.env` üzerine BitNet yazmayın; seanslık env veya `worker/.env.bitnet-l2` (gitignore).

---

## 6) Hızlı ön kontrol

```powershell
pwsh -File infrastructure/scripts/faz7-debug-session.ps1
```

8081 ve worker süreçleri script’te yoksa elle ekleyin; BitNet llama için `GET /v1/models` kontrolü şart.

Bu düzen **L2’yi altyapı şüphesi olmadan** tekrarlanabilir kılar: mock webhook yok, DB tek kaynak, verify ile çapraz doğrulama mümkün.
