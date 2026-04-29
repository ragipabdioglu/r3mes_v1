# Golden path — Qwen + RAG MVP başlatma (tek doğru yol)

**Amaç:** Aşağıdaki akışın tekrarlanabilir şekilde çalışması için servis sırası, Docker bağımlılıkları ve ortam değişkenleri:

`wallet auth → knowledge upload → retrieve → source-backed chat (+ optional behavior LoRA)`

Bu dosya **yeni özellik tanımlamaz**; mevcut `pnpm bootstrap`, Compose dosyaları ve `turbo dev` düzenini tek kaynakta toplar.

**İlgili (detay / port matrisi / Windows):** [infrastructure/README.md](../infrastructure/README.md), [LOCAL_DEV.md](LOCAL_DEV.md), [SINGLE_TEST_RUNTIME.md](SINGLE_TEST_RUNTIME.md).

---

## 1. İki katman: Docker vs host

| Katman | Ne | Nasıl |
|--------|-----|--------|
| **Docker Compose** | PostgreSQL + pgvector, Redis, Kubo (IPFS), HTTP gateway (9080) | `pnpm bootstrap` içindeki `docker compose` komutları |
| **Host (turbo)** | backend-api **3000**, dApp **3001**, ai-engine **8000** | Kök `pnpm dev` |
| **Host (ayrı süreç)** | `llama-server` **8080** | `pnpm dev` **içermez**; ayrı terminal — [LIVE_RUN.md](../infrastructure/LIVE_RUN.md) |

---

## 2. Docker Compose: servisler, sıra, `depends_on` / healthcheck

**Dosyalar (sıra `bootstrap` ile aynı):**

1. `infrastructure/docker/docker-compose.postgres.yml` — yalnızca **postgres**
2. `infrastructure/docker/docker-compose.storage.yml` — **ipfs**, **redis**, **gateway**

İki Compose dosyası **birbirine `depends_on` ile bağlı değil**; ikisi de `up -d` ile ayakta olmalı. `pnpm bootstrap` önce postgres, sonra storage’ı kaldırır.

### 2.1 `r3mes-postgres`

| Alan | Değer |
|------|--------|
| Servis adı | `postgres` |
| Konteyner | `r3mes-postgres` |
| Port | **5432** → host |
| `depends_on` | Yok |
| `healthcheck` | `pg_isready -U postgres -d r3mes` (5s aralık, `start_period` 15s) |

### 2.2 `r3mes-storage` (storage ağı)

| Servis | Konteyner | Port (host) | `depends_on` | `healthcheck` |
|--------|-----------|-------------|--------------|----------------|
| **ipfs** | `r3mes-ipfs` | 4001, **5001** (Kubo API) | — | `ipfs id` (interval 10s, `start_period` 60s) |
| **redis** | `r3mes-redis-cache` | **6379** | — | `redis-cli ping` |
| **gateway** | `r3mes-storage-gateway` | **9080** → konteyner 8080 | **ipfs**: `service_healthy`, **redis**: `service_healthy` | `wget` ile `/health` içinde `healthy` |

**Başlatma sırası (mantıksal):** `ipfs` ve `redis` paralel; ikisi **healthy** olunca `gateway` başlar. Gateway, IPFS için HTTP ön yüzü sağlar (**9080**).

---

## 3. Host süreçleri (MVP zinciri için)

| Süreç | Port | Bağımlılık | Not |
|--------|------|------------|-----|
| **backend-api** | 3000 | Postgres, Redis, (upload için) Kubo API 5001 | `pnpm dev` |
| **dApp** | 3001 | Backend 3000 (`NEXT_PUBLIC_BACKEND_URL`) | `pnpm dev` |
| **ai-engine** | 8000 | llama **8080** (Qwen GGUF) | `pnpm dev` |
| **QA worker** | — | legacy behavior/QA akışları | isteğe bağlı |
| **llama-server** | 8080 | Qwen2.5-3B GGUF dosyaları (ASCII yol) | **Manuel**; [LIVE_RUN.md](../infrastructure/LIVE_RUN.md) |

### 3.1 Yerel Qwen + optional LoRA slot başlatma

Aktif MVP yolu Qwen2.5-3B base + RAG’dir. Behavior LoRA yalnız stil/persona içindir ve knowledge doğruluğu taşımaz.

Windows yerel örnek:

```powershell
C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\llama-runtime\win-vulkan-x64\llama-server.exe `
  -m C:\r3mes-model-cache\qwen2.5-3b-instruct-q5_k_m.gguf `
  --host 127.0.0.1 `
  --port 8080 `
  --ctx-size 2048 `
  -ngl 999 `
  --lora-init-without-apply `
  --lora C:\r3mes-lora\doctor-role-qwen3b-v3.gguf
