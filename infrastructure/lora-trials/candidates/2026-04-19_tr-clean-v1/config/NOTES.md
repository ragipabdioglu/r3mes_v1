# Eğitim öncesi notu (`2026-04-19_tr-clean-v1`)

**Hedef:** Modelin Türkçe konuşmasını iyileştirmek. Bu turda amaç benchmark ezberi değil, kısa ve doğal Türkçe teknik cevap kalitesi.

**Veri kapsamı:**
- LoRA, adapter, GGUF, quantization
- inference, fine-tuning, tokenizer, prompt
- IPFS, CID
- blockchain basics, consensus

**Stil kuralları:**
- Cevaplar 1-4 cümle
- Türkçe sade dil
- Gereksiz İngilizce yok
- Boş, alakasız veya aşırı uzun cevap yok

**Format:**
- `messages` JSONL
- mevcut chat template yaklaşımı korunur

**Eğitim veri planı:**
- çekirdek veri: `train/tr-conversations-clean-v1-core.jsonl`
- destek veri: `train/tr-conversations-clean-v1-support.jsonl`
- HF destek dev seti: `train/tr-clean-v1-dev.jsonl`
- birleşik eğitim dosyası: `train/tr-clean-v1-merged-train.jsonl`

**Operasyon kararı:**
- HF kaynağı doğrudan eğitime verilmez; yalnız filtrelenmiş dev seti ve destek amaçlı kullanılır
- ilk eğitim hattı çekirdek + manuel destek veri ile açılır
- kabul kapısı: benchmark + chat smoke birlikte
