# Section 05 - Ingestion / Document Understanding / Knowledge Quality Audit

Date: 2026-05-16

Scope: Kullanıcı dosyayı seçtiği andan dokümanın chat retrieval katmanına hazır hale gelmesine kadar olan ingestion ve document-understanding katmanı. Bu dosya retrieval, evidence composer, safety ve feedback katmanlarını yeniden denetlemez; o katmanlara sadece ingestion sinyali taşıdığı noktaları not eder.

Non-scope: Yeni parser implementasyonu, kod değişikliği, model seçimi, Qwen cevap sentezi, blockchain anlatısı.

## Executive Verdict

Section 04 tamamlandıktan sonra sıradaki mimari bölüm ingestion/document understanding olmalı. Repo mevcut durumda ürün seviyesine yaklaşan bir async ingestion omurgasına sahip: upload streaming raw storage'a yazıyor, job/status modeli var, parser registry yüzeyi var, parse/chunk/metadata/embedding/Qdrant aşamaları ayrı statülerle izleniyor.

Ana boşluk artık "dosya kabul edildi mi?" değil; "dosyadaki bilgi yapısal olarak doğru anlaşıldı mı?" sorusu. PDF/DOCX/PPTX/HTML parsing tek bir external command'a bağlı, Excel/XLSX/CSV kaynak tipi yok, artifact modeli blok seviyesinde kalıyor, tablo hücre/satır/sütun semantiği kalıcı tipe dönüşmüyor, parse quality text-level heuristic ölçüyor ve kötü parse'i chat'e karşı sert şekilde bloke etmiyor.

KAP/table/numeric cevap kalitesi için ingestion katmanı muhtemel ana suçlulardan biri. Eğer tablo semantiği burada korunmazsa downstream StructuredFact/AnswerPlan iyileştirmeleri yalnızca hasarlı text chunk üzerinde çalışır.

## Evidence Base

| Area | Repo evidence |
|---|---|
| UI parser capability fetch | `apps/dApp/lib/api/knowledge.ts:72`, `apps/dApp/components/studio/knowledge-upload-panel.tsx:134` |
| UI upload endpoint | `apps/dApp/lib/api/knowledge.ts:86`, `apps/dApp/lib/api/knowledge.ts:89`, `apps/dApp/components/studio/knowledge-upload-panel.tsx:248` |
| UI job polling | `apps/dApp/lib/api/knowledge.ts:103`, `apps/dApp/components/studio/knowledge-upload-panel.tsx:160` |
| Backend parser capabilities | `apps/backend-api/src/routes/knowledge.ts:300`, `apps/backend-api/src/routes/knowledge.ts:305` |
| Backend upload route | `apps/backend-api/src/routes/knowledge.ts:573` |
| Raw storage | `apps/backend-api/src/lib/knowledgeRawStorage.ts:83` |
| File validation / scan | `apps/backend-api/src/lib/knowledgeFileValidation.ts:41`, `apps/backend-api/src/lib/knowledgeFileValidation.ts:129`, `apps/backend-api/src/lib/knowledgeFileValidation.ts:192` |
| Parser registry | `apps/backend-api/src/lib/parserRegistry.ts:1`, `apps/backend-api/src/lib/parserRegistry.ts:38` |
| Built-in/external parser | `apps/backend-api/src/lib/knowledgeText.ts:349`, `apps/backend-api/src/lib/knowledgeText.ts:581`, `apps/backend-api/src/lib/knowledgeText.ts:747` |
| Artifact model | `apps/backend-api/src/lib/knowledgeText.ts:25`, `apps/backend-api/src/lib/knowledgeArtifactPersistence.ts:160`, `apps/backend-api/prisma/schema.prisma:388` |
| Chunking | `apps/backend-api/src/lib/knowledgeText.ts:790`, `apps/backend-api/src/lib/knowledgeText.ts:1065`, `apps/backend-api/src/lib/knowledgeText.ts:1084` |
| Ingestion processor | `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts:196`, `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts:240`, `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts:272`, `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts:484` |
| Parse quality | `apps/backend-api/src/lib/knowledgeParseQuality.ts:68`, `apps/backend-api/src/lib/knowledgeParseQuality.ts:108`, `apps/backend-api/src/lib/knowledgeParseQuality.ts:155`, `apps/backend-api/src/lib/knowledgeParseQuality.ts:162` |
| Auto metadata / profile | `apps/backend-api/src/lib/knowledgeAutoMetadata.ts:189`, `apps/backend-api/src/lib/knowledgeAutoMetadata.ts:506`, `apps/backend-api/src/lib/knowledgeAutoMetadata.ts:582`, `apps/backend-api/src/lib/knowledgeAutoMetadata.ts:653` |
| Qdrant payload quality signals | `apps/backend-api/src/lib/qdrantStore.ts:112`, `apps/backend-api/src/lib/qdrantStore.ts:132` |
| Retrieval strict route gating | `apps/backend-api/src/lib/knowledgeAccess.ts:403`, `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:822` |
| Parse quality eval | `apps/backend-api/scripts/run-parse-quality-eval.mjs:70`, `infrastructure/evals/parse-quality/golden.jsonl:1` |
| Profile health eval | `apps/backend-api/scripts/run-knowledge-profile-health-eval.mjs:31`, `apps/backend-api/scripts/run-knowledge-profile-health-eval.mjs:51` |

