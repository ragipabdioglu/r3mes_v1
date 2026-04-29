# R3MES Konsolidasyon Planı — MVP'ye Giden Yol

> Bu plan mevcut 9 fazın üzerine inşa edilir.
> Amaç: Sistemi ilk kez uçtan uca çalıştırmak ve Faz 10 testnet'e hazır hale getirmek.
> Orchestrator bu planı sprint'lere bölerek ajanlara dağıtır.

---

## Mevcut Durum Özeti

- Faz 0–9 tamamlandı: mimari, iskelet, kontratlar, backend, indexer, QA sandbox, frontend, güvenlik raporu hepsi yazıldı
- **Hiçbir şey entegre çalıştırılmadı** — her faz Docker yoktu notu ile kapandı
- AI engine tamamen mock — gerçek inference yok
- Coin akışı (fee kesme, slash/approve zincire yazma) bağlı değil
- Wallet auth iskelet seviyesinde
- Stake/reward UI eksik
- **Yeni karar:** BitNet + LoRA için `qvac-fabric-llm.cpp` fork'u kullanılacak

---

## Sprint 1 — AI Engine Yeniden Yazımı

**Sorumlu Ajan:** AGENT-AI  
**Tahmini Süre:** 2-3 gün  
**Blocker:** Evet — bu olmadan hiçbir şey gerçek değil

### Görevler

**1. `apps/ai-engine` klasörünü temizle**

Mevcut `inference_mock.py`, `ipfs_sync.py` ve transformers/PEFT bağımlılıklarını kaldır. `pyproject.toml`'dan PEFT, transformers satırlarını sil.

**2. `qvac-fabric-llm.cpp` binary'lerini Docker image'ına dahil et**

```dockerfile
# infrastructure/docker/Dockerfile.ai-engine
FROM python:3.12-slim

# qvac binary'leri indir ve koy
RUN apt-get update && apt-get install -y wget
RUN wget https://github.com/tetherto/qvac-fabric-llm.cpp/releases/latest/download/llama-bin-ubuntu-x64.zip \
    && unzip llama-bin-ubuntu-x64.zip -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/llama-server \
    && chmod +x /usr/local/bin/llama-finetune-lora

COPY . /app
WORKDIR /app
RUN pip install -r requirements.txt
```

**3. FastAPI'yi llama-server'a proxy olarak yeniden yaz**

llama-server zaten OpenAI uyumlu HTTP server sunuyor. FastAPI sadece şunları yapar:
- IPFS'ten BitNet base model ve LoRA adaptörünü indir
- llama-server'ı doğru parametrelerle başlat
- `/v1/chat/completions` isteklerini llama-server'a proxy'le
- Hot-swap: farklı adaptör seçilince `/lora-adapters` endpoint'ini çağır

```python
# apps/ai-engine/r3mes_ai_engine/server.py
import subprocess
import httpx
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()
LLAMA_SERVER_URL = "http://localhost:8080"

@app.on_event("startup")
async def start_llama_server():
    # IPFS'ten base model indir
    base_model_path = await download_from_ipfs(FROZEN_CORE_CID)
    # llama-server başlat
    subprocess.Popen([
        "llama-server",
        "-m", base_model_path,
        "--port", "8080",
        "--lora-init-without-apply",  # adaptörler runtime'da yüklenir
    ])

@app.post("/v1/chat/completions")
async def chat(req: ChatRequest):
    # Adaptörü hot-swap ile yükle
    async with httpx.AsyncClient() as client:
        await client.post(f"{LLAMA_SERVER_URL}/lora-adapters", 
                         json=[{"id": 0, "path": req.adapter_path, "scale": 1.0}])
    # İsteği proxy'le, streaming destekli
    async def stream():
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", f"{LLAMA_SERVER_URL}/v1/chat/completions",
                                     json=req.dict()) as response:
                async for chunk in response.aiter_bytes():
                    yield chunk
    return StreamingResponse(stream(), media_type="text/event-stream")
```

**4. DoRA temizliği**

Şu dosyalardaki tüm DoRA referanslarını kaldır:
- `docs/schemas/r3mes_adapter_manifest.schema.json` → `adapter.kind` alanını `"LORA"` sabit yap
- `docs/schemas/peft_adapter_config.schema.json` → DoRA satırlarını sil
- `docs/ai_architecture.md` → DoRA referanslarını kaldır
- `apps/dApp/app/studio/page.tsx` → UI'daki DoRA metinlerini kaldır

**5. Adaptör formatını GGUF'a güncelle**

Manifest şemasında `weight_files` alanı artık `.gguf` uzantısı bekliyor:
```json
{
  "adapter": {
    "kind": "LORA",
    "weight_files": [
      { "path": "adapter.gguf", "sha256": "...", "role": "primary" }
    ]
  }
}
```

**Teslim Kriteri:** `llama-server` ayakta, `/v1/chat/completions`'a prompt gönderince gerçek metin dönüyor.

---

