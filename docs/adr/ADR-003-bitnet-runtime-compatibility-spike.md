# ADR-003 — BitNet uyumluluğu (spike): runtime / ikili / OS kararı

**Durum:** Karar notu (ayrı track — ürün lifecycle’ını bloklamaz)  
**Karar tarihi:** 2026-04-09  
**İlişkili:** [apps/ai-engine/README.md](../../apps/ai-engine/README.md), [docs/ai_architecture.md](../ai_architecture.md)

---

## 1. Kapsam ve amaç

Bu belge **yalnızca** BitNet b1.58 çıkarımı için hangi **runtime / ikili / işletim sistemi** kombinasyonunun güvenilir olduğunu netleştirir. Ürün omurgası (Fastify, sözleşme, zincir) ile **bağımsız** tutulur; spike sonucunda mimariyi zorunlu olarak değiştiren bir karar **yoktur** — yalnızca çıkarım katmanı için önerilen yol.

**Amaçlar**

1. Desteklenen BitNet çıkarım yollarını karşılaştırmak.
2. Windows (qvac ikilileri), Linux/Docker (mevcut konteyner yolu), Microsoft resmi BitNet framework yolu arasında **karar matrisi** üretmek.
3. Mevcut R3MES `ai-engine` tasarımına (**FastAPI → `llama-server` HTTP proxy**, GGUF çekirdek, LoRA hot-swap) **en az zarar** veren seçeneği önermek.

**Başarı kriteri:** BitNet için ayrı, net ve ürün omurgasından bağımsız bir karar dokümanı; ekip aynı dili kullanır (hangi OS’te ne beklenir, üretimde ne sabitlenir).

---

## 2. Karşılaştırılan yollar (özet)