## Current Architecture Map

### 1. UI parser capability discovery

UI, authenticated wallet header ile `/v1/knowledge/parsers` endpoint'ini çağırıyor. Dönen capability listesinde available parser extension'ları upload accept listesine ekleniyor; unavailable parser'lar kullanıcıya kısa sebep olarak gösteriliyor.

- Deterministic: UI capability filtering.
- Backend deterministic: `listKnowledgeParserCapabilities()`.
- Fallback: Capability alınamazsa UI `BUILT_IN_EXTENSIONS` değerine dönüyor.
- Risk: Bu sadece upload affordance. Parser capability runtime success garantisi değil.

### 2. UI upload request

UI `FormData` içine `collectionName`, `wallet`, opsiyonel `title`, ve tek `file` koyup `POST /v1/knowledge/upload` çağırıyor. Başarılı response `202 Accepted` semantiği taşıyor ve `jobId/statusUrl` üzerinden polling başlıyor.

- Deterministic: FormData construction.
- Fallback: Upload response parse edilemezse UI generic success fallback basabiliyor.
- Risk: UI, parser availability'i önceden gösterse de backend validation/parser sonucu asıl kaynak.

### 3. Backend upload route

Backend wallet doğruluyor, multipart parçalarını okuyor, ilk file parçasını `storeKnowledgeRawUpload` ile raw storage'a stream ediyor. `collectionId` verilirse mevcut collection bulunuyor; verilmezse private collection yaratılıyor. Aynı `collectionId + contentHash` için mevcut document varsa mevcut job bilgisiyle 202 dönüyor.

- Deterministic: wallet check, collection ownership, dedup lookup.
- Fallback: Collection yoksa yeni private collection yaratılıyor.
- Risk: Dedup sadece collection içi `contentHash` ile sınırlı.

### 4. Raw storage

Raw storage dosyayı temp path'e stream ediyor, SHA-256 hash hesaplıyor, ilk 1 MB ile validation sample topluyor, sonra dosyayı raw veya quarantine dizinine taşıyor.

- Deterministic: streaming, filename sanitize, contentHash, byte limit.
- Fallback: `R3MES_KNOWLEDGE_STORAGE_DIR` yoksa repo-local `data/knowledge-raw`.
- Risk: Local disk storage product deployment için tek başına yeterli değil; object storage/retention/tenant quota yok.

### 5. File validation and malware scan

Validation extension allowlist, magic-byte/text/JSON kontrolleri yapıyor. Desteklenen extension listesi `.pdf`, `.docx`, `.pptx`, `.json`, `.txt`, `.md`, `.html`, `.htm`. Malware scan env override ve EICAR signature dışında gerçek AV/CDR entegrasyonu yapmıyor.

- Deterministic: extension, PDF `%PDF`, Office ZIP signature, UTF-8 text-like, JSON shape.
- Fallback: Scan env ile forced clean/quarantine/failed yapılabiliyor.
- Gap: XLS/XLSX/CSV yok. Bu product hedefindeki Excel/rapor kullanımına doğrudan aykırı.

### 6. Document/job creation

Upload route `KnowledgeDocument` ve `IngestionJob` yaratıyor. Quarantine varsa document failed, job failed; değilse parse/chunk/embed/vector/quality statüleri pending başlıyor. Response job URL ve initial indexing/status alanlarını döndürüyor.