```

Önemli: `llama-server` LoRA slotunu bazen `scale=1` ile açar. Base/RAG denemeleri kirlenmesin diye başlatma sonrası default scale’i kapatın:

```powershell
pnpm --filter @r3mes/backend-api lora:scale -- 0 0
```

Medical behavior LoRA testinde tekrar açmak için:

```powershell
pnpm --filter @r3mes/backend-api lora:scale -- 0 1
```

Backend chat resolver medical dışı domainlerde doctor LoRA’yı devre dışı bırakır; yine de manuel eval/base test öncesi scale `0` en temiz başlangıçtır.

---

## 4. Ortam değişkenleri (tek tablo)

Aşağıdaki değerler **yerel golden path** ile uyumlu örneklerdir; tam şablon: `apps/backend-api/.env.example`, `apps/ai-engine/.env.example`, `apps/dApp/.env.example`. Gerçek sırlar **yalnızca** gitignore’lu `.env` / `.env.local` içinde tutulur.

| Bileşen | Değişken | Örnek / varsayılan (yerel) | Kim kullanır |
|---------|----------|----------------------------|--------------|
| **Postgres** | `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:5432/r3mes` | backend-api (Prisma) |
| **Redis** | `REDIS_URL` | `redis://127.0.0.1:6379` | backend-api |
| **Redis (worker)** | `R3MES_REDIS_URL` | `redis://127.0.0.1:6379/0` (worker varsayılanı) | QA worker (`pydantic-settings`, `R3MES_` öneki) |
| **Kubo API** | `IPFS_API_URL` | `http://127.0.0.1:5001` (kod varsayılanı; `.env` boşsa aynı) | backend upload (`ipfsAdd`) |
| **Gateway URL** | `R3MES_IPFS_GATEWAY_URL` (backend) | `http://127.0.0.1:9080` | backend (isteğe bağlı; upload doğrudan API kullanabilir) |
| **ai-engine** | `R3MES_IPFS_GATEWAY` | `http://127.0.0.1:9080` | ai-engine |
| **ai-engine** | `R3MES_LLAMA_INTERNAL_PORT` | `8080` | ai-engine → llama |
| **ai-engine** | `R3MES_SKIP_LLAMA` | `1` (yalnız contract test) | ai-engine |
| **Backend → AI** | `R3MES_AI_ENGINE_URL` | `http://127.0.0.1:8000` | chat proxy |
| **dApp → API** | `NEXT_PUBLIC_BACKEND_URL` | `http://127.0.0.1:3000` veya `http://localhost:3000` | dApp |
| **QA webhook** | `R3MES_QA_WEBHOOK_SECRET` | paylaşılan gizli anahtar | backend + QA worker (HMAC aynı olmalı) |
| **Worker → backend** | `R3MES_BACKEND_QA_WEBHOOK_URL` | `http://127.0.0.1:3000/v1/internal/qa-result` | QA worker |
| **Worker → llama** | `R3MES_QA_LLAMA_BASE_URL` | `http://127.0.0.1:8080` | QA worker |
| **HTTP** | `PORT`, `HOST` | `3000`, `0.0.0.0` | backend |

**Chat ücreti (yerel MVP):** `R3MES_OPERATOR_PRIVATE_KEY` + paket/object id’ler veya `R3MES_SKIP_CHAT_FEE=1` (yalnızca `NODE_ENV !== production`) — aksi halde chat proxy **503**; bkz. `apps/backend-api/.env.example`.

**Yerel imza bypass (isteğe bağlı):** `R3MES_SKIP_WALLET_AUTH=1` + `R3MES_DEV_WALLET` — yalnızca dev/test.

---

## 5. `pnpm bootstrap` → migrate → `dev` (adım adım)

### Adım A — Önkoşul: Docker

- **Docker Desktop** çalışıyor olmalı (Windows’ta API pipe erişilebilir).
- **Eksikse:** `pnpm bootstrap` başarısız; Postgres/Redis/IPFS yok → upload, kuyruk, worker **kırılır**.

### Adım B — `pnpm bootstrap` (kök dizin)

Komut tanımı (`package.json`):

`node infrastructure/scripts/bootstrap-local.mjs`

Script şunları sırayla yapar:
- postgres compose `up -d`
- storage compose `up -d`
- `r3mes-postgres`, `r3mes-redis-cache`, `r3mes-ipfs`, `r3mes-storage-gateway` için `healthy` bekler
- `pnpm db:migrate` çalıştırır

| Alt adım | Ne yapar | Eksikse ne kırılır |
|----------|-----------|---------------------|
| Postgres `up -d` | DB dinler **5432** | Prisma / backend DB yok |
| Storage `up -d` | Redis **6379**, Kubo **5001**, gateway **9080** | `REDIS_URL` bağlanamaz; IPFS upload/indirme yok; gateway health yok |
| Health wait | Postgres + Redis + IPFS + gateway için `healthy` bekler | Yarış koşulu kalır; migrate/servis başlangıcı belirsiz olur |
| `pnpm db:migrate` | `prisma migrate deploy` | Şema yok → API hata |

### Adım C — `pnpm dev` (kök dizin)

`turbo run dev --parallel` → backend, dApp, ai-engine, QA worker (ve monorepo paketleri tanımına göre diğerleri).

| Bileşen | Redis’e ihtiyaç | Postgres’a ihtiyaç |
|---------|------------------|-------------------|
| backend-api | Evet (kuyruk) | Evet |
| QA worker | **Evet** (BLPOP) | Hayır (doğrudan) |
| dApp | Hayır | Hayır |
| ai-engine | Hayır | Hayır |

