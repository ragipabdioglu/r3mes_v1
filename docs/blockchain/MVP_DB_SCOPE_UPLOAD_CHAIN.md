# MVP kapsamı: Upload ve zincir `register_adapter`

**Durum:** Karar notu  
**İlişkili:** [ONCHAIN_READ_MODEL_AND_EVENTS.md](./ONCHAIN_READ_MODEL_AND_EVENTS.md), [ADR-002](../adr/ADR-002-stake-claim-source-of-truth.md)

---

## Karar

**`POST /v1/adapters` (multipart upload) akışında `adapter_registry::register_adapter` çağrılmaz** — bu MVP sürümünde **bilinçli olarak kapsam dışı** bırakılmıştır. Yükleme yalnızca IPFS + PostgreSQL `Adapter` kaydı oluşturur.

---

## Sonuçlar (DB “MVP” modeli)

| Alan | Upload sonrası |
|------|----------------|
| `onChainAdapterId` | **null** (indexer zincir olayı olmadan doldurmaz) |
| `onChainObjectId` | **null** |

**QA webhook (`/v1/internal/qa-result`)** içinde `canChain`:

```text
canChain = Boolean(onChainObjectId && onChainAdapterId !== null && pkg && operatorKeypair && adminCap)
```

Bu yükleme modelinde **çoğu zaman `canChain === false`** olur; QA sonucu **yalnızca veritabanında** `ACTIVE` / `REJECTED` olarak uygulanır, zincirde `approve_adapter` / `reject_adapter` **atlanır**.

**Chat çözümü** (`chatAdapterResolve`) yalnızca Prisma `Adapter.status === ACTIVE` gerektirir — zincir kimliği şart değildir.

---

## Sonraya bırakılan (bu notu iptal etmez)

- Üretimde “adaptör zincirde kayıtlı olsun” gereksinimi: ayrı iş kalemi (backend PTB veya istemci TX + indexer + `canChain` true senaryosu).
