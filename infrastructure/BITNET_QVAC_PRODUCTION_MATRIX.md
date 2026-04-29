# BitNet / QVAC — resmi üretim matrisi (pin’li teknik satır)

> **Legacy / R&D notu:** Bu matris tarihî BitNet/QVAC pin kaydıdır. Güncel ürün runtime pin’i olarak okunmamalıdır.

**Amaç:** “Yanlış BitNet dosyası / yanlış ikili” kaynaklı sessiz kırılmaları kesmek. Bu dosya **tek onaylı kombinasyon**u tanımlar; sapma = **desteklenmez** (yeni spike gerekir).

**İlişkili:** [BITNET_L2_STACK.md](BITNET_L2_STACK.md), [ADR-003](../docs/adr/ADR-003-bitnet-runtime-compatibility-spike.md), [RUNTIME_PROFILES.md](RUNTIME_PROFILES.md).

---

## Tek satırlık kanon (kopyala-yapıştır kontrol listesi)

```text
qvac-fabric-llm.cpp@b7349 + llama-b7349-bin-<OS>-<arch>.zip | HF:qvac/fabric-llm-bitnet-finetune/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf (~912MB) | LoRA: aynı org’dan TQ2 adapter GGUF (örn. tq2_0-biomed-trained-adapter.gguf ~30MB) | ASLA: microsoft/bitnet-b1.58-2B-4T-gguf/ggml-model-i2_s.gguf + bu b7349 ikilisi
```

---

## 1) Exact binary (runtime)

| Alan | Üretim değeri |
|------|----------------|
| **Proje / hat** | [tetherto/qvac-fabric-llm.cpp](https://github.com/tetherto/qvac-fabric-llm.cpp) |
| **Release etiketi (pin)** | **`b7349`** |
| **Derleme kimliği (log)** | `build: 7349 (b73e75af)` — `llama-server` stderr’de görünür |
| **Windows x64 (CPU)** | `llama-b7349-bin-win-cpu-x64.zip` — [doğrudan indir](https://github.com/tetherto/qvac-fabric-llm.cpp/releases/download/b7349/llama-b7349-bin-win-cpu-x64.zip) |
| **Linux x64 (CPU, üretim önerisi)** | `llama-b7349-bin-ubuntu-x64.zip` — [doğrudan indir](https://github.com/tetherto/qvac-fabric-llm.cpp/releases/download/b7349/llama-b7349-bin-ubuntu-x64.zip) |
| **Çıkarılan giriş noktası** | `llama-server` (zip kökünde; **tüm DLL’ler aynı dizinde** çalıştırılmalı) |

**Not:** Vulkan/HIP/SYCL vb. diğer zip’ler **aynı b7349** ailesidir; üretimde **hedef donanıma göre** seçilir — matris satırına eklenince yeni bir “pin satırı” oluşturun (OS + backend + zip adı).

---

## 2) Exact base GGUF

| Alan | Üretim değeri |
|------|----------------|
| **Hugging Face repo** | `qvac/fabric-llm-bitnet-finetune` |
| **Dosya adı (pin)** | **`1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`** |
| **Beklenen boyut (referans)** | **~911 870 016 bayt** (~912 MB) |
| **Quant / format** | **TQ2_0** (BitNet b1.58 XL — tam model dosyası) |
| **Model adı (`/v1/chat/completions` `model`)** | `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` |

**Yasaklı kombinasyon (bu matris dışı):**  
`microsoft/bitnet-b1.58-2B-4T-gguf` / `ggml-model-i2_s.gguf` — **b7349** `llama-server` ile yapılan kanıtta **tensor okuma hatası** (IQ4 blok uyumsuzluğu). Bu dosya **bu ikili pin’i ile üretimde kullanılmaz**; farklı ikili/sürüm spike’ı olmadan yükleme yapılmaz.

---

## 3) Exact adapter beklentisi (LoRA GGUF)

| Alan | Üretim kuralı |
|------|----------------|
| **Biçim** | Tek dosya **LoRA GGUF** — backend `validatePrimerGgufWeights` + worker IPFS yolu ile uyumlu ([INTEGRATION_CONTRACT §3.3.1](../docs/api/INTEGRATION_CONTRACT.md)) |
| **Mimari uyumu** | **TQ2** taban ile uyumlu BitNet LoRA (kök model ile aynı eğitim hattı ailesi) |
| **Örnek pin (kanıtlanmış)** | `qvac/fabric-llm-bitnet-finetune` / **`tq2_0-biomed-trained-adapter.gguf`** |
| **Referans boyut** | **~29 970 080 bayt** (~30 MB) |
| **Yanlış örnek** | Qwen veya başka mimari için üretilmiş `convert_lora_to_gguf` çıktıları **BitNet tabanına takılmaz** |

**Slot:** `llama-server ... --lora <path\to\slot0.gguf> --lora-init-without-apply` — worker indirdiği dosyayı bu yolun üzerine yazar ([worker README](../packages/qa-sandbox/worker/README.md)).

---

## 4) Exact smoke komutu (çıkarım)

Aynı dizinde `llama-server` + DLL’ler; **ASCII yol** önerilir.

**Windows (PowerShell):**

```powershell
$exe = ".\llama-server.exe"
$base = "C:\path\to\1bitLLM-bitnet_b1_58-xl-tq2_0.gguf"
$slot = "C:\path\to\bitnet_slot0.gguf"
Copy-Item -Force "C:\path\to\tq2_0-biomed-trained-adapter.gguf" $slot
& $exe -m $base --lora $slot --lora-init-without-apply --port 8090
```

**Minimum HTTP doğrulama (sırayla):**

```text
GET  http://127.0.0.1:8090/v1/models          → 200
GET  http://127.0.0.1:8090/lora-adapters      → 200, id 0, path == slot
POST http://127.0.0.1:8090/v1/chat/completions → 200 (model: 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf)
POST http://127.0.0.1:8090/lora-adapters      → 200 (ör. {"success":true})
```

---

## 5) Exact lifecycle komutu (ürün L2 — özet)

Tam satır: [BITNET_L2_STACK.md §2–§4](BITNET_L2_STACK.md) — özet:

1. Postgres + Redis + gateway **9080** + **backend-api 3000** + `R3MES_QA_WEBHOOK_SECRET` hizalı  
2. Yukarıdaki **BitNet llama** (tercihen **8081**, Qwen’den ayrı)  
3. Worker: `R3MES_BACKEND_QA_WEBHOOK_URL`, `R3MES_QA_LLAMA_BASE_URL`, `R3MES_IPFS_GATEWAY`, `R3MES_QA_MODEL_NAME=1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`  
4. Upload sonrası: `pnpm verify:lifecycle-chain -- --adapter-id <id> --job-id <benchmarkJobId>`

---

## 6) Matris dışı kalan her şey

- Farklı **release etiketi** (≠ `b7349`)  
- Farklı **base** dosyası (özellikle Microsoft `ggml-model-i2_s.gguf` bu pin ile)  
- **Uyumsuz** LoRA (Qwen adapter’ı BitNet’e)  

→ **Yeni doğrulama turu**; bu dosyadaki tek satır **otomatik genişlemez**.

---

**Dosya sürümü:** üretim pin’i değişince bu belge ve üstteki **tek satır** birlikte güncellenir.
