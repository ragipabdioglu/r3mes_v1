# Canlı başarı koşusu — operatör notu (tekrar üretim)

Golden path özeti: [`README.md`](README.md) → *Yerel golden path*. Bu dosya aktif ürün yolunda **Qwen2.5-3B + RAG-backed chat** düzeninin aynı şekilde tekrarlanması içindir.

## 1) Ön koşul (hepsi ayakta)

`pnpm bootstrap` (veya Compose ile Postgres + storage), ardından uygulama süreçleri. Hızlı kontrol:

```powershell
pwsh -File infrastructure/scripts/faz7-debug-session.ps1
```

Beklenen: **9080** gateway, **8080** llama, **8000** ai-engine, **3000** backend, **3001** dApp, Redis/Postgres.

## 2) llama-server başlangıç komutu ve optional behavior LoRA slot düzeni

Aktif MVP yolunda Qwen base-only inference yeterlidir. Behavior LoRA kullanılacaksa aynı `llama-server` süreci `--lora` slot ile başlatılabilir; kullanılmayacaksa base-only çalıştırın.

**Örnek (Windows, `win-x64`; yollar ASCII olmalı):**

```text
llama-server.exe ^
  -m C:\path\to\qwen2.5-3b-instruct.gguf ^
  --port 8080
```

Behavior LoRA kullanılacaksa örnek:

```text
llama-server.exe ^
  -m C:\path\to\qwen2.5-3b-instruct.gguf ^
  --port 8080 ^
  --lora-init-without-apply ^
  --lora C:\path\to\behavior-slot0.gguf
```

`ai-engine` base-only veya adapter-optional çalışır; retrieval ve source assembly backend tarafında yapılır.

## 3) Worker ile hizalı env (özet)

| Env | Anlam |
|-----|--------|
| `R3MES_QA_LLAMA_BASE_URL` | `http://127.0.0.1:8080` |
| `R3MES_LORA_SLOT_ID` | Behavior LoRA kullanılıyorsa `0` = ilk `--lora` |
| `R3MES_LORA_SCALE` | Behavior LoRA kullanılıyorsa genelde `1.0` |
| `R3MES_QA_LORA_COPY_TARGET` | Behavior LoRA kullanılıyorsa isteğe bağlı; boşsa `GET /lora-adapters` dönen path kullanılır |
| `R3MES_QA_WORKER_LOG_FILE` | Örn. `logs/live-run-worker.log` (UTF-8, kalıcı) |

## 4) Tek denemede log toplama (kaybolmasın)

| Süreç | Öneri |
|-------|--------|
| Worker | `R3MES_QA_WORKER_LOG_FILE` mutlaka ayarla |
| Backend | `pnpm` çıktısını `backend-live-stdout.log` / `stderr` dosyasına yönlendir veya mevcut turbo log dosyalarını kullan |
| llama | `Start-Process` ile `-RedirectStandardOutput` / `-RedirectStandardError` ayrı dosyalara |
| Deneme bitince | Log dosyalarını tarih ekleyerek arşivle (`logs/archive/2026-04-12-...`) |

## 5) Yaygın altyapı “sahte” hata (önle)

- **400 `/lora-adapters`:** Behavior LoRA uygulanmak istenirken `--lora` slotu yok veya slot id uyuşmuyor.
- **403 webhook:** `R3MES_QA_WEBHOOK_SECRET` / backend `X-QA-HMAC` uyumsuzluğu (uygulama katmanı).
- **8000 düşüyor:** `start-all.sh` çıkışında trap — ai-engine için `run-ai-engine-dev.ps1` veya ayrı terminal.

Bu not, aktif Qwen + RAG yolunu aynı düzenle tekrar etmek içindir. BitNet/QVAC koşuları legacy/R&D dokümanlarında kalır.