## Sprint 2 — Coin Akışını Bağla

**Sorumlu Ajan:** AGENT-BE + AGENT-BC  
**Tahmini Süre:** 1-2 gün  
**Blocker:** Evet — ekonomik döngü olmadan platform anlamsız

### Görevler

**1. Chat fee kesimi**

`apps/backend-api/src/routes/chat.ts` içine ekle:

```typescript
import { Transaction } from '@mysten/sui/transactions';

async function deductChatFee(walletAddress: string, adapterOwner: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::reward_pool::record_usage`,
    arguments: [
      tx.object(POOL_OBJECT_ID),
      tx.pure.address(walletAddress),
      tx.pure.address(adapterOwner),
    ],
  });
  await suiClient.signAndExecuteTransaction({ transaction: tx, signer: serverSigner });
}
```

Miktar şimdilik sabit: 1 MIST. Dinamik fiyatlandırma Faz 11'e bırak.

**2. QA sonucunu zincire yaz**

`apps/backend-api/src/routes/internal.ts` içinde `/v1/internal/qa-result` handler'ına ekle:

```typescript
if (result.status === 'approved') {
  await callContract('adapter_registry::approve_adapter', [adapterId]);
} else {
  await callContract('staking_pool::slash_stake_on_rejected', [adapterId]);
}
```

**3. Reward dağıtım endpointi**

`GET /v1/user/:wallet/rewards` endpoint'i ekle — kullanıcının claim edilmemiş ödüllerini döner.

**Teslim Kriteri:** Chat isteği sonrası cüzdanda MIST düştüğü görülüyor. QA reject edince slash olduğu on-chain görülüyor.

---

## Sprint 3 — Wallet Auth

**Sorumlu Ajan:** AGENT-BE + AGENT-FE  
**Tahmini Süre:** 3-4 saat

### Görevler

**1. Backend'de imza doğrulama**

`apps/backend-api/src/plugins/auth.ts`:

```typescript
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

export async function verifySuiWallet(
  message: string,
  signature: string, 
  address: string
): Promise<boolean> {
  const publicKey = await verifyPersonalMessageSignature(
    new TextEncoder().encode(message),
    signature
  );
  return publicKey.toSuiAddress() === address;
}
```

**2. Frontend'de imza gönderme**

`apps/dApp/lib/api/auth.ts`:

```typescript
import { useSignPersonalMessage } from '@mysten/dapp-kit';

export async function authenticateWallet(walletAddress: string) {
  const message = `R3MES Auth: ${Date.now()}`;
  const { signature } = await signPersonalMessage({ message: new TextEncoder().encode(message) });
  return { message, signature, address: walletAddress };
}
```

Her API isteğine `X-Wallet-Address`, `X-Message`, `X-Signature` header'ları ekle.

**Teslim Kriteri:** Auth olmadan API çağrıları 401 dönüyor.

---

## Sprint 4 — Stake & Reward UI

**Sorumlu Ajan:** AGENT-FE  
**Tahmini Süre:** 4-5 saat

### Görevler

**1. Stake sayfası**

`apps/dApp/app/stake/page.tsx` oluştur. İçinde 3 bölüm:

```typescript
// Bölüm 1: Stake et
<StakeForm onSubmit={(amount) => callContract('staking_pool::deposit_stake', [amount])} />

// Bölüm 2: Mevcut stake durumu
<StakeStatus wallet={walletAddress} />  // GET /v1/user/:wallet/stake

// Bölüm 3: Ödüller
<RewardsClaim wallet={walletAddress} />  // GET /v1/user/:wallet/rewards
```

**2. Egitici panelini tamamla**

`apps/dApp/app/studio/page.tsx` içine adaptör durumu ekle:

```typescript
const statusColors = { 
  PENDING: 'yellow', 
  ACTIVE: 'green', 
  REJECTED: 'red' 
};
// Benchmark skoru ve durum göster
```

**3. Lockup takvimi**

Şimdilik statik tablo — mainnet tarihleri belli olunca dinamikleşir:

```typescript
const LOCKUP_SCHEDULE = [
  { day: 0, percent: 25, label: 'Mainnet açılışı' },
  { day: 90, percent: 25, label: '3. ay' },
  { day: 180, percent: 25, label: '6. ay' },
  { day: 270, percent: 25, label: '9. ay' },
];
```

**Teslim Kriteri:** Stake sayfası çalışıyor, adaptör durumu studio'da görünüyor.

---

## Sprint 5 — Stack'i Çalıştır (En Kritik)

**Sorumlu Ajan:** AGENT-INF + Orchestrator  
**Tahmini Süre:** 1 gün  
**Blocker:** Evet — bu olmadan testnet'e gidemezsin

### Sırayla çalıştır

```bash
# 1. Altyapı
docker compose -f infrastructure/docker/docker-compose.postgres.yml up -d
docker compose -f infrastructure/docker/docker-compose.storage.yml up -d

# 2. DB migrasyonu
pnpm --filter @r3mes/backend-api db:migrate

