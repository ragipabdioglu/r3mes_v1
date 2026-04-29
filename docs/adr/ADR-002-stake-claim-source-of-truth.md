# ADR-002 — Stake / claim ve “on-chain source of truth”

**Durum:** Kabul (Faz 4 — zincir ve read-model kaynak gerçeği)  
**Karar tarihi:** 2026-04-08  
**İlişkili:** [ONCHAIN_READ_MODEL_AND_EVENTS.md](../blockchain/ONCHAIN_READ_MODEL_AND_EVENTS.md), [ADR-001-admin-cap-multisig.md](./ADR-001-admin-cap-multisig.md)

---

## 0. Resmi tanım — “Claim” nedir?

R3MES zincirinde **tek bir “claim” adlı Move entry fonksiyonu yoktur**; ürün ve mühendislik aynı cevabı şöyle verir: eğitici, kilitli R3MES’i adaptör **onaylandıktan sonra** yalnızca `withdraw_stake_after_approval` ile geri alır (buna ürün dilinde açıkça *stake iadesi* veya *unstake* denir); sohbet ücreti SUI olarak `record_usage` ile havuza işlenir ve havuzdan çıkan SUI yalnızca `OperatorCap` sahibinin `withdraw_rewards` çağrısıyla hareket eder — buna *kullanıcı cüzdanı claim’i* denmez. Bu yüzden arayüz ve API’de tek başına **“Claim”** etiketi kullanılmaz; hangi zincir veya operasyonel adımın kastedildiği her zaman somut terimle (stake iadesi, kullanım ücreti özeti, operatör çekimi vb.) adlandırılır ve zincirde karşılığı olmayan “geçici claim” akışı tasarlanmaz.

---

## 1. Amaç

**Stake / claim** ürün dilinin Move ve operasyonel gerçeklikle çakışmaması; **şu an zincirde olan** ile **ileride planlanan** arasında belge üzerinde açık ayrım.

---

## 2. Zincirde bugün “kaynak gerçek” olanlar (Move)

| Kavram | Move gerçeği |
|--------|----------------|
| Eğitici stake | `staking_pool::deposit_stake` — yalnızca adaptör **Pending** iken; `StakeDepositedEvent`. |
| Stake iadesi | `withdraw_stake_after_approval` — yalnızca adaptör **Active** iken; `StakeWithdrawnEvent`. |
| Slash | `slash_stake_on_rejected` — **Rejected** + `RegistryAdminCap`; `StakeSlashedEvent`; R3MES yakımı. |
| Sohbet ücreti (SUI) | `reward_pool::record_usage` — **OperatorCap**, tam **1 MIST**; `UsageRecordedEvent`. |
| Havuzdan SUI çekimi | `reward_pool::withdraw_rewards` — **OperatorCap**. |

---

## 3. “Claim” sözcüğü — eşleşen ürün terimleri (kısıtlı kullanım)

| Ürün anlamı | Zincir karşılığı (bugün) | UI / doküman notu |
|-------------|---------------------------|-------------------|
| Stake geri alma | `withdraw_stake_after_approval` | “Stake iadesi”, “Unstake” — **Claim değil**. |
| Slash sonrası tazmin | Yok | Ayrı ürün / politika; zincir yok. |
| Sohbet ücreti / havuz | `UsageRecordedEvent` + bakiye; dağıtım `withdraw_rewards` | Kullanıcı doğrudan çekmez; **operatör / protokol** süreci. |
| Genel “token ödülü” | Bu pakette tanımlı değil | Ayrı modül veya ADR gerekir. |

---

## 4. Stake lifecycle — ürün dili ↔ Move (bire bir)

| Ürün / süreç adımı | Move önkoşulu | Olay |
|--------------------|----------------|------|
| Stake yapılabilir | Adaptör Pending | `StakeDepositedEvent` |
| Benchmark / inceleme bekleniyor | — | Zincir olayı değil; off-chain |
| Onaylandı, stake iade | Adaptör Active | `StakeWithdrawnEvent` |
| Red + slash | Adaptör Rejected | `StakeSlashedEvent` |

