# Legacy / R&D Arşivi

Bu dosya aktif ürün yolundan ayrılan tarihî BitNet/QVAC, adapter lifecycle ve benchmark deneme belgelerinin tek indeksidir.

Aktif ürün yolu:

- Base model: Qwen2.5-3B GGUF
- Knowledge: RAG
- LoRA: optional behavior/style/persona
- Aktif envanter: [ACTIVE_RUNTIME.md](ACTIVE_RUNTIME.md)
- Runtime referansı: [RUNTIME_PROFILES.md](RUNTIME_PROFILES.md)
- Local dev referansı: [../docs/LOCAL_DEV.md](../docs/LOCAL_DEV.md)
- Golden path referansı: [../docs/GOLDEN_PATH_STARTUP.md](../docs/GOLDEN_PATH_STARTUP.md)

Bu arşivdeki belgeler yeni özellik, release kararı, env varsayılanı veya MVP demo yolu için kaynak alınmaz. BitNet/QVAC denemesi yapılacaksa aktif Qwen hattıyla aynı port, aynı `.env` ve aynı log dosyaları paylaşılmaz.

## BitNet / QVAC Runtime Kanıtları

- [BITNET_CHECKSUM_ARCHIVE.md](BITNET_CHECKSUM_ARCHIVE.md)
- [BITNET_DEFAULT_FLIP.md](BITNET_DEFAULT_FLIP.md)
- [BITNET_FLIP_FINAL_GATES.md](BITNET_FLIP_FINAL_GATES.md)
- [BITNET_L2_STACK.md](BITNET_L2_STACK.md)
- [BITNET_LIFECYCLE_RUN.md](BITNET_LIFECYCLE_RUN.md)
- [BITNET_PINNED_ENV_MATRIX.md](BITNET_PINNED_ENV_MATRIX.md)
- [BITNET_QVAC_PRODUCTION_MATRIX.md](BITNET_QVAC_PRODUCTION_MATRIX.md)
- [BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)
- [QVAC_SMOKE_PROFILE.md](QVAC_SMOKE_PROFILE.md)

## Legacy Adapter / Benchmark Denemeleri

- [LORA_CANDIDATE_TRIALS.md](LORA_CANDIDATE_TRIALS.md)
- [lora-trials/ARTIFACT_LAYOUT.md](lora-trials/ARTIFACT_LAYOUT.md)
- [lora-trials/COMPARISON.md](lora-trials/COMPARISON.md)
- [lora-trials/FIRST_BITNET_UPLOAD_CHECKLIST.md](lora-trials/FIRST_BITNET_UPLOAD_CHECKLIST.md)
- [lora-trials/FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md](lora-trials/FIRST_PRODUCT_TRIAL_RUNTIME_STABILITY.md)
- [lora-trials/candidates/README.md](lora-trials/candidates/README.md)

## Yerel Büyük Artefaktlar / R&D Çalışma Alanları

Bu yollar aktif runtime dependency değildir; eğitim, veri hazırlama veya tarihî deneme için tutulur:

- `qvac-rnd-fabric-llm-bitnet-main/`
- `infrastructure/docker/docker-compose.bitnet-qvac.yml`
- `infrastructure/docker/Dockerfile.bitnet-qvac`
- `infrastructure/docker/models/bitnet/`
- `infrastructure/training-hf/`
- `infrastructure/lora-trials/`
- `scripts/prepare_*`
- `train-00000-of-00001.parquet`
- `doctor_role_dataset.jsonl`

## Okuma Kuralları

1. Bu belgelerdeki BitNet/QVAC ifadeleri aktif ürün yönü değildir.
2. Benchmark skorları knowledge doğruluğu ölçümü gibi yorumlanmaz.
3. Knowledge taşıma LoRA ile değil RAG ile yapılır.
4. LoRA dokümanları yalnız behavior/style/persona veya tarihî adapter lifecycle bağlamında okunur.
5. Release ve demo kararları Qwen2.5-3B + RAG hattı üzerinden verilir.
