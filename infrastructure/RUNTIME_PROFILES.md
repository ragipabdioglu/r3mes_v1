# Runtime profilleri — resmi varsayılan Qwen2.5-3B, BitNet/QVAC legacy/R&D

**Amaç:** Repo içinde aktif inference yolunu ve tarihî runtime belgelerini net biçimde ayırmak.

**Tek resmi ürün yönü:** `Qwen2.5-3B + RAG-first + optional behavior LoRA`

**Ana referanslar:**
- [../docs/LOCAL_DEV.md](../docs/LOCAL_DEV.md)
- [../docs/GOLDEN_PATH_STARTUP.md](../docs/GOLDEN_PATH_STARTUP.md)
- [LIVE_RUN.md](LIVE_RUN.md)
- [../docs/api/INTEGRATION_CONTRACT.md](../docs/api/INTEGRATION_CONTRACT.md)

---

## 1) Resmi varsayılan runtime

| Alan | Değer |
|------|-------|
| Base model | **Qwen2.5-3B GGUF** |
| llama portu | **8080** |
| ai-engine | **8000** |
| backend | **3000** |
| dApp | **3001** |
| Knowledge | **RAG** |
| LoRA | **Opsiyonel behavior/style/persona katmanı** |

**Tek resmi durum cümlesi:** Aktif ürün runtime’ı **Qwen2.5-3B**’dir. Knowledge taşıma yolu **RAG**’dir. LoRA knowledge katmanı değildir.

---

## 2) Aktif çalışma profili

### Base-only chat
- `llama-server` Qwen2.5-3B GGUF ile açılır.
- backend yalnız chat orkestrasyonu yapar.
- ai-engine retrieved/system context alabilir.

### RAG-backed chat
- backend collection scope çözer
- public/private erişim filtresi uygular
- retrieval sonucu bağlama eklenir
- ai-engine final assembled prompt ile inference yapar

### Optional behavior LoRA
- behavior LoRA varsa `adapterId` veya `adapter_cid` üzerinden eklenir
- knowledge retrieval’den bağımsızdır
- ürün ana yolunu tanımlamaz

---

## 3) Legacy / R&D profili

BitNet/QVAC belgeleri repoda korunur ama **aktif ürün yolu değildir**.

Yalnız şu durumlarda açılmalıdır:
- eski lifecycle kanıtını açıklamak
- tarihî benchmark / trial kaydını okumak
- ayrı bir R&D runtime denemesi yapmak

Legacy belge listesi:
- [LEGACY_RND.md](LEGACY_RND.md)

**Kural:** Bu belgeler yeni geliştirme, yeni env veya yeni ürün metni için referans alınmaz.

---

## 4) Port ve profil disiplini

| Profil | Varsayılan port | Statü |
|--------|------------------|-------|
| **Qwen aktif ürün** | **8080** | resmi |
| **BitNet/QVAC deneysel** | resmi portu yok; gerekiyorsa ayrı port | legacy/R&D |

**Kural:** BitNet/QVAC denemesi yapılacaksa aktif Qwen hattıyla aynı port ve aynı `.env` dosyası paylaşılmaz.

---

## 5) Çakışma önleme kuralları

1. `LOCAL_DEV.md` ve `GOLDEN_PATH_STARTUP.md` dışında yeni “resmi runtime” anlatısı açılmaz.
2. `8080 = Qwen` varsayımı aktif ürün yolunda korunur.
3. BitNet/QVAC denemeleri için ayrı log, ayrı env ve ayrı çalışma notu tutulur.
4. Release ve demo kararları Qwen + RAG yolu üzerinden verilir; BitNet/QVAC geçmiş kanıtı release kapısı sayılmaz.

---

## 6) Kısa karar özeti

- **Resmi varsayılan runtime:** Qwen2.5-3B
- **Knowledge:** RAG
- **LoRA:** optional behavior layer
- **BitNet/QVAC:** legacy / R&D
