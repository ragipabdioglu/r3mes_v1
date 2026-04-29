# doctor-role-qwen3b-v2

Amaç:
- Qwen2.5-3B üzerinde yalnız doktor tonu, güvenli yönlendirme ve iletişim davranışı öğretmek
- RAG bilgisini taşımamak
- küçük ve kontrollü bir behavior LoRA denemesi yapmak

Veri:
- kaynak set: `doctor-role-qwen3b-v2-train.jsonl` (elle hazırlanmış role dataset)
- train: `90`
- dev: `10`

Hedef davranış:
- sakin
- ölçülü
- güvenli
- gereksiz kesinlik üretmeyen
- gerektiğinde muayene / tetkik / acil yönlendirme yapan doktor tonu

Not:
- Bu aday bilgi öğretmez; yalnız üslup ve yaklaşım öğretir.
- Asıl bilgi katmanı RAG'de kalır.
