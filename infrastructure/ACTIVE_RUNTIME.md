# Active Runtime Inventory

This file is the short source of truth for the current MVP path. If another
document disagrees with this inventory, treat that document as stale until it is
updated.

## Active Product Path

| Layer | Active choice | Notes |
| --- | --- | --- |
| Base model | Qwen2.5-3B GGUF | Do not replace with Qwen 0.5B for MVP quality work. |
| Inference server | llama-server on 8080 | Hosted locally; ai-engine forwards requests. |
| AI proxy | apps/ai-engine on 8000 | Thin proxy around llama-compatible APIs. |
| Backend | apps/backend-api on 3000 | Auth, access control, orchestration, RAG, safety. |
| Frontend | apps/dApp on 3001 | Studio upload, source selection, chat UI. |
| Vector memory | Qdrant on 6333 | Used with Prisma lexical candidates in true hybrid retrieval; active vector size is 1024 for BGE-M3 embeddings. |
| Relational memory | Postgres + pgvector on 5432 | Prisma source of truth for collections, docs, chunks, metadata. |
| Knowledge | RAG | Knowledge is not carried by LoRA. |
| LoRA | Optional behavior/style/persona | Default local scale can be 0 for clean base/RAG evaluation. |

## Active Chat Pipeline

1. Wallet/dev auth and request validation.
2. Query planner and metadata/domain routing.
3. Access-controlled collection scope resolution.
4. True hybrid retrieval: Qdrant candidates + Prisma lexical candidates.
5. Strict route scope and rerank/prune to a small context.
6. Evidence extractor builds usable facts, risks, and unsupported items.
7. Intent-based answer composer renders the final answer when grounded.
8. Safety gate blocks risky certainty, low-quality language, and source mismatch.
9. UI displays sources and metadata/source suggestions.

## Active Quality Gates

```powershell
pnpm --filter @r3mes/backend-api exec tsc -p tsconfig.json --noEmit
pnpm --filter @r3mes/backend-api run eval:adaptive-rag
```

## Public / Debug Chat Response Boundary

`POST /v1/chat/completions` public responses expose only the OpenAI-style chat payload plus clean `sources`.
Internal fields are hidden by default:

- `grounded_answer`
- `safety_gate`
- `answer_quality`
- `retrieval_debug`

Debug/eval callers can opt in with:

```text
X-R3MES-Debug: 1
```

or local env:

```powershell
$env:R3MES_EXPOSE_CHAT_DEBUG='1'
```

The grounded eval runner sends the debug header automatically.

## Composer Role Boundary

Fallback and safety answers stay deterministic. Grounded answers can be switched explicitly:

| Mode | Env | Behavior |
| --- | --- | --- |
| Deterministic default | `R3MES_GROUNDED_COMPOSER_MODE=deterministic` | Uses the domain evidence composer for stable MVP answers. |
| Model synthesis | `R3MES_GROUNDED_COMPOSER_MODE=model` | Sends clean evidence to Qwen for natural synthesis when retrieval is grounded. |
| Auto | `R3MES_GROUNDED_COMPOSER_MODE=auto` | Keeps medical on deterministic safety-first path; lets non-medical grounded answers use model synthesis. |

No-source, source-suggestion, privacy-safe, and alignment-mismatch fallbacks do not depend on Qwen.

## Active Embedding / Reindex Gate

Qdrant reindex must not run on silent deterministic fallback when `R3MES_EMBEDDING_PROVIDER=ai-engine` or `bge-m3`.

```powershell
pnpm ai-engine:embedding
$env:R3MES_REQUIRE_REAL_EMBEDDINGS='1'
pnpm --filter @r3mes/backend-api run smoke:embedding-provider
Remove-Item Env:R3MES_REQUIRE_REAL_EMBEDDINGS
pnpm --filter @r3mes/backend-api run qdrant:reindex
```

Expected smoke diagnostics before reindex:

```json
{ "actualProvider": "ai-engine", "fallbackUsed": false, "dimension": 1024 }
```

The reindex script checks the Qdrant collection vector size before upsert and aborts if embedding fallback is used.

Targeted unit tests for the active path live under:

- `apps/backend-api/src/lib/skillPipeline.test.ts`
- `apps/backend-api/src/lib/hybridKnowledgeRetrieval.test.ts`
- `apps/backend-api/src/lib/domainEvidenceComposer.test.ts`
- `apps/backend-api/src/lib/safetyGate.test.ts`
- `apps/backend-api/src/lib/knowledgeAccess.test.ts`

## Legacy / R&D Boundary

The following are not active product defaults:

- BitNet/QVAC runtime documents and compose files.
- Knowledge-heavy/domain LoRA as the source of factual accuracy.
- Old benchmark-worker quality as a proxy for RAG factual quality.
- Qwen 0.5B model files for MVP answer quality.
- Training outputs and local datasets as runtime dependencies.

Legacy and R&D references are indexed in `infrastructure/LEGACY_RND.md`.