# 3. Tüm servisler
pnpm dev

# 4. AI engine ayrı terminalde
cd apps/ai-engine && python -m r3mes_ai_engine
```

### Mutlu Yol Testi — Bu sırayla geçmeli

```
1. Tarayıcıda http://localhost:3001 aç
2. Sui testnet cüzdanı bağla
3. Studio'ya git — küçük bir LoRA .gguf dosyası yükle
4. QA worker'ın çalışmasını bekle (Redis'ten iş almalı)
5. Adaptör ACTIVE olunca marketplace'de görünmeli
6. Chat ekranına git — o adaptörü seç
7. Mesaj gönder — gerçek BitNet cevabı gelmeli
8. Cüzdanda MIST düşmeli
```

Bu akış bir kez takılmadan geçene kadar Faz 10'a geçme.

### Beklenen Sorunlar ve Çözümleri

| Sorun | Çözüm |
|-------|-------|
| llama-server başlamıyor | Binary path'i kontrol et, chmod +x |
| IPFS'ten model inmiyor | Kubo ayakta mı? `curl http://localhost:5001/api/v0/version` |
| Redis bağlantı hatası | `docker compose logs redis` |
| DB migration hatası | `DATABASE_URL` .env'de doğru mu? |
| Sui RPC hatası | `SUI_RPC_URL` testnet endpoint'i mi? |

---

## Sprint 6 — Sui Testnet Deploy

**Sorumlu Ajan:** AGENT-BC  
**Tahmini Süre:** 2-3 saat

### Görevler

```bash
# Sui testnet'e deploy
cd packages/sui-contracts
sui client switch --env testnet
sui move build
sui client publish --gas-budget 100000000

# Çıkan paket adresini not al
# PACKAGE_ID=0x...
```

`.env` dosyalarını güncelle:
```
R3MES_PACKAGE_ID=0x<deploy_edilen_adres>
R3MES_COIN_TYPE=0x<adres>::r3mes_coin::R3MES_COIN
```

Frontend'de `NEXT_PUBLIC_R3MES_COIN_TYPE` güncelle.

**Teslim Kriteri:** Sui Explorer'da kontrat görünüyor, `ACTIVE` durumunda.

---

## Kalmayan Sorunlar (Bu Plan Sonrası)

| Sorun | Durum |
|-------|-------|
| Gerçek BitNet inference yok | ✅ Sprint 1 ile çözüldü |
| LoRA entegrasyonu yok | ✅ qvac fork ile çözüldü |
| Streaming yok | ✅ llama-server native destekliyor |
| Coin flow bağlı değil | ✅ Sprint 2 ile çözüldü |
| Wallet auth iskelet | ✅ Sprint 3 ile çözüldü |
| Stake UI eksik | ✅ Sprint 4 ile çözüldü |
| Hiç çalıştırılmadı | ✅ Sprint 5 ile çözüldü |
| Testnet deploy yok | ✅ Sprint 6 ile çözüldü |
| DoRA referansları | ✅ Sprint 1 ile temizlendi |

---

## Faz 10 Öncesi Son Kontrol Listesi

Bu maddelerin hepsi ✅ olmadan Faz 10'a geçme:

- [ ] `llama-server` gerçek BitNet modeli çalıştırıyor
- [ ] LoRA adaptörü yüklenip inference değişiyor
- [ ] Mutlu yol bir kez baştan sona çalıştı
- [ ] Sui testnet'te kontrat adresi var
- [ ] Chat'te fee kesiliyor
- [ ] QA reject edince slash oluyor
- [ ] Cüzdan auth çalışıyor
- [ ] Stake sayfası açılıyor

---

## Yapılmayacaklar (Kapsam Dışı)

- Governance / DAO mekanizması
- Mobil uygulama
- Multi-chain destek
- Gelişmiş analitik dashboard
- Türkçe model fine-tuning (trainer'lara bırak)
- K8s production deploy (lokal Docker önce)
- Dinamik fee hesaplama
- Sosyal özellikler

---

## Notlar

**qvac-fabric-llm.cpp hakkında:** Bu repo Tether/QVAC tarafından Apache 2.0 lisansıyla yayınlandı. Ticari kullanım serbest. llama.cpp fork'u olduğu için llama.cpp'nin tüm özelliklerini destekliyor.

**BitNet model seçimi:** Microsoft `bitnet-b1.58-2B-4T` modeli kullan. GGUF formatı için `microsoft/bitnet-b1.58-2B-4T-gguf` HuggingFace repo'sundan indir. Fine-tuning için `microsoft/bitnet-b1.58-2B-4T-bf16` kullan, sonra GGUF'a convert et.

**Türkçe sorunu:** BitNet'in Türkçe desteği zayıf. Bunu benchmark setine Türkçe sorular ekleyerek ve trainer'ları Türkçe veri seti ile fine-tuning yapmaya yönlendirerek çöz. Testnet'te bu organik olarak gelişir.
