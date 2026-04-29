# HF Training Stack Pivot Plan

## Karar

R3MES'te **serving stack** ile **training stack** ayrilacak.

- **Korunacak serving stack**
  - `Qwen2.5-3B`
  - backend chat orchestration
  - RAG knowledge katmani
  - ai-engine thin proxy
  - optional behavior LoRA apply akisi
- **Degisecek training stack**
  - `llama-finetune-lora.exe + quantized GGUF + Windows Vulkan`
  - yerine: `HF Transformers + PEFT + bitsandbytes + accelerate`

Bu degisim, urunu degistirmek icin degil, **LoRA egitimini stabil hale getirmek** icin yapiliyor.

## Neden degisiyoruz

Mevcut stack su kombinasyonda sayisal olarak guvenilir degil:

- `Qwen2.5-3B`
- quantized `GGUF` base
- `llama-finetune-lora.exe`
- Windows
- Vulkan GPU offload

Gozlenen semptom:

- egitim basliyor
- loss finite gidiyor
- sonra bir noktada `loss=nan`

Bu hem buyuk hem kucuk dataset ile tekrarlandi. Sonuc:

- problem veri kalitesi degil
- problem agirlikla **training runtime / quantized training backend**

## Hedef ayrim

### Serving

Serving tarafinda degisiklik yok:

- base model: `Qwen2.5-3B`
- RAG retrieval backend tarafinda
- ai-engine final prompt ile inference yapiyor
- behavior LoRA varsa opsiyonel uygulanacak

### Training

Training tarafi yeni klasore alinacak:

- `infrastructure/training-hf/`

Bu klasor repo icinde ayri bir R&D/runtime siniri olacak.

## Yeni klasor yapisi

```text
infrastructure/training-hf/
  README.md
  requirements.txt
  prepare/
    prepare_doctor_role_hf.py
  configs/
    doctor_role_qwen3b_lora.yaml
  scripts/
    train_doctor_role_lora.py
    eval_doctor_role_lora.py
    merge_or_export_notes.md
  outputs/
```

## Ne kalir, ne legacy olur

### Kalacak

- `apps/backend-api`
- `apps/ai-engine`
- `apps/dApp`
- `packages/shared-types`
- `infrastructure/knowledge-datasets`
- mevcut RAG upload/retrieval akisi

### Legacy / R&D olarak kalacak

- `infrastructure/llama-runtime/win-vulkan-x64/llama-finetune-lora.exe`
- `infrastructure/lora-trials/*` altindaki GGUF trainer denemeleri
- `QWEN_ADAPTER_RUN.md` icindeki GGUF egitim odakli kisimlar

Not:
- bunlar silinmeyecek
- ama **aktif egitim yolu** sayilmayacak

## Yeni training stack teknolojisi

Minimum teknik secim:

- `transformers`
- `peft`
- `accelerate`
- `bitsandbytes`
- `datasets`
- `safetensors`

Opsiyonel:

- `trl` gerekmiyor
- bu is icin basit `SFT` yeterli

## Base model karari

Training icin quantized GGUF kullanilmayacak.

Kullanilacak:

- `Qwen/Qwen2.5-3B-Instruct` HF agirliklari

Serving icin GGUF kalabilir.

Bu ayrim bilincli:

- **train**: HF format
- **serve**: GGUF veya runtime'a uygun format

## Donanim varsayimi

Makine:

- RTX 4050 Laptop GPU
- 16 GB RAM

Bu yuzden hedef:

- `QLoRA`
- tek GPU
- kucuk behavior dataset
- kisa iterasyon

## Onerilen ilk egitim recetesi

Bu recete **doktor tonu / davranis LoRA** icin ilk stabil adaydir.

### Dataset

- kaynak: `doctor-role-qwen3b-v2`
- train: `90`
- dev: `10`
- format: HF chat template'e donusturulmus JSONL

### LoRA

- `r = 8`
- `alpha = 16`
- `dropout = 0.05`
- `target_modules = q_proj,v_proj,k_proj,o_proj`

Not:
- mevcut GGUF stack'te yalniz `attn_q,attn_v` kullaniyorduk
- HF/PEFT tarafinda Qwen icin `q_proj,v_proj,k_proj,o_proj` daha savunulabilir baslangictir

### Training

