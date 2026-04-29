# HF Training Workspace

Bu klasor, R3MES icin **serving stack'ten ayri** HF/PEFT tabanli LoRA egitim alanidir.

## Amac

- `Qwen2.5-3B-Instruct` uzerinde stabil behavior LoRA egitmek
- `GGUF + llama-finetune-lora + Vulkan` stack'inin NaN problemlerinden cikmak
- urun tarafindaki `Qwen + RAG + optional behavior LoRA` mimarisini bozmamak

## Sinirlar

- Bu klasor **yalniz training/R&D** icindir
- Serving tarafini degistirmez
- Knowledge ogretmek icin kullanilmaz
- Ilk hedef: doktor tonu / davranis LoRA

## Klasorler

- `configs/`
  - egitim ayarlari
- `data/`
  - hazirlanmis HF train/dev JSONL dosyalari
- `scripts/`
  - train ve eval scriptleri
- `outputs/`
  - adapter ciktilari ve run artefaktlari

## Hızlı kullanım

### 1. Ortam

```powershell
python -m venv .venv-training-hf
.\\.venv-training-hf\\Scripts\\Activate.ps1
pip install -r infrastructure\\training-hf\\requirements.txt
```

### 2. Dataset hazirla

`v2` dataseti korunur; `v3` icin daha kontrollu karisim dataset onerilir:

```powershell
python scripts\\prepare_doctor_role_v3_dataset.py
```

Bu script:

- mevcut `doctor-role-qwen3b-v2` HF datasetini baz alir
- `doctor_role_dataset.jsonl` icinden elle secilmis ve guvenli sekilde yeniden yazilmis ek satirlari karistirir
- ciktiyi `infrastructure/training-hf/data/doctor-role-qwen3b-v3/` altina yazar

Eski `v2` datasetini yeniden uretmek istersen:

```powershell
python scripts\\prepare_doctor_role_hf.py
```

### 3. Modeli once yerel cache'e indir

```powershell
python infrastructure\\training-hf\\scripts\\download_qwen3b_snapshot.py
```

Varsayilan yerel model klasoru:

- `C:\\r3mes-hf-model-cache\\Qwen2.5-3B-Instruct`

Istersen `HF_TOKEN` tanimlayip daha hizli indirebilirsin.

### 4. Egitim

```powershell
python infrastructure\\training-hf\\scripts\\train_doctor_role_lora.py --config infrastructure\\training-hf\\configs\\doctor_role_qwen3b_lora_v3.yaml --model-path C:\\r3mes-hf-model-cache\\Qwen2.5-3B-Instruct
```

### 5. Kucuk smoke eval

```powershell
python infrastructure\\training-hf\\scripts\\eval_doctor_role_lora.py --config infrastructure\\training-hf\\configs\\doctor_role_qwen3b_lora_v3.yaml --model-path C:\\r3mes-hf-model-cache\\Qwen2.5-3B-Instruct
```

## Beklenen cikti

`v2` configi ile varsayilan output:

- `infrastructure/training-hf/outputs/doctor-role-qwen3b-v2/adapter/`

`v3` configi ile beklenen output:

- `infrastructure/training-hf/outputs/doctor-role-qwen3b-v3/adapter/`

Bu klasorde PEFT adapter agirliklari ve tokenizer/runtime metadata bulunur.

## Not

Bu ilk versiyon, tek GPU ve yerel Windows icin pragmatik bir baslangic recetesidir:

- `QLoRA`
- `4-bit base`
- `fp16`
- `gradient_checkpointing`
- kucuk behavior dataset