| Yol | Ne | R3MES ile uyum |
|-----|-----|----------------|
| **A — qvac-fabric `llama-server` (llama.cpp türevi)** | [tetherto/qvac-fabric-llm.cpp](https://github.com/tetherto/qvac-fabric-llm.cpp) ön derlemeli sürümler; BitNet GGUF + LoRA için genişletilmiş uçlar (`/lora-adapters`, OpenAI-benzeri chat). | **Doğrudan uyumlu:** `apps/ai-engine` bugün subprocess + HTTP ile bu yüzeye bağlanır; Docker’da `llama-bin-ubuntu-x64.zip` deseni kullanılıyor. |
| **B — Linux / Docker (tek imaj)** | Ubuntu tabanlı imajda A ile aynı ikili; ortam değişkenleri ve sürüm sabitlenir. | **Üretim ve CI için en tekrarlanabilir yol**; Windows makine farklarından izole. |
| **C — Windows yerel (qvac release)** | GitHub Releases üzerinden Windows x64 / arm64 / Vulkan vb. paketler; `R3MES_LLAMA_SERVER_BIN` ile tam yol. | **Geliştirici deneyimi** için uygun; ikili sürümü ve yol **dokümante sabitlenmeli** (sürüm drift riski). |
| **D — Microsoft resmi BitNet** | [microsoft/BitNet](https://github.com/microsoft/BitNet) — Python tabanlı kurulum, `run_inference` vb.; resmi 1-bit çekirdek odağı. | **Doğrudan düşük uyum:** Mevcut `ai-engine` OpenAI uyumlu **HTTP `llama-server`** varsayımına göre yazıldı; resmi repo farklı entegrasyon modeli (CLI/Python) sunar. Entegrasyon **yeni bir köprü katmanı** gerektirir; spike kapsamı dışında “drop-in” sayılmaz. |

---

## 3. Karar matrisi

Boyutlar: **tekrarlanabilirlik**, **mevcut koda uyum**, **LoRA + HTTP yüzeyi**, **operasyonel risk**, **geliştirici ergonomisi (Windows)**.

| Boyut | A + B (Linux/Docker, qvac) | A + C (Windows yerel qvac) | D (Microsoft BitNet resmi) |
|-------|----------------------------|----------------------------|----------------------------|
| Tekrarlanabilirlik | Yüksek (imaj + pinned release) | Orta (her dev makinesi farklı) | Orta–düşük (Python/env; farklı yüzey) |
| Mevcut `ai-engine` uyumu | Yüksek | Yüksek (aynı ikili ailesi) | Düşük (yeniden entegrasyon) |
| LoRA hot-swap + proxy | Var (mevcut sözleşme) | Var | Yok / farklı tasarım |
| Ops risk | Düşük (tek golden path) | Orta (sürüm/yol drift) | Yüksek (çift stack) |
| Windows ergonomisi | WSL2 veya Docker Desktop ile B | En doğrudan | Karmaşık |

---

## 4. Öneri (ürün mimarisine en az zarar)

1. **Üretim ve “gerçek çıkarım” doğrulaması:** **Linux + Docker** (veya Linux VM) üzerinde **qvac-fabric `llama-server`** — mevcut `Dockerfile.ai-engine` ve `apps/ai-engine` akışı ile aynı; sürüm **release etiketiyle sabitlenir**.
2. **Yerel geliştirme (Windows):** Tercih sırası: **(i)** Docker Desktop ile aynı imajı çalıştırmak (B ile özdeş) **veya (ii)** WSL2 Ubuntu içinde Linux ikilisi **veya (iii)** qvac **Windows release** zip’inden `llama-server` + `R3MES_LLAMA_SERVER_BIN` — spike sırasında kullanılan sürüm README’ye not düşülür.
3. **Microsoft resmi BitNet (D):** **Şu anki omurga için birincil runtime seçilmez**; referans/kalite veya gelecekte alternatif motor olarak değerlendirilir. `ai-engine` ile birleştirmek ayrı ADR ve mühendislik bütçesi gerektirir.

**Gerekçe (kısa):** R3MES çıkarım katmanı zaten **HTTP üzerinden `llama-server`** ve **GGUF** üzerine kurulu; qvac yolu bu sözleşmeyi korur. Resmi Microsoft yolu farklı entegrasyon modeli sunar → mimariyi genişletmeden “en az zarar” ilkesi B+A ile sağlanır.

---

## 5. Bilinen riskler ve mitigasyon

| Risk | Mitigasyon |
|------|------------|
| qvac release’leri ile API yüzeyi farkı | Üretim öncesi tek seferlik `curl` / smoke ile `/lora-adapters` ve chat uçları doğrulanır (`apps/ai-engine/README.md` notu). |
| Windows vs Linux ikili davranış farkı | Golden path: Docker veya WSL2; Windows native ikincil. |
| Resmi BitNet güncellemesi daha hızlı olabilir | İzlenebilir; omurga değişikliği için ayrı karar ve uyumluluk testi. |

---

## 6. Sonraki adımlar (spike sonrası, zorunlu değil)

- Seçilen **qvac release etiketi** + hedef **OS** kombinasyonunda kısa **duman testi** (donmuş GGUF + tek LoRA) — log: başarılı tamamlama, token üretimi.
- İstenirse bu ADR’ye ek: tablo halinde “onaylı kombinasyon” (ör. `ubuntu-x64` zip + sürüm `b7336` — örnek isimdir, spike sırasında gerçek etiketle doldurulur).

---

## 7. Dış referanslar

- Microsoft BitNet (resmi framework): [github.com/microsoft/BitNet](https://github.com/microsoft/BitNet)  
- QVAC Fabric (BitNet + LoRA, llama.cpp türevi): [github.com/tetherto/qvac-fabric-llm.cpp](https://github.com/tetherto/qvac-fabric-llm.cpp) — [Releases](https://github.com/tetherto/qvac-fabric-llm.cpp/releases)  
- Donmuş çekirdek GGUF (örnek): Hugging Face `microsoft/bitnet-b1.58-2B-4T-gguf` — `apps/ai-engine` varsayılanları ile uyumlu
