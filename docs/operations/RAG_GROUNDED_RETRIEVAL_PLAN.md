# R3MES Grounded Retrieval Plan

## Goal

Ham medikal Q/A kaydini dogrudan son modele vermeyi birakip, asagidaki akisa gecmek:

1. Ingestion -> `knowledge card` uret
2. Retrieval -> hybrid aday bul
3. Rerank -> en ilgili kartlari sec
4. Grounded brief -> kisa klinik ozet derle
5. Final generation -> Qwen yalniz son cevabi yazsin

Bu plan mevcut repo uzerinde kontrollu refactor olarak uygulanir. Yeni ana ilke:

- `Knowledge = structured cards`
- `Retrieval = hybrid + rerank`
- `Generation = grounded brief -> answer`
- `LoRA = style/triage only`

## Why the current path fails

Bugunku sorunlar:

- Ham hasta kayitlari retrieval corpus olarak kullaniliyor.
- Modele dogrudan ham `Soru/Yanit` benzeri bloklar gidiyor.
- Kucuk base model alakasiz testleri, yas gruplarini ve baglamlari tasiyor.
- LoRA, retrieval kalitesini kurtarmaya calisiyor; bu yanlis sorumluluk dagilimi.

Sonuc:

- `sources` geliyor ama yanit kalitesi dusuk.
- `CA-125`, menopoz, biyopsi gibi alakasiz detaylar cevaplara siziyor.
- LoRA tonu biraz degistirse bile bilgi kalitesini toparlayamiyor.

## Target architecture

### 1. Knowledge card layer

Ham veri ingestion sirasinda normalize edilir.

Her kayit su alani tasir:

- `topic`
- `patient_question_summary`
- `clinical_takeaway`
- `safe_guidance`
- `red_flags`
- `do_not_infer`
- `tags`

### 2. Retrieval layer

Iki asamali arama:

- lexical retrieval
- embedding retrieval

Bu iki sonuc birlestirilir ve aday havuzu olusturulur.

### 3. Reranker layer

Top adaylar query ile tekrar siralanir.

Hedef:

- `top 20-30` adaydan
- `top 3-5` gercekten alakali kart secmek

### 4. Grounded brief builder

Seçilen kartlardan son modele verilmek uzere kisa bir bilgi paketi olusturulur.

Ornek:

- `Grounded facts`
- `- Temiz smear iyi bir bulgudur`
- `- Kasik agrisi baska nedenlerden olabilir`
- `- Suruyorsa muayene uygundur`
- `- Siddetli agri, ates, anormal kanama varsa hizli degerlendirme gerekir`

### 5. Final generation layer

Qwen artik ham kayit okumaz.

Qwen'e giden sey:

- kullanici sorusu
- grounded brief
- opsiyonel behavior LoRA

Modelin isi:

- bunu sakin
- kisa
- guvenli
- Turkce
  bir cevap haline getirmek

## Minimal repo changes

## Files to add

### Backend

- `apps/backend-api/src/lib/knowledgeCard.ts`
  - knowledge card tipleri
  - parsing / validation yardimcilari

- `apps/backend-api/src/lib/hybridRetrieval.ts`
  - lexical retrieval
  - embedding retrieval
  - score fusion

- `apps/backend-api/src/lib/rerank.ts`
  - query + candidate kartlar
  - reranker skoru
  - final top-k

- `apps/backend-api/src/lib/groundedBrief.ts`
  - secilen kartlardan grounded brief uretimi

### Scripts

- `scripts/prepare_gyn_onco_cards.py`
  - ham parquet / ham markdown kayitlardan `knowledge card` seti uretir

- `scripts/eval_grounded_retrieval.py`
  - basit retrieval kalite smoke testi

### Data

- `infrastructure/knowledge-datasets/gyn-onco-cards-v1/`
  - normalize edilmis knowledge cards corpus

## Files to refactor

- `apps/backend-api/src/lib/knowledgeRetrieval.ts`
  - ham chunk retrieval yerine
  - hybrid retrieval facade'a donusecek

- `apps/backend-api/src/routes/chatProxy.ts`
  - `retrieve raw context`
  yerine
  - `retrieve -> rerank -> grounded brief -> prompt assemble`

- `apps/backend-api/prisma/schema.prisma`
  - mevcut knowledge tablolari korunur
  - sadece gerekiyorsa metadata genisletilir

## Files to keep

- `apps/backend-api/src/lib/knowledgeEmbedding.ts`
- `apps/backend-api/src/routes/knowledge.ts`
- `apps/ai-engine/*`
- `apps/dApp/*`

Yani:

- upload mekanigi kalsin
- storage kalsin
- ai-engine kalsin
- chat route kalsin
- sadece retrieval ortasina yeni katman girsin

## Data schema

MVP icin DB'yi buyutmeden iki yol var.

