# R3MES entegrasyon sözleşmesi (kanon)

**Sahiplik:** ortak tip paketi (`@r3mes/shared-types`) ve bu belge. Uygulama kodu ile çelişki durumunda önce bu belge ve `shared-types` güncellenir; sonra servisler uyumlanır.

> **Aktif ürün yönü:** `Qwen2.5-3B + RAG-first + optional behavior LoRA`
>
> Bu belgede geçen eski BitNet/QVAC “varsayılan runtime” ifadeleri artık **legacy/R&D** olarak okunmalıdır. Aktif local/dev başlangıç yolu için:
> - [LOCAL_DEV.md](../LOCAL_DEV.md)
> - [GOLDEN_PATH_STARTUP.md](../GOLDEN_PATH_STARTUP.md)

**İlgili:** `packages/shared-types/src/canonical.ts`, `packages/shared-types/src/index.ts`. **OpenAPI (alt küme, Faz 6):** [openapi.contract.yaml](./openapi.contract.yaml) — INTEGRATION_CONTRACT ile çelişirse önce bu belge güncellenir, sonra YAML.

---

## 1. Adapter kimliği (tek ana kimlik)


| Rol               | Alan adı                    | Tanım                                                                                                                                      |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ana (primary)** | `adapterDbId`               | PostgreSQL `Adapter.id` (cuid). REST’te `/v1/adapters/{id}` path parametresi. Kuyruk (`BenchmarkJobPayload.adapterDbId`) bu kimliği taşır. |
| Türetilmiş        | `onChainAdapterId`          | Move `adapter_id` (u64). String olarak API’de; henüz indeks yoksa `null` / atlanır.                                                        |
| Türetilmiş        | `onChainObjectId`           | Sui `Adapter` paylaşımlı nesnesinin Object ID’si.                                                                                          |
| Türetilmiş (IPFS) | `weightsCid`, `manifestCid` | Ayrı pinlenmiş dosyaların CID’leri.                                                                                                        |
| Kuyruk / QA wire  | `adapterCid`                | Webhook ve QA iş yükünde benchmark’lanan içerik CID’si; **normalizasyon kuralı:** `adapterCid === weightsCid` (aynı artefakt).             |
| Eski / çevresel   | `adapter_id`                | Bazı JSON gövdelerinde (snake_case) `adapterDbId` ile aynı anlam; **tercih edilen:** `adapterDbId` veya path `:id`.                        |


**Kural:** Bir istekte bağlam net değilse önce `adapterDbId` ile konumlandır; zincir veya IPFS sorguları bunun üzerinden türetilir.

---

## 2. Durum enum’ları (wire ↔ Move)


| `AdapterStatusWire` (API / Prisma) | Anlam                                  |
| ---------------------------------- | -------------------------------------- |
| `PENDING_REVIEW`                   | Off-chain kayıt; QA / onay bekliyor.   |
| `ACTIVE`                           | Onaylı; kullanıma uygun.               |
| `REJECTED`                         | QA veya politika nedeniyle reddedildi. |
| `SLASHED`                          | Stake slash sonrası (varsa).           |
| `DEPRECATED`                       | Kullanımdan kalkmış.                   |


**Move (`adapter_registry`) u8:** `PENDING=0`, `ACTIVE=1`, `REJECTED=2`.  
Bunlar **farklı türler**; indexer ve zincir köprüleri eşler. İstemci yalnızca `AdapterStatusWire` görür.

---

## 3. İstek / yanıt sözleşmesi matrisi

Aşağıdaki tablolar “mevcut yüzey” ile uyumlu sözleşmedir; `docs/backend_architecture.md` içindeki Faz-0 **taslak** uçlar (ör. `/v1/ai/queries`) henüz ayrı bir kanon değildir.

### 3.1 Adapter listeleme


|                  |                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yöntem / yol** | `GET /v1/adapters` (alias: `GET /adapters`) — herkese açık liste (pazaryeri)                                                                                                                                              |
| **Query**        | `limit`, `cursor`, `status` (opsiyonel; `AdapterStatusWire` veya `all`)                                                                                                                                                 |
| **Yanıt özeti**  | `data[]`: `id` (=adapterDbId), `name`, `status`, `kind`, `onChainAdapterId`, `onChainObjectId`, `**ipfsCid`** (= `weightsCid ?? manifestCid`), `benchmarkScore`, `domainTags`, `ownerWallet`, `createdAt`; `nextCursor` |


