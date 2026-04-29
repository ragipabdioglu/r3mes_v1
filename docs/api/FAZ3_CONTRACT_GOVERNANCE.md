# Sözleşme genişletme ve doğrulama disiplini (Faz 3–7)

**Referans:** `fazlar/v3/faz_2.md` (karar özeti), `docs/api/INTEGRATION_CONTRACT.md` (kanon). **Faz 4:** yeni teori üretilmez; kabul edilmiş contract minimum değişiklikle sürer. **Faz 5:** ORTAK yalnızca gerçekleşen davranışı kanona yazar; `openapi.contract.yaml` içinde §3.6 bilinçli **501** yüzeyleri de tanımlı tutulur (kısmi OpenAPI drift’i merge öncesi engel). **Faz 6:** ORTAK **koruyucu** roldedir; yeni ürün teorisi üretmez, tek kanonik yüzeyi bozmaz; küçük gerçek değişiklikler varsa yine **tek tur dörtlü senkron** (aşağı). **Faz 7:** **Contract freeze** (Faz 6 ile aynı disiplin) korunur; canlı doğrulama / demo yalnızca **yeni, kanıtlanmış runtime gerçeği** ortaya çıkarırsa kanon **tek turda** güncellenir — yoksa **contract’a dokunulmaz**.

## Tek doğrulama katmanı

| Katman | Konum | Amaç |
|--------|--------|------|
| TypeScript tipleri | `packages/shared-types/src/*.ts` | Derleme zamanı |
| Zod şemaları | `packages/shared-types/src/schemas.ts` | Runtime parse / güvenli `safeParse` |
| Invariant guard’lar | `packages/shared-types/src/contractGuards.ts` | Kuyruk/webhook mantığında `adapterCid === weightsCid`, skor aralığı |
| OpenAPI parçası | `docs/api/openapi.contract.yaml` | İnsan / codegen referansı; Zod ile çelişmemeli |
| Regression testleri | `packages/shared-types/test/contractRegression.test.ts` | CI’da Faz 2 ihlali yakalama |

Yeni JSON yüzeyi eklendiğinde **önce** `INTEGRATION_CONTRACT.md` §3 ve §7 güncellenir; ardından aşağıdaki **dört artefakt aynı PR’da** güncellenir (biri eksik kalırsa merge edilmez):

1. `docs/api/INTEGRATION_CONTRACT.md` (markdown kanon)
2. `packages/shared-types/src/schemas.ts` (ve gerekiyorsa `payloadTypes.ts` / `apiContract.ts`)
3. `docs/api/openapi.contract.yaml`
4. `packages/shared-types/test/contractRegression.test.ts`

**Faz 4 — stake / claim:** `§3.6` yüzeyi BLOCKCHAIN + BACKEND kararından önce **501** ile sabittir. Karar sonrası ORTAK tek güncelleme turu yapar; ara sözleşme dosyası veya ikinci “contract repo” oluşturulmaz — karar notu `docs/adr/` veya ekip runbook’unda kalabilir, **kanon yalnızca** bu belge + shared-types + OpenAPI + testtir.

## PR checklist (zorunlu alan)

- [ ] Faz 2 kimlik kuralları bozulmadı (`adapterDbId` ana kimlik; `adapterCid` / `weightsCid` ilişkisi).
- [ ] `AdapterStatusWire` veya `benchmarkScore` anlamı değişmediyse şema sıkılığı aynı kaldı.
- [ ] Değişiklik **§7 Breaking / non-breaking** altında sınıflandırıldı (PR açıklamasında tek cümle).
- [ ] `pnpm run build && pnpm run test` (`packages/shared-types`) yeşil.
- [ ] Güvenlik / iç webhook için ayrı inceleme gerekiyorsa etiketlendi.

## Çelişen ürün talebi

Faz 2 ile uyumsuz talep gelirse: önce **karar notu** (`docs/adr/` veya BLOCKCHAIN/BACKEND) — sözleşme mi genişletilecek, istek mi reddedilecek. **Engel:** Sorun çıktığında yeni “ara sözleşme” veya paralel kanon üretilmez.

## Breaking / non-breaking tablosu (güncel tutma)

`INTEGRATION_CONTRACT.md` §7 ana kurallar + §7 içindeki Faz 4 stake/claim satırları güncel tutulur. Ürün değişikliği PR’ında tabloya tek satır ekleme veya §7 notu yeterlidir; ayrı tablo dosyası açılmaz (drift riski).

---

## Faz 6 — ORTAK koruyucu rol, stabil contract ve freeze

**Rol:** ORTAK, mevcut kanonu **korur**; BACKEND / FRONTEND / ALTYAPI çıkan son düzeltmeleri ancak **gerçekten davranışı değiştiriyorsa** tek turda kanona işler. Yeni teori veya “rahatlatmak için” alan/isim icat edilmez.