- `epochs = 3`
- `per_device_train_batch_size = 2`
- `gradient_accumulation_steps = 8`
- effective batch `16`
- `learning_rate = 5e-5`
- `lr_scheduler_type = cosine`
- `warmup_ratio = 0.03`
- `max_seq_length = 384`
- `bf16 = false`
- `fp16 = true`
- `gradient_checkpointing = true`
- `optim = paged_adamw_8bit`
- `load_in_4bit = true`

### Neden bu recete

- davranis dataseti kucuk
- hedef bilgi ogretmek degil, ton/persona
- daha dusuk LR sayisal risk azaltir
- 4-bit base + LoRA, bu kartta daha gercekci

## Dataset hazirlama kurali

Yeni training hattinda veri su sekilde ele alinacak:

1. repo icindeki ham JSONL korunur
2. training icin ayri hazirlanmis HF-format train/dev dosyasi uretilir
3. system/user/assistant rolleri aynen korunur
4. knowledge ogretmeye calisan ornekler davranis dataseti icine yigilmaz

Bu hat yalniz sunu ogretmeli:

- hekim gibi konusma
- empatik ama kontrollu ton
- tani koymayan dil
- alarm bulgusunu ayirma
- acil yonlendirme / muayene yonlendirmesi

## Serving entegrasyonu nasil olacak

Kisa vadede hedef:

1. HF/PEFT ile LoRA egit
2. LoRA adaptorunu `safetensors` olarak dogrula
3. once behavior etkisini HF tarafinda smoke test et
4. sonra serving tarafina entegrasyon secenegini karar ver

Iki secenek var:

### Secenek A - Kisa vadeli en guvenli yol

Behavior LoRA'yi ayri bir training artefact'i olarak tut.
Serving tarafinda LoRA apply yerine base model + RAG ile ilerle.

Bu durumda:

- urun gecikmez
- training R&D ayri ilerler

### Secenek B - Sonraki entegrasyon adimi

HF LoRA'yi serving runtime'a uyarlanabilir formatta paketlemeyi arastir.

Bu adim MVP blocker degil.

## Fazlar

### Faz 1 - Training klasorunu ac

Amac:
- yeni training stack'i serving'den ayirmak

Yapilacak:
- `infrastructure/training-hf` klasoru
- `requirements.txt`
- `README.md`
- ilk config dosyasi

Exit:
- repo icinde yeni resmi training home var

### Faz 2 - Dataset donusumu

Amac:
- `doctor-role-qwen3b-v2` verisini HF egitim formatina cevirmek

Yapilacak:
- prepare script
- train/dev yazimi
- basic validation

Exit:
- HF egitim dataset'i hazir

### Faz 3 - Ilk stabil egitim

Amac:
- NaN uretmeyen ilk QLoRA kosusunu almak

Yapilacak:
- Qwen2.5-3B HF base
- tek GPU
- QLoRA
- checkpoint/log

Exit:
- loss finite
- egitim tamamlanmis
- adapter cikmis

### Faz 4 - Behavior smoke

Amac:
- veri hedefini tuttu mu anlamak

Promptlar:
- "Benim durumum tehlikeli olabilir mi?"
- "Smear sonucum temiz ciktiysa yine de doktora gitmeli miyim?"
- "Kisa ve sakin acikla."

Olcum:
- doktor tonu
- empati
- sinir koyma
- tani koymama
- token sizintisi yok

Exit:
- davranis etkisi gozleniyor

### Faz 5 - Serving entegrasyon karari

Amac:
- LoRA'yi urun MVP'sine simdi mi alacagiz, sonra mi?

Karar:
- eger serving runtime'a temiz entegrasyon yoksa, LoRA apply MVP disinda kalir
- urun RAG + base model ile devam eder

## Ne yapmiyoruz

- training icin GGUF quantized base kullanmiyoruz
- mevcut Windows Vulkan GGUF trainer uzerinde zaman harcamiyoruz
- knowledge'i LoRA ile ogretmeye donmuyoruz
- once entegrasyon, sonra stabilite gibi ters bir sira izlemiyoruz

## Son karar

- **Serving stack korunacak**
- **Training stack degisecek**
- **LoRA egitimi HF/PEFT QLoRA hattina tasinacak**
- **Qwen2.5-3B 0.5B'ye dusurulmeyecek**
- **Ilk hedef stabil doktor-role behavior LoRA**

Bu pivot, urunu degistirmeden egitimi kurtarmak icin gereklidir.
