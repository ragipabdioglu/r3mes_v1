# Export — `tr-v1` (ilk tam BitNet LoRA koşusu)

**Tarih (UTC):** 2026-04-14  
**Araç:** `llama-finetune-lora.exe` (build **7349**, commit `b73e75af`)  
**Çalışma dizini:** `infrastructure/llama-runtime/win-cpu-x64` (DLL’ler ile aynı klasör)

## Yol stratejisi (Windows Unicode)

Tüm girdi/çıktı yolları **`SUBST` ile bağlı sürücü `R:\`** üzerinden verildi (ASCII-only; `Masaüstü` Unicode sorunu yok).

Önkoşul (oturum başına bir kez, yönetici gerektirmez):

```cmd
subst R: C:\Users\rabdi\OneDrive\Masaüstü\R3MES
```

## Çalıştırılan eğitim komutu

```cmd
cd /d R:\infrastructure\llama-runtime\win-cpu-x64
llama-finetune-lora.exe ^
  --model R:\infrastructure\docker\models\bitnet\1bitLLM-bitnet_b1_58-xl-tq2_0.gguf ^
  --file R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\train\tr-conversations-v1.jsonl ^
  --assistant-loss-only ^
  --output-adapter R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\export\tr-v1.gguf ^
  --num-epochs 20 ^
  --lora-rank 16 --lora-alpha 32 --lora-modules all ^
  -ngl 0 -c 128 -b 128 -ub 128 ^
  --flash-attn off ^
  --learning-rate 1e-5 --lr-min 1e-8 ^
  --lr-scheduler cosine --warmup-ratio 0.1 ^
  --checkpoint-save-steps 100 ^
  --checkpoint-save-dir R:\infrastructure\lora-trials\candidates\2026-04-14_tr-v1\train\checkpoints
```

Tam stdout/stderr: `train-full.log` (bu klasörde).

## Çıktı artefaktı

| Dosya | Açıklama |
|-------|----------|
| `tr-v1.gguf` | LoRA adapter GGUF (`general.type=adapter`, `adapter.type=lora`) |
| `tr-v1.gguf.sha256` | SHA256 özeti (upload öncesi doğrulama) |

**Boyut (referans):** ~59.9 MiB — `--lora-modules all` ve rank 16 ile taban ~30 MiB referans örneğinden daha büyük; beklenen aralıkta.

## Doğrulama özeti

- `llama-cli` ile taban + adapter yükleme: başarılı (`general.type=adapter` stderr’de).
- `llama-server` (port **8092**): `GET /v1/models` ve `GET /lora-adapters` **200**; `POST /v1/chat/completions` **200** (kısa Türkçe soru).

## Sonraki adım (ürün hattı)

Upload / QA turu: `export/tr-v1.gguf` + `tr-v1.gguf.sha256` ile IPFS/API; ardından worker benchmark / lifecycle doğrulaması ([ARTIFACT_LAYOUT.md](../../../ARTIFACT_LAYOUT.md)).
