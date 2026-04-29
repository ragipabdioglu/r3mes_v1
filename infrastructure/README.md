# Altyapı ve yerel geliştirme

**Aktif runtime envanteri:** [`ACTIVE_RUNTIME.md`](ACTIVE_RUNTIME.md). **Kısa özet (servis haritası + Qwen/RAG golden path):** [../docs/LOCAL_DEV.md](../docs/LOCAL_DEV.md).

**Çıkış / release kararı:** Tek sayfalık kural ve rol tablosu → [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md). **Demo / MVP doğrulama tek giriş:** `pnpm mvp` (= `pnpm release:check`: validate + smoke:ts + MVP kanıt özeti + GO banner). Önkoşullar → [`PREREQUISITES.md`](PREREQUISITES.md).

## Tek komut bootstrap (Docker + migrate)

Kök dizinden (PATH’te `docker` ve `pnpm` olmalı):

```bash
pnpm bootstrap
```

Bu komut sırasıyla:

1. `docker-compose.postgres.yml` ve `docker-compose.storage.yml` ile konteynerleri `up -d` eder.
2. Postgres, Redis, Qdrant, IPFS ve gateway için `healthy` bekler.
3. `pnpm db:migrate` çalıştırır.

Qdrant retrieval denemesi için mevcut Prisma knowledge verisini Qdrant'a basmak:

```bash
pnpm --filter @r3mes/backend-api build
pnpm --filter @r3mes/backend-api qdrant:reindex
```

Adaptive RAG kalite kapısı:

```bash
pnpm --filter @r3mes/backend-api run eval:adaptive-rag
```

**Windows:** Docker Desktop açık olmalı. `pnpm bootstrap` Docker daemon’a bağlanamıyorsa önce Docker Desktop’ı başlatın; sonra aynı komutu tekrar çalıştırın.

**Önemli:** `pnpm bootstrap` / Docker **yalnızca altyapı konteynerlerini** kaldırır. **Backend, dApp, ai-engine ve llama-server Docker içinde değildir**; bunlar ayrı süreçlerdir. Golden path Qwen2.5-3B + RAG için aşağıdaki tablo tek kaynak kabul edilir.

---

## Yerel golden path (tek düzen)

**Ne yapılır:** `pnpm bootstrap` → Docker’da **Postgres + Redis + IPFS + gateway**; sonra uygulamalar **ayrı süreçler** (Docker hepsini açmaz).

### Runtime matrisi (tek tablo)

| Ne | Port | Yerel adres |
|----|------|-------------|
| Postgres + pgvector | 5432 | `DATABASE_URL` ile |
| Redis | 6379 | backend / worker `redis://…` |
| Qdrant | 6333 | `R3MES_QDRANT_URL` ile |
| IPFS gateway (Nginx) | **9080** | `http://127.0.0.1:9080` (**8080 değil** — llama ile çakışmasın) |
| llama-server | **8080** | `http://127.0.0.1:8080` |
| ai-engine | **8000** | `http://127.0.0.1:8000` |
| backend-api | **3000** | `http://127.0.0.1:3000` |
| dApp | **3001** | `http://localhost:3001` |

**Üretim (güvenlik):** `ai-engine` (**8000**) yalnızca backend’in eriştiği private network (VPC / internal mesh) üzerinde dinlemeli; doğrudan internete veya genel yüzeye expose edilmemelidir.

Kubo API/P2P: **5001** / **4001** (Compose içi; genelde doğrudan uygulama portu değil).

### Yerel hardcode / varsayılan (dağılmadan oku)

Bunlar kod veya örnek `.env` içinde sabitlenmiş **yerel mutabakat**; prod adresi değildir.

| Ne nerede sabit / varsayılan |
|------------------------------|
| `apps/backend-api` dev script → **3000** (`package.json` / Fastify dinleme) |
| `apps/dApp` → **3001** (`next dev -p 3001`) |
| `apps/ai-engine` → **8000** (`uvicorn … --port 8000`) |
| QA worker → `R3MES_QA_LLAMA_BASE_URL` varsayılan **`http://127.0.0.1:8080`** |
| ai-engine ayarları → aktif ürün için **Qwen2.5-3B GGUF**; BitNet/QVAC örnekleri yalnız [`LEGACY_RND.md`](LEGACY_RND.md) içindeki R&D arşividir |
| `R3MES_SKIP_LLAMA` — yalnız contract/proxy testlerinde **1**; golden path chat için llama-server **8080** çalışmalı ve bu değer **0** veya unset olmalı |

