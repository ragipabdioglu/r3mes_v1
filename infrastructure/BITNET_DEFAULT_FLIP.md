# BitNet/QVAC — varsayılan runtime’a kontrollü geçiş ve rollback

> **Legacy / R&D notu:** Bu belge tarihî BitNet/QVAC rollout planıdır. Aktif ürün yolu değildir. Güncel resmi yol için [RUNTIME_PROFILES.md](RUNTIME_PROFILES.md), [../docs/LOCAL_DEV.md](../docs/LOCAL_DEV.md) ve [../docs/GOLDEN_PATH_STARTUP.md](../docs/GOLDEN_PATH_STARTUP.md) kullanılmalıdır.

**Durum (2026-04-14 UTC):** **Operasyon gate’leri kapatıldı** (checklist: pin’li Docker burn-in, rollback tatbikatı, L2/verify kanıtları — bkz. [`BITNET_FLIP_FINAL_GATES.md`](BITNET_FLIP_FINAL_GATES.md)). **Bu, üretim ortamında BitNet’in şu anda tek çalışan yük olduğu anlamına gelmez;** prod **ingress / secret / süreç dağıtımı** ayrı yürütme.

**Ayrım (yanlış alarm önlemi):**

| İfade | Anlamı |
|-------|--------|
| **Gate kapandı** | Ön koşullar ve kanıt kutuları işlendi; **release** güvenli denebilir. |
| **Deploy icrası** | Hedef ortamda **gerçekten** yeni runtime env + süreçlerin yürütülmesi (staging veya prod). |
| **Tarihî karar: varsayılan runtime = BitNet/QVAC** | Bu satır yalnız geçmiş rollout kararını anlatır; **güncel ürün varsayılanı değildir**. Aktif durum için `RUNTIME_PROFILES.md` kullanılır. |

**Qwen fallback:** resmi referans yolu; tek kaynak: [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md).

**Bu dosyanın rolü:** Flip **hedefi** sabitleri, release sırası ve **rollback** prosedürü. **Kanıt:** L2 ([`BITNET_L2_STACK.md`](BITNET_L2_STACK.md), [`GGUF_LIFECYCLE_PROOF_FAZ6.md`](../docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md)). Kanon: [INTEGRATION_CONTRACT §3.3.2](../docs/api/INTEGRATION_CONTRACT.md).

---

## 1) Flip sonrası sabitler (hedef düzen)

