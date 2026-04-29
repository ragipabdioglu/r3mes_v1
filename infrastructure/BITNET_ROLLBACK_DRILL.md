# BitNet → Qwen rollback tatbikatı (operasyon)

> **Legacy / R&D notu:** Bu belge eski BitNet varsayılanı için tarihî rollback tatbikatıdır. Aktif ürün varsayılanı zaten Qwen2.5-3B + RAG olduğu için release/golden path kapısı değildir.

**Bağlam:** [`BITNET_DEFAULT_FLIP.md`](BITNET_DEFAULT_FLIP.md) §3 — bu dosya **ölçülebilir** adımlar ve **RTO** notu için şablondur.

**Önkoşul:** Qwen base + slot0 dosyaları ve env yedeği **rollback öncesi** bilinen bir dizinde (ASCII yol).

---

## 1) Tetikleyiciler (örnek)

- `GET /v1/models` sürekli 5xx veya model yüklenemedi
- Worker QA hatası / lifecycle verify art arda FAIL
- Üretim eşiği: hata oranı > X % (ekip politikası)

---

## 2) Sıra (BitNet → Qwen)

1. **BitNet sürecini durdur**  
   - Docker: `docker compose -f infrastructure/docker/docker-compose.bitnet-qvac.yml down`  
   - systemd / PM2: ilgili unit stop.

2. **8080’i serbest bırak** — aynı portta yalnızca bir `llama-server` (Qwen).

3. **Qwen llama’yı başlat** — [`QWEN_ADAPTER_RUN.md`](QWEN_ADAPTER_RUN.md) §1 komutu; `-m` ve `--lora` Qwen dosyaları. **Burn-in (2026-04-14):** aynı `qvac` `llama-server` ikilisi ile yalnızca **base** (`-m` Qwen GGUF, port 8080) kullanıldı — üretim parity için slot/`--lora` ayrıca doğrulanır.

4. **Worker env** — `R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080`, `R3MES_QA_MODEL_NAME` ve `R3MES_QA_LORA_COPY_TARGET` **Qwen** pin’lerine çekilir ([`BITNET_PINNED_ENV_MATRIX.md`](BITNET_PINNED_ENV_MATRIX.md) Qwen satırı).

5. **ai-engine** — yedek `.env` veya secret store’dan Qwen uyumlu `R3MES_FROZEN_*` / `R3MES_SKIP_LLAMA`.

6. **Backend** — gerekirse `R3MES_AI_ENGINE_URL` yedek inference URL’ine (tek upstream politikasına göre).

---

## 3) Health / verify

| Adım | Komut / aksiyon | Beklenti |
|------|------------------|----------|
| Llama | `curl -sS http://127.0.0.1:8080/v1/models` | 200; gövde Qwen model adını içerir |
| Backend | `curl -sS http://127.0.0.1:3000/health` (veya prod URL) | `ok` |
| Zincir (ortam varsa) | `pnpm verify:lifecycle-chain -- --adapter-id … --job-id …` | PASS veya bilinen kabul |

---

## 4) RTO notu (tatbikat sonrası doldurulur)

| Alan | Değer |
|------|--------|
| **Tatbikat tarihi** | **2026-04-14** — yerel burn-in (Docker Desktop, Windows host) |
| **Sorumlu** | Cursor agent (otomatik burn-in) |
| **Başlangıç (T0)** | `T0_ROLLBACK_START=2026-04-14T00:37:36.7434163+03:00` (rollback runbook başı; ardından `docker compose … down`) |
| **Bitiş (T1)** | Qwen `GET /v1/models` **200** (gövde: `qwen2.5-0.5b-instruct-q4_k_m.gguf`) |
| **RTO (T1−T0), soğuk** | HF’den Qwen GGUF indirme (~6 dk) + konteyner + model mmap baskın — **SLA ölçümü için uygun değil** |
| **RTO (T1−T0), sıcak** | GGUF diskte hazırken: BitNet `down` → Qwen konteyner → ilk **200**: **~60–90 s** (mmap süresi host’a bağlı) |
| **Sapma notu** | Worker `verify` / backend `/health` bu turda koşturulmadı (yalnızca llama HTTP) |

---

## 5) Burn-in kanıt özeti (llama HTTP)

**BitNet (pin, compose `up -d`):** `GET http://127.0.0.1:8080/v1/models` → **200**; `data[0].id` = `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`; `meta.size` = 911129472 (disk ~911870016 bayt ile tutarlı).

**Teknik düzeltme:** İlk denemede `libgomp.so.1` eksikliği → `make_cpu_buft_list: no CPU backend found`. `Dockerfile.bitnet-qvac` içine **`libgomp1`** eklendi.

**Rollback (BitNet durdur → Qwen):** `docker compose … down` → `docker run … r3mes/bitnet-qvac:b7349` + `-m /models/qwen2.5-0.5b-instruct-q4_k_m.gguf` → **200**; model adı Qwen dosya adıyla görünür.

---

## 6) Tatbikat kaydı

[`BITNET_FLIP_FINAL_GATES.md`](BITNET_FLIP_FINAL_GATES.md) Kapı 3 checklist’inde tarih, sorumlu ve RTO işlenir.
