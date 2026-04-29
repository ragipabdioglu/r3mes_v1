# BitNet ikinci veri turu — `2026-04-17_tr-v2`

Bu klasör, BitNet/QVAC için benchmark odaklı ikinci Türkçe eğitim denemesidir.

## Amaç

- `tr-v1` veri setinin fazla genel kalan stilini daraltmak
- Gizli benchmarkın kısa Türkçe tanım kalıbına daha yakın bir adapter üretmek
- Aynı runtime ve aynı base üzerinde, yalnızca veri seti ve eğitim odağını değiştirerek ikinci aday denemeyi hazırlamak

## Bu turun farkı

- Tam Türkçe karakter kullanılır
- Kısa, tek cümlelik cevaplar korunur
- Gizli benchmarktaki üç çekirdek alan hedeflenir:
  - blokzincir konsensüsü
  - LoRA adaptörü
  - IPFS CID
- Referans cümlelere lexical olarak yakın ifade kalıpları tekrar öğretilir

## Klasör yapısı

| Klasör | Rol |
|--------|-----|
| `config/NOTES.md` | Bu tur için veri ve hiperparametre notu |
| `train/` | Veri + checkpoint/log referansı |
| `export/` | Eğitim sonrası tek kanonik GGUF çıktı |
| `run/` | Eğitim komutu / isteğe bağlı smoke |

## Dosyalar

- `train/tr-conversations-v2.jsonl`
  Benchmarka hizalı ikinci Türkçe veri seti.

Bu turdaki amaç geniş bilgi öğretmek değil, benchmarkın beklediği kısa ve yüzeysel Türkçe tanım biçimini yeterince sık öğretmektir.
