# Çalışma ortamı önkoşulları (R3MES)

Kısa liste; ayrıntı: `README.md` / `infrastructure/README.md`.

| Gereksinim | Minimum | Ne için |
|------------|---------|---------|
| **Node.js** | `>=20.10` (engines) | pnpm, turbo, Next, backend |
| **pnpm** | `9.x` (packageManager) | monorepo |
| **Python** | `3.10+` | `ai-engine`, `qa-worker` testleri |
| **Docker** | İsteğe bağlı | `pnpm bootstrap` (Postgres + storage) |
| **Sui CLI** | İsteğe bağlı yerelde | `release:check:full`, `smoke:contracts` |

**Yerel ↔ CI:** `pnpm validate` çıktısındaki `pip` satırları; tam test öncesi:

`pip install -r apps/ai-engine/requirements.txt`  
`pip install -e "packages/qa-sandbox/worker[dev]"`

Linux CI’da Sui: `bash infrastructure/scripts/install-sui-ci.sh`.

**Tek komutla MVP / release öncesi kanıt:** `pnpm mvp` (=`release:check`) — manifest + TS smoke + MVP özeti + GO banner.