### 3.1b Eğitmen listesi (güvenilir sahip filtresi)


|                  |                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yöntem / yol** | `GET /v1/me/adapters`                                                                                                                                                                                                   |
| **Auth**         | `walletAuthPreHandler`: `X-Signature`, `X-Message`, `X-Wallet-Address` (imzalı cüzdan ile aynı); `R3MES_SKIP_WALLET_AUTH=1` ile yerel dev atlama.                                                                          |
| **Query**        | `GET /v1/adapters` ile aynı (`limit`, `cursor`, `status`).                                                                                                                                                               |
| **Yanıt**        | `GET /v1/adapters` ile aynı şekil; yalnızca **imzalı cüzdan adresine ait** `Adapter` kayıtları. İstemci tarafında `ownerWallet` ile süzme **güvenilir değildir**; stüdyo bu uç kullanmalı.                                |


### 3.2 Adapter detay


|                  |                                                                                 |
| ---------------- | ------------------------------------------------------------------------------- |
| **Yöntem / yol** | `GET /v1/adapters/:id`                                                          |
| **Yanıt**        | `weightsCid`, `manifestCid` ayrık; `ipfsCid` yok (türetim liste sözleşmesinde). |


### 3.3 LoRA yükleme (multipart)


|                  |                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **Yöntem / yol** | `POST /v1/adapters`                                                                                    |
| **Auth**         | `walletAuthPreHandler`: `X-Signature`, `X-Message`, `X-Wallet-Address` (HTTP başlıkları küçük harfe indirgenir); `R3MES_SKIP_WALLET_AUTH=1` ile yerel dev atlama. |
| **Form**         | `displayName`, `manifest` (dosya), **`weights` (tek dosya — aynı alanın birden fazla parçası 400 `MULTIPLE_WEIGHTS_NOT_ALLOWED`)**; form `wallet` alanı isteğe bağlı (kimlik başlıklardan çözülür). |
| **Yanıt**        | `LoRAUploadAcceptedResponse`: `adapterId`, `weightsCid`, `manifestCid`, `benchmarkJobId`, `status`     |

**Zincir (sözleşme özeti):** `weightsCid` tek primer GGUF’nun IPFS CID’sidir → kuyruk `benchmarkJobId` ile aynı yüklemeye bağlanır → QA worker sonucu `POST /v1/internal/qa-result` gövdesinde `jobId` + `adapterCid` (**`adapterCid` ≡ `weightsCid`**) döner → `QaWebhookReceipt` / `Adapter.status` / `benchmarkScore` güncellenir.

#### 3.3.1 Adapter ağırlık dosyası — resmi biçim (Faz 5, runtime gerçeği)

**Tek cümle:** Çıkarım (`apps/ai-engine` → `llama-server` `/lora-adapters`) ve otomatik QA (`packages/qa-sandbox` worker → aynı uç) için **resmi desteklenen** tek dosya biçimi **llama.cpp uyumlu LoRA GGUF**’dur; `weightsCid`, kuyruk `ipfsCid`, webhook `adapterCid` ve chat `adapter_cid` **bu dosyanın** IPFS içerik kimliğini taşır.

| Konu | Kanon |
|------|--------|
| **Dönüşüm** | Sunucuda **safetensors → GGUF dönüşümü yok.** “Belki ileride” ile contract’ta yer açılmaz. |
| **Upload alanı `weights`** | Ham bayt alır; dosya adı öneri **`.gguf`**. Eski metinlerde geçen `.safetensors` etiketi **runtime ile uyumsuzdu**; içerik yine de GGUF olmalıdır. |
| **Zip / çoklu parça LoRA** | Bu hatta **tek CID = tek GGUF dosyası**; zip-içi safetensors paketi `lora-adapters` ile doğrudan yüklenmez. |

**Desteklenmeyen (dönüşümsüz):** Yalnız PEFT/HF **safetensors** LoRA (GGUF değil), PyTorch `.bin`, safetensors-only içerikle “`.gguf` diye kaydetme” (uzantı kurtarmaz).

