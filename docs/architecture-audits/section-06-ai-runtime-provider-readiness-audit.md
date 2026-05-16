# Section 06 - AI Runtime / Provider Readiness / Model Serving Audit

Date: 2026-05-17

Scope: UI chat request'inden backend chat proxy'ye, backend'in ai-engine/model/embedding/reranker provider kararlarına, ai-engine runtime'ına, LoRA hot-swap'a, Qdrant/BGE-M3 provider gerçekliğine ve runtime readiness/smoke yüzeylerine kadar olan katman.

Non-scope: Retrieval relevance algoritmasını yeniden denetlemek, Section 03 composer/AnswerPlan içeriğini tekrar açmak, ingestion parser kalitesini tekrar denetlemek, yeni feature implementasyonu yapmak.

## Executive Verdict

Section 05 tamamlandıktan sonra sıradaki mimari bölüm AI runtime / provider readiness olmalı. Repo artık RAG cevap kalitesini sadece "retrieval iyi mi?" üzerinden değil, "runtime gerçekte hangi provider'ı kullandı?" üzerinden de doğrulamak zorunda.

Mevcut mimari çalışır bir omurgaya sahip:

- UI chat backend proxy'ye gider; istemci ai-engine URL'sini bilmez.
- Backend RAG-first çalışır ve çoğu grounded non-stream durumda deterministic composer ile Qwen'i bypass edebilir.
- Qwen2.5-3B ai-engine içinde llama.cpp/GGUF yoluyla base-only çalışabilir; behavior LoRA optionaldır.
- BGE-M3 embedding ve cross-encoder reranker ai-engine endpoint'leri üzerinden kullanılabilir.
- Provider readiness script'leri ve smoke'lar eklenmiş.

Ana boşluk: runtime gerçekliği tek bir ürün seviyesi kontrata bağlanmamış. Backend `/ready` yalnız DB/Redis'e bakıyor, ai-engine `/health/runtime` ayrı yaşıyor, embedding/reranker fallback'leri non-prod'da sessiz çalışabiliyor, UI "stream" API ismine rağmen fiilen `stream:false` gönderiyor, ve answer path/provider bilgisi ancak debug açıldığında görülebiliyor.

Bu bölümün ana riski cevap kalitesini doğrudan bozabilir: UI kötü cevap verdiğinde bunun model cevabı mı, deterministic composer mı, ai-engine fallback'i mi, lightweight reranker mı, deterministic embedding mi, yoksa Qdrant/Prisma fallback'i mi olduğu tek bakışta ürün seviyesinde ayrışmıyor.

## Evidence Base

Tüm gözlemler repo dosyalarına dayalıdır.

