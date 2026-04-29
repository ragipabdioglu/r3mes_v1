# `r3mes-qa-worker` (Python)

## Rol (Faz 8.1)

Mock metin üretimi **kaldırıldı.** Skorlar, **llama-server** üzerinden alınan **gerçek model yanıtları** ile referans metinler arasında **ROUGE-L** ve **BLEU** hesaplanarak üretilir (`compare_base_vs_adapters.py` mantığına paralel: üretim **HTTP** ile, PyTorch yok).

Akış:

1. IPFS’ten adaptör **.gguf** indir.
2. **llama-server** süreci en az bir LoRA ile başlamış olmalı (`--lora <yol.gguf>`; isteğe bağlı `--lora-init-without-apply`). `POST /lora-adapters` gövdesi yalnızca **`id` + `scale`** içerir (llama.cpp `parse_lora_request`); yeni dosya yolu HTTP ile kayıt edilmez. Worker, indirilen GGUF’u `GET /lora-adapters`’daki (veya `R3MES_QA_LORA_COPY_TARGET`) dosya yolunun üzerine kopyalar, ardından ölçeği yazar.
3. Gizli veri setindeki her `prompt` için `POST .../v1/chat/completions` (`stream: false`).
4. ROUGE/BLEU → baraj → webhook.

## Ortam

**Tek profil (worker ↔ ai-engine ↔ backend URL):** [`infrastructure/LLAMA_QA_AI_ENGINE_PROFILE.md`](../../../infrastructure/LLAMA_QA_AI_ENGINE_PROFILE.md) — `R3MES_QA_LLAMA_BASE_URL` ile `R3MES_AI_ENGINE_URL` ayrımı, port, slot, Windows ASCII yolu.

| Değişken | Açıklama |
|----------|-----------|
| `R3MES_QA_WEBHOOK_SECRET` | Backend `apps/backend-api/.env` ile **aynı** HMAC sırrı; `packages/qa-sandbox/worker/.env` içinde tanımlanmalı (bkz. `.env.example`) |
| `R3MES_QA_LLAMA_BASE_URL` | Çalışan `llama-server` tabanı (varsayılan `http://127.0.0.1:8080`) |
| `R3MES_QA_LORA_COPY_TARGET` | (İsteğe bağlı) İndirilen LoRA’nın kopyalanacağı mutlak yol; `--lora` ile aynı dosya olmalı |
| `R3MES_LORA_SLOT_ID` | `--lora` listesindeki sıra (ilk adaptör = `0`, varsayılan `0`) |
| `R3MES_IPFS_DOWNLOAD_CONNECT_TIMEOUT_SEC` | IPFS gateway bağlantı zaman aşımı (saniye, varsayılan `30`) |
| `R3MES_IPFS_DOWNLOAD_READ_TIMEOUT_SEC` | IPFS gövde okuma zaman aşımı (saniye, varsayılan `600`) |

## Test

```bash
python -m pytest -q
```
