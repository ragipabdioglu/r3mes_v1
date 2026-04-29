# LoRA aday denemesi — kayıt (şablon)

**Trial id:** `YYYY-MM-DD_shortname` — [candidates/ klasör adı](candidates/README.md) ile **aynı**; ürün kaydı: `lora-trials/runs/<trial_id>/` ([ARTIFACT_LAYOUT.md](ARTIFACT_LAYOUT.md))  
**Adapter etiketi:** `kısa-etiket` — `export/<etiket>.gguf` ve `COMPARISON.md` sütunu ile **aynı kök**  
**Operatör:**  
**Runtime profili:** BitNet/QVAC — [BITNET_QVAC_PRODUCTION_MATRIX.md](../BITNET_QVAC_PRODUCTION_MATRIX.md) (değişmez; sapma = yeni pin satırı)

## Üretim hattı (BitNet, içeride) — özet

| Aşama | Konum | Not |
|-------|--------|-----|
| Eğitim çıktısı | `candidates/<trial_id>/train/` | Upload/test **girmez** |
| GGUF export | `candidates/<trial_id>/export/<adapter_etiketi>.gguf` | **Tek canonical** upload kaynağı |
| (Opsiyonel) runtime smoke | `candidates/<trial_id>/run/` | Export **kopyası**; küçük log metni |
| Ürün doğrulama | Upload → QA → `verify` | Aşağıdaki API alanları |

## İlk trial — ürün kanıtı (minimum 6 alan)

Ürün adayı kararı için [ACTIVE_CANDIDATE_MINIMUM_PROOF.md](../../apps/backend-api/docs/ACTIVE_CANDIDATE_MINIMUM_PROOF.md) §6 ile **aynı** alanlar doldurulur:

| # | Alan | Değer |
|---|------|--------|
| 1 | **adapterId** | |
| 2 | **weightsCid** | |
| 3 | **benchmarkJobId** | |
| 4 | **benchmarkScore** | |
| 5 | **status** | |
| 6 | **OFFICIAL_VERIFY_LINE** | Aşağıdaki blokta tam satır |

**ACTIVE adayı:** `status=ACTIVE` + `verify=PASS` + altı alan eksiksiz + export GGUF (eğitim çıktısı) + worker BitNet profilinde aynı `jobId`. Aksi: başarısız trial veya test.

## Chat smoke sonucu

**Kanonik hedef:** [docs/operations/TURKISH_LORA_QUALITY_PLAN.md](../../docs/operations/TURKISH_LORA_QUALITY_PLAN.md)

| Prompt | Kısa sonuç |
|--------|------------|
| `LoRA nedir?` | |
| `GGUF ne işe yarar?` | |
| `IPFS'i kısa açıkla.` | |
| `Fine-tuning ile inference farkı nedir?` | |
| `Adapter nedir? Türkçe ve kısa cevap ver.` | |

**Chat smoke kararı:** `PASS` / `ITERATE` / `FAIL`

## Sabitlenen alanlar (API / DB ile uyumlu)

| Alan | Değer | Not |
|------|--------|-----|
| **base model (pin)** | `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` | `llama -m` / `model` alanı |
| **adapter dosyası (export)** | `…/export/<adapter_etiketi>.gguf` | Upload **kaynağı**; train/ değil |
| **adapter SHA256** | `…` | `export/*.sha256` ile aynı olmalı |
| **adapterId** | `cuid…` | `POST /v1/adapters` yanıtı |
| **weightsCid** | `Qm…` / `bafy…` | upload sonrası |
| **benchmarkJobId** | `benchmark-0-…` | kuyruk / QA job adı (= `jobId` webhook’ta) |
| **benchmarkScore** | sayı veya boş | `GET /v1/adapters/:id` |
| **final status** | `PENDING_REVIEW` / `ACTIVE` / `REJECTED` | terminal; ürün **ACTIVE adayı** yalnızca `ACTIVE` + verify PASS |

## Doğrulama satırı (kopyala-yapıştır)

```text
pnpm verify:lifecycle-chain -- --adapter-id <adapterId> --job-id <benchmarkJobId>
# R3MES_VERIFY_BASE_URL=http://127.0.0.1:3000 (yerel)
```

**OFFICIAL_VERIFY_LINE (çıktının son satırı — `verify=PASS` içermeli):**

```text
OFFICIAL_VERIFY_LINE: verify=PASS adapterId=… jobId=… status=… receipt=… completedAt=… score=… chain=…
```

## Log dosyaları (bu denemeye ait)

| Kaynak | Yol |
|--------|-----|
| llama stderr | |
| QA worker | `R3MES_QA_WORKER_LOG_FILE` |

## Serbest notlar (hiperparametre, veri kümesi, regression)

-