- Deterministic: Prisma transaction.
- Fallback: Enqueue hata verirse document/job failed işaretleniyor.
- Risk: Upload response'a `parseQualityWarnings: ingestion_mode:*` ekleniyor; bu kullanıcı için kalite değil, execution mode sinyali.

### 7. Queue and recovery

`R3MES_KNOWLEDGE_INGESTION_MODE` `manual`, `inline`, `background` olabilir; default background `queueMicrotask`. Startup'ta pending jobs recovery çalışıyor.

- Deterministic: in-process microtask veya inline.
- Fallback: manual mode ile job elle işlenebilir.
- Risk: Background mode process-local. Multi-instance/durable worker semantiği yok; job recovery var ama queue durability yok.

### 8. Parser registry and parser selection

Parser registry typed bir abstraction sunuyor. Built-in parserlar `.txt`, `.md`, `.json` için hazır. PDF/DOCX/PPTX/HTML external parser command set edilirse destekleniyor. Command yoksa `parseKnowledgeBuffer` parser bulamıyor ve parse fail olur.

- Deterministic: extension -> parser adapter.
- External: `R3MES_DOCUMENT_PARSER_COMMAND`, args/profile/timeout.
- Fallback: External parser stdout JSON değilse Markdown/text gibi parse ediliyor.
- Risk: External parser tek command. Format bazlı parser priority, health check, versioned contract, OCR/table profile seçimi yok.

### 9. Parsed document contract

`ParsedKnowledgeDocument` text-first contract: `sourceType`, normalized `text`, `artifacts`, parser id/version, diagnostics. Artifact kind listesi title/heading/paragraph/definition/list/table/qa/url/footer/page_marker/image_caption ile sınırlı.

- Deterministic: normalize text, normalize artifacts.
- Fallback: Parser artifact vermezse `inferDocumentArtifactsFromText` heuristic artifact çıkarıyor.
- Gap: Artifact `metadata` JSON olabilir ama first-class table rows/cells/columns yok. Semantik preservation parser goodwill'ine ve downstream metadata JSON kullanımına kalıyor.

### 10. Normalization and artifact inference

Text normalize soft-wrap birleştiriyor, low-value footer/url/page pattern'lerini filtreliyor, headings/page markers/table-like block'ları line heuristic ile çıkarıyor.

- Deterministic: regex/string heuristics.
- Fallback: Hiç artifact yoksa tek paragraph artifact.
- Risk: Genel belge için faydalı, fakat hardcoded-ish domain/format sinyalleri var: Turkish month footer, `Kayıt` record heading, medical/legal/finance audience/domain terms. Bunlar veri-özel değil ama generic document intelligence da değil.

### 11. Chunking

Önce artifact-aware chunking deneniyor; footer/page_marker/url/title/heading chunk'a alınmıyor. Table için Markdown table splitter header tekrar ediyor. Artifact yoksa paragraph chunking'e düşüyor.

- Deterministic: maxChars 900 default, Markdown table heuristics, record-aware Markdown.
- Fallback: Oversized text sentence/word splitting.
- Strength: Markdown table header tekrar etme iyi bir geçici iyileştirme.
- Gap: Hücre/satır/sütun identity yok. Table chunk text iyi kalsa bile `field -> value -> row -> source cell` zinciri yok.

### 12. Parse quality and ingestion quality

`scoreKnowledgeParseQuality` text/chunk sinyalleriyle clean/usable/noisy skor üretiyor: text length, replacement char, mojibake, control char, symbol ratio, fragmented lines, structure signal, table signal, numeric density, OCR risk. `buildIngestionQualityReport` tableRisk/ocrRisk/thinSource/strictRouteEligible çıkarıyor.

- Deterministic: heuristic scoring.
- Fallback: Yok; kalite skoru metadata'ya yazılıyor.
- Gap: Noisy parse chat'e otomatik blok değil. Strict-route eligibility ve retrieval score etkileniyor, fakat document readiness başarılı olabilir.

### 13. Auto metadata and collection profile

Her chunk için `inferKnowledgeAutoMetadata` çalışıyor. `parseKnowledgeCard`, `routeQuery`, title/content slice, generic phrase extraction ve expanded concept terms kullanılıyor. Document metadata chunk metadata'larının merge'i. Collection metadata mevcut collection metadata + yeni document metadata merge'i.

