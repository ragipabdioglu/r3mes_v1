# BitNet/QVAC — staging / production pin’li env matrisi

> **Legacy / R&D notu:** Bu env matrisi yalnız BitNet/QVAC tarihî dağıtım profili içindir. Güncel MVP deployment varsayılanı değildir.

**Teknik pin (qvac + GGUF):** [`BITNET_QVAC_PRODUCTION_MATRIX.md`](BITNET_QVAC_PRODUCTION_MATRIX.md) — bu dosya **dağıtım env + yol + port + log** düzenini sabitler.

**Fallback:** [`QWEN_ADAPTER_RUN.md`](QWEN_ADAPTER_RUN.md) — Qwen pin’leri BitNet satırlarından **ayrı** tutulur; aynı host’ta yan yana testte Qwen **8080**, BitNet **8081** ([`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md) §2).

---

## 1) Ortak artefakt pin’i (staging = production)

| Alan | Staging | Production | Not |
|------|---------|------------|-----|
| **qvac release** | `b7349` | `b7349` | Zip: `llama-b7349-bin-ubuntu-x64.zip` (Linux) |
| **Build log (stderr)** | `build: 7349 (b73e75af)` | aynı | `llama-server` başlangıç çıktısı |
| **Base GGUF (HF)** | `qvac/fabric-llm-bitnet-finetune` / `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` | aynı | ~912 MB; **TQ2_0** |
| **Adapter örnek pin** | `tq2_0-biomed-trained-adapter.gguf` → slot0 | aynı | Tek dosya LoRA GGUF; worker `R3MES_QA_LORA_COPY_TARGET` ile hizalı |
| **Yasaklı ikili** | `microsoft/.../ggml-model-i2_s.gguf` + b7349 | aynı | Matris dışı — kanıtlı uyumsuzluk |

**SHA256 / imza:** Repoda pin satırları: [`BITNET_CHECKSUM_ARCHIVE.md`](BITNET_CHECKSUM_ARCHIVE.md) + [`docker/SHA256SUMS.bitnet-pin.txt`](docker/SHA256SUMS.bitnet-pin.txt); üretimde ayrıca secret store / wiki (Kapı 1 — [`BITNET_FLIP_FINAL_GATES.md`](BITNET_FLIP_FINAL_GATES.md)).

---

## 2) Port / path / log (flip sonrası varsayılan: BitNet tek canonical llama)

Aynı host’ta **tek** `llama-server` süreci; **8080** canonical inference (BitNet default flip tamamlandığında).

| Alan | Staging (öneri) | Production (öneri) |
|------|------------------|---------------------|
| **llama HTTP** | `http://127.0.0.1:8080` veya iç DNS | ingress / sidecar ile aynı mantık |
| **Linux base dizin** | `/var/lib/r3mes/runtime/bitnet/` | `/var/lib/r3mes/runtime/bitnet/` |
| **Base dosya adı** | `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` | aynı |
| **Slot0 (placeholder)** | `/var/lib/r3mes/runtime/bitnet/slot0.gguf` | aynı |
| **Log kökü** | `/var/log/r3mes/profile-bitnet-default/` | aynı veya merkezi log aracı |
| **llama stderr** | örn. `.../llama-stderr.log` | aynı düzen |
| **Docker (yerel repro)** | bind: `infrastructure/docker/models/bitnet` → `/models` | aynı dosya adları; host yolu operasyonel |

**Qwen fallback (ayrı pin satırı — BitNet ile aynı path kullanılmaz):**

| Alan | Değer |
|------|--------|
| Base GGUF | `qwen2.5-0.5b-instruct-q4_k_m.gguf` (ör.; ekip pin’i) |
| Port (rollback sonrası tek süreç) | **8080** — BitNet durdurulduktan sonra Qwen aynı porta |
| Log | `/var/log/r3mes/profile-qwen/` veya `logs/profile-qwen/` |

---

## 3) Worker / ai-engine env (ortam başına secret store’da)

| Değişken | BitNet default (flip sonrası) | Qwen rollback |
|----------|-------------------------------|---------------|
| `R3MES_QA_LLAMA_BASE_URL` | BitNet `llama-server` taban URL | Qwen `llama-server` taban URL |
| `R3MES_QA_MODEL_NAME` | `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` | Qwen model adı (ör. `...q4_k_m.gguf`) |
| `R3MES_QA_LORA_COPY_TARGET` | slot0 yolu (ASCII) | Qwen slot0 yolu |
| `R3MES_LORA_SLOT_ID` | `0` | `0` |
| `R3MES_SKIP_LLAMA` (ai-engine) | `0` veya politika | Qwen ile uyumlu |
| `R3MES_FROZEN_GGUF_LOCAL_PATH` / HF | BitNet base | Qwen base |

Backend: `R3MES_AI_ENGINE_URL` — [`RELEASE_RUNTIME_FLIP_BITNET_DEFAULT.md`](../apps/backend-api/docs/RELEASE_RUNTIME_FLIP_BITNET_DEFAULT.md) §3.

---

## 4) Sağlık (flip sonrası kayıt için minimum)

| Kontrol | Beklenti |
|---------|----------|
| `GET /v1/models` | 200 |
| `GET /lora-adapters` | 200; slot 0 path tutarlı |
| Worker + `verify:lifecycle-chain` | ortam hazırsa PASS ([`BITNET_L2_STACK.md`](BITNET_L2_STACK.md)) |

**Docker repro:** [`docker-compose.bitnet-qvac.yml`](docker/docker-compose.bitnet-qvac.yml) + `Dockerfile.bitnet-qvac`.
