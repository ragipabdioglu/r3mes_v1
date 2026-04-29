# `@r3mes/sui-contracts`

## Sorumluluk

- **Blockchain ajanı:** R3MES coin (`r3mes_coin`), adaptor kayıt defteri (`adapter_registry`), stake / slash (`staking_pool`).

## Araç zinciri

- **Sui CLI** `sui move build` / `sui move test` (Move Analyzer ile uyumlu).
- `Move.toml` Sui framework’ü `testnet-v1.58.2` rev’ine sabitler; yerel `sui` sürümünüzle uyum için gerekirse rev güncellenir.

## Yerleşim

| Yol | İçerik |
|-----|--------|
| `sources/r3mes_coin.move` | `R3MES_COIN` FT, genesis mint, `TreasuryCap` → `Supply` (mint kilitli), `burn_from_circulation` |
| `sources/adapter_registry.move` | `Adapter` + `AdapterRegistry`, durumlar, olaylar |
| `sources/staking_pool.move` | `StakingPool`, stake, withdraw, `slash_stake_on_rejected` |
| `sources/reward_pool.move` | Paylaşımlı `RewardPool` (SUI), `record_usage` (1 MIST), `UsageRecordedEvent` |
| `tests/r3mes_tests.move` | Birim testler + `expected_failure` |

## Olaylar

- **Indexer ile Prisma’ya yazılanlar** (`@r3mes/sui-indexer`): `AdapterUploadedEvent`, `AdapterApprovedEvent`, `AdapterRejectedEvent`, `StakeDepositedEvent`, `StakeWithdrawnEvent`, `StakeSlashedEvent`.
- **Yalnızca zincirde; özet için genelde RPC `queryEvents`:** `UsageRecordedEvent` (`reward_pool`), `MintingSealedEvent` (`r3mes_coin`).

Kaynak gerçek ve “claim” terminolojisi: [ADR-002](../../docs/adr/ADR-002-stake-claim-source-of-truth.md) (§11 kapanış matrisi).

TypeScript / Sui SDK köprüsü bu pakette yoktur; Backend ajanı ayrı entegre eder.

## Testnet (Faz 8.6)

- **[TESTNET.md](./TESTNET.md)** — `sui client switch --env testnet`, faucet, `sui client publish --gas-budget 100000000`, yanıttan ID ayıklama.
- **[scripts/publish-testnet.example.sh](./scripts/publish-testnet.example.sh)** — komut özeti (simülasyon).
- **[.env.example](./.env.example)** — yayın sonrası kopyalanacak ID şablonları (mock değerler `packages/shared-types` ile uyumlu).