- Deterministic: heuristic/string route.
- Fallback: route confidence low ve generic signal yoksa sourceQuality `thin`.
- Risk: `sourceQuality: structured`, card topic/tags veya route confidence sinyalinden gelebilir; bu gerçek table/document structure anlamına gelmez.
- Risk: Collection profile incremental merge eski yanlış/stale profile sinyallerini taşıyabilir.

### 14. Persistence

Processor `KnowledgeDocumentVersion`, `KnowledgeArtifact`, `KnowledgeChunk`, `KnowledgeEmbedding` yazar. Artifact table sadece `kind/text/page/title/metadata/answerabilityScore` olarak persist edilir. Chunk artifactRowId/artifactSplitIndex ile artifact'a bağlanabilir.

- Deterministic: stable artifact row/key/id helpers.
- Strength: Future StructuredFact/Table extraction için provenance zemini var.
- Gap: Table-specific persistence yok. `KnowledgeArtifact.metadata` JSON'a koyulan cell data varsa bile canonical queryable schema değil.

### 15. Lexical embedding and pgvector

`embedKnowledgeText` 256-dim deterministic hash/bigram vector üretip Prisma `KnowledgeEmbedding` ve pgvector raw update yazıyor.

- Deterministic: local hash embedding.
- Fallback: Yok.
- Risk: Lexical vector generic; document understanding hatalarını düzeltemez.

### 16. Qdrant embedding and dual write

Qdrant embedding provider default deterministic. Env `ai-engine` veya `bge-m3` ise AI engine `/v1/embeddings` çağrılıyor; hata veya dimension mismatch durumunda production/require-real değilse deterministic fallback var.

- Deterministic fallback: `embedTextDeterministicForQdrant`.
- AI/model: ai-engine/BGE-M3 provider.
- Risk: Runtime'da `R3MES_REQUIRE_REAL_EMBEDDINGS` veya production yoksa BGE-M3 iddiası sessiz fallback ile bozulabilir.

### 17. Retrieval handoff

Qdrant payload'a sourceQuality, tableRisk, ocrRisk, thinSource, strictRouteEligible gibi ingestion sinyalleri ekleniyor. Retrieval/knowledge access strict route gating'de thin/noisy/high OCR kaynakları düşürebiliyor.

- Deterministic: payload metadata projection.
- Strength: Ingestion quality retrieval'e taşınıyor.
- Gap: Bu quality sinyalleri answer field extraction yapmaz. TableRisk sadece risk işareti, fact değildir.

### 18. Eval coverage

Parse quality eval raw JSONL text fixture üstünde `chunkKnowledgeText`, `scoreKnowledgeParseQuality`, `buildIngestionQualityReport` çalıştırıyor. Profile health eval canlı backend collection listesi üzerinden score gate yapıyor; native field yoksa fallback health hesaplıyor.

- Deterministic: parse quality fixtures.
- Integration-ish: profile health live backend endpoint.
- Gap: Actual file upload -> raw storage -> parser command -> artifact persistence -> chunk provenance -> retrieval handoff uçtan uca ölçülmüyor.

## Product-Level Gap Analysis

| Layer | Current repo state | Product-level target | Gap severity |
|---|---|---|---|
| Upload intake | Streaming raw storage, hash, status endpoint var. | Tenant quota, durable object storage, idempotency policy, retention, audit log. | Medium |
| File validation/security | Extension + magic/text checks, EICAR/env scan. | Real AV/CDR/quarantine service, file-type sniffing, parser sandboxing, macro handling. | High |
| Supported source types | TEXT/MARKDOWN/JSON/PDF/DOCX/PPTX/HTML. | PDF/DOCX/PPTX/HTML + XLS/XLSX/CSV + scanned image/OCR + connector docs. | High |
| Parser strategy | Built-in text/md/json, single external command for documents. | Registry with parser priority, per-format adapter, versioned output schema, health, retries, parser metrics. | High |
| Document understanding | Block artifacts + normalized text. | Pages, sections, tables, figures, form fields, captions, OCR spans, language, confidence. | High |
| Table semantics | Markdown table chunking preserves header text. | Typed table rows/cells/columns with units, row labels, page/bbox, confidence. | Critical |
| Chunk planning | Artifact-aware, Markdown table-aware, paragraph fallback. | Structure-aware planner that never cuts row/header/cell provenance and can emit fact candidates. | High |
| Parse quality | Heuristic text-level score. | Parser output validation, artifact count/type, OCR confidence, table fidelity, required field coverage. | High |
| Readiness gating | Processing success marks READY; noisy quality mainly influences routing. | Quality gate can mark NEEDS_REVIEW/PARTIAL_READY and block strict answer use for known-bad parse. | High |
| Metadata/profile | Heuristic profile and incremental merge. | Document-level and collection-level profile recomputed from active docs, with confidence and stale-profile invalidation. | Medium |
| Indexing | Lexical + Qdrant dual write, partial ready on Qdrant fail. | Durable indexing jobs, retry/backoff, payload index coverage, embedding diagnostics surfaced. | Medium |
| Eval loop | Text fixture parse-quality; live profile health. | End-to-end fixture corpus with actual sample PDFs/DOCX/XLSX/OCR outputs and answer-impact checks. | Critical |