**Eksikse:** Redis kapalıysa worker süreçleri **Connection refused** ile düşebilir; turbo tüm `dev` görevini durdurabilir.

### Adım D — `llama-server` (8080)

- **Otomatik değil**; MVP QA ve chat çıkarımı için ayrı başlatılmalı.
- **Eksikse:** Worker benchmark ve chat zinciri **llama** beklediği için başarısız veya reddedilir; ai-engine `R3MES_SKIP_LLAMA=1` ise proxy sağlıklı kalır ama `llama-server` yok.

### Adım E — Migration sonrası kısa doğrulama

Knowledge pivot için minimum DB doğrulaması:

```bash
docker exec r3mes-postgres psql -U postgres -d r3mes -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
docker exec r3mes-postgres psql -U postgres -d r3mes -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Knowledge%';"
```

Beklenen:
- `vector`
- `KnowledgeCollection`, `KnowledgeDocument`, `KnowledgeChunk`, `KnowledgeEmbedding`

---

## 6. MVP akışı ve servis eşlemesi (kısa)

| Adım | Gerekli altyapı |
|------|-------------------|
| Wallet auth | Backend **3000** |
| Knowledge upload | Postgres/pgvector + **Kubo 5001** (`IPFS_API_URL`) |
| Chunk / embed | Backend + Postgres/pgvector |
| Publish / unpublish | Backend **3000** |
| Chat | Backend + **ai-engine 8000** + **llama 8080** + chat fee env veya skip |

---

## 7. Tek doğrulama listesi (minimum)

| Kontrol | Beklenti |
|---------|----------|
| `GET http://127.0.0.1:3000/health` | `{"status":"ok"}` |
| `GET http://127.0.0.1:9080/health` | `healthy` |
| `GET http://127.0.0.1:8000/health` | `{"status":"ok"}` |
| `GET http://127.0.0.1:8080/v1/models` | 200 (llama ayakta) |
| `GET http://127.0.0.1:8080/lora-adapters` | doctor slot görünür; base/RAG testinde `scale: 0` |
| Redis | `redis-cli -h 127.0.0.1 PING` → `PONG` |

---

## 8. RAG kalite smoke / eval

Demo knowledge seed:

```powershell
pnpm --filter @r3mes/backend-api seed:multi-domain-demo
pnpm --filter @r3mes/backend-api seed:legal-basic-demo
```

Beklenen hızlı kalite kapıları:

```powershell
pnpm --filter @r3mes/backend-api eval:grounded-response -- --file infrastructure/evals/multi-domain-basic/golden.jsonl --out artifacts/evals/multi-domain-basic/latest.json --retries 1
pnpm --filter @r3mes/backend-api eval:grounded-response -- --file infrastructure/evals/legal-basic/golden.jsonl --out artifacts/evals/legal-basic/latest.json --retries 1
pnpm --filter @r3mes/backend-api eval:grounded-response -- --file infrastructure/evals/domain-regression/golden.jsonl --out artifacts/evals/domain-regression/latest.json --retries 1
```

Son bilinen sağlıklı sonuç:

| Eval | Beklenti |
|------|----------|
| `multi-domain-basic` | 8/8 PASS |
| `legal-basic` | 5/5 PASS |
| `domain-regression` | 5/5 PASS; domain route, kullanılan kaynak ve yanlış seçimde backend kaynak önerisi kontrol edilir |

Yerel sistem tek komutları:

```powershell
pnpm local:start
pnpm local:status
pnpm local:stop
```

UI manuel smoke için `Multi Domain Demo` collection’ını seçip şu soruyu deneyin:

```text
Production veritabanında migration çalıştırmadan önce ne yapmalıyım? Kısa, maddeli ve riskleri abartmadan açıkla.
```

Beklenen: domain `technical`, grounding `high`, kaynak `multi-technical-db-migration`; cevapta `yedek`, `staging/test`, `rollback/geri dönüş`, `log` veya veri silen komut riskleri geçmeli.

---

## 9. Debug paneli

dApp debug paneli yalnız demo/geliştirme içindir:

```env
NEXT_PUBLIC_R3MES_CHAT_DEBUG=1
```

Normal kullanıcı deneyiminde bu değer kapalı bırakılır. Kapalıyken cevap ve kaynaklar görünür, ancak domain/grounding/evidence debug detayları gösterilmez.

---

## 10. Bu belge ile diğer dokümanlar

| Dosya | Rol |
|--------|-----|
| [infrastructure/README.md](../infrastructure/README.md) | Altyapı özeti, legacy runtime/Windows notları, sağlık tablosu |
| [LOCAL_DEV.md](LOCAL_DEV.md) | Servis haritası, Studio hata ayıklama, `start-all.sh` referansı |
| [SINGLE_TEST_RUNTIME.md](SINGLE_TEST_RUNTIME.md) | Tek temiz test için minimum süreç / port |

**Golden path “başlatma” için kanonik giriş:** bu dosya (**GOLDEN_PATH_STARTUP.md**).
