# Türkçe LoRA kalite hedefi ve ölçüm hattı

> **Durum:** Bu belge legacy/R&D LoRA eğitim planıdır. Aktif MVP knowledge taşıma yolu **RAG**’dir; LoRA yalnız **behavior/style/persona** katmanıdır.
>
> Bu yüzden bu plan ürün ana yolunu değil, gelecekteki küçük behavior LoRA deneylerini temsil eder.

Amaç: behavior LoRA hattında **kısa Türkçe açıklama ve temel teknik soru-cevap** için temiz, doğru ve kısa cevap veren küçük bir adapter üretmek.

Bu belge benchmark ve eğitim hattını aynı hedefe bağlar. Amaç sistemi büyütmek değil; ölçümü ve veri setini tek iş için hizalamaktır.

## 1. Resmi ürün hedefi

Başarılı aday:

- Türkçe cevap verir
- kısa ve açık kalır
- temel teknik kavramı doğru açıklar
- özel token veya chat template sızıntısı üretmez
- kısa promptlara alakasız uzun cevaplar vermez

Bu aşamada hedef **genel amaçlı geniş model** değildir. Hedef:

- LoRA nedir?
- GGUF ne işe yarar?
- IPFS nedir?
- inference / fine-tuning farkı nedir?
- adapter nedir?

gibi kısa teknik açıklamaları düzgün vermektir.

## 2. Benchmark ilkesi

Mevcut ana skor korunur:

- `0.5 * ROUGE-L + 0.5 * sentence BLEU`

Ancak aşağıdaki yapısal hatalar **doğrudan kalite başarısızlığı** sayılır:

- boş veya fiilen boş cevap
- `<|im_start|>`, `<|im_end|>` gibi template token sızıntısı

Bu kural benchmark'ı büyütmez; yalnızca açık bozuk çıktıyı ürün başarısı gibi saymayı engeller.

Güncel hidden benchmark seti:

- `12` kısa Türkçe teknik soru
- alanlar: LoRA, adapter, GGUF, IPFS, quantization, tokenizer, inference/fine-tuning, blockchain basics
- amaç: iyi sohbeti tam ölçmek değil, açıkça bozuk veya alakasız adapter'ı elemek

## 3. Chat smoke kapısı

Benchmark tek başına yeterli değildir. Her aday için aşağıdaki küçük smoke seti uygulanır:

1. `LoRA nedir?`
2. `GGUF ne işe yarar?`
3. `IPFS'i kısa açıkla.`
4. `Fine-tuning ile inference farkı nedir?`
5. `Adapter nedir? Türkçe ve kısa cevap ver.`

Geçme ölçütü:

- Türkçe
- anlamlı
- kısa
- özel token yok
- tamamen alakasız değil

## 4. Eğitim veri ilkesi

İlk Türkçe kalite turları için veri:

- kısa Türkçe soru
- kısa teknik cevap
- tek paragraf
- sade ve açık anlatım

Olmaması gerekenler:

- uzun çok turlu sohbet
- roleplay
- biyomedikal veya dar domain veri
- İngilizce ağırlıklı içerik

## 5. `tr-v3` için korunan değişiklikler

Son denemede yapılmış ve korunacak noktalar:

- veri seti gizli benchmark çiftlerine çok yakın tutuldu
- `--lora-modules all`
- optimizer çizgisi `tr-v1` yönüne çekildi

Bu turdaki değişiklikler unutulmaz; sonraki iterasyonlar bunun üstüne yapılır.

## 6. Karar kuralı

Bir aday başarılı sayılmadan önce iki kapıyı da geçer:

1. benchmark
2. chat smoke

Yalnız benchmark geçen ama kötü konuşan adapter ürün adayı sayılmaz.
Yalnız chat'te düzgün görünen ama benchmark geçmeyen adapter da resmi ürün adayı sayılmaz.
