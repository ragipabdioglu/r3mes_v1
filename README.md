# R3MES Monorepo

Merkeziyetsiz yapay zeka uygulama platformu — Qwen2.5-3B tabanlı çıkarım, RAG knowledge katmanı, opsiyonel behavior LoRA, Fastify API ve Next.js dApp.

**Aktif runtime envanteri:** [infrastructure/ACTIVE_RUNTIME.md](./infrastructure/ACTIVE_RUNTIME.md). **Yerel servisler / portlar / golden path (tek giriş):** [docs/LOCAL_DEV.md](./docs/LOCAL_DEV.md) — ayrıntı [infrastructure/README.md](./infrastructure/README.md).

## Gereksinimler

- Node.js ≥ 20, **pnpm** 9
- Docker (isteğe bağlı: yerel PostgreSQL, Redis, IPFS yığını için)
- Python 3.11+ (**apps/ai-engine** FastAPI / uvicorn için)

## Hızlı başlatma (Büyük Başlatıcı)

```bash
# Depo kökünde
chmod +x start-all.sh infrastructure/scripts/start-all.sh
./start-all.sh
```

veya:

```bash
make start-all
```

Betik sırasıyla:

1. `apps/backend-api`, `apps/dApp`, `packages/sui-indexer` için `.env` yoksa `.env.example` kopyalar.
2. `docker-compose.postgres.yml` ve `docker-compose.storage.yml` ile konteynerleri `up -d` dener (Docker yoksa uyarı verir, devam eder).
3. `pnpm db:migrate` çalıştırır.
4. **ai-engine**’i arka planda uvicorn ile **:8000** portunda başlatır (log: `.r3mes-ai-engine.log`).
5. Ön planda **Turbo** ile Fastify **:3000** ve Next.js **:3001** sunar.

**Yerel portlar ve “hangi süreç ne?”:** Önce **[docs/LOCAL_DEV.md](./docs/LOCAL_DEV.md)**; derinlemesine adımlar → [`infrastructure/README.md`](infrastructure/README.md). Docker = yalnızca Postgres/Redis/IPFS/gateway; uygulamalar ayrı süreç.

---

## 7 Adımlı Uçtan Uca Mutlu Yol (Happy Path) Testi

Bu rehber; demo, QA ve yeni geliştiricilerin sistemi uçtan uca doğrulaması içindir. Önkoşul: yukarıdaki başlatıcı veya eşdeğer servislerin ayakta olması; Sui cüzdan eklentisi (ör. Sui Wallet) kurulu olması.

1. **Cüzdan bağla**  
   Tarayıcıda dApp’i açın (`http://localhost:3001`). Sui uyumlu Web3 cüzdanını bağlayın; ağın projenin kullandığı testnet/devnet ile uyumlu olduğundan emin olun.

2. **Sui Web3 cüzdan ile imza (Auth) ver**  
   Oturum / challenge akışında sunucunun istediği mesajı cüzdanla imzalayın; API’nin beklediği `Authorization` veya imza başlıkları oluştuğunu doğrulayın (backend `.env` ve auth moduna göre).

3. **Studio’dan knowledge verisi yükle**  
   Stüdyo akışı `.txt`, `.md` veya `.json` knowledge dosyası ile çalışır. Yükleme tamamlandığında IPFS pin, chunking ve embedding yazımının hatasız bittiğini doğrulayın.

4. **Private/public durumunu doğrula**  
   Yüklenen collection’ın önce `PRIVATE` oluştuğunu, ardından istenirse explicit publish ile `PUBLIC` olabildiğini doğrulayın.

5. **Chat’te collection seçip prompt yaz**  
   Sohbet arayüzünde ilgili knowledge collection’ı seçip kısa bir prompt gönderin; isteğin backend üzerinden retrieval ve inference zincirine gittiğini doğrulayın.

6. **Kaynaklı cevabı doğrula**  
   Cevapla birlikte source/citation alanlarının döndüğünü ve kullanılan doküman/chunk bilgisinin beklendiği gibi göründüğünü kontrol edin.

7. **İşlem bitiminde gas / fee kesimini teyit et**  
   Sui cüzdanında veya zincir gezgininde son işlemleri inceleyin; sohbet veya stake ile ilişkili mikro ücret / gas hareketinin beklendiği gibi gerçekleştiğini doğrulayın (testnet faucet ve kontrat ayarlarına bağlıdır).

---

## Ek komutlar

| Komut | Açıklama |
|--------|-----------|
| `pnpm dev` | Tüm `dev` script’li paketleri paralel çalıştırır (ai-engine çift başlatmayı önlemek için `start-all` tercih edin). |
| `pnpm db:migrate` | Prisma migrate deploy (backend-api). |
| `make docker-up` | Yalnızca Docker compose (postgres + storage). |
| `pnpm --filter @r3mes/backend-api run eval:adaptive-rag` | Aktif RAG pipeline için domain/source/safety regression eval’i. |

Lisans ve ürün detayları için depodaki `R3MES.md` ve `R3MES_MASTER_PLAN.md` dosyalarına bakın.

## Legacy notu

BitNet/QVAC ve knowledge-heavy LoRA eğitim denemeleri repoda tarihsel/R&D iz olarak durur. Bunlar ürünün mevcut golden path’ini tanımlamaz. Ana yol Qwen2.5-3B + RAG + optional behavior LoRA’dır. Tek legacy indeks: [`infrastructure/LEGACY_RND.md`](infrastructure/LEGACY_RND.md).