**Ürün / UI:** Stüdyo ve kullanıcı metinleri **“LoRA GGUF (llama.cpp uyumlu)”** ile hizalanmalı; “safetensors zorunlu” ifadesi kaldırılmalıdır. Eğitim tarafında safetensors üretiliyorsa **çevrimdışı** GGUF üretimi BACKEND/YAPAY ZEKA sürecine aittir.

**Migration / breaking:** API alan adları değişmez. **Davranış:** Daha önce safetensors yüklenmiş CID’ler QA/chat’te kırılabilir; çözüm **çevrimdışı GGUF üretip yeniden yükleme** veya yeni CID pin. Bu bir **semantik netleştirme** (§7: mevcut runtime’ın yazılması), yeni opsiyonel alan eklenmez.

**Upload erken doğrulama (400):** `WEIGHTS_TOO_SMALL`, `INVALID_GGUF_MAGIC` (ilk 4 bayt `GGUF`), `WEIGHTS_FILENAME_GGUF` (dosya adı `.gguf` ile bitmeli; boş ad `weights.gguf` sayılır), `MULTIPLE_WEIGHTS_NOT_ALLOWED` (tek primer artefact).

#### 3.3.2 İki dünya: eğitim/paketleme ↔ runtime / QA / chat

| Dünya | Amaç | Tipik artefakt | Üretim REST ile ilişki |
|--------|------|----------------|-------------------------|
| **Eğitim / paketleme** (Faz 0 taslak) | Eğitim, arşiv, manifest doğrulama | `.zip` içinde safetensors + `adapter_config` + manifest | `docs/ai_architecture.md` Bölüm 3–5 **taslak**; kanonik upload yolu ile **otomatik eşdeğer değildir**. |
| **Runtime / QA / chat** | IPFS CID → `llama-server` | Tek dosya **LoRA GGUF** (`POST /v1/adapters` → `weightsCid`) | **§3.3.1** — tek resmi üretim zinciri. |

**Zip ↔ runtime:** Üretim hattında **tek CID = tek GGUF**; zip-içi çoklu safetensors **doğrudan** `lora-adapters` ile yüklenmez. Zip, eğitim/sandbox doğrulama dünyasında kalır; **kanon karıştırılmaz.**

**Qwen / BitNet / diğer GGUF taban:** Donmuş çekirdek seçimi **dağıtım tercihidir**; ürün sözleşmesi **“LLM çekirdeği GGUF + optional LoRA GGUF”** ikilisidir. **Aktif MVP varsayılanı = Qwen2.5-3B GGUF.** BitNet/QVAC yalnızca legacy/R&D referansıdır. Güncel runtime yönü için [RUNTIME_PROFILES.md](../../infrastructure/RUNTIME_PROFILES.md) ve [LOCAL_DEV.md](../LOCAL_DEV.md) kullanılmalıdır.

**Operasyonel soru: “Hangi runtime resmi varsayılan?”** — Aktif yerel ve MVP çıkarım yolu **Qwen2.5-3B**’dir. BitNet/QVAC tarihî doğrulama hattı olarak kalır; ürünün resmi varsayılanı değildir.


### 3.4 QA webhook (iç)


|                  |                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yöntem / yol** | `POST /v1/internal/qa-result`                                                                                                                                             |
| **Gövde**        | `QaResultWebhookPayload`: `jobId`, `**adapterCid`** (weights ile aynı CID), `status` (`approved` / `rejected`), `score`, `threshold?`, `error?`, `metrics?`, `requestId?` |
| **Not**          | `metrics.reasonCode` zincir reddi / slash gerekçe kodu için kullanılabilir (uygulama sözleşmesi).                                                                         |


### 3.5 Chat (ücretli proxy)