| Alan | Flip sonrası varsayılan (öneri) |
|------|-----------------------------------|
| **llama port** | **8080** — tek “canonical” inference portu (önceki Qwen ile aynı port; **tek** `llama-server` süreci). |
| **Base GGUF** | Pin’li dosya: **`1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`** (`qvac/fabric-llm-bitnet-finetune`) — ASCII kök, örn. `%ProgramData%\R3MES\runtime\bitnet\` veya Linux `/var/lib/r3mes/runtime/bitnet/` — **Qwen dizininden ayrı** ([`BITNET_QVAC_PRODUCTION_MATRIX.md`](BITNET_QVAC_PRODUCTION_MATRIX.md)). |
| **Adapter / slot 0** | Örn. `tq2_0-biomed-trained-adapter.gguf` → operasyonel `slot0.gguf` yolu — `--lora` ile worker `R3MES_QA_LORA_COPY_TARGET` hizalı. |
| **İkili** | Pin’li qvac `llama-server` + DLL’ler — [`ADR-003`](../docs/adr/ADR-003-bitnet-runtime-compatibility-spike.md) ile uyumlu sürüm. |
| **Log kökü** | `logs/profile-bitnet-default/` (veya `logs/production-llama/`) — eski Qwen logları **`logs/profile-qwen-archive/<tarih>/`** ile arşivlenir. |
| **Worker** | `R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080` + `R3MES_BACKEND_QA_WEBHOOK_URL` gerçek API. |
| **ai-engine** | `R3MES_SKIP_LLAMA=0` (veya politikaya göre), `R3MES_FROZEN_GGUF_LOCAL_PATH` / HF BitNet — **örnek `.env` ve doküman** güncellenir; sırlar repoda tutulmaz. |

**Env anahtarları (özet):** `R3MES_QA_LLAMA_BASE_URL`, `R3MES_BACKEND_QA_WEBHOOK_URL`, `R3MES_QA_WORKER_LOG_FILE`, `R3MES_FROZEN_*` / `R3MES_LLAMA_SERVER_BIN`, `DATABASE_URL` (değişmez), `IPFS_*` / gateway URL’leri.

**Staging/production pin tablosu (tek sayfa):** [`BITNET_PINNED_ENV_MATRIX.md`](BITNET_PINNED_ENV_MATRIX.md).

---

## 2) Release sırası (önerilen)

1. **Donanım/OS:** Hedef ortamda BitNet GGUF + qvac ikilisi **yüklenir ve** `GET /v1/models` **200** (staging).
2. **Konfig:** Dağıtım env şablonunda yukarıdaki sabitler; **Qwen path/port env’leri kaldırılır veya yorum satırı** — karışıklık önlenir.
3. **Deploy:** `llama-server` → 8080; worker + ai-engine env güncelleme **aynı release** veya hemen ardından (kısa pencere).
4. **Duman:** [`BITNET_L2_STACK.md`](BITNET_L2_STACK.md) health + tek upload → verify **PASS**.
5. **Gözlem:** Worker + backend loglarında `qa_webhook_applied` / hata oranı; **rollback tetikleyicileri** aşağı §4.

6. **Doküman:** [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md) §0 tablo — “resmi referans teknik yol” satırı **ORTAK kararla** BitNet’e güncellenir; [`README.md`](README.md) golden path özeti; [`QWEN_ADAPTER_RUN.md`](QWEN_ADAPTER_RUN.md) **“rollback / referans”** olarak işaretlenir (içerik silinmez).

---

## 3) Qwen rollback (tek paragraf)

Rollback’te **tek canonical llama** yeniden Qwen olacak şekilde: BitNet sürecini durdur; base + slot dosyalarını Qwen ASCII yollarına (`%TEMP%\r3mes-gguf\...` veya ekip yolu) geri al veya önceden saklanan disk imajından kopyala; worker ve isteğe bağlı istemcilerde `R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080` **Qwen endpoint**’ine döndür; ai-engine’de `R3MES_SKIP_LLAMA=1` veya Qwen uyumlu `R3MES_FROZEN_GGUF_LOCAL_PATH` önceki değerlere çekilir; önceki `apps/backend-api/.env` / worker env **yedekten** geri yüklenir; `pnpm verify` veya smoke ile API+DB tutarlılığı doğrulanır; dokümanda “varsayılan runtime = Qwen” geri yazılır. Rollback süresi kısa tutulmalı; aynı 8080’de yanlışlıkla iki farklı base model dosyası bırakılmamalı.

---

## 4) Operasyonel riskler

| Risk | Azaltma |
|------|---------|
| **Kısmi deploy** (llama BitNet, worker hâlâ eski URL) | Tek release veya feature flag; health gate. |
| **Çift base dosyası / path** | Flip öncesi Qwen dizinini arşivle veya yeniden adlandır. |
| **Windows path / quant uyumsuzluğu** | Staging’de ADR matrisi; gerekirse Linux-only default. |
| **Doküman drift** | §6 release adımı zorunlu; Slack “resmi” tablo = RUNTIME_PROFILES. |

---

## 5) BitNet default profile “hazır mı?”

**Kod değişikliği bu dosyada yok** — hazırlık **operasyonel + karar**:

- **Teknik hazırlık:** L2 PASS + pin’li ikili + env şablonu + §1 sabitleri yazılmış olmalı.
- **Ürün hazırlığı:** §0 “Geçiş kapısı” ORTAK onayı olmadan **varsayılan flip yapılmaz** (mevcut [RUNTIME_PROFILES.md](RUNTIME_PROFILES.md) ile uyumlu).

---

**Son üç kapı (operasyon checklist):** [`BITNET_FLIP_FINAL_GATES.md`](BITNET_FLIP_FINAL_GATES.md) — pin’li matris, Linux/Docker tekrar üretilebilirlik, rollback tatbiki.

**Başarı kriteri:** Geçiş **plansız tek commit** değil; bu plan + rollback paragrafı + release sırası ile **kontrollü**; geri dönüş **tek paragraftaki** adımlarla mümkün.
