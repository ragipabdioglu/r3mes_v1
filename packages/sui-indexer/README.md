# `@r3mes/sui-indexer`

Sui `adapter_registry` ve `staking_pool` modüllerinden gelen Move olaylarını dinler (varsayılan: `queryEvents` ile periyodik polling; isteğe bağlı WebSocket `subscribeEvent`) ve PostgreSQL read modeline yazar.

`reward_pool` modülü **bilinçli olarak dinlenmez**; `UsageRecordedEvent` toplamları backend’de RPC ile ([ADR-002 §5–§11](../../docs/adr/ADR-002-stake-claim-source-of-truth.md)).

## Olaylar

| Olay | Kaynak modül | DB etkisi |
|------|----------------|-----------|
| `AdapterUploadedEvent` | `adapter_registry` | `User` + `Adapter`, ardından BullMQ `isolate-benchmark` işi |
| `AdapterApprovedEvent` | `adapter_registry` | `Adapter.status = ACTIVE` |
| `AdapterRejectedEvent` | `adapter_registry` | `Adapter.status = REJECTED` |
| `StakeDepositedEvent` | `staking_pool` | `StakePosition` upsert |
| `StakeWithdrawnEvent` | `staking_pool` | `StakePosition` sil |
| `StakeSlashedEvent` | `staking_pool` | `StakePosition` sil |

## Çalıştırma

Önkoşul: `DATABASE_URL`, migrasyon uygulanmış `apps/backend-api` şeması, `R3MES_PACKAGE_ID`.

```bash
pnpm --filter @r3mes/sui-indexer build
set DATABASE_URL=...
set R3MES_PACKAGE_ID=0x...
set SUI_RPC_URL=http://127.0.0.1:9000
pnpm --filter @r3mes/sui-indexer start
```

İkili: `pnpm exec r3mes-sui-indexer` (paket kökünden).

## Ortam

`.env.example` dosyasına bakın.

### Yerel geliştirme: `SKIP_BENCHMARK_QUEUE` (benchmark atlama)

| Değer | Davranış |
|-------|-----------|
| `0` veya tanımsız | `AdapterUploadedEvent` sonrası `enqueueBenchmarkJob` çağrılır (normal). |
| `1` | Yalnızca Prisma write; **benchmark kuyruğu atlanır** — hızlı zincir testi için. |

**Kurallar**

- Bayrağı **yalnızca** gitignore’lu dosyada tutun: `packages/sui-indexer/.env`, kök `.env`, veya araçların yüklediği `.env.local` — **commit edilmez** (bkz. kök `.gitignore`: `.env`, `.env.*`, istisna `!.env.example`).
- **`NODE_ENV=production` ile `SKIP_BENCHMARK_QUEUE=1` birlikte kullanılamaz** — `cli` başlangıcında süreç çıkar (backend’deki `R3MES_SKIP_*` üretim koruması ile aynı mantık).
- Staging/production dokümanlarında bu bayrak **varsayılan kapalı**; yalnızca yerel/E2E notlarında geçer ([`docs/LOCAL_DEV.md`](../../docs/LOCAL_DEV.md) port matrisi ayrı).
