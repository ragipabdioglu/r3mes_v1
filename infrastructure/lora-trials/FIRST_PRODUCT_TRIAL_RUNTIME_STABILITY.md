# İlk gerçek ürün trial — runtime / worker / backend stabilitesi

**Amaç:** `tr-v1.gguf` (veya aynı şemadaki ilk adapter) upload → QA benchmark turunda **port / path / env** yüzünden tartışma çıkmasın. Yeni araştırma değil; kanıtlı pin’lere bağlanır.

**İlgili:** [ARTIFACT_LAYOUT.md](ARTIFACT_LAYOUT.md) (export + checksum), [BITNET_PINNED_ENV_MATRIX.md](../BITNET_PINNED_ENV_MATRIX.md), [BITNET_L2_STACK.md](../BITNET_L2_STACK.md), [FIRST_BITNET_UPLOAD_CHECKLIST.md](FIRST_BITNET_UPLOAD_CHECKLIST.md).

---

## 1) BitNet runtime — doğru slot ve port

| Kontrol | Beklenti |
|---------|-----------|
| **Base GGUF** | [BITNET_QVAC_PRODUCTION_MATRIX.md](../BITNET_QVAC_PRODUCTION_MATRIX.md) pin’i (`1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`); başka base = **yeni trial serisi**. |
| **`llama-server` HTTP** | `GET http://127.0.0.1:<PORT>/v1/models` → **200** (trial öncesi). |
| **LoRA slot** | `llama-server` **`--lora`** ile verilen dosya yolu = worker **`R3MES_QA_LORA_COPY_TARGET`** (ASCII yol). Worker indirdiği GGUF’u **aynı path**’e yazar — [worker README](../../packages/qa-sandbox/worker/README.md). |
| **Port tek doğru** | Aşağıdaki **senaryo A veya B**’den *birini* seçin; worker `R3MES_QA_LLAMA_BASE_URL` **aynı porta** işaret etmeli. |

**Senaryo A — Yalnız BitNet (canonical inference 8080):**

- BitNet `llama-server` **8080**.
- `R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080`

**Senaryo B — Qwen 8080 + BitNet 8081 (aynı host):**

- BitNet **8081**; Qwen ayrı süreç **8080** ([BITNET_L2_STACK.md](../BITNET_L2_STACK.md) §2, §5).
- Bu trial sırasında worker **BitNet**’e bağlanacaksa: `R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8081`
- **Çakışma:** Aynı worker sürecini iki profile bağlamayın; trial bitene kadar BitNet profili sabit kalsın.

**Yanlış örnek:** Backend dokümantasyonunda varsayılan `8080` yazıyor diye worker’ı 8080’a bırakıp BitNet’i 8081’de çalıştırmak → skor **ürün BitNet başarısı** sayılmaz ([ACTIVE_CANDIDATE_MINIMUM_PROOF.md](../../apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md)).

---

## 2) Worker — backend webhook ve sırlar

| Değişken | Zorunlu değer / kural |
|----------|------------------------|
| **`R3MES_BACKEND_QA_WEBHOOK_URL`** | Çalışan API: **`http://127.0.0.1:3000/v1/internal/qa-result`** (deploy’da gerçek API kökü + aynı path). L1 mock (**3003**) bu turda **kullanılmaz** ([BITNET_L2_STACK.md](../BITNET_L2_STACK.md) §1). |
| **`R3MES_QA_WEBHOOK_SECRET`** | Backend’deki secret ile **aynı** (HMAC 403 önleme). |
| **`R3MES_REDIS_URL`** | Backend ile **aynı** Redis (kuyruk köprüsü). |
| **`R3MES_QA_MODEL_NAME`** | BitNet pin: `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` ([BITNET_PINNED_ENV_MATRIX.md](../BITNET_PINNED_ENV_MATRIX.md) §3). |
| **IPFS** | Gateway/API worker’ın `weightsCid` indirmesine uygun (`9080` health vb.). |

**Verify:** `DATABASE_URL` + `R3MES_VERIFY_BASE_URL` upload sonrası [FIRST_BITNET_UPLOAD_CHECKLIST.md](FIRST_BITNET_UPLOAD_CHECKLIST.md) ile **aynı backend DB** olmalı.

---

## 3) Export dosyası ve checksum (upload öncesi)

| Madde | Kaynak |
|--------|--------|
| GGUF yalnızca **`candidates/<trial_id>/export/`** | [ARTIFACT_LAYOUT.md](ARTIFACT_LAYOUT.md) §2, §6 |
| **`tr-v1.gguf` + `tr-v1.gguf.sha256` + `EXPORT.md`** | Trial `export/README.md` |
| Windows path | [ARTIFACT_LAYOUT.md](ARTIFACT_LAYOUT.md) §2.5 (Unicode / ASCII) |

Upload **başlamadan** §6 checklist maddeleri **evet**.

---

## 4) Trial süresince logları kaybetme

**Önerilen kök (yerel, commit edilmez):** `logs/profile-bitnet-first-product-trial/` veya `logs/profile-bitnet-l2/` ([BITNET_L2_STACK.md](../BITNET_L2_STACK.md) §3 ile uyumlu).

| Bileşen | Ne kaydedilir | Nasıl |
|---------|----------------|--------|
| **BitNet runtime** | `llama-server` stdout/stderr | Örn. `llama-<PORT>-stderr.log`; başlangıçta `build: 7349` satırı |
| **QA worker** | Tam iş akışı | `R3MES_QA_WORKER_LOG_FILE=...` (dosya yolunda `trial_id` veya `tr-v1` geçsin) |
| **backend-api** | `qa_webhook_applied`, upload, hata | `e2eLifecycle` / Fastify log; `backend-relevant.log` yönlendirmesi isteğe bağlı |
| **Verify** | `pnpm verify:lifecycle-chain` çıktısı | `verify-lifecycle-chain.txt` |

**Minimum kanıt:** Worker log + BitNet stderr + verify stdout; backend’de webhook satırının görünmesi.

---

## 5) Tur sonu rapor şablonu (iç kullanım)

Trial bittikten sonra doldurun:

- **Ortam stabil miydi?** (süreçler çökmeden benchmark tamamlandı mı)
- **Path / env doğru muydu?** (`R3MES_QA_LLAMA_BASE_URL` port = BitNet; webhook = gerçek `3000` path; slot path ASCII ve `GET /lora-adapters` tutarlı)
- **Checksum kapısı geçti mi?** (§6 — upload öncesi `.gguf` ↔ `.sha256`)
- **Loglar eksiksiz mi?** (runtime + worker + backend kanıtı arşivde)

---

## 6) Başarı kriteri

İlk gerçek BitNet ürün trial’ı **ortam karışıklığı** gerekçesiyle yeniden açılmaz; tartışma **skor / eşik / ürün** düzeyinde kalır.
