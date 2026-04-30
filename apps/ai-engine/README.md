# `ai-engine` (`apps/ai-engine`)

## Rol (Faz 8.1)

**FastAPI yalnızca proxy’dir:** PyTorch / tensör hesabı yok. Ağır yük `llama-server` (C++) üzerindedir.

- **Startup:** Varsayılan Qwen2.5-3B GGUF Hugging Face URL veya yerel yol ile çözülür; ardından `llama-server` subprocess olarak başlatılır (`--lora-init-without-apply`).
- **`POST /v1/chat/completions`:** Base-only Qwen chat birinci sınıf senaryodur. İstekte `adapter_cid` verilirse behavior LoRA **.gguf** IPFS’ten indirilir → `http://127.0.0.1:<port>/lora-adapters` ile hot-swap → gövde upstream `llama-server` OpenAI uyumlu uca proxylanır; **stream** desteklenir.

**Adapter formatı:** IPFS’ten tek dosya olarak gelen artefaktın **llama.cpp uyumlu LoRA GGUF** (`.gguf`) olması gerekir; `lora-adapters` ile yüklenebilen başka bir dosya formatı bu yol üzerinde desteklenmez.

**Ürün (tek kaynak):** “Chat neden base modelle (LoRA’sız) çalışmıyor?” — **[INTEGRATION_CONTRACT §3.5.1](../../docs/api/INTEGRATION_CONTRACT.md)**. **Adapter-only** bilinçli **feature-gap**tir; **bug** olarak triage edilmez.

### İstek sözleşmesi (inference surface)

| Alan | Zorunlu | Açıklama |
|------|---------|----------|
| `messages` | evet | OpenAI ile aynı |
| `adapter_cid` | hayır | Behavior LoRA `.gguf` artefaktının **IPFS CID** değeri (ör. `Qm…`, `bafy…`). Yoksa base-only Qwen chat çalışır. |
| `stream` | hayır | SSE akışı |
| `system_context` / `retrieved_context` | hayır | Backend’in assemble ettiği ek bağlam |

Doğrudan bu servise giden istemciler base-only veya optional `adapter_cid` ile konuşabilir. Veritabanı `adapterId` gibi tanımlayıcılar backend katmanında çözülür.

Örnek gövde:

```json
{
  "model": "qwen2.5-3b-instruct-gguf",
  "messages": [{ "role": "user", "content": "Merhaba" }],
  "stream": false
}
```

### Hata yanıtları (proxy / hot-swap)

Çıkarım başarısız olduğunda `detail` (JSON) alanları:

| Alan | Açıklama |
|------|-----------|
| `stage` | `llama_process` · `adapter_download` · `lora_hot_swap` · `upstream_completion` |
| `category` | `local_runtime` · `artifact_fetch` · `llama_inference` — operasyonel sınıf |
| `retryable` | İstemci / orchestrator için ipucu (boolean) |
| `message` | İnsan okunur açıklama |
| `adapter_cid` | İstekteki CID |
| `cause` | İsteğe bağlı: `timeout`, `http_status`, `transport`, `os_error`, `unknown` |
| `upstream_status` / `upstream_url` | llama HTTP hatalarında |

| HTTP | `stage` (örnek) | Anlam |
|------|-------------------|--------|
| 503 | `llama_process` | `R3MES_SKIP_LLAMA` değilken llama süreci yok |
| 502 | `adapter_download` | IPFS gateway üzerinden GGUF indirilemedi |
| 502 | `lora_hot_swap` | `lora-adapters` HTTP hatası (llama reddetti) |
| 503 | `lora_hot_swap` | llama-server’a bağlanılamadı |
| 502 / 503 | `upstream_completion` | `/v1/chat/completions` upstream hatası |

### Gözlemlenebilirlik

