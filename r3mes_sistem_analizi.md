# R3MES — Konsolide Sistem Analizi ve Risk Haritası (Final v2)
> 3 Bağımsız Denetim Kaynağı: Ajan Raporları + Orkestratör Tarama + Proje Sahibi Analizi
> Tarih: 2026-04-10

---

## 1. Genel Değerlendirme

### İyi Yapılanlar
- **Mimari ayrışma güçlü.** backend-api, dApp, ai-engine, qa-worker, sui-indexer, sui-contracts sınırları mantıklı; bu proje "tek dosyalık dağınık prototip" değil.
- **Domain modeli düşünülmüş.** Prisma şeması net, zincir olaylarıyla uyumlu read-model yaklaşımı var.
- **Statik kalite iyi.** `strict` TypeScript açık, `tsc --noEmit` kontrolleri geçiyor; ESLint konfigürasyonu hata vermiyor.
- **Birim test tabanı fena değil.** Backend Vitest 8/8, Indexer Vitest 2/2, AI-Engine Pytest 3/3, QA-Worker Pytest 4/4, Move 7/7. Sorunun kaynağı "kötü kod" değil, **"entegrasyon drift'i"**.
- **Backend auth mantığının kendisi sağlam.** Expiry, address binding, signature verification tarafı makul.

### Genel Hüküm
> **İskelet güçlü ama uçtan uca sözleşmeler kopmuş.** Teknik borç ağırlıkla: entegrasyon borcu, test wiring borcu ve dokümantasyon drift'i. Temel yapı toparlanabilir durumda. Ancak şu anki snapshot'ta pazaryeri, auth, chat ve stake akışları birbirleriyle konuşmuyor.

---

## 2. KRİTİK BULGULAR (P0)

### 2.1 🔴 İmza Mesaj Formatı Uyumsuzluğu (Frontend ↔ Backend)

| | |
|---|---|
| **Konum** | `dApp/lib/api/wallet-auth-message.ts:3` → `backend/src/lib/walletAuth.ts:58-79` |
| **Sorun** | Frontend `"R3MES Auth: 1712700000000"` düz string üretiyor. Backend ise `parseAuthTiming()` ile zorunlu olarak `{ "exp": <unix>, "iat": <unix> }` JSON formatı bekliyor. `trimmed.startsWith("{")` kontrolü başarısız → `INVALID_MESSAGE_FORMAT` ile 401. |
| **Etki** | **Hiçbir imzalı istek backend'den geçemez.** Auth gerektiren tüm endpoint'ler (chat, adapter yükleme, stake) fiilen kilitli. |
| **Çözüm** | Frontend'de `buildR3mesAuthMessage()` fonksiyonunu `JSON.stringify({ exp: now + ttl, iat: now, address: wallet })` formatına çevir. |

---

### 2.2 🔴 Chat Akışı Backend Proxy'yi Bypass Ediyor (Frontend → AI Engine Direkt)