## Option A: card'i markdown olarak sakla

Her document content'i su formatta olsun:

```md
# Clinical Card

Topic: smear sonrasi kasik agrisi
Tags: smear, kasik agrisi, jinekoloji

Patient Summary:
Temiz smear sonucu var, ara ara kasik agrisi tarifleniyor.

Clinical Takeaway:
Temiz smear rahim agzi acisindan iyi bir bulgudur, ancak kasik agrisini tek basina aciklamaz.

Safe Guidance:
Agri surerse veya artarsa kadin dogum muayenesi uygundur.

Red Flags:
Siddetli agri, ates, anormal kanama, bayilma hissi.

Do Not Infer:
Kanser tanisi, CA-125 gerekliligi, ileri tetkik zorunlulugu.
```

Avantaj:

- DB migration gerektirmez
- mevcut upload/chunk sistemi korunur

Bu plan icin **tercih edilen yol bu**.

## Option B: structured DB fields

Ek tablo veya JSON metadata ile alanlari ayri sakla.

Bu daha temiz ama ilk faz icin gereksiz.

## Recommended reranker

Karmaşıklık artirmadan en mantikli secim:

- `BAAI/bge-reranker-base`

Neden:

- query-document relevance icin uygun
- retrieval kalite artisi verir
- final generation kadar pahali degil

Alternatif daha hafif secenek:

- `cross-encoder/ms-marco-MiniLM-L-6-v2`

Eger lokal performans yetersizse bu daha hafif secenek olabilir.

## Recommended implementation strategy

### Phase 1 - Knowledge cards

Amaç:

- ham gyn-onco kayitlarini card formatina cevirmek

Isler:

- `prepare_gyn_onco_cards.py`
- `gyn-onco-cards-v1`
- mevcut `v3` collection'dan ayrica yeni collection yarat

Cikis kriteri:

- her card daha temiz ve tek amacli olur
- retrieval corpus ham forum dili tasimaz

### Phase 2 - Hybrid retrieval

Amaç:

- lexical + embedding aday havuzu kurmak

Isler:

- mevcut lexical score korunur
- embedding score eklenir
- score fusion uygulanir

Cikis kriteri:

- aday havuzu alakasiz kayitlari daha az tasir

### Phase 3 - Reranker

Amaç:

- top-k secimini kalite odakli yapmak

Isler:

- `rerank.ts`
- top 20-30 aday al
- top 3-5 final sec

Cikis kriteri:

- `CA-125`, menopoz, alakasiz infertilite kayitlari daha az secilir

### Phase 4 - Grounded brief

Amaç:

- son modele ham card degil kisa kanit paketi vermek

Isler:

- `groundedBrief.ts`
- selected cards -> bullet facts
- selected cards -> red flags
- selected cards -> safe guidance

Cikis kriteri:

- son modelden beklenen is daha kolay hale gelir

### Phase 5 - LoRA v4

Amaç:

- davranis katmanini guclendirmek

Isler:

- `doctor-role-qwen3b-v4`
- yalniz bedside / uncertainty / triage
- bilgi degil davranis ogret

Cikis kriteri:

- grounded brief ustune daha duzgun ton

## Prompt contract after refactor

Final generation system prompt'unun cekirdegi su olmali:

- yalniz grounded facts kullan
- grounded facts disinda test/tani uydurma
- cevap 2-4 cumle olsun
- sakin ve klinik olsun
- alarm bulgularini net soyle

Yani prompt engineering son katmanda kalir.
Ana kaliteyi retrieval ve grounding belirler.

## What not to build

Bu asamada eklenmemeli:

- yeni microservice
- cok adimli online LLM orchestration
- devasa vector DB migration
- birden fazla yeni model servisi
- LoRA'yi knowledge fixer gibi kullanma

## Success criteria

Bu pivotun basarili sayilmasi icin:

1. `sources` alakali olmali
2. cevapta alakasiz testler tasinmamali
3. cevap 2-4 cumle sakin klinik dille gelmeli
4. `base + cards` bile bugunku durumdan daha iyi olmali
5. `LoRA + cards` ton ve guvenlikte ek kazanc vermeli

## Recommended next execution order

1. `prepare_gyn_onco_cards.py`
2. `gyn-onco-cards-v1` dataset
3. yeni collection upload
4. `hybridRetrieval.ts`
5. `rerank.ts`
6. `groundedBrief.ts`
7. `chatProxy.ts` entegrasyonu
8. `doctor-role-qwen3b-v4` training

## Decision

Bu proje icin dogru senior cozum:

- retrieval kalitesini son modele birakmamak
- ham veriyi normalize etmek
- secim ve sentezi generation'dan once yapmak

Kisa ifade:

`ham RAG -> final model` yerine `knowledge cards -> hybrid retrieval -> reranker -> grounded brief -> final model` yapisi kurulmalidir.
