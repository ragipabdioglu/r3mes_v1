# QVAC / BitNet smoke — Qwen hattını kirletmeden

> **Legacy / R&D notu:** Bu smoke profili aktif ürün doğrulama yolu değildir. BitNet/QVAC üzerinde ayrı deneme yapılacaksa açılmalıdır.

**Arka plan:** [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md). **Qwen referans:** [`QWEN_ADAPTER_RUN.md`](QWEN_ADAPTER_RUN.md).

Smoke **deneyseldir**; **resmi referans yol Qwen + 8080** kalır. Bu dosya operatör checklist’idir.

---

## 1) İzolasyon sabitleri (smoke seansı)

| Öğe | Qwen (referans — dokunma) | QVAC smoke (yalnız bu seans) |
|-----|---------------------------|------------------------------|
| **llama port** | **8080** | **8081** (8080 ile asla paylaşılmaz) |
| **Base GGUF dizini** | Örn. `%TEMP%\r3mes-gguf\` | **Ayrı** dizin: `%TEMP%\r3mes-qvac-smoke\` veya `C:\r3mes-smoke\bitnet-base\` |
| **Adapter / slot dosyası** | Mevcut placeholder yolu | **Ayrı** dosya: örn. `...\qvac-slot0-placeholder.gguf` |
| **Log klasörü** | `logs/profile-qwen/` (veya mevcut düzen) | **`logs/profile-qvac-smoke/`** — Qwen loglarına yazma |
| **Worker tabanı** | `R3MES_QA_LLAMA_BASE_URL=http://127.0.0.1:8080` | Smoke sırasında **geçici** `http://127.0.0.1:8081` |

**Kural:** Smoke için worker/ai-engine env değiştirilecekse değişiklik **yalnızca o terminal oturumunda** (`set` / `$env:...`) veya ayrı `.env.smoke` kopyası ile; **kalıcı `apps/*/.env` üzerine BitNet yazmayın** — Qwen’i kirletir.

---

## 2) İki çalışma modu

### A) Yan yana (önerilen — geri dönüş kolay)

- Qwen **llama** 8080’de çalışmaya devam eder.
- BitNet/QVAC **ikinci** `llama-server` **8081** + ayrı base/`--lora` path.
- **RAM** yeterli olmalı (iki büyük model).

### B) Zaman çoğullama

- Önce Qwen llama sürecini durdur (8080 boşalır).
- Smoke: tek süreç BitNet ile **8080** veya **8081** (tercihen 8081 tutarlılığı için yine 8081 kullanın, Qwen’i sonra 8080’e geri alın).
- Daha fazla env karışıklığı riski — A modu tercih edilir.

---

## 3) Smoke komut şablonu (Windows, `win-x64`)

```text
cd infrastructure\llama-runtime\win-x64
.\llama-server.exe -m <BITNET_BASE_ASCII.gguf> --port 8081 --lora-init-without-apply --lora <PLACEHOLDER_ASCII.gguf>
```

Stdout/stderr → `logs/profile-qvac-smoke/llama-8081-stdout.log` / `stderr.log` (PowerShell `Start-Process` ile yönlendirme).

---

## 4) Smoke sonrası geri dönüş (kanıt)

1. **8081** sürecini sonlandır (`Stop-Process` veya görev yöneticisi).
2. Worker smoke’ta **8081** kullandıysa: `R3MES_QA_LLAMA_BASE_URL` tekrar **`http://127.0.0.1:8080`** (veya `.env` geri yükleme).
3. **Qwen doğrulama:** `curl -fsS http://127.0.0.1:8080/v1/models` → **200** (Qwen llama hâlâ ayaktaysa). Değilse Qwen’i [`LIVE_RUN.md`](LIVE_RUN.md) / golden path ile yeniden başlat.
4. **Env/path karışıklığı kontrolü:** `apps/ai-engine/.env` ve `packages/qa-sandbox/worker/.env` içinde BitNet’e özel kalıcı satır bırakılmadığını doğrula.

---

## 5) Başarısızlık (BitNet yüklenemez)

Windows CPU ikilisi BitNet GGUF ile uyumsuzsa smoke **başarısız** olabilir; bu **Qwen hattının hatası değildir**. Ortamı geri al: §4; referans yol Qwen üzerinden devam.

---

## 6) Sonuç kaydı (ORTAK — smoke sonrası doldurulur)

**Tek kaynak statü güncellemesi:** [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md) §0 “QVAC smoke sonucu → BitNet statüsü”. Aşağıyı koşu bitince doldurun; **boş bırakılırsa** ORTAK kayıtta smoke **ölçülmedi** sayılır.

| Alan | Değer |
| ---- | ----- |
| **Tarih (UTC)** | |
| **Operatör** | |
| **Ortam** | örn. Windows win-x64 / WSL / Docker imaj + etiket |
| **Sonuç** | **geçti** / **kısmi** / **başarısız** (kısmi: örn. `GET /v1/models` 200 ama LoRA slot veya worker POST başarısız) |
| **Kanıt** | `logs/profile-qvac-smoke/…` yolları veya kısa log alıntısı |
| **BitNet statüsü yorumu** | ORTAK: bu tabloya göre [`RUNTIME_PROFILES.md`](RUNTIME_PROFILES.md) güncellenir (deneysel / güçlü geçiş adayı / uygun değil). |

**Not:** CI `pnpm smoke` **QVAC llama/BitNet içermez**; bu tablo **manuel izole smoke** içindir.
