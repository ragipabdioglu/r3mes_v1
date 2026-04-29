# Yerel çalışma — özet (tek giriş)

**Amaç:** Yeni geliştirici Qwen2.5-3B + RAG-first stack içinde hangi servis ne yapıyor ve hangi port kullanılıyor sorularında dağılmasın.

**Aktif runtime envanteri:** [../infrastructure/ACTIVE_RUNTIME.md](../infrastructure/ACTIVE_RUNTIME.md).

**MVP golden path — tek başlatma yolu (Docker → migrate → dev, env tablosu):** [GOLDEN_PATH_STARTUP.md](GOLDEN_PATH_STARTUP.md).

**Detaylı adımlar, health matrisi, log yolları ve Windows notları:** [infrastructure/README.md](../infrastructure/README.md). **REST/API kanonu:** [api/INTEGRATION_CONTRACT.md](./api/INTEGRATION_CONTRACT.md). **Tek temiz test (upload/chat öncesi minimum süreç + port):** [SINGLE_TEST_RUNTIME.md](SINGLE_TEST_RUNTIME.md).

---

## Servis haritası

| Servis | Rol | Varsayılan port |
|--------|-----|-----------------|
| PostgreSQL + pgvector | Kalıcı veri ve vektör katmanı | 5432 |
| Redis | Kuyruk / önbellek | 6379 |
| Qdrant | Yeni nesil RAG vektör hafızası | 6333 |
| IPFS (HTTP gateway) | CID üzerinden artefakt | **9080** (host; **8080 değil** — llama ile çakışmasın) |
| **backend-api** (Fastify) | REST, chat proxy, upload | **3000** |
| **dApp** (Next.js) | Arayüz | **3001** |
| **ai-engine** (FastAPI) | Qwen GGUF inference proxy | **8000** |
| **llama-server** (llama.cpp) | Qwen2.5-3B GGUF çıkarım | **8080** |
| **qa-worker** (isteğe bağlı) | Benchmark job | Süreç portu yok; `R3MES_QA_LLAMA_BASE_URL` → genelde `http://127.0.0.1:8080` |
| **sui-indexer** (isteğe bağlı) | Zincir olayları → DB | Süreç portu yok; yerel testte isteğe bağlı paket-local `SKIP_BENCHMARK_QUEUE=1` — bu değer bilinçli olarak `R3MES_` prefix'i taşımaz, **yalnızca gitignore’lu `.env` / local E2E** içindir, üretimde yasaktır ([`packages/sui-indexer/README.md`](../packages/sui-indexer/README.md)). |

---

## Golden path (tek resmi düzen)

1. `pnpm bootstrap` — Docker (pgvector Postgres + Redis + Qdrant + IPFS) + health wait + `pnpm db:migrate`.
2. uygulamalar: backend **3000**, dApp **3001**, ai-engine **8000**, llama **8080**.
3. llama LoRA slotu kullanılıyorsa base/RAG denemeleri öncesi `pnpm --filter @r3mes/backend-api lora:scale -- 0 0`.
4. RAG kalite kapısı: `multi-domain-basic` ve `legal-basic` eval setleri; komutlar [GOLDEN_PATH_STARTUP.md](GOLDEN_PATH_STARTUP.md) içinde.
5. Qdrant retrieval denemesi için mevcut Prisma verisini taşımak gerekirse: `pnpm --filter @r3mes/backend-api build` sonra `pnpm --filter @r3mes/backend-api qdrant:reindex`.
6. Adaptive RAG regression kapısı: `pnpm --filter @r3mes/backend-api run eval:adaptive-rag`.

Tek komutlu yerel yönetim:

```powershell
pnpm local:start
pnpm local:status
pnpm local:stop
```

`local:start`, llama LoRA slotu açıldıktan sonra default scale’i `0` yapar; base/RAG denemeleri temiz başlar.

**Kural:** Yukarıdaki port seti **tek golden path**; farklı port gerekiyorsa ilgili `.env` / `NEXT_PUBLIC_*` güncellenir — repoda **ikinci bir “resmi” yerel matris** tanımlanmaz.

---

## Yerel sabitler (bilinçli hardcode)

| Konu | Not |
|------|-----|
| `start-all.sh` | Compose çıktısında **9080** gateway; ai-engine **8000** başlatır — `infrastructure/scripts/start-all.sh` ile `package.json` / Turbo `dev` portları **uyumlu** tutulmalı. |
| ai-engine | `R3MES_LLAMA_INTERNAL_PORT` (varsayılan **8080**), `R3MES_IPFS_GATEWAY` — bkz. `apps/ai-engine/.env.example`. |
| dApp | Backend URL — `apps/dApp/.env.local` (`NEXT_PUBLIC_*`). |

**Studio `net::ERR_CONNECTION_REFUSED` → :3000:** Tarayıcı backend’e TCP açamıyor = **Fastify süreci yok** veya `NEXT_PUBLIC_BACKEND_URL` yanlış host/port. Önce `curl http://127.0.0.1:3000/health` (200 beklenir). Sadece `pnpm dev` dApp klasöründe çalıştırıldıysa API başlamaz; kök `pnpm dev` veya `pnpm --filter @r3mes/backend-api dev` gerekir. Ayrıntı: [apps/dApp/README.md](../apps/dApp/README.md).

---

## Legacy runtime notu

- Golden path Qwen2.5-3B GGUF üzerindedir.
- BitNet/QVAC yalnız legacy / R&D izi olarak tutulur; ürün ana yolunu tanımlamaz.

---

## Windows

Docker Desktop, **ASCII path** ile GGUF, `llama-server` çalışma klasörü, Git Bash `EXIT` trap / ai-engine ömrü — tam liste: **[infrastructure/README.md](../infrastructure/README.md)** (“Windows özel notları” bölümü).