**Env dosyaları:** `apps/backend-api/.env`, `apps/ai-engine/.env`, `apps/dApp/.env.local` — gerçek bağlantı dizeleri burada; portlar yukarıdaki tabloyla uyumlu olmalı.

### MVP golden path — tek başlatma dokümanı

**Wallet auth → knowledge upload → retrieval → source-backed chat (+ optional behavior LoRA)** için Docker + migrate + `pnpm dev` sırası, Compose `depends_on` / healthcheck ve env tablosu: [../docs/GOLDEN_PATH_STARTUP.md](../docs/GOLDEN_PATH_STARTUP.md).

### Legacy runtime (golden path’in parçası değil)

Üretim golden path artık Qwen2.5-3B GGUF üzerindedir. BitNet/QVAC denemeleri legacy/R&D alanında tutulur; ürün ana yoluna geri bağlanmaz.

### Windows (kısa)

- **GGUF / LoRA eğitim-export:** `-m` ve bazı eğitim araçlarında Unicode path (ör. `Masaüstü`, OneDrive) bozulabilir → modeli ve çalışma kökünü **ASCII** dizinde tutun; gerekirse **`SUBST`** veya **8.3 kısa yol** — [lora-trials/ARTIFACT_LAYOUT.md](lora-trials/ARTIFACT_LAYOUT.md) §2.5.
- **llama binary:** `infrastructure/llama-runtime/win-x64/` (DLL’lerle aynı dizinden çalıştırın).
- **8000:** `./start-all.sh` çıkışında `EXIT` trap ai-engine’i öldürebilir → kalıcı çalıştırma: `infrastructure/scripts/run-ai-engine-dev.ps1` veya ayrı terminal.
- Arka planda **pnpm:** `pnpm.cmd` tam yolu güvenilir.

### Sağlık (minimum)

| Port | Hızlı kontrol |
|------|----------------|
| 6333 | `GET /healthz` → `ok` |
| 9080 | `GET /health` → `healthy` |
| 8080 | `GET /v1/models` → 200 |
| 8000 | `GET /health` → `{"status":"ok"}` |
| 3000 | `GET /health` → `{"status":"ok"}` |
| 3001 | `GET /` veya `HEAD` → 200 |
| Redis / Postgres | `redis-cli PING` / `pg_isready` (container içinden) |

Özet script: `pwsh -File infrastructure/scripts/faz7-debug-session.ps1`

### Log (tekrarlanabilir)

| Süreç | Nerede |
|-------|--------|
| ai-engine | `.r3mes-ai-engine.log` (start-all ile) |
| QA worker | `R3MES_QA_WORKER_LOG_FILE` (ör. `logs/qa-worker.log`) |
| llama / turbo | stdout/stderr’i dosyaya yönlendirin; denemeden önce kopyalayın |

**İlk başarılı canlı lifecycle’ı aynı düzende tekrar etmek:** [`LIVE_RUN.md`](LIVE_RUN.md) (llama `--lora` slot düzeni, worker env, log şeması).

**Qwen tabanı + slotlu LoRA + artefakt doğrulama referansı:** [`QWEN_ADAPTER_RUN.md`](QWEN_ADAPTER_RUN.md).

**Runtime yönü ve legacy ayrımı:** [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md).

## Legacy / R&D arşivi

Aşağıdaki grup, yalnız tarihî BitNet/QVAC kanıtları veya ayrı R&D denemeleri için açılmalıdır. Tek indeks: [`LEGACY_RND.md`](LEGACY_RND.md).

---

## Uygulama süreçleri (dev)

```bash
# Git Bash veya WSL
./start-all.sh
```

veya `make start-all` (bash + make gerekir).

## Test stratejisi

Tek kaynak: `infrastructure/test-surface.json` (manifest). Değişiklik yapınca hem ilgili `package.json` hem bu dosyayı güncelleyin; CI `pnpm validate` ile drift yakalar.

| Paket | `pnpm test` davranışı |
|--------|------------------------|
| `@r3mes/backend-api`, `@r3mes/sui-indexer`, `@r3mes/shared-types` | Vitest (gerçek) |
| `@r3mes/sui-contracts` | `sui move test` (Sui CLI gerekir) |
| `@r3mes/qa-worker`, `@r3mes/ai-engine` | `pytest` |
| `@r3mes/dapp`, `@r3mes/qa-sandbox` | `test-skip.mjs` — bilinçli atlama |

### Golden path validation

