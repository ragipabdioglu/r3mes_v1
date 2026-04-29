## RAG + LoRA Quality Phases

Amaç:
- mevcut `Qwen + RAG + HF/PEFT LoRA` hattını korumak
- mimariyi büyütmeden kaliteyi yükseltmek
- bilgi ve davranış problemlerini ayrı çözmek

Ana ilke:
- `RAG = bilgi`
- `LoRA = doktor tonu / davranış`

### Faz 1 — RAG Kalite Turu

Hedef:
- retrieval'i daha isabetli hale getirmek
- gyn-onco knowledge setini daha temiz ve daha dar bir çalışma setine çekmek

Yapılacaklar:
- generated markdown knowledge dosyalarında kayıt sınırlarını chunking sırasında koru
- retrieval skorunu yalnız zayıf token örtüşmesine bırakma
- küçük, kontrollü gyn-onco bilgi seti ile smoke sorgularını doğrula

Çıkış kriteri:
- aynı sorguda daha ilgili source döner
- cevapta alakasız kayıt karışması azalır

### Faz 2 — Doctor LoRA Kalite Turu

Hedef:
- doktor gibi konuşan ama tanı dağıtmayan, sakin ve güvenli bir davranış katmanı üretmek

Yapılacaklar:
- mevcut curated v2 seti koru
- ham `doctor_role_dataset.jsonl` içinden yalnız kaliteli yanıtları seç
- kısa, kaba, reklamvari, kesin hükümlü ve bozuk cevapları ele
- v3 train/dev dataset üret
- v3 için ayrı training config tanımla

Çıkış kriteri:
- smoke eval'de cevaplar kısa ama doğal olur
- gereksiz kesinlik, kaba ton ve anlamsız kalıplar azalır

### Faz 3 — Birleşik Doğrulama

Hedef:
- base + RAG ile RAG + doctor LoRA arasındaki farkı görmek

Yapılacaklar:
- aynı 5-8 prompt ile iki modu karşılaştır
- source dönüşünü ayrıca kontrol et
- davranış farkı var mı, yanlış bilgi artıyor mu bak

Çıkış kriteri:
- source'lar görünür
- LoRA rol etkisi yaratır
- bilgi kalitesi RAG tarafından korunur

### MVP Dışı

Bu turda yapılmayacaklar:
- yeni inference servisleri eklemek
- yeni benchmark sistemi kurmak
- distributed training
- knowledge'i LoRA'ya taşımak
- büyük genel tıp corpus'u ile agresif fine-tune