**Backlog (ürün / mimari, bu ADR’yi iptal etmez):** “Kilit süresi”, “benchmark skoru” gibi kavramların tamamen off-chain kalıp kalmayacağı veya ileride zincire taşınıp taşınmayacağı ayrı karar konusudur.

---

## 5. Olaylar: indexer vs RPC — karar

| Modül | Indexer (Prisma) | Doğrudan RPC (`queryEvents`) |
|--------|------------------|------------------------------|
| `adapter_registry` | Evet | İsteğe bağlı |
| `staking_pool` | Evet | Özet / ödül agregasyonunda da kullanılıyor |
| `reward_pool` | **Hayır (Faz 4 kararı)** | `UsageRecordedEvent` — `aggregateRewardTotals` (`suiRewards.ts`) |

**Karar:** `reward_pool` olayları **Faz 4’te indexer’a alınmaz**; kullanım başına SUI özetinin kaynağı RPC olay taraması kalır. İndeksere taşınması gerekirse **ADR-003** (şema, checkpoint, idempotency) ile ayrı kabul edilir.

---

## 6. Yeni Move yüzeyi mi, backend yorumu mu — karar

**Karar (Faz 4):** Mevcut Move yüzeyi **kaynak gerçek** olarak yeterlidir; belirsizliği gidermek için önce bu ADR ve [ONCHAIN_READ_MODEL_AND_EVENTS.md](../blockchain/ONCHAIN_READ_MODEL_AND_EVENTS.md) ile ürün/API dilini hizalamak yeterlidir. **Kullanıcıya yönelik yeni bir claim / dağıtım entry’si** ancak ürün gereksinimi netleştikten sonra yazılır; o durumda aşağıdaki etki analizi şablonu ve yeni ADR zorunludur.

---

## 7. İsteğe bağlı gelecek Move değişikliği — etki analizi şablonu

*Yalnızca yeni kullanıcı claim / dağıtım fonksiyonu gündeme gelirse doldurulacak.*

| Alan | Etki |
|------|------|
| **Move** | Yeni `public`/`entry` fonksiyon(lar), yetki modeli (`OperatorCap` dışı?), `event` şeması, `E*` hata kodları, minimum test ve `sui move test`. |
| **Dağıtım** | Paket yükseltme veya yeni nesne; mevcut `RewardPool` / havuz taşıma politikası. |
| **Indexer** | Yeni olay türleri, `IndexerCheckpoint` genişlemesi veya üçüncü cursor, Prisma alanları. |
| **Backend** | RPC filtreleri, idempotent yazım, mevcut `aggregateRewardTotals` ile çakışma önleme. |
| **Ürün / FE** | Cüzdan imzası, “claim” etiketinin artık teknik olarak doğrulanabilir olması. |

---

## 8. Dokümantasyon ilkesi (engel)

- Zincirde olmayan davranış backend/UI’da **mevcutmuş** gibi sunulmaz.
- Erken faz [blockchain_architecture.md](../blockchain_architecture.md) ile operasyonel [ONCHAIN_READ_MODEL_AND_EVENTS.md](../blockchain/ONCHAIN_READ_MODEL_AND_EVENTS.md) karıştırılmaz; operasyonel doğruluk için ikincisi ve bu ADR önceliklidir.

---

## 9. Karar kaydı (Kabul — dolduruldu)

| Soru | Karar | Not |
|------|--------|-----|
| “Claim” resmi tanımı | Bkz. **Bölüm 0**; genel “Claim” etiketi kullanılmaz. | Tek paragraf ürün + teknik uyumlu. |
| Ödül / stake özeti kaynakları | Stake pozisyonları: **indexer → Prisma**. Kullanım ücreti (SUI) toplamları: **RPC olayları** (`suiRewards`). | İki kaynak bilinçli; tek tabloda birleştirme zorunlu değil. |
| `reward_pool` indexer’a alınsın mı? | **Hayır (Faz 4).** | İhtiyaç halinde ADR-003. |
| Yeni Move yüzeyi | **Gerekli değil** (Faz 4); ihtiyaç halinde etki analizi + yeni ADR. | |