|                  |                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yöntem / yol** | `POST /v1/chat/completions`                                                                                                                                                                                                                                                                                                       |
| **Başlık**       | `X-Signature`, `X-Message`, `X-Wallet-Address` — imzalı mesaj + süre (`exp` / `iat` JSON içinde); ücretlendirme için doğrulanmış cüzdan (`req.verifiedWalletAddress`). `R3MES_SKIP_WALLET_AUTH=1` ile yerel dev atlama.                                                                                                                                                                                                                             |
| **Gövde**        | OpenAI uyumlu; temel alanlar `messages`, opsiyonel `collectionIds`, `includePublic`, `adapterId` / `adapter_cid`, `stream`. Backend önce collection scope + visibility filtresi + retrieval yapar; sonra assembled prompt’u ai-engine’e gönderir. Behavior LoRA kullanılırsa `adapterId` / `adapter_cid` çözümlenir, ancak **base-only** ve **RAG + base** chat birinci sınıf senaryodur. |
| **Yanıt**        | Normal chat payload + opsiyonel `sources[]` citation listesi ve debug açık ise retrieval/source-selection metadata. |
| **Hata**         | Collection erişimi / visibility ihlali: `403` veya boş retrieval; adaptör çözüm hatası yalnız adapter istenmişse `400` (`ADAPTER_RESOLUTION_FAILED`, `ADAPTER_RESOLUTION_CONFLICT`, `ADAPTER_NOT_ACTIVE`); yapılandırma / ödeme: `402`, `503`. |

#### 3.5.1 RAG-first chat ve optional behavior LoRA

**Soru: “Chat neden base modelle veya LoRA’sız çalışıyor?” — tek kaynak cevap**

R3MES üretim sohbet yüzeyi artık **RAG-first** çalışır. Ana değer knowledge retrieval + source-backed answer zinciridir. LoRA yalnızca cevap üslubu/persona/format gibi davranış katmanı için opsiyoneldir; knowledge doğruluğu LoRA’dan beklenmez.

| Tür | Açıklama |
|-----|-----------|
| **Teknik** | `adapter_cid` opsiyoneldir. Backend request validation → collection scope → visibility enforcement → retrieval/rerank/prune → prompt assembly → optional adapter resolution → ai-engine zincirini uygular. |
| **Ürün** | Kullanıcı knowledge collection seçerek veya public kaynakları dahil ederek konuşur; LoRA seçimi zorunlu değildir. |
| **Destek / QA** | `adapter_cid` eksikliği bug değildir. Kaynaklı cevap bekleniyorsa önce collection seçimi, visibility ve retrieval sonucu kontrol edilir. |
| **Uyumluluk** | Eski adapter contract’ları korunur; ancak adapter-first chat ürünü aktif MVP yolu değildir. |


### 3.6 Kullanıcı stake / bakiye / ödül


|          |                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| **GET**  | `/v1/user/:wallet/stake`, alias `**GET /v1/chain/stake/:wallet`** — indekslenmiş stake pozisyonları                       |
| **GET**  | `/v1/user/:wallet/balance` — `R3MES_COIN_TYPE` ayarlıysa coin bakiyesi                                                    |
| **GET**  | `/v1/user/:wallet/rewards` — zincir olaylarından türetilen özet (paket ID gerekir)                                        |
| **POST** | `/v1/stake` — **501** `NOT_IMPLEMENTED` + `NotImplementedOnChainRestResponse`; önce `walletAuthPreHandler` (**401** imza yok; skip env hariç) |
| **POST** | `/v1/user/:wallet/rewards/claim` — **501** + aynı gövde şeması; yol `:wallet` imzalı adres ile eşleşmeli (**403** aksi halde); geçersiz adres **400** |

**Faz 5 — 501 yüzeyi ürün kararı (her POST için tek satır):**

| Uç | Karar | Anlam |
| --- | --- | --- |
| `POST /v1/stake` | **bilinçli koru (501)** | Sunucu stake imzası veya işlem orkestrasyonu **yürütmez**; kullanıcı Sui cüzdanı / Move ile işlem yapar. Bu REST yolu **rezerve** kalır; **501** + `NotImplementedOnChainRestResponse` **ürün standardıdır**, “ileride kesin yapılacak” anlamında **backlog kalemi değildir**. |
| `POST /v1/user/:wallet/rewards/claim` | **bilinçli koru (501)** | Sunucu claim orkestrasyonu yok; aynı semantik. |

**Gelecekte BLOCKCHAIN + ORTAK ile mümkün olanlar:** (1) **implement** — sunucu köprülü akış tanımlanırsa 501 kalkar; durum kodları ve gövde bu belge + `shared-types` ile birlikte güncellenir (**breaking** eşiği aşağıda). (2) **kaldır** — uç tamamen kaldırılırsa **semver major** ve istemci uyarısı. (3) **501 koru** — yukarıdaki kararın sürmesi (yeni davranış icat edilmez).

