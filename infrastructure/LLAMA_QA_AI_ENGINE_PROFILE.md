# Llama / QA worker / AI engine — tek çalışan profil tablosu

**Amaç:** `R3MES_QA_LLAMA_BASE_URL` (QA worker) ile AI engine’in llama sürecine verdiği host/port’un **aynı HTTP uç noktayı** göstermesi; `R3MES_AI_ENGINE_URL` ile karışmaması.

**Önemli ayrım**

| Kavram | Ne |
|--------|-----|
| **`R3MES_AI_ENGINE_URL`** | Backend **FastAPI AI engine** tabanı (ör. `http://127.0.0.1:8000`). Chat proxy buraya gider; **llama değildir**. |
| **Llama HTTP tabanı** | `llama-server` OpenAI uyumlu API (`/v1/chat/completions`, `/lora-adapters`). Worker **`R3MES_QA_LLAMA_BASE_URL`** ile buraya bağlanır. AI engine içinde adres `R3MES_LLAMA_INTERNAL_HOST` + `R3MES_LLAMA_INTERNAL_PORT` ile üretilir (`llama_bootstrap._llama_base`). |

**Tek satırda hizalama (yerel tek makine):**

`R3MES_QA_LLAMA_BASE_URL` = `http://<R3MES_LLAMA_INTERNAL_HOST>:<R3MES_LLAMA_INTERNAL_PORT>`  
Varsayılanlar eşleşirse: `http://127.0.0.1:8080`.

---

## Çalışan profil tablosu (mevcut pipeline — yeni endpoint/model eklenmez)

| Bileşen | Ortam anahtarı | Varsayılan | Port / adres | İkili / model yolu | `--lora` slot |
|--------|-----------------|------------|----------------|---------------------|---------------|
| **Backend → AI engine** | `R3MES_AI_ENGINE_URL` | `http://127.0.0.1:8000` | **8000** (HTTP API) | — | — |
| **AI engine → llama (iç)** | `R3MES_LLAMA_INTERNAL_HOST`, `R3MES_LLAMA_INTERNAL_PORT` | `127.0.0.1`, **8080** | **8080** | `R3MES_LLAMA_SERVER_BIN` (örn. `llama-server`), `-m` = donmuş GGUF (`R3MES_FROZEN_*` / cache) | `R3MES_LORA_ADAPTER_SLOT_ID` (ai-engine) |
| **QA worker → llama** | `R3MES_QA_LLAMA_BASE_URL` | `http://127.0.0.1:8080` | **8080** (worker’un gördüğü ile ai-engine iç host/port aynı olmalı) | Worker GGUF’u IPFS’ten indirir; hedef dosya `R3MES_QA_LORA_COPY_TARGET` veya `GET /lora-adapters` path (**sunucudaki `--lora` ile aynı dosya**) | `R3MES_LORA_SLOT_ID` (worker) — **ai-engine’deki slot ile aynı indeks** |

**Not (LoRA üretim QA):** Repo’daki `start_llama_server` komutu donmuş modele `-m` ve isteğe bağlı `--lora-init-without-apply` içerir; **üretimde** llama sürecinin en az bir **`--lora <yol.gguf>`** ile başlaması gerekir (worker dosyayı bu yola kopyalar). Bu tablo yalnızca mevcut tasarımı sabitler; yeni binary veya model eklenmez.

---

## Windows + ASCII yol kısıtı

- **`--lora` dosya yolu**, **`R3MES_QA_LORA_COPY_TARGET`** ve IPFS’ten indirilen GGUF’un yazıldığı hedef: **yalnızca ASCII** karakter kullanın (Türkçe veya boşluk içeren `OneDrive\Masaüstü` vb. yollar `llama-server` / alt süreçlerde sorun çıkarabilir).
- Mümkünse kısa bir kök altında çalışın (örn. `C:\r3mes\lora\slot0.gguf`).

---

## “FAILED” semantiği (webhook)

Backend `/v1/internal/qa-result` yalnızca `status === "approved"` ile **onay** ayırır; altyapı veya skor reddi **`status: "rejected"`** + **`error`** alanı ile gelir — operasyonel olarak **başarısız QA job** budur. Ayrıntılı aşama için worker `metrics.failure_stage` ve `metrics.qa_outcome` kullanır (`packages/qa-sandbox/worker`).