---

## 10. Sonraki bakım

- BACKEND / ORTAK: API ve UI metinlerinin Bölüm 0 ile uyumunu doğrulamak (route imzası değişmeden kopya/yanıt gövdesi).
- Backlog: ADR-003 taslağı yalnızca `reward_pool` indeksleme ihtiyacı doğrulandığında.

---

## 11. Faz 5 — Uygulama durumu matrisi (kapanış)

Aşağıdaki tablo ADR-002 kararlarının **Faz 5** sonunda teknik tarafta nasıl kapandığını gösterir. Amaç: backend’in dayandığı zincir gerçekliği **belirsiz kalmadan** netleşsin; gereksiz Move değişikliği yapılmadan kararlar kapatılsın.

| Karar / kapsam | Durum | Not |
|------------------|--------|-----|
| “Claim” resmi tanımı ve terminoloji (Bölüm 0, §3) | **Uygulandı** | Kaynak: bu ADR; ek Move gerekmedi. |
| Stake lifecycle ↔ Move entrypoint / olaylar (§2, §4) | **Uygulandı** | `staking_pool` + `adapter_registry` mevcut yüzey yeterli. |
| Kullanıcıya genel “claim” entry’si eklenmesi | **Gerekmedi** | Kasıtlı olarak yok; ürün dışı kavram zincire kodlanmadı. |
| `reward_pool` olaylarının indexer’a alınması | **Gerekmedi** (Faz 5) | Kullanım ücreti özetleri `suiRewards` / RPC ile; ADR-003 ancak ürün tek DB’de birleşme isterse. |
| Yeni Move modülü / genişletilmiş reward yüzeyi | **Gerekmedi** (Faz 5) | API rahatlasın diye yapılmadı; §7 yalnızca gelecek ihtimal için şablon. |
| `reason_code` ve benzeri alanların Prisma read model’de tutulması | **Backlog** | Olaylarda alan var; şema genişletmesi BACKEND işi; zincir değişikliği şart değil. |
| Ürün/API metinlerinin Bölüm 0 ile hizası | **Backlog (ORTAK / BACKEND)** | Route mantığı dışı kopya; zincir bloğu değil. |

**Özet karar:** Mevcut zincir yüzeyi ADR-002 ile **uyumlu ve Faz 5 için yeterli** kabul edilir; ek Move veya indexer işi **zorunlu değildir**.

---

## 12. Faz 5 — Blockchain PR hedefi (dar kapsam)

**Hedef:** ADR-002 kapanış matrisini (§11) repo içinde sabitlemek ve entegrasyon noktalarında yanlış varsayımı önlemek.

| Dahil | Dahil değil |
|-------|-------------|
| Bu ADR’deki §11 güncellemesi (bu commit) | Sırf “API rahatlasın” diye yeni `public fun` / entry |
| Paket README’lerinde indexer kapsamı vs RPC (`UsageRecordedEvent`) ayrımı | Ürün kavramlarının Move’a gömülmesi |

**Başarı kriteri:** Backend / ORTAK, stake ve kullanım ücreti için hangi verinin **Prisma** (indexer), hangisinin **RPC olay** olduğunu ADR-002 ve [ONCHAIN_READ_MODEL_AND_EVENTS.md](../blockchain/ONCHAIN_READ_MODEL_AND_EVENTS.md) üzerinden tekil kaynaktan okuyabilir; zincir tarafında ek iş **gerekli mi / gerekmedi** sorusu bu belgeyle **kapalıdır**.

---

## 13. Faz 7 — MVP zincir kabulü

MVP demo için zincir yeterliliği ve “blockchain backlog’unun MVP blocker sayılmaması” ayrıca **[MVP_BLOCKCHAIN_ACCEPTANCE.md](../blockchain/MVP_BLOCKCHAIN_ACCEPTANCE.md)** ile kapatılmıştır. Faz 7’de yeni Move kapsamı açılmaz.