## Failure Chain: KAP/Table/Numeric Bad Answer

| Step | Current behavior | Likely culprit? | Reason |
|---|---|---|---|
| Query asks for numeric field | Outside this section. | Not primary here | Query understanding can fail, but ingestion can already lose field semantics. |
| Source selection | Ingestion profile/tableConcepts can influence strict route. | Partial | `tableRisk` and profile terms help route, but do not identify requested field/value. |
| Raw upload | Streams and hashes correctly. | No, unless unsupported file | For supported markdown/text docs raw storage is not the cause. Excel unsupported is a hard fail. |
| File validation | XLS/XLSX/CSV rejected; PDF/DOCX accepted only by extension/magic. | Yes for Excel; partial for scanned docs | Product promise includes Excel-like data; current allowlist excludes it. |
| Parser selection | PDF/DOCX/PPTX/HTML require env external command. | Yes | Missing/wrong parser means parse fail or weak text fallback. |
| Parser output contract | Text + block artifacts. | Yes | Table row/column/value semantics are optional metadata, not canonical. |
| Artifact inference | Regex/line-based artifact inference. | Yes | Markdown-like tables okay; arbitrary PDF/OCR tables are not reliably reconstructed. |
| Chunking | Repeats Markdown table header and keeps context. | Partial | Helps retrieval but still stores raw table text, not facts. |
| Parse quality | Detects table-like content/tableRisk. | Partial | It says "there is table risk", not "field X value is Y". |
| Metadata/profile | Heuristic domain/topic/sourceQuality. | Partial | Can label source structured without true structural table representation. |
| Persistence | Artifact and chunk provenance exists. | Partial | Good base, but table cells/facts are not persisted. |
| Qdrant/Prisma indexing | Indexes chunk text and metadata. | Not primary | Indexing can retrieve the table chunk but cannot infer field-value reliably. |
| Evidence/composer later | Outside this section. | Yes downstream | Downstream lacks typed table facts if ingestion did not create them. |

Verdict for this failure chain: ingestion is a root contributor, not the only contributor. Retrieval/evidence/composer can improve, but product-level table/numeric accuracy requires typed table/fact preservation at ingestion.

## Top Root Causes In This Section

### S05-RC01 - Excel/XLSX/CSV intake is absent

- Symptoms: Product target includes Excel/procedure/report data, but source type enum and validation allowlist do not include spreadsheet formats.
- Evidence: `KnowledgeSourceType` lacks spreadsheet values at `apps/backend-api/prisma/schema.prisma:46`; validation allowlist lacks `.xls/.xlsx/.csv` at `apps/backend-api/src/lib/knowledgeFileValidation.ts:41`.
- Why important: Enterprise numeric data often arrives as Excel/CSV. Rejecting or forcing conversion to markdown/text pushes users into lossy manual preprocessing.
- Test: Upload `.xlsx`, `.xls`, `.csv` fixtures and assert current rejection; add future acceptance tests with sheet/table/cell provenance.
- Fix direction: Add canonical `SPREADSHEET`/`CSV` source kinds or flexible rawSourceKind; add spreadsheet parser adapter that emits typed table artifacts before chunks.
- Risk: Critical.

### S05-RC02 - External document parser is single-command and not parser-registry complete

- Symptoms: PDF/DOCX/PPTX/HTML capability depends on `R3MES_DOCUMENT_PARSER_COMMAND`; no per-format parser priority or parser health execution.
- Evidence: External parser command is built at `apps/backend-api/src/lib/knowledgeText.ts:581`; capability is available based on env only at `apps/backend-api/src/lib/knowledgeText.ts:702`; `parseKnowledgeBuffer` fails without parser at `apps/backend-api/src/lib/knowledgeText.ts:747`.
- Why important: Product-level ingestion must know whether Docling/Marker/Tika/OCR parser actually works for each source type.
- Test: Run matrix where PDF parser configured but exits non-zero, times out, emits wrong schema, or loses tables; assert parser diagnostics/status.
- Fix direction: Keep current adapter but wrap it in registry entries with per-format health check, selected parser id, output schema version, timeout/retry metrics.
- Risk: High.

