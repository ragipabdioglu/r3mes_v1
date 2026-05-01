const AI_ENGINE_URL = (process.env.R3MES_AI_ENGINE_URL || process.env.AI_ENGINE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const query = process.env.R3MES_RERANKER_SMOKE_QUERY || "Production migration öncesi hangi kontroller yapılmalı?";
const documents = [
  "Title: Veritabanı migration güvenliği\nTags: technical, migration, rollback, staging\nMigration öncesi yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
  "Title: Tatil hazırlığı\nTags: travel, passport\nSeyahat öncesi pasaport geçerliliği ve rezervasyon bilgileri kontrol edilmelidir.",
];

async function main() {
  const started = Date.now();
  const response = await fetch(`${AI_ENGINE_URL}/v1/rerank`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, documents }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`reranker smoke failed: status=${response.status} body=${text.slice(0, 300)}`);
  }

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.scores) || parsed.scores.length !== documents.length) {
    throw new Error(`reranker smoke failed: expected ${documents.length} scores, got ${JSON.stringify(parsed)}`);
  }
  if (!parsed.scores.every((score) => typeof score === "number" && Number.isFinite(score))) {
    throw new Error(`reranker smoke failed: non-finite score in ${JSON.stringify(parsed.scores)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    aiEngineUrl: AI_ENGINE_URL,
    query,
    scores: parsed.scores,
    provider: parsed.provider ?? null,
    fallbackUsed: parsed.fallback_used === true,
    fallbackReason: parsed.fallback_reason ?? null,
    latencyMs: Date.now() - started,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
