# Tek temiz test — Qwen + RAG MVP runtime matrisi (minimum)

**Amaç:** Chat / knowledge upload öncesi **tek** backend, **tek** Qwen `llama-server`, **tek** ai-engine akışı — yanlış port veya eski süreç kalıntısından kaynaklanan kirli sinyal üretmemek.

**İlgili:** [LOCAL_DEV.md](LOCAL_DEV.md), [infrastructure/README.md](../infrastructure/README.md), [LIVE_RUN.md](../infrastructure/LIVE_RUN.md).

---

## 1) Test için gereken süreç seti (sabit)

| # | Süreç | Nasıl kalkar | Port |
|---|--------|----------------|------|
| 1 | **Docker** (Postgres, Redis, Kubo, gateway) | `pnpm bootstrap` | 5432, 6379, 5001 (API), **9080** (gateway) |
| 2 | **Uygulamalar** (tek oturum) | Repo kökünden **tek** `pnpm dev` | **3000** backend, **3001** dApp, **8000** ai-engine, QA worker (port yok) |
| 3 | **Qwen `llama-server`** | Ayrı terminal; [LIVE_RUN.md](../infrastructure/LIVE_RUN.md) — `--port 8080` | **8080** |

**Kasıtlı olarak tek süreç:**

- **Bir** Fastify backend (3000).
- **Bir** `llama-server` (8080); bu dokümanda **8080 = Qwen2.5-3B** kabul edilir.
- **Bir** `pnpm dev` / turbo; ikinci kez çalıştırma **yok**.

---

## 2) Port özeti (çakışma yok)

| Port | Servis |
|------|--------|
| 3000 | backend-api |
| 3001 | dApp (`NEXT_PUBLIC_BACKEND_URL` → 3000) |
| 8000 | ai-engine |
| 8080 | Qwen / llama |
| 9080 | IPFS HTTP gateway (**8080 değil**) |

---

## 3) Kirli ortamı önleme (upload / chat öncesi)

1. Eski **node** süreçlerini **3000**’de dinleyen ikinci kopya olarak bırakmayın — `netstat -ano | findstr :3000` ile tek **LISTENING** PID olmalı.
2. **İki** `pnpm dev` penceresi açmayın; biri Ctrl+C ile kapatılsın.
3. Retrieval / citation testi yapıyorsanız backend ve ai-engine tek oturumda kalsın; ikinci backend veya ikinci `pnpm dev` açmayın.
4. Yerel kolaylık env (`R3MES_SKIP_CHAT_FEE`, vb.) **yalnızca** gitignore’lu `.env`; deploy edilen ortamla paylaşılmaz.

**Otomatik ön kontrol (isteğe bağlı):**

```powershell
pwsh -File infrastructure/scripts/check-single-test-runtime.ps1
```

---

## 4) “Hazır” tanımı (upload öncesi)

- [ ] `pnpm bootstrap` tamam, Docker konteynerleri healthy.
- [ ] Tek `pnpm dev`; `GET http://127.0.0.1:3000/health` → ok.
- [ ] `GET http://127.0.0.1:8080/v1/models` → **200**.
- [ ] `GET http://127.0.0.1:9080/health` → healthy.
- [ ] dApp `NEXT_PUBLIC_BACKEND_URL` → **3000** ile uyumlu.

Bu maddeler tamamsa kullanıcı **tek temiz knowledge upload + chat** denemesine geçebilir; kalan risk çoğunlukla **IPFS add / embedding / cüzdan imzası** gibi uçtan uca doğrulama gerektiren taraftır.

---

## Legacy notu

BitNet/QVAC ile çok profilli veya QA-worker odaklı eski test düzenleri artık aktif MVP yolunun parçası değildir. Yalnız tarihî/R&D referansı olarak:

- [RUNTIME_PROFILES.md](../infrastructure/RUNTIME_PROFILES.md)
- [BITNET_L2_STACK.md](../infrastructure/BITNET_L2_STACK.md)
- [FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md](../infrastructure/lora-trials/FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md)
