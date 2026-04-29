# Run — isteğe bağlı yerel BitNet smoke

**Amaç:** `export/tr-v1.gguf` dosyasının **kopyası** ile pin’li `llama-server` üzerinde kısa doğrulama (ör. `/v1/models`).

- **Kaynak:** Yalnızca `../export/tr-v1.gguf` — `train/` veya checkpoint **kullanılmaz**.
- Bu klasöre isteğe bağlı: `README.md` (komut özeti), `llama-snippet.txt` (kısa stderr/health).
- **Upload IPFS/API için `run/` kullanılmaz** — kanonik dosya `export/` altındadır.