**Karar sonrası tek noktadan güncelleme (zorunlu dörtlü):** `INTEGRATION_CONTRACT` §3.6 → `shared-types` (`payloadTypes` / `schemas` / `apiContract` gerektiği kadar) → `openapi.contract.yaml` → `contractRegression.test.ts`. Ayrı bir “ara sözleşme” reposu oluşturulmaz; çelişki durumunda önce karar notu, sonra kanon.

**Breaking eşiği (özet):** 501 bekleyen istemciler için 200 + iş gövdesi **breaking** sayılır; opsiyonel yeni alanlar **non-breaking** (§7 tablosu).


---

## 4. `benchmarkScore` ve ROUGE


| Alan                       | Anlam                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `benchmarkScore`           | QA pipeline çıktısı: **0–100 ölçeğinde tek özet skor** (Prisma `Decimal`). Ürün ve liste API’sinde gösterilen değer.                       |
| ROUGE / BLEU ham değerleri | `**QaResultWebhookPayload.metrics`** içinde (ör. `rouge_l_f1_mean`, `per_sample`). Ayrı bir üst düzey `rougeScore` alanı tanımlı değildir. |


---

## 5. IPFS alanları (`ipfsCid`, `weightsCid`, `manifestCid`)


| Alan                  | Anlam                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `weightsCid`          | Birincil artefakt: **llama.cpp uyumlu LoRA GGUF** dosyasının IPFS CID’si; QA işi ve `adapterCid` bununla hizalanır (içerik biçimi §3.3.1).          |
| `manifestCid`         | `manifest.json` ayrı pinlendiyse.                                                                      |
| `ipfsCid` (liste API) | **Türetilmiş** tek alan: `weightsCid ?? manifestCid` — UI kısayolu; kalıcı “tek CID” iddiası değildir. |


---

## 6. Dokümantasyon drift notları


