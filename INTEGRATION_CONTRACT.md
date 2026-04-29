# Entegrasyon sözleşmesi (giriş)

Kanonik adapter kimliği, API matrisi, durum enum’ları ve IPFS alan anlamları için tek kaynak:

**[docs/api/INTEGRATION_CONTRACT.md](./docs/api/INTEGRATION_CONTRACT.md)** — eğitim/paketleme vs runtime (**§3.3.2**). **“Chat neden base modelle çalışmıyor?”** → **§3.5.1** (adapter-only, **feature-gap**, bug değil).

TypeScript tipleri:

**[packages/shared-types/src/canonical.ts](./packages/shared-types/src/canonical.ts)**

Faz 3 doğrulama (Zod, guard, test, OpenAPI parçası): `docs/api/INTEGRATION_CONTRACT.md` §8. Faz 4–5 bakım ve stake/claim (bilinçli 501): §3.6, §7. **Faz 6** (ORTAK koruyucu, stabil contract, release drift): §8 ve **[docs/api/FAZ3_CONTRACT_GOVERNANCE.md](./docs/api/FAZ3_CONTRACT_GOVERNANCE.md)** — release öncesi `pnpm contract:drift`. **Faz 7** (freeze, canlı doğrulama; yalnızca gerçek runtime farkında kanon güncellemesi): aynı governance **Faz 7** bölümü. **Faz 6** (ilk GGUF lifecycle kanıtı): [docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md](./docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md).