### S05-RC03 - ParsedDocument is text-first; table semantics are not canonical

- Symptoms: Artifact kind can be `table`, but table rows/cells/columns are not typed fields.
- Evidence: `DocumentArtifact` has text/title/page/metadata only at `apps/backend-api/src/lib/knowledgeText.ts:38`; Prisma `KnowledgeArtifact` stores kind/text/metadata at `apps/backend-api/prisma/schema.prisma:388`.
- Why important: Numeric answer quality requires precise field/value extraction; raw table text makes composer guess.
- Test: A KAP table with repeated labels and two numeric columns must preserve row label, column label, value, unit, source page.
- Fix direction: Add `StructuredDocumentArtifact` or `TableArtifact` schema in metadata first, then promote to Prisma table/cell if needed.
- Risk: Critical.

### S05-RC04 - Artifact inference is heuristic/string-based

- Symptoms: Footers, headings, table-like blocks, page markers are inferred by regex.
- Evidence: `inferDocumentArtifactsFromText` starts at `apps/backend-api/src/lib/knowledgeText.ts:429`; footer/table/heading helpers are regex-driven around `apps/backend-api/src/lib/knowledgeText.ts:354`.
- Why important: Generic enterprise documents vary widely; heuristic inference is useful fallback, not primary document understanding.
- Test: OCR table without Markdown pipes, multi-page PDF footer/header noise, form-like fields, and nested lists.
- Fix direction: Treat inference as fallback with low confidence. Prefer parser-emitted artifacts with confidence and block coordinates.
- Risk: High.

### S05-RC05 - Chunking preserves table text, not fact identity

- Symptoms: Markdown table splitter repeats headers, but chunk content remains raw text.
- Evidence: `splitMarkdownTable` at `apps/backend-api/src/lib/knowledgeText.ts:859`; `chunkParsedKnowledgeDocument` at `apps/backend-api/src/lib/knowledgeText.ts:1084`.
- Why important: Retrieval may return the right table chunk while answer generation still fails requested field selection.
- Test: Ask for one field from a table with many adjacent numeric values; assert no raw table dump and exact requested value.
- Fix direction: Emit fact candidates alongside chunks: `table.row_label`, `column_label`, `value`, `unit`, `page`, `artifactId`.
- Risk: High.

### S05-RC06 - Parse quality is text-level and does not validate structural fidelity

- Symptoms: Table content can score clean due to structure/table signals, even when table schema is not recoverable.
- Evidence: `scoreKnowledgeParseQuality` uses text metrics at `apps/backend-api/src/lib/knowledgeParseQuality.ts:68`; table-like warning is triggered by regex at `apps/backend-api/src/lib/knowledgeParseQuality.ts:108`.
- Why important: Eval can be green while UI answer is bad because the eval validates "text looks structured", not "facts are answerable".
- Test: Fixture with clean-looking table text but swapped/missing columns; parse quality should flag table_field_coverage or table_schema_missing.
- Fix direction: Add `DocumentUnderstandingQuality` with artifact counts, table schema coverage, cell confidence, page coverage, and parser warnings.
- Risk: Critical.

### S05-RC07 - Quality signals do not strictly gate readiness

- Symptoms: Processor writes `qualityStatus: READY` and document can become `READY` even if parseQuality has warnings; strict route may be affected later.
- Evidence: Processor sets document quality ready at `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts:339`; final readiness depends on vector index status at `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts:536`.
- Why important: Chat can use sources that are technically processed but semantically weak.
- Test: Noisy OCR fixture should produce `NEEDS_REVIEW` or not be eligible for strict answer unless user opts in.
- Fix direction: Keep current statuses but add `answerReadiness` or `semanticReadiness`: READY, PARTIAL_READY, NEEDS_REVIEW, FAILED.
- Risk: High.

### S05-RC08 - Auto metadata can label "structured" without structural parsing