| Area | Repo evidence |
|---|---|
| Active product direction | `docs/ai_architecture.md:3`, `docs/ai_architecture.md:5`, `docs/ai_architecture.md:37`, `docs/ai_architecture.md:38` |
| ai-engine role and Qwen GGUF path | `apps/ai-engine/README.md:5`, `apps/ai-engine/README.md:7`, `apps/ai-engine/README.md:8`, `apps/ai-engine/README.md:137` |
| ai-engine request contract | `apps/ai-engine/r3mes_ai_engine/schemas_openai.py:15`, `apps/ai-engine/r3mes_ai_engine/schemas_openai.py:20`, `apps/ai-engine/r3mes_ai_engine/schemas_openai.py:22`, `apps/ai-engine/r3mes_ai_engine/schemas_openai.py:28` |
| Backend ai-engine URL and composer mode | `apps/backend-api/src/routes/chatProxy.ts:140`, `apps/backend-api/src/routes/chatProxy.ts:168` |
| UI forces non-stream chat | `apps/dApp/lib/api/chat-stream.ts:156`, `apps/dApp/lib/api/chat-stream.ts:158`, `apps/dApp/lib/api/chat-stream.ts:161` |
| UI receives JSON answer/debug | `apps/dApp/lib/api/chat-stream.ts:196`, `apps/dApp/lib/api/chat-stream.ts:198`, `apps/dApp/lib/api/chat-stream.ts:201`, `apps/dApp/lib/api/chat-stream.ts:203` |
| Backend deterministic bypass paths | `apps/backend-api/src/routes/chatProxy.ts:2208`, `apps/backend-api/src/routes/chatProxy.ts:2226`, `apps/backend-api/src/routes/chatProxy.ts:2245`, `apps/backend-api/src/routes/chatProxy.ts:2267`, `apps/backend-api/src/routes/chatProxy.ts:2286`, `apps/backend-api/src/routes/chatProxy.ts:2298` |
| Backend ai-engine call path | `apps/backend-api/src/routes/chatProxy.ts:2318`, `apps/backend-api/src/routes/chatProxy.ts:2358`, `apps/backend-api/src/routes/chatProxy.ts:2373`, `apps/backend-api/src/routes/chatProxy.ts:2380`, `apps/backend-api/src/routes/chatProxy.ts:2384` |
| Mini validator second model call | `apps/backend-api/src/routes/chatProxy.ts:440`, `apps/backend-api/src/routes/chatProxy.ts:2420`, `apps/backend-api/src/routes/chatProxy.ts:2431`, `apps/backend-api/src/routes/chatProxy.ts:2440` |
| Adapter runtime select | `apps/backend-api/src/lib/adapterRuntimeSelect.ts:1`, `apps/backend-api/src/lib/adapterRuntimeSelect.ts:5` |
| Adapter resolution | `apps/backend-api/src/lib/chatAdapterResolve.ts:16`, `apps/backend-api/src/lib/chatAdapterResolve.ts:34`, `apps/backend-api/src/lib/chatAdapterResolve.ts:71`, `apps/backend-api/src/lib/chatAdapterResolve.ts:121`, `apps/backend-api/src/lib/chatAdapterResolve.ts:142` |
| ai-engine startup and health | `apps/ai-engine/r3mes_ai_engine/app.py:21`, `apps/ai-engine/r3mes_ai_engine/app.py:25`, `apps/ai-engine/r3mes_ai_engine/app.py:56`, `apps/ai-engine/r3mes_ai_engine/app.py:60` |
| llama-server bootstrap | `apps/ai-engine/r3mes_ai_engine/llama_bootstrap.py:24`, `apps/ai-engine/r3mes_ai_engine/llama_bootstrap.py:71`, `apps/ai-engine/r3mes_ai_engine/llama_bootstrap.py:116`, `apps/ai-engine/r3mes_ai_engine/llama_bootstrap.py:127` |
| LoRA lock/hot-swap | `apps/ai-engine/r3mes_ai_engine/proxy_service.py:26`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:57`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:358`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:380`, `apps/ai-engine/README.md:65` |
| Stream diagnostics limitation | `apps/ai-engine/r3mes_ai_engine/proxy_service.py:346`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:350`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:351`, `apps/ai-engine/README.md:61` |
| Embedding provider fallback | `apps/backend-api/src/lib/qdrantEmbedding.ts:40`, `apps/backend-api/src/lib/qdrantEmbedding.ts:104`, `apps/backend-api/src/lib/qdrantEmbedding.ts:126`, `apps/backend-api/src/lib/qdrantEmbedding.ts:142`, `apps/backend-api/src/lib/qdrantEmbedding.ts:164` |
| ai-engine embedding runtime | `apps/ai-engine/r3mes_ai_engine/hf_embeddings.py:49`, `apps/ai-engine/r3mes_ai_engine/hf_embeddings.py:95`, `apps/ai-engine/r3mes_ai_engine/hf_embeddings.py:139` |
| Reranker fallback | `apps/backend-api/src/lib/modelRerank.ts:320`, `apps/backend-api/src/lib/modelRerank.ts:420`, `apps/backend-api/src/lib/modelRerank.ts:460`, `apps/ai-engine/r3mes_ai_engine/hf_reranker.py:104`, `apps/ai-engine/r3mes_ai_engine/hf_reranker.py:150` |
| Runtime health summary | `apps/backend-api/src/lib/retrievalRuntimeHealth.ts:6`, `apps/backend-api/src/lib/retrievalRuntimeHealth.ts:93`, `apps/backend-api/src/lib/retrievalRuntimeHealth.ts:105`, `apps/backend-api/src/lib/retrievalRuntimeHealth.ts:213` |
| Backend `/ready` scope | `apps/backend-api/src/routes/health.ts:8`, `apps/backend-api/src/routes/health.ts:10`, `apps/backend-api/src/routes/health.ts:13`, `apps/backend-api/src/routes/health.ts:15` |
| Provider readiness scripts | `apps/backend-api/package.json:36`, `apps/backend-api/package.json:53`, `apps/backend-api/package.json:57`, `apps/backend-api/scripts/run-provider-readiness.mjs:128`, `apps/backend-api/scripts/run-provider-readiness.mjs:136`, `apps/backend-api/scripts/smoke-quality-providers.mjs:4` |
| Qdrant provider payload and search | `apps/backend-api/src/lib/qdrantStore.ts:46`, `apps/backend-api/src/lib/qdrantStore.ts:48`, `apps/backend-api/src/lib/qdrantStore.ts:493`, `apps/backend-api/src/lib/qdrantStore.ts:511` |
| Hybrid retrieval provider handling | `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1532`, `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1539`, `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1543`, `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1699`, `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1931` |

## A) Current Architecture Map

### 1. Product runtime doctrine

`docs/ai_architecture.md` açıkça legacy BitNet/LoRA-first notu olduğunu söylüyor; aktif yön `Qwen2.5-3B + RAG-first + optional behavior LoRA`. Aynı dosyada LoRA'nın güncel MVP'de bilgi doğruluğu değil davranış/üslup/persona katmanı olduğu belirtiliyor.

- Deterministic: repo dokümantasyonu ve backend adapter policy.
- AI/model: Qwen yalnız sentez/runtime rolünde.
- Fallback: eski BitNet/LoRA dokümanı repo içinde duruyor; kanonik kaynak uyarısı var.
- Risk: Product/readiness dokümanları ve runtime config farklı yerlerde olduğu için "hangi model gerçekten çalışıyor?" cevabı tek kontratta toplanmıyor.

### 2. UI chat submission

UI `streamChatCompletions` fonksiyonu backend `/v1/chat/completions` endpoint'ine gider. İstemci ai-engine URL'sini bilmez; `getBackendUrl()` kullanır. Fonksiyon ismi streaming olsa da body içinde `stream:false` sabitlenmiş. Yorumda mevcut backend/ai-engine streaming path'inin upstream header beklerken takılabildiği yazıyor.

- Deterministic: `messages`, adapter id/cid, selected collection ids, `includePublic`, auth headers.
- Fallback/UI simulation: JSON yanıt geldikten sonra typewriter chunks ile streaming hissi veriliyor.
- Model/AI yok: UI tarafı model çağırmıyor.
- Risk: UI gerçek stream path'ini kullanmadığı için stream runtime sorunları eval/UI gerçekliğinden kopabilir.

### 3. Backend chat request context

Backend `/v1/chat/completions` cüzdan doğrulama ve opsiyonel chat fee sonrası body'den `stream`, `includePublic`, `collectionIds`, retrieval query, debug header ve request context çıkarıyor. Collection seçilmemişse ve public istenmemişse private source auto-default sinyali trace'e yazılıyor.

- Deterministic: request parsing, wallet gate, collection access.
- Fallback: auto private source default.
- AI/model yok.
- Risk: runtime provider bilgisi bu aşamada sadece trace/debug objelerine bağlanıyor, normal ürün response'unda açık değil.

### 4. Query/retrieval execution and provider diagnostics

True hybrid retrieval Qdrant + Prisma + critical evidence candidate yollarını paralel çalıştırıyor. Qdrant için embedding `embedTextForQdrantWithDiagnostics()` ile üretiliyor; Prisma lexical ayrı çalışıyor; sonra alignment ve reranker ile final source listesi oluşturuluyor. Qdrant/Prisma/critical candidate hataları `Promise.allSettled` ile yakalanıp console warning'e düşüyor.

- Deterministic: Prisma lexical, alignment, pre-rank, evidence pruning.
- AI/model: BGE-M3 embedding ve cross-encoder reranker env'e bağlı.
- Fallback: Qdrant candidate collection fail olursa Prisma adaylarıyla devam edilebilir.
- Risk: Qdrant veya embedding provider bozulduğunda cevap tamamen düşmeyebilir; bu iyi bir availability davranışı ama product-grade kalite için fallback'in görünür/gate'li olması gerekir.

### 5. Backend deterministic answer bypass

Backend, Qwen çağrısından önce birkaç deterministic answer path'e sahip:

1. No-source fallback: kaynak yok ve low grounding ise `buildDeterministicGroundedAnswer`.
2. RAG fast path: non-stream, retrieval var, source var, grounding low değilse ve composer mode model değilse deterministic.
3. Contradiction/low-confidence evidence fast path.
4. Fast grounded composer env ile açılırsa deterministic.

Bu path'ler `applyRenderedAnswer` üzerinden AnswerSpec/AnswerPlan/composer/safety katmanına girer ve ai-engine çağrısı yapılmaz.

- Deterministic: yukarıdaki fast path'ler.
- AI/model yok: Qwen bypass edilir.
- Fallback: safety fallback veya planned composer fallback devreye girebilir.
- Risk: "Qwen kötü cevap verdi" teşhisi çoğu UI kötü cevabı için yanlış olabilir. Kötü cevap deterministic composer/safety/presentation kaynaklı olabilir.

### 6. Backend ai-engine answer path

Fast path kullanılmazsa backend retrieved context'i system message olarak inject eder, temperature/top_p/max_tokens/stops değerlerini düşürür, runtime'ı `getConfiguredChatRuntime()` ile ekler, adapter id/cid/path alanlarını çözer ve ai-engine `/v1/chat/completions` endpoint'ine post eder.

- Deterministic: prompt/context injection, adapter resolution, request shaping.
- AI/model: ai-engine chat completion.
- Fallback: non-stream 5xx için tek retry var; fetch exception'da `AI_ENGINE_UNAVAILABLE`.
- Risk: normal kullanıcı response'unda "ai_engine", "ai_engine_parsed", "ai_engine_draft_wrapped" gibi answer path sadece debug açıkken anlaşılır.

### 7. Mini validator model call

Non-stream ve retrieval kullanılan durumda mini validator varsayılan olarak devrede; low grounding, parse edilemeyen answer veya thin answer olduğunda ai-engine'e ikinci bir validator payload gönderilebilir.

- Deterministic: validator eligibility.
- AI/model: ikinci Qwen/ai-engine çağrısı.
- Fallback: validator parse edilemezse ilk yanıt wrapped/rendered devam eder.
- Risk: provider latency ve model call count ürün seviyesinde bütçelenmiyor; debug/trace dışında ayrışması zor.

### 8. Adapter / LoRA resolution

Backend `adapter_cid`, `adapter_id`, `adapter_db_id` veya `on_chain_adapter_id` alanlarını DB'deki ACTIVE adapter kaydına çözüyor. PEFT adapter llama_cpp runtime'da kullanılamazsa hata dönebiliyor; bazı medical behavior adapter'ları non-medical domain için strip ediliyor. GGUF + local storage path varsa `adapter_path` ile llama_cpp'e yönlenebiliyor.

- Deterministic: DB lookup, status/runtime/format/domain checks.
- AI/model yok.
- Fallback: bazı domain uyumsuz adapter'lar strip edilip RAG-only devam eder.
- Risk: behavior LoRA product narrative için ikincil kalmalı; code bunu büyük ölçüde destekliyor, ama runtime failure kullanıcıya adapter/runtime hatası olarak dönebilir.

### 9. ai-engine startup

FastAPI app lifecycle içinde settings okunuyor, default backend `llama_cpp` ise `bootstrap_llama()` çağrılıyor. Bootstrap local GGUF, IPFS CID veya HF URL üzerinden Qwen2.5-3B GGUF dosyasını çözüp `llama-server` subprocess başlatıyor ve `/health` hazır olana kadar bekliyor.

- Deterministic: settings, download/local path resolution, subprocess startup, readiness loop.
- AI/model: llama-server çalıştıktan sonra inference.
- Fallback: `R3MES_SKIP_LLAMA` test/dev için subprocess başlatmayı atlıyor.
- Risk: `skip_llama` dev/test için gerekli ama yanlış ortamda açık kalırsa `/health` "ok" kalabilir; runtime health'te `llama.loaded=false` görülür.

### 10. ai-engine chat proxy

ai-engine chat endpoint FastAPI içinde tensor hesabı yapmıyor; llama_cpp runtime'da upstream `llama-server /v1/chat/completions` çağrılıyor. `system_context` ve `retrieved_context` system message olarak başa ekleniyor. `adapter_cid` veya `adapter_path` varsa LoRA slotu hazırlanıyor.

- Deterministic: context prepend, adapter download/cache, slot copy/scale, headers.
- AI/model: upstream llama-server.
- Fallback: adapter download, hot-swap ve upstream hataları stage/category ile HTTPException'a dönüşür.
- Risk: stream path'te diagnostic header sadece `X-R3MES-Diagnostics: see_server_logs`; non-stream kadar self-contained değil.

### 11. LoRA hot-swap concurrency

LoRA işlemleri global `_lora_lock` ile seri çalışıyor. Stream ve non-stream path'lerde adapter download/hot-swap bu lock içinde. Base-only request lora slot path varsa scale reset yapabiliyor.

- Deterministic: single lock, cache headers, swap timings.
- AI/model yok.
- Fallback: local adapter path ve IPFS adapter path ayrı.
- Risk: multi-tenant behavior LoRA trafiğinde kuyruk/latency artar. Bilgi doğruluğu için LoRA kullanılmamalı; mevcut ürün yönüyle uyumlu ama pilot readiness'te throughput sınırı açık yazılmalı.

### 12. Transformers/PEFT runtime branch

ai-engine `transformers_peft` runtime seçilirse HF runtime lazy-load eder, local model snapshot veya HF model name kullanır, opsiyonel PEFT adapter path bağlar, generation yapar. Backend default runtime `llama_cpp`.

- Deterministic: runtime switch.
- AI/model: transformers generate.
- Fallback: adapter path yoksa base model; local file missing ise HTTP error.
- Risk: settings içinde `transformers_peft` için "yeni ana yol" açıklaması var, ancak backend default ve README golden path llama_cpp/GGUF/Qwen. Runtime doctrine tek yerde netleşmeli.

### 13. Embedding provider path

Backend default embedding provider deterministic. `R3MES_EMBEDDING_PROVIDER=ai-engine` veya `bge-m3` ise ai-engine `/v1/embeddings` çağrılıyor. Vector dimension beklenen Qdrant dimension ile uyuşmazsa non-prod'da deterministic fallback kullanılabiliyor. `R3MES_REQUIRE_REAL_EMBEDDINGS=1` veya production'da fallback hata olarak atılıyor.

- Deterministic: hash/token embedding fallback.
- AI/model: BGE-M3 via ai-engine.
- Fallback: provider failure/vector mismatch -> deterministic, strict değilse.
- Risk: non-prod eval yeşilken gerçek semantic retrieval çalışmıyor olabilir.

### 14. Reranker provider path

Backend decision config default reranker mode'u `model`; model path ai-engine `/v1/rerank` çağırıyor. ai-engine reranker modelini yükleyemezse `lightweight_fallback` skoru döndürüyor. Backend ayrıca ai-engine/rerank hatasında deterministic reranker'a dönebiliyor. `R3MES_REQUIRE_REAL_RERANKER=1` veya production bu fallback'i hata yapıyor.

- Deterministic: local reranker fallback.
- AI/model: cross-encoder via ai-engine.
- Fallback: iki katmanlı fallback var: ai-engine lightweight, backend deterministic.
- Risk: "reranker active" demek her zaman cross-encoder active demek değil; provider/fallback flag'i gate edilmezse kalite ölçümü bozulur.

### 15. Runtime health/readiness

Backend `/ready` sadece Prisma `SELECT 1` ve Redis `PING` yapıyor. ai-engine `/health/runtime` inference, llama, hf, embedding ve reranker durumunu döndürüyor. Backend retrieval runtime health objesi debug/trace içinde provider fallback uyarılarını özetleyebiliyor. Provider readiness script'i embedding/reranker cold-warm koşar ve fallback/model doğrular.

- Deterministic: health endpoints and smoke scripts.
- AI/model: readiness script provider endpoint'lerini çağırır.
- Fallback: backend `/ready` provider fallback'i bilmez.
- Risk: deploy/product readiness için tek kırmızı/yeşil kapı yok.

## B) Gap Analysis

| Layer | Current state | Product-grade expectation | Gap |
|---|---|---|---|
| Runtime doctrine | Active direction docs'ta var; legacy docs uyarılı şekilde duruyor | Tek `RuntimeProfile` veya runbook: chat model, embedding, reranker, fallback policy, model version | Config/doküman birden fazla dosyada |
| UI chat runtime | Backend proxy kullanıyor; `stream:false` zorlanmış | UI gerçek path'i açık bilmeli; stream/non-stream farkı testlenmeli | Fonksiyon adı streaming, gerçek body non-stream |
| Backend answer path | Deterministic fast path + ai-engine path + validator path | Her answer response/trace answer path ve provider lineage taşımalı | Normal response'ta sınırlı görünürlük |
| Qwen call | Sadece fast path dışı ve validator durumlarında | Qwen "synthesis only" rolü açık metriklenmeli | Call count/answer path product metric yok |
| Adapter/LoRA | ACTIVE adapter resolution, optional behavior LoRA | LoRA only style/persona; knowledge correctness'e karışmamalı | Throughput ve runtime failure UX net gate değil |
| llama.cpp runtime | Qwen GGUF subprocess, health loop var | Model artifact provenance + sha + loaded status deployment gate | `/ready` bunu kontrol etmiyor |
| Embedding provider | BGE-M3 optional, deterministic fallback mümkün | Pilot/staging/prod'da real embedding zorunlu ve reindex gate'li | Non-prod green eval yanıltıcı olabilir |
| Reranker provider | Cross-encoder optional, two-level fallback | Cross-encoder gerçekliği readiness gate ve trace'te zorunlu | "model mode" fallback ile de çalışabiliyor |
| Qdrant runtime | Search collection bootstrap ediyor; hybrid fail-soft | Qdrant unavailable kalite düşüşü release/block veya açık degrade state | Fail-soft debug dışı kolay kaybolur |
| Health/readiness | Backend ready DB/Redis; ai-engine runtime ayrı; smoke script var | Tek product readiness endpoint/report | Operasyonel truth split |
| Observability | Debug header, chat_trace, runtime diagnostics var | Answer id bazında provider lineage: embedding/rerank/chat/composer/safety | Debug kapalıyken sınırlı |
| Eval gating | Provider readiness script var | CI/release/pilot gate'e bağlı zorunlu provider checks | Package script var, zorunluluk repo içinde kanıtlanmadı |

## C) Failure Chain - UI Bad Answer Runtime Diagnosis

Örnek: KAP/table numeric sorusunda UI kötü cevap verdi.

| Step | Runtime risk | Muhtemel suçlu? | Evidence |
|---|---|---:|---|
| UI body | UI `stream:false`; non-stream deterministic fast paths daha sık devreye girer | Evet, path farkı için | `apps/dApp/lib/api/chat-stream.ts:156`, `apps/dApp/lib/api/chat-stream.ts:161` |
| Source selection | Section 02 konusu; auto-private/selected/public etkisi var | Kısmen | `apps/backend-api/src/routes/chatProxy.ts:1715`, `apps/backend-api/src/routes/chatProxy.ts:1751` |
| Embedding | BGE-M3 yerine deterministic fallback çalışabilir | Evet | `apps/backend-api/src/lib/qdrantEmbedding.ts:104`, `apps/backend-api/src/lib/qdrantEmbedding.ts:142` |
| Qdrant | Qdrant fail olursa Prisma adaylarıyla devam edebilir | Kısmen | `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1532`, `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1543` |
| Reranker | Cross-encoder yerine lightweight/deterministic fallback olabilir | Evet | `apps/ai-engine/r3mes_ai_engine/hf_reranker.py:104`, `apps/backend-api/src/lib/modelRerank.ts:460` |
| Evidence | Section 03 konusu; runtime provider değil | Kısmen | `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1834`, `apps/backend-api/src/lib/hybridKnowledgeRetrieval.ts:1840` |
| Composer | Qwen bypass edilip deterministic composer kullanılmış olabilir | Evet | `apps/backend-api/src/routes/chatProxy.ts:2245`, `apps/backend-api/src/routes/chatProxy.ts:2267` |
| Qwen | Sadece ai-engine path veya validator path'te çağrılır | Duruma bağlı | `apps/backend-api/src/routes/chatProxy.ts:2380`, `apps/backend-api/src/routes/chatProxy.ts:2440` |
| Safety/presentation | `applyRenderedAnswer` kalite/safety fallback ile final content'i değiştirebilir | Evet | `apps/backend-api/src/routes/chatProxy.ts:961`, `apps/backend-api/src/routes/chatProxy.ts:1024`, `apps/backend-api/src/routes/chatProxy.ts:1072` |
| UI display | JSON response content type üzerinden tek sefer alınıp typewriter ile gösterilir | Hayır, genelde sunum | `apps/dApp/lib/api/chat-stream.ts:196`, `apps/dApp/lib/api/chat-stream.ts:205` |

Sonuç: Bu bölüm açısından kötü cevabın ana runtime suçluları embedding/reranker fallback, deterministic composer bypass ve provider lineage görünmezliği. Qwen tek başına ana suçlu kabul edilmemeli.

## D) Top Runtime Root Causes

### RC01 - Backend `/ready` AI provider readiness'i kapsamıyor

- Belirti: Backend ready dönebilir ama ai-engine, Qdrant, BGE-M3 veya reranker hazır olmayabilir.
- İlgili dosyalar: `apps/backend-api/src/routes/health.ts:8`, `apps/ai-engine/r3mes_ai_engine/app.py:60`.
- Neden önemli: Pilot ortamında "servis ayakta" ile "RAG quality provider ayakta" aynı şey değil.
- Test: ai-engine kapalıyken backend `/ready` çağır; sonra provider-readiness çalıştır.
- Düzeltme yönü: ayrı `GET /ready/rag-runtime` veya backend `/ready?deep=1` ile ai-engine runtime, Qdrant, embedding, reranker warm checks.
- Risk: High.

### RC02 - Embedding fallback non-prod'da sessiz kalite sapması yaratabilir

- Belirti: `R3MES_EMBEDDING_PROVIDER=ai-engine` hata verirse deterministic vector fallback çalışabilir.
- İlgili dosyalar: `apps/backend-api/src/lib/qdrantEmbedding.ts:104`, `apps/backend-api/src/lib/qdrantEmbedding.ts:142`, `apps/backend-api/src/lib/qdrantEmbedding.ts:164`.
- Neden önemli: Eval yeşilken semantic retrieval gerçekte devrede olmayabilir.
- Test: ai-engine embedding endpoint'ini kapatıp answer-quality eval çalıştır; `retrieval_debug.runtime.embeddingFallbackUsed` zorunlu fail olmalı.
- Düzeltme yönü: staging/pilot profile'da `R3MES_REQUIRE_REAL_EMBEDDINGS=1`; fallback sadece local dev.
- Risk: High.

### RC03 - Reranker iki katmanlı fallback nedeniyle "model mode" yanıltıcı

- Belirti: ai-engine `lightweight_fallback` dönebilir; backend ayrıca deterministic reranker'a düşebilir.
- İlgili dosyalar: `apps/ai-engine/r3mes_ai_engine/hf_reranker.py:104`, `apps/ai-engine/r3mes_ai_engine/hf_reranker.py:150`, `apps/backend-api/src/lib/modelRerank.ts:420`, `apps/backend-api/src/lib/modelRerank.ts:460`.
- Neden önemli: Cross-encoder reranker yoksa KAP/table field selection kalitesi düşer ama sistem cevap vermeye devam eder.
- Test: reranker local path'i boz; provider readiness ve answer-quality eval fallback flag ile fail etmeli.
- Düzeltme yönü: pilot profile'da `R3MES_REQUIRE_REAL_RERANKER=1`; backend trace'te `reranker.provider` ve `fallbackUsed` release gate'e bağlanmalı.
- Risk: High.

### RC04 - UI gerçek stream path'ini kullanmıyor

- Belirti: UI API generator `streamChatCompletions` adını taşıyor ama `stream:false` gönderiyor.
- İlgili dosyalar: `apps/dApp/lib/api/chat-stream.ts:141`, `apps/dApp/lib/api/chat-stream.ts:156`, `apps/dApp/lib/api/chat-stream.ts:161`.
- Neden önemli: Stream/non-stream backend path'leri farklı. Non-stream deterministic bypass ve validator davranışı UI gerçekliğini belirliyor.
- Test: UI request body snapshot; backend trace `stream:false` doğrulansın. Ayrı stream e2e smoke gerçek SSE path'ini doğrulasın.
- Düzeltme yönü: Ya fonksiyonu non-stream olarak adlandır ve ürün sözleşmesini düzelt, ya stream path header hang riskini çözmeden stream promise verme.
- Risk: Medium.

### RC05 - Qwen call path product-level metrik değil

- Belirti: Qwen kimi cevaplarda hiç çağrılmıyor; kimi cevaplarda validator nedeniyle ikinci kez çağrılıyor.
- İlgili dosyalar: `apps/backend-api/src/routes/chatProxy.ts:2208`, `apps/backend-api/src/routes/chatProxy.ts:2373`, `apps/backend-api/src/routes/chatProxy.ts:2420`.
- Neden önemli: Kötü cevabı model mi composer mı üretti ayrımı UI feedback'ten otomatik çıkmıyor.
- Test: Her chat response için `answer_path`, `model_call_count`, `validator_used` trace export edilsin.
- Düzeltme yönü: debug dışı sanitized `runtime_trace_summary` veya feedback metadata'ya answer path/provider lineage yaz.
- Risk: High.

### RC06 - Provider readiness script var ama zorunlu product gate değil

- Belirti: `eval:provider-readiness` ve smoke script'leri mevcut; backend readiness'e bağlı değil.
- İlgili dosyalar: `apps/backend-api/package.json:36`, `apps/backend-api/scripts/run-provider-readiness.mjs:128`, `apps/backend-api/scripts/smoke-quality-providers.mjs:4`.
- Neden önemli: Operatör script'i çalıştırmazsa gerçek BGE-M3/cross-encoder yokluğu release öncesi yakalanmayabilir.
- Test: CI job veya startup gate olmadan deploy simülasyonu; provider failure backend `/ready`'yi bozmaz.
- Düzeltme yönü: pilot release checklist/CI'da mandatory provider-readiness; son raporu backend health summary'ye expose et.
- Risk: Medium.

### RC07 - ai-engine stream observability non-stream'den zayıf

- Belirti: stream success header `X-R3MES-Diagnostics: see_server_logs`; non-stream adapter cache/lock/swap headers daha detaylı.
- İlgili dosyalar: `apps/ai-engine/r3mes_ai_engine/proxy_service.py:346`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:350`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:351`, `apps/ai-engine/README.md:61`.
- Neden önemli: Stream path tekrar açılırsa runtime debug UI/API response üzerinden eksik kalır.
- Test: stream chat smoke'ta adapter cache/lock/swap ölçümleri response/trace'e gelmeli.
- Düzeltme yönü: stream start event veya trailing diagnostic event ile structured runtime summary.
- Risk: Medium.

### RC08 - LoRA hot-swap global lock multi-tenant throughput sınırı

- Belirti: Aynı anda tek LoRA yükleme/tamamlama lock içinde seri çalışıyor.
- İlgili dosyalar: `apps/ai-engine/r3mes_ai_engine/proxy_service.py:26`, `apps/ai-engine/r3mes_ai_engine/proxy_service.py:358`, `apps/ai-engine/README.md:65`.
- Neden önemli: LoRA behavior/persona optional kalmalı; bilgi doğruluğu veya core chat latency buna bağlanmamalı.
- Test: eşzamanlı adapter chat load test; lock wait dağılımını ölç.
- Düzeltme yönü: base-only RAG path default; LoRA adapter queue/budget/timeout; opsiyonel ayrı worker pool.
- Risk: Medium.

### RC09 - llama_cpp ve transformers_peft runtime doktrini karışık

- Belirti: Backend default `llama_cpp`; ai-engine settings açıklaması `transformers_peft` için "yeni ana yol" diyor; README golden path Qwen GGUF/llama-server.
- İlgili dosyalar: `apps/backend-api/src/lib/adapterRuntimeSelect.ts:3`, `apps/ai-engine/r3mes_ai_engine/settings.py:13`, `apps/ai-engine/README.md:7`.
- Neden önemli: Operasyon hangi runtime'ı product kabul ettiğini bilmezse adapter formatı, observability ve performance beklentisi kayar.
- Test: runtime profile snapshot test: backend env + ai-engine env + README contract aynı profile adı üretmeli.
- Düzeltme yönü: `R3MES_RUNTIME_PROFILE=local-dev|pilot-rag|peft-lab` gibi tek profile contract.
- Risk: Medium.

### RC10 - Runtime fallback normal response'ta kullanıcı/feedback için yeterince görünür değil

- Belirti: `retrieval_debug.runtime` debug header/env ile geliyor; feedback UI normalde runtime provider fallback'i doğrudan kaydetmiyor.
- İlgili dosyalar: `apps/backend-api/src/lib/chatDebugBoundary.ts:15`, `apps/backend-api/src/routes/chatProxy.ts:1093`, `apps/dApp/components/chat-screen.tsx:799`, `apps/dApp/components/chat-screen.tsx:815`.
- Neden önemli: BAD_ANSWER feedback'i provider fallback ile eşleşmezse regresyon yanlış katmanda aranır.
- Test: debug kapalı UI feedback metadata'sında answer path/provider fallback var mı kontrol et.
- Düzeltme yönü: PII-safe runtime lineage summary feedback metadata'ya otomatik eklensin.
- Risk: High.

## E) Product-Level Remediation Direction

Bu bölümde kod yazılmadı. Minimum kırılmayla sonraki çözüm analizinde ele alınması gereken hedefler:

1. `RuntimeProfile` contract:
   - `chatRuntime`, `chatModel`, `embeddingProvider`, `embeddingModel`, `rerankerProvider`, `fallbackPolicy`, `qdrantVectorSize`, `strictRuntime`.
   - Backend ve ai-engine aynı profile'ı raporlamalı.

2. Deep readiness gate:
   - DB + Redis + ai-engine `/health/runtime` + Qdrant health + embedding warm smoke + reranker warm smoke.
   - Pilot/staging'de real embedding/reranker fallback fail olmalı.

3. Provider lineage in every answer:
   - `answerPath`, `qwenCalled`, `validatorCalled`, `embeddingProviderActual`, `embeddingFallbackUsed`, `rerankerProviderActual`, `rerankerFallbackUsed`, `qdrantAvailable`.
   - Debug kapalı normal response'ta user-visible detay değil; feedback/eval için PII-safe summary.

4. Stream contract decision:
   - Ya UI non-stream product contract olarak netleştirilecek.
   - Ya stream path gerçekten product-grade olacak: diagnostic event, timeout, SSE integration tests.

5. Fallback policy hardening:
   - Local dev: deterministic fallback allowed.
   - Eval/pilot/staging/prod: real embedding/reranker required; fallback fail.
   - Chat model unavailable: no silent model substitute; deterministic composer only if evidence-answer path explicitly eligible.

6. Runtime-specific eval tags:
   - Answer-quality eval her test sonucu için provider lineage assert etmeli.
   - `source_found_but_bad_answer` bucket'ı answer path ile ayrışmalı: `composer_bad`, `qwen_bad`, `safety_bad`, `provider_fallback_bad`.

## F) Suggested Next Review Focus

Section 07 için mantıklı sonraki bölüm `Product Readiness / Deployment / Observability / Ops Contract` olmalı. Çünkü Section 06 sonunda görünen ana açık kodun tek bir fonksiyonu değil; runtime gerçekliğini deploy, CI, health, feedback ve eval tarafında tek ürün kontratına bağlama eksikliği.

Öncesinde Section 06 solutions phase yapılacaksa öncelik sırası:

1. RuntimeProfile + provider lineage design.
2. Deep readiness endpoint/report.
3. Strict provider fallback policy by environment.
4. Feedback metadata runtime bridge.
5. Stream contract decision.

## Unknowns / Not Found

- Repo içinde backend `/ready` endpoint'inin ai-engine veya provider-readiness raporunu okuduğuna dair kod bulmadım.
- Provider-readiness script'inin CI'da zorunlu gate olduğuna dair repo içi workflow kanıtı bu audit sırasında bulunmadı.
- UI normal kullanıcı response'unda debug kapalıyken provider fallback summary gösteren bir yüzey bulmadım.
- Runtime profile'ı tek tip doğrulayan paylaşımlı TS/Python contract dosyası bulmadım.

## Final Assessment

Section 06 seviyesi: çalışır ve testlenebilir, ama product-grade runtime contract henüz tamam değil.

Ana darboğaz: modelin kendisi değil; provider gerçekliği, fallback görünürlüğü ve readiness gate'in parçalı olması.

Qwen2.5-3B ile hedef gerçekçi: evet, ama yalnızca Qwen'in synthesis-only rolü korunur, BGE-M3/cross-encoder gerçekliği gate edilir, deterministic composer path'i answer lineage ile ayrıştırılırsa.

Satılabilir pilot minimum eşiği:

- Her UI cevabında feedback/eval tarafına provider lineage düşmeli.
- Pilot/staging'de embedding/reranker fallback sıfır toleransla fail olmalı.
- Backend readiness AI runtime'ı da kapsamalı.
- Stream ya product path yapılmalı ya UI/contract'ta non-stream olarak adlandırılmalı.
- LoRA bilgi doğruluğu katmanı gibi sunulmamalı; behavior/persona optional kalmalı.
