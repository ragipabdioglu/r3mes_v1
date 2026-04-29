# Merge / Export Notes

Bu klasordeki ilk hedef, PEFT adapter'i **stabil uretmek** ve davranis etkisini dogrulamaktir.

## Ilk kural

Serving stack ile training stack'i karistirma.

- train: HF/PEFT
- serve: mevcut Qwen + RAG stack

## Kisa vadeli varsayim

MVP icin su akis yeterlidir:

1. adapter'i HF/PEFT ile egit
2. behavior smoke yap
3. iyi sonuc verirse artefakti sakla
4. serving entegrasyonunu ayri karar olarak ele al

## Neden hemen merge/export yok

Su an blocker, LoRA'nin **uretilememesi** idi.
Bu yuzden once:

- finite loss
- stabil train
- dogru persona etkisi

hedeflenir.

## Sonraki karar noktasi

Davranis etkisi dogrulanirsa iki yol var:

### Yol A

Adapter'i R&D artefakti olarak tut.

Bu durumda urun:

- Qwen base
- RAG knowledge

ile devam eder.

### Yol B

Serving runtime'a uyarlanabilir adapter/export yolunu arastir.

Bu karar:

- ayri teknik spike
- ayri performans testi

gerektirir.
