# Release checklist (R3MES)

## Tek cümleyle çıkış kuralı

**PR’da `ci.yml` yeşil ve (merge/tag öncesi) `pnpm release:check` yeşil ise normal çıkış yapılabilir; `packages/sui-contracts` veya Move sözleşmeleri bu sürümde değiştiyse ayrıca `pnpm release:check:full` de yeşil olmalıdır.**

**Aynı cümle `pnpm mvp` için geçerli** (`mvp` = `release:check` takma adı; tek giriş noktası).

**Inference runtime (ORTAK):** [RUNTIME_PROFILES.md](RUNTIME_PROFILES.md) — **resmi varsayılan = Qwen2.5-3B**; BitNet/QVAC yalnız legacy/R&D referansıdır. Release notları ve dağıtım env şablonları buna uyumlu olmalıdır.

---

## MVP smoke ve release kapısı (Faz 7)

| Soru | Karar |
|------|--------|
| Uçtan uca **tarayıcı MVP** akışı (E2E) release kapısına bağlı mı? | **Hayır** — bilinçli dışarıda; teknik kapı `validate` + **tanımlı smoke:ts** (+ Move için tam smoke). |
| **MVP kanıtı** ne? | `pnpm mvp` / `pnpm release:check` sonunda **MVP kanıt özeti** + **RELEASE GATE: GO** — aynı komutlar yerelde ve release öncesi; yorum tek. |
| `smoke.yml` (Postgres + migrate + tam smoke)? | Üretim benzeri ek doğrulama; **zorunlu PR kapısı değil** (`ci.yml` + yerel `mvp` ile birlikte değerlendirilir). |

Önkoşullar: [`PREREQUISITES.md`](PREREQUISITES.md).

---

## Go / No-Go özeti

| Sinyal | GO | NO-GO |
|--------|----|--------|
| `pnpm validate` | Konsolda **UYUMLU**, çıkış 0 | **DRIFT** veya çıkış 1 |
| `ci.yml` (PR) | Tüm adımlar yeşil | Herhangi bir adım kırmızı |
| `pnpm release:check` veya **`pnpm mvp`** (aynı) | Sonunda **MVP kanıt özeti** + **RELEASE GATE: GO** | Zincir kırıldıysa özet/banner yok |
| `pnpm release:check:full` | MVP özeti (full) + **GO** (Move dahil) | Sui / Move hatası |

Yerel ile CI aynı kararı vermeli: `ci.yml` içinde `pytest`/`Sui` öncesi adımlar repoda tanımlıdır; yerelde tam `turbo test` veya `release:check` öncesi `pip install` satırlarını uygulayın (`validate` çıktısı bunları hatırlatır).

---

## Rol dağılımı (ne zaman ne çalışır?)

| Rol | Ne zaman | Ne yapar | Yeşil ne anlama gelir |
|-----|----------|----------|------------------------|
| **PR CI** (`ci.yml`) | Her push / PR | lint, build, `turbo test`, `pnpm validate`, audit | Kod + manifest + güvenlik denetimi; merge edilebilir teknik taban |
| **Yerel `release:check` / `mvp`** | Merge öncesi, etiket öncesi | `validate` + `smoke:ts` + MVP özeti + GO banner | PR + smoke kapsamındaki ürünler derlenir ve test edilir (Move hariç) |
| **`release:check:full`** | Sözleşme / on-chain değişiklik | `validate` + tam `smoke` (TS + Move) | Üstteki + `sui move build/test` |
| **Smoke workflow** (`smoke.yml`) | `main` push veya elle | Postgres + migrate + `pnpm smoke` | Üretim benzeri DB + tam smoke (CI’da uzun; her PR’da değil bilinçli) |
| **`pnpm smoke` / `smoke:ts` tek başına** | Debug / dar test | Sadece smoke | CI ile aynı komutlar; sonuç yorumu için `release:check` veya checklist kullanın |

---

## `release:check` / `mvp` sonuçlarını okuma

1. **`pnpm validate`** — Tabloda tüm paketler `ok`; **UYUMLU**. Değilse önce manifest / `package.json` düzeltin.
2. **`pnpm run smoke:ts`** — Turbo build + test filtreleri yeşil. Kırmızıysa ilgili paket loguna bakın.
3. **MVP kanıt özeti** — Hangi paketlerin smoke kapsamında olduğunu ve E2E’nin kapıda olmadığını netler (ürün sinyali).
4. **Banner** — **RELEASE GATE: GO**; tanımlı kapı için operasyonel onay.

---

## E2E (tarayıcı / uçtan uca)

Şu an **release kapısının parçası değil**; bilinçli olarak dışarıda. Playwright veya benzeri eklendiğinde:

- Minimum kapsam (ör. kritik kullanıcı akışı) bu dosyada ve `ci.yml` / ayrı workflow’da tanımlanana kadar çıkış kuralı yukarıdaki tek cümleye dayanır.
- Ağır E2E’yi her PR’da koşturmak süreyi şişirir; tercih: `main` / elle tetik veya ince path filtresi.

---

## ORTAK contract drift (Faz 6–7)

Release adayı / tag öncesi: `pnpm contract:drift` yeşil olmalı (`@r3mes/shared-types` derlemesi + `contractRegression`). Freeze ve stabil contract kuralları: `docs/api/FAZ3_CONTRACT_GOVERNANCE.md` (Faz 6). **Faz 7:** canlı doğrulama sonrası yalnızca **kanıtlanmış** runtime farkı kanonda tek tur güncellenir; aksi halde contract churn yok — aynı belgenin **Faz 7** bölümü.

**Faz 6 (GGUF lifecycle):** AI yüzeyi değişen sürümlerde ilk uçtan uca kanıt özeti **[docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md](../docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md)** üzerinden okunmalıdır (`PENDING` ise release notuna “kanıt bekleniyor” denilebilir).

---

## İlgili dosyalar

- Manifest: `infrastructure/test-surface.json`
- Smoke filtreleri: kök `package.json` → `smoke:build`, `smoke:test` (`mvp-proof.mjs` ile senkron tutun)
- Altyapı özeti: `infrastructure/README.md`
- Önkoşullar: `infrastructure/PREREQUISITES.md`
