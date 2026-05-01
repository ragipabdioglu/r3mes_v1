const AI_ENGINE_URL = (process.env.R3MES_AI_ENGINE_URL || process.env.AI_ENGINE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

async function postJson(path, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${AI_ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${path} failed: status=${response.status} body=${text.slice(0, 300)}`);
    }
    return { latencyMs: Date.now() - started, data: JSON.parse(text) };
  } finally {
    clearTimeout(timeout);
  }
}

async function warmEmbedding() {
  const result = await postJson(
    "/v1/embeddings",
    {
      input: [
        "Production migration öncesi yedek, staging ve rollback kontrolü yapılmalıdır.",
        "Baş ağrısı sorusunda kaynak yoksa yanlış karın ağrısı kaynağı kullanılmamalıdır.",
      ],
    },
    Number(process.env.R3MES_EMBEDDING_WARMUP_TIMEOUT_MS || 180_000),
  );
  const firstEmbedding = result.data?.data?.[0]?.embedding;
  if (!Array.isArray(firstEmbedding) || firstEmbedding.length === 0) {
    throw new Error("embedding warmup failed: missing embedding vector");
  }
  return {
    latencyMs: result.latencyMs,
    model: result.data?.model ?? null,
    dimension: firstEmbedding.length,
  };
}

async function warmReranker() {
  const result = await postJson(
    "/v1/rerank",
    {
      query: "Production migration öncesi hangi kontroller yapılmalı?",
      documents: [
        "Title: Veritabanı migration güvenliği\nTags: technical, migration, rollback, staging\nMigration öncesi yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
        "Title: Tatil hazırlığı\nTags: travel, passport\nSeyahat öncesi pasaport geçerliliği ve rezervasyon bilgileri kontrol edilmelidir.",
      ],
    },
    Number(process.env.R3MES_RERANKER_WARMUP_TIMEOUT_MS || 120_000),
  );
  if (!Array.isArray(result.data?.scores) || result.data.scores.length !== 2) {
    throw new Error("reranker warmup failed: missing rerank scores");
  }
  return {
    latencyMs: result.latencyMs,
    provider: result.data?.provider ?? null,
    fallbackUsed: result.data?.fallback_used === true,
    fallbackReason: result.data?.fallback_reason ?? null,
    scores: result.data.scores,
  };
}

async function main() {
  const started = Date.now();
  const embedding = await warmEmbedding();
  const reranker = await warmReranker();
  console.log(JSON.stringify({
    ok: true,
    aiEngineUrl: AI_ENGINE_URL,
    durationMs: Date.now() - started,
    embedding,
    reranker,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