| | |
|---|---|
| **Konum** | `dApp/lib/api/chat-stream.ts:16` → `getAiEngineUrl()` (http://localhost:8000) |
| **Sorun** | Frontend chat isteğini Backend (`:3000/v1/chat/completions`) yerine doğrudan AI Engine (`:8000/v1/chat/completions`) URL'sine gönderiyor. Sonuç: Backend'deki `walletAuthPreHandler`, `recordChatUsageOnChain()` (fee kesimi) ve CORS koruması hiç devreye girmiyor. |
| **Etki** | Ücret kesilmiyor, kullanım kaydı yazılmıyor, auth bypass ediliyor. Ekonomik döngü tamamen devre dışı. |
| **Çözüm** | `chat-stream.ts:16`'daki `getAiEngineUrl()` → `getBackendUrl()` olarak değiştirilecek. Chat her zaman Backend proxy üzerinden akacak. |

---

### 2.3 🔴 Marketplace → Chat Adaptör ID Uyumsuzluğu

| | |
|---|---|
| **Konum** | `dApp/components/marketplace-list.tsx` → `chat-screen.tsx` → `ai-engine/schemas_openai.py` |
| **Sorun** | Pazaryerinden seçilen adaptör `adapter` (DB ID) query parametresi ile chat'e geçiyor. Chat bu değeri `adapter_id` olarak gönderebilir ama AI Engine sözleşmesi **zorunlu `adapter_cid`** (IPFS CID) bekliyor. CID iletilmezse 422 hatası. |
| **Etki** | **Pazaryeri → Chat happy path'i kırık.** Kullanıcı model seçip sohbet başlatamaz. |
| **Çözüm** | Pazaryeri listesinde CID'yi de taşı; chat URL'ine `?cid=bafyXxx` ekle; AI Engine'de `adapter_cid` zorunluluk yerine `adapter_cid OR adapter_id` ile backend lookup yap. |

---

### 2.4 🔴 `reward_pool::record_usage` — Yetkisiz Erişim

| | |
|---|---|
| **Konum** | `sui-contracts/sources/reward_pool.move:43-51` |
| **Sorun** | Hiçbir `Capability` veya `ctx.sender()` kısıtı yok. Herhangi biri 1 MIST ödeyerek `user` alanına istediği adresi yazıp sahte `UsageRecordedEvent` üretebilir. |
| **Etki** | Ekonomi manipülasyonu, sahte kullanım kaydı, spam. |
| **Çözüm** | `OperatorCap` capability objesi ekle; fonksiyon imzasında parametre olarak zorunlu kıl. |

---

### 2.5 🔴 RewardPool'dan Fon Çıkışı Tanımsız

| | |
|---|---|
| **Konum** | `reward_pool.move` — tam dosya |
| **Sorun** | SUI havuza giriyor (`coin::put`) ama çıkaran, eğiticilere dağıtan veya acil durumda kurtaran fonksiyon yok. |
| **Etki** | Eğiticiler asla ödül alamaz → Platform ekonomik değer üretemez. |
| **Çözüm** | `distribute_rewards()` ve `admin_emergency_withdraw()` fonksiyonları yaz. |

---

### 2.6 🔴 QA Webhook Kimlik Doğrulaması Yok

| | |
|---|---|
| **Konum** | `backend-api/src/routes/internalQa.ts:11` |
| **Sorun** | `POST /v1/internal/qa-result` endpoint'inde `walletAuthPreHandler` veya HMAC secret yok. Herhangi biri sahte `{ status: "approved", score: 100 }` POST'u atarak kalitesiz modeli onaylatabilir. |
| **Etki** | Çöp modeller pazaryerine sızar, güven çöker. |
| **Çözüm** | HMAC shared secret header doğrulaması (`X-QA-HMAC`) ekle. |

---

### 2.7 🔴 Admin Cap Tek Nokta Arızası (SPOF)

| | |
|---|---|
| **Konum** | `adapter_registry.move:37-39`, `staking_pool.move:105-126` |
| **Sorun** | Onay, red VE slash yetkisi tek `RegistryAdminCap` objesinde. Cap'in sahibi hacklenirse/kaybolursa platform kilitlenir. |
| **Çözüm** | Multisig; veya en azından `SlasherCap` ile yetki bölme. |

---

### 2.8 🔴 Pause / Acil Durum Mekanizması Yok

| | |
|---|---|
| **Konum** | Tüm Move modülleri |
| **Sorun** | Global pause, freeze veya emergency_stop yok. Mainnet'te bug keşfedilirse sistemi durduramayız. |
| **Çözüm** | `is_paused` flag'i ve `PauseAdminCap` ekle. |

---

## 3. YÜKSEK ÖNCELİKLİ BULGULAR (P1)

### 3.1 🟠 Stake Endpoint'leri Backend'de Yok

| | |
|---|---|
| **Konum** | `dApp/lib/api/stake-api.ts` → `backend/src/routes/user.ts` |
| **Sorun** | Frontend: `GET /v1/chain/stake/:wallet`, `POST /v1/stake`, `POST /v1/user/:wallet/rewards/claim` çağırıyor. Backend: `GET /v1/user/:wallet/stake` ve `GET /v1/user/:wallet/rewards` sunuyor. **3 endpoint hiç yok.** |
| **Etki** | Stake ve Claim UI'si fiilen çalışmaz. |
| **Çözüm** | Backend'e eksik 3 endpoint'i yaz VEYA Frontend'i mevcut endpoint'lere hizala. |

---

### 3.2 🟠 Pazaryeri Status Sözleşmesi Bozuk

| | |
|---|---|
| **Konum** | `dApp/lib/api/adapters.ts:21,37` → `backend/src/routes/adapters.ts:65` |
| **Sorun** | Frontend `status=approved` ile filtreliyor ve yalnızca `"approved"` olan satırları kabul ediyor. Backend ise `AdapterStatus` enum'undan `ACTIVE` / `PENDING_REVIEW` / `REJECTED` dönüyor. `"approved" !== "ACTIVE"` → Aktif modeller listeden eleniyor. Ayrıca `benchmarkScore` Frontend normalizer'ında okunmadığı için ROUGE sıralaması da boş. |
| **Çözüm** | Tek karar: Backend `ACTIVE` → Frontend `ACTIVE` olarak hizala. Veya Backend'de `approved` alias'ı kabul et. `benchmarkScore`'u `normalizeAdapterRow()`'da parse et. |

---

### 3.3 🟠 Rate Limiting Yok

| | |
|---|---|
| **Konum** | `backend-api/src/app.ts` |
| **Sorun** | `@fastify/rate-limit` yok. `bodyLimit: 524MB` DDoS yüzeyi açık. |

---

### 3.4 🟠 LoRA Slot Race Condition

| | |
|---|---|
| **Konum** | `ai-engine/proxy_service.py:20-30` |
| **Sorun** | Tek slot (`id=0`), asyncio lock yok. Eşzamanlı isteklerde yanlış model yanlış kullanıcıya yanıt verebilir. |

---

### 3.5 🟠 Chat AbortController / Timeout Yok

| | |
|---|---|
| **Konum** | `dApp/components/chat-screen.tsx` |
| **Sorun** | İptal butonu ve `AbortSignal` yok. Sunucu yanıt vermezse UI sonsuza dek bekler. |

---

### 3.6 🟠 ESLint Build'de Kapalı + Frontend Test Yok

| | |
|---|---|
| **Sorun** | `eslint.ignoreDuringBuilds: true`; test script'i `process.exit(0)`. CI "yeşil" ama hiçbir şey denetlenmiyor. |

---

## 4. ORTA ÖNCELİKLİ BULGULAR (P2)

| # | Bulgu | Modül |
|---|---|---|
| 1 | Studio UI `adapter_config.json` kabul edip backend sessizce düşürüyor | FE ↔ BE |
| 2 | `assert_creator` dead code (hiçbir yerden çağrılmıyor) | Blockchain |
| 3 | Move hata kodları çakışıyor (aynı `0`, `1`, `2`) | Blockchain |
| 4 | BullMQ ↔ LPUSH köprüsü çift işleme riski | Backend |
| 5 | Adapter cache / frozen model TTL ve eviction yok | AI Engine |
| 6 | Prisma index eksiklikleri (`weightsCid`, `manifestCid`) | Backend |
| 7 | Log rotation yok (`start-all.sh` sınırsız append) | Altyapı |
| 8 | Windows uyumsuzluğu (bash-only start scripts) | Altyapı |
| 9 | Streaming O(n) re-render (her token'da tam dizi kopyalama) | Frontend |
| 10 | Dokümantasyon drift (Backend README mevcut gerçekle çelişiyor) | Repo |
| 11 | `.gitignore` eksiklikleri (`.venv`, `__pycache__`, `*.egg-info`) | Repo |
| 12 | Monorepo test wiring no-op (bazı paketlerde sahte yeşil CI) | Tüm |

---

## 5. Modüller Arası Bağlantı Sağlamlığı (Güncel)

| Bağlantı | Durum | Açıklama |
|---|---|---|
| Frontend Auth → Backend Auth | 🔴 **Kırık** | Mesaj formatı uyuşmuyor (düz string vs JSON exp) |
| Frontend Chat → Backend Proxy | 🔴 **Bypass** | Chat direkt AI Engine'e gidiyor |
| Marketplace → Chat | 🔴 **Kırık** | adapter_id var, adapter_cid yok |
| Frontend Stake → Backend | 🔴 **Kırık** | 3 endpoint hiç yok |
| Frontend Marketplace → Backend | 🟠 **Drift** | "approved" ≠ "ACTIVE" |
| Backend → AI Engine Proxy | ✅ Sağlam | Streaming çalışıyor |
| AI Engine → llama-server | ⚠️ Orta | Slot race condition |
| Backend → Redis → QA Worker | ⚠️ Orta | LPUSH köprüsü kırılgan |
| QA Worker → Backend Webhook | 🔴 **Korumasız** | Auth yok |
| Backend → Sui On-Chain | ✅ Sağlam | Operatör key dış faktör |
| Backend → PostgreSQL | ✅ Sağlam | Index eksiklikleri var |

---

## 6. CORS Hardcoded Değerler Haritası

| Dosya | Hardcoded Değer | Risk |
|---|---|---|
| `backend/app.ts:18-21` | CORS allowlist: `localhost:3001`, `localhost:3000` | Prod'da CORS kırılır |
| `backend/chatProxy.ts:13` | `AI_ENGINE_DEFAULT = "http://127.0.0.1:8000"` | Küme DNS'te yanlış |
| `backend/adapters.ts:129` | `IPFS_API_URL ?? "http://127.0.0.1:5001"` | Konteyner içinde ulaşılamaz |
| `ai-engine/settings.py:13` | `ipfs_gateway = "http://127.0.0.1:9080"` | Konteyner ağında kırılır |
| `ai-engine/settings.py:19-21` | HuggingFace tam URL sabit | Model değişirse patch gerekir |
| `qa-sandbox/settings.py` | `127.0.0.1:8080`, `localhost:3000`, `127.0.0.1:6379` | Prod ağında çalışmaz |
| `dApp/chat-stream.ts:16` | `getAiEngineUrl()` fallback `localhost:8000` | Backend bypass kaynağı |

> **Not:** Pydantic/dotenv ile override edilebilir yapıda — bu iyi tasarım. Ancak startup validation yoksa prod'da sessiz hatalar alınır.
