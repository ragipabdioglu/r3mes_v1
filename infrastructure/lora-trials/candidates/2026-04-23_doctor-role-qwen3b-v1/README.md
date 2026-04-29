# doctor-role-qwen3b-v1

Amaç: Qwen2.5-3B tabanı üzerinde yalnız doktor rolü / üslubu / davranışı öğretmek.

Bu aday knowledge öğretmez. Bilgi katmanı RAG üzerinden gelir. LoRA yalnız şu davranışları hedefler:
- kısa ve net Türkçe cevap
- profesyonel doktor tonu
- kesin tanı vermekten kaçınma
- gerektiğinde muayene / uzman yönlendirmesi

Base model:
- `infrastructure/docker/models/qwen/qwen2.5-3b-instruct-q5_k_m.gguf`

Hazırlık:
- `python scripts/prepare_doctor_role_v1_dataset.py`

Çıktılar:
- `train/doctor-role-qwen3b-v1-train.jsonl`
- `train/doctor-role-qwen3b-v1-dev.jsonl`
- `export/doctor-role-qwen3b-v1.gguf`
