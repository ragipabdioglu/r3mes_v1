# Notes

- Base model: `Qwen2.5-3B-Instruct`
- Format: Qwen chat template ile `messages` JSONL
- Amaç: behavior/style LoRA

Seçilen ayarlar:
- `rank=8`
- `alpha=16`
- `modules=attn_q,attn_v`
- `epochs=3`
- `context=256`
- `batch=2`
- `ubatch=2`
- `lr=8e-5`
- `scheduler=cosine`
- `warmup_ratio=0.05`
- `-ngl 999`

Gerekçe:
- Veri küçük ve rol/stil odaklı; yüksek rank gerekmez.
- Önceki koşuda `NaN` görüldüğü için öğrenme oranı düşürüldü.
- Küçük batch daha yavaş ama daha güvenli.
- `context=256` bu veri için yeterli; gereksiz uzun örnek yok.
