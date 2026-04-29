# BitNet lifecycle koşusu — Qwen hattını kirletmeden

> **Legacy / R&D notu:** Bu koşu artık aktif golden path değildir. Yalnız eski lifecycle kayıtlarını veya BitNet denemelerini tekrarlamak için kullanılmalıdır.

**Resmi referans:** Qwen + [`QWEN_ADAPTER_RUN.md`](QWEN_ADAPTER_RUN.md) + **8080**.  
**Deneysel BitNet/QVAC:** bu dosya + [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md) §0.  
**Kısa smoke:** [`QVAC_SMOKE_PROFILE.md`](QVAC_SMOKE_PROFILE.md).  
**Canlı lifecycle kanıt şablonu:** [`docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md`](../docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md).

**L2 (gerçek ürün koşusu — mock yok):** [`BITNET_L2_STACK.md`](BITNET_L2_STACK.md) — backend **3000** webhook, aynı Postgres, `verify:lifecycle-chain`.

Bu koşu **upload → kuyruk → worker → webhook → (isteğe bağlı) chat** zincirini BitNet profilinde yürütür; **Qwen dosyaları, 8080 varsayılanı ve `logs/profile-qwen/`** ile paylaşılmaz.

---

## 1) BitNet profile — sabitler (bu koşu için)

| Alan | Sabit değer / şablon | Not |
|------|----------------------|-----|
| **llama port** | **8081** | Qwen **8080** ile çakışmaz. |
| **Base GGUF path** | `%TEMP%\r3mes-bitnet-lifecycle\ggml-model-i2_s.gguf` (veya aynı mantıkta **ASCII** tek dizin) | Qwen `...\r3mes-gguf\qwen*.gguf` ile **aynı klasörü kullanmayın**. |
| **Adapter / slot 0 placeholder** | `%TEMP%\r3mes-bitnet-lifecycle\slot0-lora-placeholder.gguf` | `--lora` ile başlat; worker `R3MES_QA_LORA_COPY_TARGET` aynı path. |
| **Log kökü** | **`logs/profile-bitnet-lifecycle/`** | Alt: `llama-8081-stdout.log`, `llama-8081-stderr.log`, `worker.log`, isteğe bağlı `notes.txt`. |
| **Worker** | `R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8081` | Yalnız bu koşu terminalinde veya `worker/.env.bitnet-lifecycle` (commit etme). |
| **Worker dosya logu** | `R3MES_QA_WORKER_LOG_FILE=logs/profile-bitnet-lifecycle/worker.log` | Repo kökünden göreli veya mutlak ASCII path. |
| **ai-engine (isteğe bağlı)** | BitNet tabanını test edecekseniz ayrı env: `R3MES_FROZEN_GGUF_LOCAL_PATH` → yukarıdaki base path; **`apps/ai-engine/.env` üzerine kalıcı yazmayın** — kopya dosya kullanın. |

**llama komutu (şablon):**

```text
cd infrastructure\llama-runtime\win-x64
.\llama-server.exe -m %TEMP%\r3mes-bitnet-lifecycle\ggml-model-i2_s.gguf --port 8081 --lora-init-without-apply --lora %TEMP%\r3mes-bitnet-lifecycle\slot0-lora-placeholder.gguf
```

*(PowerShell’de `%TEMP%` yerine `$env:TEMP\...` kullanın.)*

---

## 2) Qwen ile ezilme kontrolü (koşu öncesi / sonrası)

| Kaynak | Qwen (dokunulmaz) | BitNet lifecycle (yalnız bu koşu) |
|--------|-------------------|-----------------------------------|
| Port | **8080** | **8081** |
| Base GGUF dizini | `...\r3mes-gguf\` (örnek) | `...\r3mes-bitnet-lifecycle\` |
| Placeholder LoRA | Qwen hattındaki dosya | **Ayrı** `slot0-lora-placeholder.gguf` |
| Log | `logs/profile-qwen/` veya mevcut | `logs/profile-bitnet-lifecycle/` |
| Worker URL | `http://127.0.0.1:8080` | `http://127.0.0.1:8081` (yalnız seans) |

**Doğrulama:**

1. `dir` / Explorer ile iki base dizinin **aynı `.gguf` dosyasını paylaşmadığını** kontrol edin.  
2. Koşu sonrası `apps/backend-api/.env`, `apps/ai-engine/.env`, `packages/qa-sandbox/worker/.env` içinde **BitNet’e özel kalıcı satır kalmadığını** doğrulayın (gerekirse yedekten geri yükleyin).  
3. Qwen doğrulama: `curl -fsS http://127.0.0.1:8080/v1/models` → **200** (Qwen llama ayaktaysa).

---

## 3) Lifecycle adımları (özet)

1. Altyapı: Docker (Postgres, Redis, gateway) — [`README.md`](README.md) bootstrap.  
2. BitNet llama **8081** + §1 log yönlendirmesi.  
3. Backend + (gerekirse) ai-engine — wallet/IPFS için mevcut demo akışı; worker **8081** env ile.  
4. Kanıt: `GGUF_LIFECYCLE_PROOF_FAZ6.md` tablosu + bu klasördeki loglar.

Koşu bitince: **§2 geri dönüş**, [`QVAC_SMOKE_PROFILE.md`](QVAC_SMOKE_PROFILE.md) §4 ile uyumlu (8081 kapat, worker URL 8080).

---

## 4) Tekrar üretilebilirlik

- Aynı sabitler tablosu + aynı dizin adları + aynı port **8081** → koşu tekrarlanır.  
- Ortam farklıysa (Linux): port ve path’leri koruyun, ikili yolu güncelleyin.  
- Windows’ta BitNet GGUF **yüklenemezse** bu bir **BitNet/ikili uyumu** sorunudur; Qwen referansı etkilenmez ([`QVAC_SMOKE_PROFILE.md`](QVAC_SMOKE_PROFILE.md) §5).
