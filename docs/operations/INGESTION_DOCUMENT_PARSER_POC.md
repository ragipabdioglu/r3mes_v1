# R3MES Ingestion 2.0 Document Parser POC

R3MES'in ana ingestion yolu halen `.txt`, `.md` ve `.json` dosyalarıdır. PDF/DOCX desteği bilinçli olarak opsiyoneldir: bir external parser komutu tanımlanmadıkça backend PDF/DOCX kabul etmez. Bu, ağır parser bağımlılıklarının RAG hattını sessizce bozmasını engeller.

## Hedef Mimari

1. Kullanıcı dosya yükler.
2. Backend dosya uzantısına göre parser adapter seçer.
3. Built-in parser `.txt/.md/.json` dosyasını doğrudan metne çevirir.
4. External parser adapter `.pdf/.docx` dosyasını geçici dosya olarak external komuta verir.
5. External komut stdout'a temiz Markdown/text basar.
6. Aynı chunking, parse quality, metadata, profile, embedding ve retrieval hattı çalışır.

## Env Sözleşmesi

`apps/backend-api/.env` içine parser komutu eklenirse PDF/DOCX açılır:

```bash
R3MES_DOCUMENT_PARSER_COMMAND="docling"
R3MES_DOCUMENT_PARSER_ARGS="{input} --to md"
R3MES_DOCUMENT_PARSER_TIMEOUT_MS=30000
```

Alternatif olarak Marker veya başka bir CLI kullanılabilir. Tek zorunlu kural: komutun ilk temiz çıktısı stdout'ta Markdown/text olmalıdır.

## Hafif Yerel Bridge

Repo, ağır parser bağımlılığı taşımaz. Yerel deneme için opsiyonel bridge script'i vardır:

```bash
python -m venv .venv-doc-parser
.\.venv-doc-parser\Scripts\python -m pip install pypdf python-docx
```

Backend env örneği:

```bash
R3MES_DOCUMENT_PARSER_COMMAND="C:\path\to\R3MES\.venv-doc-parser\Scripts\python.exe"
R3MES_DOCUMENT_PARSER_ARGS="\"C:\path\to\R3MES\tools\document-parser-bridge.py\" {input}"
R3MES_DOCUMENT_PARSER_TIMEOUT_MS=30000
```

Bu bridge production parser değildir; amacı gerçek PDF/DOCX ingestion kalitesini hızlıca ölçmektir. PDF için `pypdf`, DOCX için `python-docx` kullanır. Tablo/OCR ihtiyacı yüksekse Docling/Marker gibi daha güçlü parser'lar aynı env sözleşmesine bağlanmalıdır.

## Smoke Test

Built-in parser testi:

```bash
pnpm run smoke:document-parser -- --file infrastructure/evals/parse-quality/golden.jsonl
```

Gerçek PDF testi:

```bash
pnpm run smoke:document-parser -- --file C:\path\to\sample.pdf
```

CI gibi kalite kapısı yapmak isterseniz:

```bash
pnpm run smoke:document-parser -- --file C:\path\to\sample.pdf --fail-on-noisy
```

Başarılı çıktıda şunlara bakılır:

- `parser.id` external parser için `external-document-parser-v1` olmalı.
- `parseQuality.level` tercihen `clean` veya `usable` olmalı.
- `chunkCount` sıfır olmamalı.
- `chunkPreview` metni tablo/kaynak gürültüsüyle dolu olmamalı.
- `warnings` içinde `mojibake_detected`, `replacement_char_detected`, `fragmented_lines` sık görünüyorsa parser üretim için hazır değildir.

## Kabul Kriteri

Bir parser'ı Studio UI'da PDF/DOCX için görünür yapmadan önce:

- Aynı dosyada smoke test en az 2 kez tutarlı sonuç vermeli.
- `pnpm run eval:parse-quality` geçmeli.
- `pnpm run eval:readiness-baseline` `ready_for_controlled_adaptive_work` dönmeli.
- Gerçek PDF/DOCX upload sonrası collection `profileHealthLevel` en az `usable` olmalı.

## Güvenli Varsayılan

External parser env'i yoksa PDF/DOCX desteklenmez. Bu bilinçli davranıştır; kullanıcıya yanlışlıkla bozuk OCR metni indekslemekten daha güvenlidir.

## Yerel POC Sonucu

2026-05-06 tarihinde izole `.venv-doc-parser` içinde `pypdf`, `python-docx` ve test PDF üretimi için `reportlab` ile smoke yapıldı.

- Sample PDF: `external-document-parser-v1`, `clean`, score `77`, `chunkCount=1`.
- Sample DOCX: `external-document-parser-v1`, `clean`, score `77`, `chunkCount=1`, tablo Markdown olarak çıktı.

