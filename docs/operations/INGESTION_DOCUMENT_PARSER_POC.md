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
