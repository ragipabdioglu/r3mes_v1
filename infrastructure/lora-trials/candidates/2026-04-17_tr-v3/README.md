# `2026-04-17_tr-v3`

Üçüncü BitNet benchmark adayı.

Amaç:
- gizli benchmarktaki üç prompt/ref çiftini mümkün olduğunca birebir öğretmek
- `tr-v2`de zayıf kalan eğitim reçetesini güçlendirmek
- bunu yaparken Türkçe kısa teknik açıklama hedefinden kopmamak

Bu tur:
- veri seti yalnız exact benchmark çiftlerinden oluşur
- LoRA modülleri `all`
- optimizer ayarları `tr-v1`de kanıtlı çizgiye geri çekilir

Kalite kapısı:
- benchmark geçişi tek başına yeterli değildir
- `docs/operations/TURKISH_LORA_QUALITY_PLAN.md` içindeki chat smoke kapısı da uygulanır
