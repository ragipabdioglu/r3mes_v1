# `@r3mes/shared-types`

## Sahiplik

Ortak ajan: kanonik API / kuyruk / QA sözleşmeleri ve `packages/shared-types` ile `docs/api/INTEGRATION_CONTRACT.md` uyumu.

## Amaç

- **Tek doğruluk kaynağı (tipler):** `src/canonical.ts` (adapter kimliği, `AdapterStatusWire`, Move u8 eşlemesi için sabitler).
- **Kuyruk / webhook / yükleme yanıtları:** `src/index.ts` içindeki `BenchmarkJobPayload`, `QaResultWebhookPayload`, `LoRAUploadAcceptedResponse`.
- **Sui testnet sabitleri:** `src/r3mesTestnetMock.ts` (paket ve nesne ID’leri).

## Kanonik belge

- Matris ve drift: **[../../docs/api/INTEGRATION_CONTRACT.md](../../docs/api/INTEGRATION_CONTRACT.md)**
- Faz 3–7 yönetişim (dört artefakat senkronu, stake/claim, **Faz 6–7 freeze / drift**, Faz 7 canlı doğrulama kuralı): **[../../docs/api/FAZ3_CONTRACT_GOVERNANCE.md](../../docs/api/FAZ3_CONTRACT_GOVERNANCE.md)**
- OpenAPI parçası: **[../../docs/api/openapi.contract.yaml](../../docs/api/openapi.contract.yaml)**

## Doğrulama (Faz 3)

- **Zod:** `src/schemas.ts` — `parseAdapterListResponse`, `parseQaResultWebhookPayload`, vb.
- **Guard:** `src/contractGuards.ts` — `assertAdapterCidEqualsWeightsCid`, `assertBenchmarkScoreSemantic`
- **Test:** `pnpm run test` (vitest, `test/contractRegression.test.ts`)
- **Faz 6 — release drift (build + regression):** `pnpm run contract:drift` (monorepo kökünde `pnpm contract:drift`)

## Tüketim

`workspace:*` ile `apps/dApp`, `apps/backend-api`, `packages/qa-sandbox` vb.

```bash
pnpm exec tsc -p tsconfig.json
pnpm run test
```
