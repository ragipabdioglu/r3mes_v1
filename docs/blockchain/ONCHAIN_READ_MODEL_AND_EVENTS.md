# Zincir olayları, kimlikler ve read model eşlemesi

Bu belge `packages/sui-contracts` ile `packages/sui-indexer` ve backend’in **okuma** beklentileri arasındaki sözleşmeyi sabitler. Route mantığı burada tanımlanmaz; yalnızca semantik ve veri akışı.

Stake / “claim” ürün kararları ve kaynak gerçek çerçevesi için bkz. [ADR-002-stake-claim-source-of-truth.md](../adr/ADR-002-stake-claim-source-of-truth.md) (**Kabul**). MVP için zincir yeterliliği: [MVP_BLOCKCHAIN_ACCEPTANCE.md](./MVP_BLOCKCHAIN_ACCEPTANCE.md). Upload ↔ zincir kaydı (`register_adapter`) MVP kapsamı: [MVP_DB_SCOPE_UPLOAD_CHAIN.md](./MVP_DB_SCOPE_UPLOAD_CHAIN.md).

---

## 1. `onChainAdapterId`, nesne ID ve CID

| Kavram | Move tarafı | Prisma / API |
|--------|-------------|--------------|
| **Sıra numarası** | `Adapter.adapter_id: u64` — `AdapterRegistry.next_adapter_id` ile monoton artan protokol kimliği | `Adapter.onChainAdapterId` (`BigInt`), benzersiz iş anahtarı |
| **Paylaşımlı nesne** | `Adapter` struct’ının Sui `UID` / `object::id(&adapter)` | `Adapter.onChainObjectId` (hex string); olaylarda `object_id` |
| **Ağırlık dosyası** | `Adapter.ipfs_cid: String` (UTF-8 IPFS CID) | `Adapter.weightsCid` |

**İlişki:** `adapter_id` ile `object_id` bire bir eşlenir (her yükleme yeni bir paylaşımlı `Adapter` nesnesi). CID, aynı `AdapterUploadedEvent` içinde hem zincirde hem DB’de `weightsCid` olarak tutulur; sonraki onay/red olaylarında Move yalnızca `adapter_id` + `object_id` taşır — CID değişmez.

---

## 2. Olay → indexer → Prisma

`SuiIndexer` yalnızca **`adapter_registry`** ve **`staking_pool`** modüllerini dinler (`indexer.ts`). `handleSuiEvent`, olay adının son segmentine (`::` sonrası) göre dallanır.

| Move olayı | Alanlar (özet) | Prisma yazımı |
|------------|----------------|---------------|
| `AdapterUploadedEvent` | `adapter_id`, `object_id`, `creator`, `ipfs_cid` | `User` upsert; `Adapter` upsert (`onChainAdapterId`, `onChainObjectId`, `weightsCid`, `PENDING_REVIEW`); benchmark kuyruğu (`enqueueBenchmarkJob`) |
| `AdapterApprovedEvent` | `adapter_id`, `object_id` | `Adapter.status = ACTIVE` (`onChainAdapterId` ile) |
| `AdapterRejectedEvent` | `adapter_id`, `object_id`, `reason_code` | `Adapter.status = REJECTED`; **`reason_code` şu an DB’de yok** (kayıp alan) |
| `StakeDepositedEvent` | `adapter_id`, `trainer`, `amount`, `pool_object_id` | `StakePosition` upsert |
| `StakeWithdrawnEvent` | `adapter_id`, `trainer`, `amount` | `StakePosition` silme (`onChainAdapterId`) |
| `StakeSlashedEvent` | `adapter_id`, `trainer`, `amount`, `reason_code` | `StakePosition` silme; **`reason_code` indexer’da saklanmıyor** |

---

## 3. Ödül / kullanım olayları (indexer dışı)

| Move olayı | Modül | Backend read model |
|------------|--------|-------------------|
| `UsageRecordedEvent` | `reward_pool` | Prisma’ya yazılmaz. `aggregateRewardTotals` (`apps/backend-api/src/lib/suiRewards.ts`) doğrudan **`queryEvents`** ile `MoveEventType` filtreler; `user`, `amount_mist`, `pool_id` alanlarını okur. |

**Sonuç:** Kullanım başına SUI ücret özeti için **kaynak**, Sui RPC olay akışıdır; indexer checkpoint tablosu bu modülü kapsamaz.

---

## 4. Stake ve “claim” — zincirde desteklenen akışlar

Zincirde tanımlı akışlar:

1. **Stake:** `deposit_stake` — yalnızca `Adapter` **Pending** iken; minimum `MIN_STAKE` (1000 birim).
2. **İade (onay sonrası):** `withdraw_stake_after_approval` — yalnızca **Active** adaptör; tam stake iadesi, `StakeWithdrawnEvent`.
3. **Slash:** `slash_stake_on_rejected` — **Rejected** + admin cap; yakım, `StakeSlashedEvent`.

**Ödül havuzu (SUI):** `record_usage` (OperatorCap + 1 MIST) ve `withdraw_rewards` (OperatorCap, havuzdan SUI çekimi). Kullanıcı cüzdanına otomatik “claim” yok; operatör yetkisi gerekir.

Backend’de `POST /v1/user/:wallet/rewards/claim` gibi uçlar **zincir üstü talep akışını** tek başına temsil etmez; ürün tarafında açıkça netleştirilmelidir (stub / off-chain süreç).

---

## 5. Bilinen read model farkları

- **`AdapterRejectedEvent.reason_code` / `StakeSlashedEvent.reason_code`:** Move’da var; Prisma şemasında karşılık yok.
- **`UsageRecordedEvent`:** RPC ile okunur; indexer ve `StakePosition` / `Adapter` tablolarına yansımaz.
- **Stake olaylarında `pool_object_id`:** Yalnızca `StakeDepositedEvent` içinde taşınır; çekim/slash olaylarında yok (pozisyon silindiği için yeterli).

Bu farklar bilinçli veya ileride şema genişletmesi ile kapatılabilir; davranış değişikliği yapmadan önce tüketicileri (dApp, raporlama) güncellemek gerekir.
