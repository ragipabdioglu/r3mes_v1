import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { embedTextsForQdrantWithDiagnostics, getQdrantVectorSize } from "../dist/lib/qdrantEmbedding.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const defaultOut = resolve(root, "artifacts/evals/provider-readiness/latest.json");
const AI_ENGINE_URL = (process.env.R3MES_AI_ENGINE_URL || process.env.AI_ENGINE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function isBgeM3Model(value) {
  return typeof value === "string" && value.toLowerCase().includes("bge-m3");
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function measure(name, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return {
      name,
      ok: true,
      latencyMs: Date.now() - started,
      ...value,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function measureEmbedding(name) {
  const previousRequire = process.env.R3MES_REQUIRE_REAL_EMBEDDINGS;
  process.env.R3MES_REQUIRE_REAL_EMBEDDINGS = "1";
  try {
    return await measure(name, async () => {
      const samples = [
        "KAP finansal tabloda net kar ve hasılat değişimi nasıl okunur?",
        "Finansal tabloda net kar, hasılat ve dönemsel değişim birlikte değerlendirilir.",
        "Okulda BEP planı için veli ve rehberlik servisiyle görüşme yapılır.",
      ];
      const result = await embedTextsForQdrantWithDiagnostics(samples);
      const [queryVector, positiveVector, negativeVector] = result.vectors;
      const positiveSimilarity = cosineSimilarity(queryVector ?? [], positiveVector ?? []);
      const negativeSimilarity = cosineSimilarity(queryVector ?? [], negativeVector ?? []);
      return {
        diagnostics: result.diagnostics,
        expectedDimension: getQdrantVectorSize(),
        positiveSimilarity: Number(positiveSimilarity.toFixed(6)),
        negativeSimilarity: Number(negativeSimilarity.toFixed(6)),
      };
    });
  } finally {
    if (previousRequire === undefined) {
      delete process.env.R3MES_REQUIRE_REAL_EMBEDDINGS;
    } else {
      process.env.R3MES_REQUIRE_REAL_EMBEDDINGS = previousRequire;
    }
  }
}

async function postJson(path, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function measureReranker(name) {
  return measure(name, async () => {
    const parsed = await postJson(
      "/v1/rerank",
      {
        query: "Production migration öncesi hangi kontroller yapılmalı?",
        documents: [
          "Title: Veritabanı migration güvenliği\nTags: technical, migration, rollback, staging\nMigration öncesi yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
          "Title: Tatil hazırlığı\nTags: travel, passport\nSeyahat öncesi pasaport geçerliliği ve rezervasyon bilgileri kontrol edilmelidir.",
          "Title: KAP kar dağıtım tablosu\nTags: finance, kap, dividend\nSPK'ya göre net dönem kârı ve dağıtılabilir kâr kalemleri tabloda ayrı satırlarda verilir.",
        ],
      },
      Number(process.env.R3MES_RERANKER_READINESS_TIMEOUT_MS || 120_000),
    );
    return {
      provider: parsed.provider ?? null,
      fallbackUsed: parsed.fallback_used === true,
      fallbackReason: parsed.fallback_reason ?? null,
      scores: Array.isArray(parsed.scores) ? parsed.scores : [],
    };
  });
}

function summarize(report) {
  const failures = [];
  const embeddingRuns = report.embedding.runs;
  const rerankerRuns = report.reranker.runs;
  const embeddingWarm = embeddingRuns.at(-1);
  const rerankerWarm = rerankerRuns.at(-1);
  const embeddingDiagnostics = embeddingWarm?.diagnostics ?? {};

  if (!embeddingRuns.every((run) => run.ok)) failures.push("embedding_run_failed");
  if (embeddingDiagnostics.fallbackUsed === true) failures.push("embedding_fallback_used");
  if (!["ai-engine", "bge-m3"].includes(embeddingDiagnostics.actualProvider)) failures.push("embedding_provider_not_real");
  if (!isBgeM3Model(embeddingDiagnostics.model)) failures.push("embedding_model_not_bge_m3");
  if (embeddingWarm?.positiveSimilarity <= embeddingWarm?.negativeSimilarity) failures.push("embedding_semantic_similarity_failed");

  if (!rerankerRuns.every((run) => run.ok)) failures.push("reranker_run_failed");
  if (rerankerWarm?.fallbackUsed === true) failures.push("reranker_fallback_used");
  if (rerankerWarm?.provider !== "cross_encoder") failures.push("reranker_provider_not_cross_encoder");
  if (!Array.isArray(rerankerWarm?.scores) || rerankerWarm.scores.length < 2) failures.push("reranker_scores_missing");

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "pass" : "fail",
    failures,
    embeddingWarmLatencyMs: embeddingWarm?.latencyMs ?? null,
    rerankerWarmLatencyMs: rerankerWarm?.latencyMs ?? null,
    embeddingColdLatencyMs: embeddingRuns[0]?.latencyMs ?? null,
    rerankerColdLatencyMs: rerankerRuns[0]?.latencyMs ?? null,
    embeddingProvider: embeddingDiagnostics.actualProvider ?? null,
    embeddingModel: embeddingDiagnostics.model ?? null,
    rerankerProvider: rerankerWarm?.provider ?? null,
  };
}

async function main() {
  const out = resolve(root, argValue("--out", process.env.R3MES_PROVIDER_READINESS_OUT || defaultOut));
  const generatedAt = new Date().toISOString();
  const embeddingRuns = [
    await measureEmbedding("embedding_cold"),
    await measureEmbedding("embedding_warm"),
  ];
  const rerankerRuns = [
    await measureReranker("reranker_cold"),
    await measureReranker("reranker_warm"),
  ];
  const report = {
    generatedAt,
    aiEngineUrl: AI_ENGINE_URL,
    embedding: {
      runs: embeddingRuns,
    },
    reranker: {
      runs: rerankerRuns,
    },
  };
  report.summary = summarize(report);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (!report.summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