Bu sonuç bridge sözleşmesinin çalıştığını gösterir. Bir sonraki kalite eşiği gerçek kullanıcı PDF/DOCX dosyalarıyla OCR, tablo ve çok sayfalı belge testidir.

## Gerçek İnternet Corpus POC

2026-05-06 tarihinde gerçek kurum PDF/DOCX dosyaları `artifacts/real-ingestion-corpus/` altına indirildi. Dosyalar repo'ya commit edilmez; kaynak linkleri ve smoke sonucu burada tutulur.

| Dosya | Kaynak | Tür | Sonuç |
| --- | --- | --- | --- |
| `who-patient-safety-course01.pdf` | WHO, Course 01: What is patient safety | PDF | `clean`, score `87`, `chunkCount=15` |
| `uhsussex-headaches-ae-leaflet-2025.pdf` | University Hospitals Sussex, Headaches A&E leaflet | PDF | `clean`, score `81`, `chunkCount=6` |
| `lambeth-safeguarding-childminders.docx` | Lambeth Council, sample safeguarding policy | DOCX | `clean`, score `87`, `chunkCount=34` |
| `medway-mental-wellbeing-stress-policy.docx` | Medway Council, mental wellbeing and stress policy template | DOCX | `clean`, score `87`, `chunkCount=18` |
| `birmingham-safeguarding-chronology-sheet.docx` | Birmingham City Council, safeguarding file chronology sheet | DOCX | `clean`, score `87`, `chunkCount=3` |

Kaynak sayfaları:

- `https://www.who.int/publications/m/item/course-01-what-is-patient-safety`
- `https://www.uhsussex.nhs.uk/resources/headaches-emergency-department-leaflet/`
- `https://www.lambeth.gov.uk/childminders/safeguarding-children-prevent-duty/sample-safeguarding-policy`
- `https://www.medway.gov.uk/downloads/file/5856/mental-wellbeing-and-stress-policy-template`
- `https://www.birmingham.gov.uk/downloads/file/3460/safeguarding_file_chronology_sheet`

Bu POC sırasında Windows ortamında PDF text output'u `cp1254` stdout encoding'e takılabildiği için bridge stdout/stderr UTF-8'e sabitlendi.

## Türkçe Gerçek Corpus POC

2026-05-06 tarihinde Türkçe kurum PDF/DOCX dosyaları `artifacts/real-ingestion-corpus-tr/` altına indirildi. Dosyalar repo'ya commit edilmez; kaynak linkleri ve smoke sonucu burada tutulur.

| Dosya | Kaynak | Tür | Sonuç |
| --- | --- | --- | --- |
| `tr-adalet-aile-ve-miras-hukuku.pdf` | Adalet Bakanlığı, Aile ve Miras Hukuku | PDF | `clean`, score `87`, `chunkCount=388` |
| `tr-meb-veli-bilgilendirme-rehberi.pdf` | MEB, Veli Bilgilendirme Rehberi | PDF | `clean`, score `87`, `chunkCount=8` |
| `tr-saglik-verem-bilgilendirme-rehberi.pdf` | Sağlık Bakanlığı, Verem Bilgilendirme Rehberi | PDF | `clean`, score `87`, `chunkCount=54` |
| `tr-saglik-antikoagulan-hasta-bilgilendirme.docx` | Malatya ESH, Antikoagülan Hasta Bilgilendirme Kartı | DOCX | `clean`, score `81`, `chunkCount=5` |
| `tr-saglik-hastanin-bilgilendirilmesi-talimat.docx` | Kilis ADSM, Hastanın Bilgilendirilmesi Talimatı | DOCX | `clean`, score `81`, `chunkCount=5` |
| `tr-saglik-hasta-bilgilendirme-riza-onam.docx` | Kilis ADSM, Hasta Bilgilendirme Rıza Onam Formu | DOCX | `usable`, score `59`, `chunkCount=1`, warning `fragmented_lines` |

Kaynak sayfaları:

- `https://adb.adalet.gov.tr/`
- `https://ogm.meb.gov.tr/`
- `https://hsgm.saglik.gov.tr/`
- `https://kilisadsm.saglik.gov.tr/TR-863574/formlar.html`
- `https://kilisadsm.saglik.gov.tr/TR-863569/talimatlar.html`
- `https://malatyaesh.saglik.gov.tr/TR-203681/hasta-yakini-bilgilendirme.html`

Bu POC sırasında bazı DOCX dosyalarında metnin normal paragraph/table yerine XML header/footer veya shape alanlarında kalabildiği görüldü. Bridge, `python-docx` çıktısı çok zayıf kaldığında `word/*.xml` içindeki `w:t` metinlerini yedek kaynak olarak okuyacak şekilde genişletildi. Bu davranış production parser yerine kalite sinyaliyle birlikte POC amaçlıdır; zayıf belge yine `usable/noisy` seviyede kalmalı ve profile health bu sinyali dikkate almalıdır.