| Belge                          | Durum                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/backend_architecture.md` | Faz-0 **taslak**; çok sayıda yol henüz yok. Güncel yüzey için §3 bu dosyaya bakın. Diyagramlar tarihsel kabul edilir; aktif ürün çekirdeği **Qwen2.5-3B + RAG-first + optional behavior LoRA** yoludur (§3.3.2).                                                                                 |
| `docs/ai_architecture.md`      | Faz 0 **eğitim/paketleme** (zip/safetensors) ile **üretim runtime** (§3.3.1 GGUF) aynı cümlede karıştırılmamalı; üst bölümde uyarı + **§3.3.2** tek kaynak.                                                                 |
| Kök `README.md` Happy path     | Adım 3 kanon: **LoRA GGUF + manifest** (§3.3.1); eski “safetensors” ifadeleri kaldırılmalıdır. |
| IPFS geçidi portu              | Yerel Docker: host **9080** → konteyner 8080 (`docker-compose.storage.yml`); kök README ile uyumludur.                                                             |
| **Faz 6 — ilk GGUF lifecycle kanıtı** | Tek kaynak: **[../operations/GGUF_LIFECYCLE_PROOF_FAZ6.md](../operations/GGUF_LIFECYCLE_PROOF_FAZ6.md)** — canlı sonuç (başarı/başarısız) dağınık kanıt yerine burada; §3.3.1 ile çelişen ölçüm varsa önce kayıt, sonra ORTAK dörtlü senkron. |
| “Chat neden base modelle çalışıyor / LoRA zorunlu mu?” | **§3.5.1** — RAG-first chat; behavior LoRA opsiyonel. |
| Yerel port / servis haritası | **[LOCAL_DEV.md](../LOCAL_DEV.md)** — golden path; API matrisi bu dosyada değil. |


---

## 7. Breaking / non-breaking değişiklik kuralları

- **Breaking:** `adapterDbId` veya liste/detay JSON’da `id` alanının kaldırılması / yeniden adlandırılması; `AdapterStatusWire` string değerlerinin değiştirilmesi; `QaResultWebhookPayload` zorunlu alanların kaldırılması.
- **Non-breaking:** Yeni opsiyonel query/header; `metrics` içine yeni anahtarlar; yeni enum değeri (istemciler bilinmeyeni yok sayabilir).
- **Migration:** Yeni bir “ana kimlik” tanımlanmayacak; tüm yeni bağlantılar `adapterDbId` üzerinden genişletilir.

| Yüzey (Faz 4 izleme) | Tipik breaking | Tipik non-breaking |
| -------------------- | -------------- | ------------------- |
| `POST /v1/stake`, `POST .../rewards/claim` | 501 → 200 veya zorunlu gövde alanı | Yeni **opsiyonel** alan; aynı 501 gövdesinde ek metadata |
| Paylaşılan tipler (`NotImplementedOnChainRestResponse`) | `code` / `success` anlamı değişir | Yeni opsiyonel alan |
| §3.3.1 LoRA GGUF kanonu (mevcut runtime’ın yazılması) | — | Alan adları / JSON şeması aynı; yalnızca içerik beklentisi netleşir |
| §3.3.2 iki dünya + §3.5.1 RAG-first optional adapter chat | Eski istemcide adapter zorunlu varsayımı varsa davranış değişir | Yeni opsiyonel `collectionIds`, `includePublic`, `adapterId`; adapter-first alanlar geriye uyum için kalır |

**Faz 3–4:** Yeni endpoint veya alan eklerken PR’da **breaking / non-breaking** sınıfı zorunludur. Checklist: **[FAZ3_CONTRACT_GOVERNANCE.md](./FAZ3_CONTRACT_GOVERNANCE.md)** (Faz 4 dörtlü senkron dahil).

**Faz 5 (artefact):** §3.3.1 **tek resmi biçim** — upload → QA → chat zincirinde **dönüşüm yok**; önceki belirsizlik giderilir, wire tipi değişmez (**non-breaking** sınıflandırması).

---

## 8. Doğrulama katmanı (Faz 3 — Faz 2’yi koruyarak)


| Bileşen                                | Konum                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| Zod şemaları + `parse`* / `safeParse*` | `packages/shared-types/src/schemas.ts`                  |
| Runtime invariant’lar                  | `packages/shared-types/src/contractGuards.ts`           |
| Kuyruk / webhook tipleri               | `packages/shared-types/src/payloadTypes.ts`             |
| OpenAPI parçası (insan/codegen)        | `docs/api/openapi.contract.yaml` (§3.1, §3.4–§3.5 chat, §3.6 501 yüzeyleri) |
| Regression testleri                    | `packages/shared-types/test/contractRegression.test.ts` |


**Kural:** Faz 2 anlamları değiştirilmeden genişletme; şema sıkılığı `INTEGRATION_CONTRACT` ile tutarlı kalmalıdır. **Faz 5:** Stake/claim için OpenAPI’de yalnızca **501** + `NotImplementedOnChainRestResponse` şeması taahhüdü vardır; 200 gövdesi eklendiğinde bu tablo + §7 birlikte güncellenir (**breaking** eşiği §3.6).

**Faz 4:** Yeni teori üretilmez; stake/claim ve benzeri kararlar **BLOCKCHAIN + BACKEND** notundan sonra bu dosyaya işlenir ve guard katmanı aynı PR’da güncellenir (**§3.6**, **FAZ3_CONTRACT_GOVERNANCE**).

**Faz 6 — stabil contract:** Bu sürümde paylaşılan wire / şema / OpenAPI / test dosyalarına **dokunulmadıysa** contract yüzeyi **değişmemiş** sayılır; ORTAK ek iş üretmez. Release öncesi doğrulama ve freeze kuralları için **[FAZ3_CONTRACT_GOVERNANCE.md](./FAZ3_CONTRACT_GOVERNANCE.md)** (Faz 6 bölümü). Küçük gerçek fark varsa yine **tek tur dörtlü senkron**; “son dakika küçük düzenleme” ile tek artefakt güncellenmez.

**Faz 7 — freeze + canlı doğrulama:** Contract freeze korunur; canlı doğrulama veya demo **yeni, kanıtlanmış runtime gerçeği** göstermedikçe kanona **dokunulmaz**. Fark varsa **tek tur dörtlü**; demo nüansları veya kopya metin tek başına kanon güncellemesi gerektirmez. Ayrıntı: **[FAZ3_CONTRACT_GOVERNANCE.md](./FAZ3_CONTRACT_GOVERNANCE.md)** (Faz 7 bölümü).
