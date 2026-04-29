# ai-engine — kısa runbook (Faz 6)

**Amaç:** Release öncesi ve arıza anında **hızlı teşhis** — ek telemetry sistemi yok.

## Release öncesi checklist

1. `R3MES_SKIP_LLAMA` üretimde **kapalı**; llama + IPFS gateway erişilebilir.
2. `python scripts/smoke_ai_engine.py --health-only` → çıkış `0`.
3. Onaylı LoRA CID ile: `python scripts/smoke_ai_engine.py --prove-inference --json` → `live_proof.completion_verified`, idealde `cache_pattern: miss_then_hit`.
4. Tek istek: `python scripts/smoke_ai_engine.py --json` → `chat_status: 200`, `assistant_preview` dolu.
5. İsteğe bağlı yük: `--concurrent 5` → lock farkı veya log’da `lock_wait_ms`.
6. Backend kullanıyorsanız: aynı senaryo backend üzerinden (auth + CID çözümlemesi ayrı).

Canlı kanıt ayrıntısı: [LIVE_SMOKE.md](LIVE_SMOKE.md).

## Smoke script (karar desteği)

| Çıkış | Anlam |
|-------|--------|
| `0` | Health (+ varsa chat) başarılı |
| `1` | Health başarısız |
| `2` | CID verilmedi, chat atlandı |
| `3` | Health tamam, chat HTTP hatası (`detail`) |
| `4` | HTTP 200 ama completion gövdesi kanıtlanamadı |
| `5` | `--prove-inference` ile `--concurrent` > 1 |

```bash
python scripts/smoke_ai_engine.py --health-only
python scripts/smoke_ai_engine.py --json
python scripts/smoke_ai_engine.py --concurrent 5
```

`--json` son satırda `JSON_SUMMARY: {...}` — `triage`, `triage_hint`, eşzamanlı koşuda `lock_wait_ms` min/max.

`X-Request-ID`: `--request-id` veya `R3MES_SMOKE_REQUEST_ID` (ai-engine log ile eşleştirme).

## Sorumluluk

| Katman | Rol |
|--------|-----|
| **Backend** | Auth, ücret, `adapter_id` → **`adapter_cid`**, sonra `R3MES_AI_ENGINE_URL` |
| **ai-engine** | Sadece **`adapter_cid`** ile LoRA + llama |

## Hata gövdesi: backend mi, ai-engine mi?

| Kaynak | Gövde (tipik) | Ne zaman |
|--------|----------------|----------|
| **ai-engine** (FastAPI proxy) | `{"detail": {"stage", "category", "cause", ...}}` | Upstream doğrudan ai-engine veya backend bu JSON’u **olduğu gibi** iletirse |
| **Backend** (çözümleme, auth) | `{"error": "...", "message": "..."}` | CID çözülemedi, cüzdan, ücret vb. |

`chatProxy` ai-engine yanıtını ham iletir; **502/503** ile gelen `detail` ai-engine triage’idir. **401 / 402 / 4xx** backend kurallarından da gelebilir — önce HTTP status ve gövde anahtarlarına bakın (`detail` vs `error`).

## ai-engine triage (detail içi)

| `stage` | Bakılacak yer |
|---------|----------------|
| `adapter_download` | Gateway, CID, `R3MES_IPFS_*` |
| `lora_hot_swap` | `.../lora-adapters` |
| `upstream_completion` | llama `.../v1/chat/completions` |
| `llama_process` | llama süreci, `skip_llama` |

Stream/non-stream aynı `detail` şekli: `tests/test_error_shape_parity.py`.

## Cache / lock (temel yük)

- Aynı CID ikinci istekte `X-R3MES-Adapter-Cache: hit` beklenir (ilk `miss` normal).
- Global lock: eşzamanlı isteklerde biri düşük diğeri yüksek `X-R3MES-Lock-Wait-Ms` — sıralama kanıtı. Ayrıntı [ADAPTER_CACHE_AND_SWAP.md](ADAPTER_CACHE_AND_SWAP.md).

## Otomasyon özeti

| Dosya | Ne |
|-------|-----|
| `scripts/smoke_ai_engine.py` | Canlı smoke + JSON özet |
| `tests/test_proxy_operational.py` | Lock / mock operasyonel |
| `tests/test_error_shape_parity.py` | Hata şekli paritesi |