- Symptoms: `sourceQuality: structured` comes from card topic/tags, not table/cell/document artifact confidence.
- Evidence: `inferKnowledgeAutoMetadata` sets `structured` from card topic/tags at `apps/backend-api/src/lib/knowledgeAutoMetadata.ts:590`; returns `sourceQuality` at `apps/backend-api/src/lib/knowledgeAutoMetadata.ts:649`.
- Why important: Routing can overtrust a document because it looks like a structured knowledge card.
- Test: A hand-written note with `Topic/Tags` but no real table should not become structurally trusted for numeric extraction.
- Fix direction: Split `profileSourceQuality` from `documentStructureQuality`.
- Risk: Medium.

### S05-RC09 - Collection profile merge can carry stale/wrong signals

- Symptoms: Processor merges existing collection autoMetadata with new document metadata instead of recomputing from active documents.
- Evidence: `mergeKnowledgeAutoMetadata([existingCollectionMetadata, documentAutoMetadata])` at `apps/backend-api/src/lib/knowledgeIngestionProcessor.ts:431`.
- Why important: Mixed enterprise collections can retain old domains/table concepts after replacements/deletions.
- Test: Upload finance table, then unrelated HR procedure into same collection; inspect profile domains/tableConcepts and strict routing behavior.
- Fix direction: Rebuild collection profile from current active document metadata after ingestion completion, at least behind a safe feature flag.
- Risk: Medium.

### S05-RC10 - Ingestion eval does not run the real upload/parser/artifact path

- Symptoms: Parse quality eval feeds raw text to scoring functions, not real files to upload/parser pipeline.
- Evidence: Eval calls `chunkKnowledgeText(caseItem.text)` at `apps/backend-api/scripts/run-parse-quality-eval.mjs:70`; fixtures are JSONL text at `infrastructure/evals/parse-quality/golden.jsonl:1`.
- Why important: Parser regressions, lost artifact metadata, table row flattening, and Excel absence are invisible.
- Test: Add E2E ingestion fixtures with sample PDF/DOCX/XLSX/OCR outputs and expected artifacts/facts.
- Fix direction: Keep text eval, add parser contract eval and end-to-end ingestion fixture eval.
- Risk: Critical.

### S05-RC11 - BGE-M3/Qdrant embedding fallback can hide runtime mismatch

- Symptoms: If provider fails or dimension mismatches, deterministic fallback is used unless real embeddings are required.
- Evidence: fallback on mismatch/failure at `apps/backend-api/src/lib/qdrantEmbedding.ts:126` and `apps/backend-api/src/lib/qdrantEmbedding.ts:150`.
- Why important: Runtime may not match architecture claim "BGE-M3 active"; retrieval quality can differ between eval/prod/dev.
- Test: Set `R3MES_EMBEDDING_PROVIDER=bge-m3` with dead AI engine; assert diagnostics are surfaced and CI/prod fails when required.
- Fix direction: For product pilots set `R3MES_REQUIRE_REAL_EMBEDDINGS=1` or expose fallbackUsed in ingestion/index diagnostics.
- Risk: Medium.

### S05-RC12 - Malware scan is a stub interface, not enterprise protection

- Symptoms: Scanner only supports env forced result and EICAR signature.
- Evidence: `scanKnowledgeUpload` at `apps/backend-api/src/lib/knowledgeFileValidation.ts:192`.
- Why important: Enterprise document upload is a high-risk boundary, especially Office/PDF.
- Test: EICAR should quarantine; non-EICAR malicious Office/PDF cannot be detected currently.
- Fix direction: Keep interface, add AV/CDR provider adapter and parser sandbox boundary.
- Risk: High for deployment security, medium for answer quality.

## Hardcoded / Data-Specific Risk Register

| Pattern | Evidence | Assessment |
|---|---|---|
| Turkish footer/month regex | `apps/backend-api/src/lib/knowledgeText.ts:354` | Acceptable as heuristic fallback, not reliable for global enterprise docs. |
| `## Kayıt` record-aware chunking | `apps/backend-api/src/lib/knowledgeText.ts:763` | Useful for current fixtures, but Turkish/format-specific. Must remain fallback, not product intelligence. |
| Domain/audience keywords such as patient/client/student/operator | `apps/backend-api/src/lib/knowledgeAutoMetadata.ts:564` | Routing convenience; should not drive structural trust. |
| Finance/KAP-like table signals | `apps/backend-api/src/lib/knowledgeParseQuality.ts:38` | Helps KAP detection but risks becoming product-specific shortcut. Need generic table schema extraction. |
| Parse quality golden includes clinical-card and KAP table | `infrastructure/evals/parse-quality/golden.jsonl:1` | Good smoke coverage; insufficient for arbitrary enterprise data. |

