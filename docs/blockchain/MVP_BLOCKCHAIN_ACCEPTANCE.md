# MVP zincir kabulü (Faz 7)

**Durum:** Kabul  
**Tarih:** 2026-04-08

---

## Amaç

Faz 7’de blockchain işi **yeni özellik eklemek değil**; MVP akışı için zincir tarafında **eksik kalmadığını** teyit edip kapatmaktır. MVP doğrulama aşamasında **yeni Move kapsamı açılmaz** ([ADR-002 §11–§12](../adr/ADR-002-stake-claim-source-of-truth.md)).

---

## MVP’den zincirde beklenen minimum davranış

| Beklenti | Karşılık |
|----------|-----------|
| Adaptör yükleme + durum (beklemede / onaylı / red) | `adapter_registry` + ilgili olaylar; indexer → Prisma |
| Eğitici stake, onay sonrası iade, redde slash | `staking_pool` + olaylar; indexer → `StakePosition` |
| Sohbet başına ücret akışı ve kullanıcıya göre özet | `reward_pool::record_usage` + `UsageRecordedEvent`; backend **RPC** (`aggregateRewardTotals`) |
| Kaynak gerçek ve terminoloji | [ADR-002](../adr/ADR-002-stake-claim-source-of-truth.md), [ONCHAIN_READ_MODEL_AND_EVENTS.md](./ONCHAIN_READ_MODEL_AND_EVENTS.md) |

Stake / read-model / RPC ayrımı bu belgeler ve paket README’leriyle tanımlıdır; MVP için **ek zincir modülü veya zorunlu indexer genişlemesi gerekmez**.

---

## Kabul kararı

**Mevcut `packages/sui-contracts` yüzeyi ve mevcut indexer + RPC bölüşümü MVP demo için yeterlidir.**

- **Blockchain backlog’u MVP’yi bloklayan iş olarak ele alınmaz** (yeni Move veya paket genişletmesi şart değil).
- Ürün kopyası, API yanıt gövdeleri ve isteğe bağlı Prisma alanları [ADR-002 §10](../adr/ADR-002-stake-claim-source-of-truth.md) kapsamında BACKEND / ORTAK işidir; zincir engeli sayılmaz.

---

## Başarı kriteri

MVP planında “zincir eksik” gerekçesiyle **yeni Move işi** açılmaz; eksiklik varsa önce entegrasyon, ortam değişkenleri ve [ADR-002 Bölüm 0](../adr/ADR-002-stake-claim-source-of-truth.md) ile uyumlu ürün dili gözden geçirilir.