```bash
pnpm validate
```

**Çıktı:** Önce tek satırlık durum (UYUMLU / DRIFT), gerçek test ve bilinçli skip sayıları, paket tablosu (`durum` sütunu: `ok` veya `DRIFT`). Drift varsa numaralı **Ne yapmalı?** listesi (dosya yolu + düzeltme adımı). CI’da aynı özet GitHub **Job summary** alanına markdown olarak yazılır (`GITHUB_STEP_SUMMARY`).

Manifest ile `package.json` uyuşmazsa çıkış kodu 1 — PR’da `Golden path` adımı kırmızı olur.

Otomasyon / denetçi araçları için:

```bash
pnpm validate -- --json
```

stdout’ta tek bir JSON nesnesi (`ok`, `issueCount`, `issues`, paket listesi).

Faz 2 smoke hattını (Move hariç) doğrulamak için:

```bash
pnpm validate -- --run-smoke
```

#### Drift gördüğünüzde (kısa)

| Sorun | Aksiyon |
|--------|---------|
| `MANIFEST_EKSIK` | Yeni paket: `test-surface.json` → `packages` içine kayıt ekleyin. |
| `YÜZEY_DRIFT` | Ya `scripts.test`’i stratejiye uydurun ya da manifest’teki `surface` / `runner` / `note`’u güncelleyin. |
| `MANIFEST_FAZLA` | Silinen paket için manifest anahtarını kaldırın. |

Yerel–CI paritesi: `validate` başarılı çıktıda aynı `pip` / Sui satırlarını hatırlatır; CI (`ci.yml`) bu adımları zaten koşar — yerelde tam `turbo test` öncesi bu komutları uygulayın.

## Smoke (tam zincir derleme + test alt kümesi)

```bash
pnpm smoke
```

`smoke:contracts` hem `sui move build` hem `sui move test` çalıştırır; `sui` CLI gerekir. Yalnızca TypeScript tarafını denemek için: `pnpm run smoke:ts`.

GitHub Actions: **Smoke** workflow (`smoke.yml`) tam zinciri Postgres + migrate + `pnpm smoke` ile doğrular (`main` push veya `workflow_dispatch`). **CI** (`ci.yml`) her PR’da lint/build/test + `pnpm validate` çalıştırır (Sui + Python dahil).

## Teslimat kapısı (Faz 5 — güvenilir sinyal)

**Amaç:** Release / merge kararı için `validate` ve `smoke` çıktısı tek başına yeterli bir “yeşil / kırmızı” sinyali versin; gereksiz script katmanı eklenmesin.

| Katman | Komut / iş akışı | Ne garanti eder |
|--------|------------------|-----------------|
| Zorunlu (PR) | `ci.yml` yeşil | Lint, build, `turbo test`, manifest drift (`pnpm validate`), audit. |
| Önerilen (yerel veya MR öncesi) | `pnpm release:check` | `validate` + `smoke:ts` — uygulama + kütüphane derlemesi, birim/integration test alt kümesi, Python testleri; **Move yok** (Sui gerektirmez). |
| Tam (sözleşme / on-chain değişiklik veya sürüm etiketi öncesi) | `pnpm release:check:full` veya `pnpm smoke` | Yukarıdakiler + **sui-contracts** build + `sui move test` (Sui CLI). |
| Opsiyonel CI | `smoke.yml` | Postgres + migrate + tam `pnpm smoke` — `main` merge sonrası veya elle. |

**Başarı kriteri:** `pnpm validate` **UYUMLU** ve `pnpm release:check` (veya tam senaryoda `release:check:full`) sonunda **RELEASE GATE: GO** banner’ı ve çıkış kodu 0 → tanımlı kapı için operasyonel onay. Drift veya kırmızı adım **NO-GO**. Tek cümlelik kural: [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) başlığı.

**Smoke kapsamını güncelleme:** Yeni feature yeni workspace paketi veya yeni build/test ihtiyacı getiriyorsa kök `package.json` içindeki `smoke:build` ve `smoke:test` `--filter` listelerini genişletin; `test-surface.json` ile tutarlı kalsın (`pnpm validate` drift yakalar).

**E2E:** Tarayıcı veya prod-benzeri uçtan uca testler henüz bu kapıda tanımlı değil; eklendiğinde bu bölüm ve gerekirse ayrı bir workflow güncellenir — PR süresini şişirmemek için CI’da ağır E2E’yi yalnızca gerekli dallarda / elle tetiklemeyi tercih edin.