## Minimum Product-Level Direction For Section 05

Do not rewrite the ingestion pipeline. Keep the current upload/job/status/artifact/chunk/index backbone and add structural layers incrementally.

### Phase 05-A - Parser Contract Hardening

- Add parser output schema version with required fields: pages, artifacts, tables, warnings, confidence.
- Surface parser runtime diagnostics in job status: selected parser, duration, stderr category, fallbackUsed.
- Acceptance: broken external parser produces explicit parser failure; unsupported table schema is visible.

### Phase 05-B - Spreadsheet Intake

- Add `.csv`, `.xls`, `.xlsx` validation and source type handling.
- Implement spreadsheet parser adapter that emits sheet/table/cell artifacts.
- Acceptance: workbook with two sheets persists sheet name, row/column labels, cell values, numeric formats.

### Phase 05-C - TableArtifact / Structured Document Artifact

Start with JSON metadata shape before adding normalized Prisma tables:

```ts
type StructuredTableArtifact = {
  version: 1;
  kind: "table";
  tableId: string;
  title?: string;
  page?: number;
  sheetName?: string;
  headers: Array<{ columnId: string; text: string; normalizedText: string }>;
  rows: Array<{
    rowId: string;
    label?: string;
    cells: Array<{
      columnId: string;
      text: string;
      value?: string | number;
      unit?: string;
      confidence?: number;
    }>;
  }>;
  provenance: {
    parserId: string;
    parserVersion: number;
    bbox?: number[];
  };
};
```

- Acceptance: KAP/non-KAP numeric table can answer requested field without raw table dump.

### Phase 05-D - Document Understanding Quality

Add a separate quality object:

```ts
type DocumentUnderstandingQuality = {
  version: 1;
  parseQuality: "clean" | "usable" | "noisy";
  structureQuality: "strong" | "partial" | "weak";
  tableQuality: "none" | "text_only" | "structured";
  ocrQuality: "none" | "usable" | "weak";
  answerReadiness: "ready" | "partial" | "needs_review" | "failed";
  blockers: string[];
  warnings: string[];
};
```

- Acceptance: Table-heavy text-only parse gets `tableQuality: text_only`, not structurally ready.

### Phase 05-E - End-to-End Ingestion Eval

Add eval buckets:

- `unsupported_enterprise_source`: XLSX currently fails; future should pass.
- `pdf_table_structure`: parser emits table cells and page provenance.
- `ocr_noise_needs_review`: noisy OCR cannot become strict answer-ready.
- `metadata_staleness`: collection profile recompute removes old table/domain concepts.
- `embedding_provider_mismatch`: BGE requested but fallback used must fail in product profile.

Acceptance: eval must execute real parser path, not only `scoreKnowledgeParseQuality(text)`.

## Architecture Decision Points For Next Discussion

1. Spreadsheet support should be added as first-class source type or flexible rawSourceKind? My recommendation: add flexible `rawSourceKind/sourceExtension/sourceMime/parserId` now; add enum value only where Prisma/API contract requires it.
2. Table cells should first live in `KnowledgeArtifact.metadata` or separate Prisma model? My recommendation: metadata first for small blast radius, then normalized model after eval proves schema.
3. Should noisy parse block chat? My recommendation: do not break existing retrieval globally; add `answerReadiness` and make strict/no-source discipline respect it.
4. Should parser be Docling, Tika, custom bridge, or multi-parser? My recommendation: registry can support all; do not bake one parser into core pipeline.
5. Should collection profiles be incremental or recomputed? My recommendation: recompute from active document metadata for product correctness; cache after recompute.

## Final Section 05 Verdict

The ingestion backbone is no longer the weak part structurally; the weak part is document understanding fidelity. The current system can upload, store, parse, chunk, index, and expose status. It cannot yet guarantee that arbitrary enterprise documents, especially Excel/PDF/OCR tables, become structured evidence suitable for accurate field-level answers.

For product-level RAG, Section 05 must evolve from "text extraction and chunking" to "document structure preservation". The smallest safe path is: parser contract hardening, spreadsheet intake, structured table artifact metadata, document-understanding quality, and real end-to-end ingestion eval. This preserves the current RAG backbone and avoids a rewrite.