- İsteğe bağlı **`X-Request-ID`** başlığı log satırındaki `request_id` ile eşleşir.
- **Non-stream** başarılı yanıtlar: `X-R3MES-Adapter-Cache` (`hit`/`miss`), `X-R3MES-Lock-Wait-Ms`, `X-R3MES-Adapter-Resolve-Ms`, `X-R3MES-Lora-Swap-Ms`, `X-R3MES-Lora-Slot`.
- **Stream:** tam süre başlıkta yok; aynı özet sunucu loglarında `r3mes_inference` ile yazılır (`X-R3MES-Diagnostics: see_server_logs`).

Önbellek, lock ve hot-swap davranışının özeti: [docs/ADAPTER_CACHE_AND_SWAP.md](docs/ADAPTER_CACHE_AND_SWAP.md).

### Seri LoRA kullanımı

Aynı anda tek istek LoRA yükleme + tamamlama yapar (`asyncio.Lock`); eşzamanlı istekler sıraya girer. Bekleme süresi log’da `lock_wait_ms` olarak görünür.

## Ortam değişkenleri (özet)

| Değişken | Açıklama |
|----------|-----------|
| `R3MES_SKIP_LLAMA` | `true`: test / geliştirme; llama subprocess başlatılmaz; chat yine de şema ve route için çağrılabilir (proxy mock ile test) |
| `R3MES_IPFS_GATEWAY` | GGUF indirme (varsayılan 9080 — 8080 çakışmasını önlemek için) |
| `R3MES_FROZEN_CORE_CID` | Donmuş model IPFS CID |
| `R3MES_FROZEN_CORE_HF_URL` | Varsayılan Qwen GGUF HF indirme URL’i |
| `R3MES_LLAMA_INTERNAL_PORT` | `llama-server` portu (varsayılan 8080) |
| `R3MES_ADAPTER_CACHE_DIR` | LoRA .gguf önbelleği |

## Docker

`Dockerfile.ai-engine`: Ubuntu, `llama-bin-ubuntu-x64.zip` indirme, `llama-server` / `llama-finetune-lora` kurulumu, FastAPI `uvicorn` 8000.

## Kurulum (yerel)

```bash
cd apps/ai-engine
python -m venv .venv
pip install -e ".[dev]"
python -m pytest -q
```

Operasyonel smoke senaryoları (`stage`/`category`/`cause` ayrıştırması, lock, indirme retry): `tests/test_proxy_operational.py`, `tests/test_http_download_retries.py`, `tests/test_error_shape_parity.py`.

**Canlı ürün öncesi:** [docs/RUNBOOK.md](docs/RUNBOOK.md), [docs/LIVE_SMOKE.md](docs/LIVE_SMOKE.md) — `scripts/smoke_ai_engine.py` (`--prove-inference` ile çıkarım + cache kanıtı; çıkış kodları 0–5).

## BGE-M3 embedding smoke

Qdrant RAG v2 için backend `R3MES_EMBEDDING_PROVIDER=ai-engine` kullanıyorsa ai-engine `/v1/embeddings` endpoint'i açık olmalıdır. Embedding smoke, gerçek BGE-M3 çalışmadığında deterministic fallback'i yakalar.

Windows yerel kullanım:

```powershell
pnpm ai-engine:embedding
```

Ayrı terminalde:

```powershell
$env:R3MES_REQUIRE_REAL_EMBEDDINGS='1'
pnpm --filter @r3mes/backend-api run smoke:embedding-provider
Remove-Item Env:R3MES_REQUIRE_REAL_EMBEDDINGS
```

Beklenen sonuç:

```json
{
  "diagnostics": {
    "actualProvider": "ai-engine",
    "fallbackUsed": false,
    "dimension": 1024
  },
  "passed": true
}
```

Eğer `fallbackUsed: true` görünürse Qdrant reindex yapılmamalıdır; önce ai-engine sağlık, BGE-M3 local path ve `R3MES_EMBEDDING_LOCAL_FILES_ONLY` ayarları kontrol edilmelidir.

## CLI

`model_loader.py` — bayt düzeyinde IPFS / HTTP indirme ölçümü.

## Legacy notu

BitNet/QVAC referansları repoda yalnız eski R&D izi olarak kalır. Bu servis için ürün golden path’i Qwen2.5-3B + retrieved context + optional behavior LoRA’dır.
