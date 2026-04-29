# Qwen tabanı + slotlu LoRA — tekrarlanabilir çalışma düzeni

**Golden path:** [`README.md`](README.md) (Yerel golden path). **Canlı koşu operatörü:** [`LIVE_RUN.md`](LIVE_RUN.md). Bu dosya **Qwen** ile adapter / QA hattını aynı düzende tekrar etmek içindir.

## 1) Base model ve slot dosya yolları (yerel mutabakat)

| Rol | Örnek (Windows, ASCII) | Not |
|-----|-------------------------|-----|
| **Base (Qwen)** | `infrastructure/docker/models/qwen/qwen2.5-3b-instruct-q5_k_m.gguf` | Aktif ürün tabanı. 0.5B hatları yeni koşular için kullanılmaz. |
| **Slot 0 (placeholder LoRA)** | `C:\r3mes-lora\slot0-placeholder.gguf` | `llama-server` ilk `--lora` ile bu yolu verir; worker IPFS’ten indirdiği GGUF’u **aynı path**’e yazar (`R3MES_QA_LORA_COPY_TARGET` ile aynı yapın). |

**Tek satırlık llama (örnek):**

```text
llama-server.exe -m <BASE_QWEN_3B.gguf> --port 8080 --lora-init-without-apply --lora <SLOT0_PLACEHOLDER.gguf>
```

- İlk `--lora` → **slot id = 0** (worker varsayılanı `R3MES_LORA_SLOT_ID=0`).
- Binary: `infrastructure/llama-runtime/win-x64/`, çalışma dizini bu klasör.

## 2) Artefakt / GGUF doğrulama (kodda ne var?)

**Upload (`POST /v1/adapters`) — weights:**

- Sunucu **GGUF içerik** kontrolünü `validatePrimerGgufWeights` ile yapar: ilk 4 bayt `GGUF`, dosya adı `.gguf`.
- Kaynak: [`apps/backend-api/src/lib/ggufWeightsValidate.ts`](../apps/backend-api/src/lib/ggufWeightsValidate.ts)  
- Birim testler: `apps/backend-api/src/lib/ggufWeightsValidate.test.ts` — `pnpm --filter @r3mes/backend-api exec vitest run src/lib/ggufWeightsValidate.test.ts`

**Manifest (`general.type` vb.):**

- Bu repo yolunda multipart **manifest** isteğe bağlı pinlenir; **backend route’u manifest JSON şemasını `general.type=adapter` diye doğrulamaz** (ağırlık dosyası kanon §3.3.1). Studio / ürün manifest şeması ayrı dokümana bağlanır.
- Kanon referansı: [`docs/api/INTEGRATION_CONTRACT.md`](../docs/api/INTEGRATION_CONTRACT.md) §3.3.1 (LoRA GGUF).

**Lifecycle dumanı (script):**

- `apps/backend-api/scripts/e2e-lifecycle-smoke.mjs` — minimal GGUF sihri ile upload + webhook (ortam gerekir).

## 3) Worker / env (Qwen hattıyla hizalı)

| Env | Değer |
|-----|--------|
| `R3MES_QA_LLAMA_BASE_URL` | `http://127.0.0.1:8080` |
| `R3MES_LORA_SLOT_ID` | `0` (tek `--lora`) |
| `R3MES_QA_LORA_COPY_TARGET` | Slot 0 ile **aynı** dosya yolu (ASCII) |
| `R3MES_QA_WORKER_LOG_FILE` | Örn. `logs/qwen-adapter-run.log` |

## 4) Sağlık ve log (seans boyunca stabil)

- Tek matris: `pwsh -File infrastructure/scripts/faz7-debug-session.ps1`
- Log: `LIVE_RUN.md` §4 ile aynı ilke — worker dosya logu, llama stdout/stderr dosyaya.

Bu düzen aktif ürün için **Qwen2.5-3B doğrulama** tabanını hedefler; BitNet ayrı track olarak [`README.md`](README.md) içinde kalır.