| Durum | ORTAK aksiyonu |
|--------|----------------|
| Faz 6’da paylaşılan tipe / API’ye **dokunulmadı** | Ek PR gerekmez; `INTEGRATION_CONTRACT.md` §8’deki **stabil contract** notu geçerlidir (sürüm notunda “contract yüzeyi değişmedi” denebilir). |
| **Küçük ama gerçek** wire / tip / OpenAPI farkı var | **Dörtlü senkron** zorunlu (yukarıdaki liste); tek dosya “son dakika düzenlemesi” ile merge edilmez. |
| Release adayı / freeze penceresi | Kanon dosyalarında (`docs/api/INTEGRATION_CONTRACT.md`, `packages/shared-types/**`, `docs/api/openapi.contract.yaml`, `contractRegression.test.ts`) **gereksiz churn yok**; yüzey **sabit** kalır. |

**Engel (Faz 6):** “Sadece küçük” diye contract’ı tek artefaktta oynatıp diğerlerini bırakmak — merge öncesi **drift taraması** ile yakalanmalıdır.

### Release öncesi contract drift taraması (minimum)

Monorepo kökünden:

```bash
pnpm contract:drift
```

Bu, `@r3mes/shared-types` için `build` + `contractRegression` (vitest) çalıştırır; tipler, Zod ve regression testleri **aynı hikâyede** kaldığını doğrular. BACKEND/FRONTEND ile çapraz kontrol: runtime rotalar ve hata gövdeleri için `apps/backend-api/README.md` ve güvenlik/release checklist’leri; çelişki varsa önce kanon, sonra kod.

### Contract freeze kontrolü (release adayı)

- [ ] `pnpm contract:drift` yeşil.
- [ ] Freeze penceresinde ORTAK kapsamında **istenmeyen diff yok** (veya tek PR’da dörtlü + §7 sınıflandırması var).
- [ ] “Stabil contract” iddiası: ilgili sürümde ORTAK dosyalarına **hiç commit yoksa** veya yalnızca metin/netlik (davranış değiştirmeyen) ise release notunda açıkça yazılır.

**Başarı ölçütü (Faz 6):** Release adayı süresince **contract yüzeyi** (§3 matrisi + paylaşılan tipler + OpenAPI alt kümesi + regression testler) **sabit** kalır; değişiklik varsa tek seferde, dörtlü ve bilinçli.

**İlk gerçek GGUF lifecycle kanıtı:** Operasyonel tek kaynak **[../operations/GGUF_LIFECYCLE_PROOF_FAZ6.md](../operations/GGUF_LIFECYCLE_PROOF_FAZ6.md)** — başarılı veya başarısız sonuç burada sabitlenir; kanon §3.3.1 ile uyumlu kanıt için ek JSON alanı zorunlu değildir.

---

## Faz 7 — Canlı doğrulama, freeze ve yalnızca gerçek fark

**Rol:** ORTAK **contract freeze**’i sürdürür (Faz 6 ile uyumlu). **Yeni** ürün teorisi veya “demo için güzel görünsün” diye alan eklenmez. **Yalnızca** BACKEND / YAPAY ZEKA / FRONTEND tarafında canlı koşuda **kanıtlanmış** ve **kanondan farklı** bir wire davranışı (durum kodu, zorunlu alan, hata gövdesi, vb.) tespit edilirse **tek tur dörtlü senkron** ile kanon güncellenir.

| Durum | ORTAK aksiyonu |
|--------|----------------|
| Canlı doğrulama / demo sonrası **yeni bilgi yok** (kanon zaten doğru) | **Contract’a dokunulmaz**; `pnpm contract:drift` yeşil kalmalı. |
| **Gerçek runtime farkı** var (önceki §3 / OpenAPI / test ile çelişen ölçülebilir davranış) | Tek PR’da **dörtlü** + §7 sınıflandırması; runbook/ADR’e kısa not isteğe bağlı, **kanon** yine bu dosya + shared-types + OpenAPI + test. |
| Demo sırasında “küçük nüans” / UX tercihi / metin tonu | **Kanon dışı** (copy, UI); ORTAK churn’ü tetiklemez. |

**Engel (Faz 7):** Demo veya keşif sırasında görülen **dokümantasyon** veya **kozmetik** farklar için gereksiz contract güncellemesi — önce kanon ile karşılaştırılmalı; gerçekten wire değiştiyse dörtlü, değilse **kanon sabit**.

**Bağımlılık:** BACKEND, YAPAY ZEKA (AI engine / proxy zinciri), FRONTEND — davranış değişikliği bu hatlardan gelirse ORTAK yalnızca **yansıtıcı** günceller.

**Başarı ölçütü (Faz 7):** Faz süresince **kanon istikrarlı** kalır; yalnızca ölçülen **gerçek** fark tek turda işlenir. `pnpm contract:drift` release/demo öncesi **önerilir** (Faz 6 ile aynı minimum).
