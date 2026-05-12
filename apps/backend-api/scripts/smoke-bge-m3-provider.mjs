import { embedTextsForQdrantWithDiagnostics, getQdrantVectorSize } from "../dist/lib/qdrantEmbedding.js";

const previousProvider = process.env.R3MES_EMBEDDING_PROVIDER;
const previousRequire = process.env.R3MES_REQUIRE_REAL_EMBEDDINGS;

process.env.R3MES_EMBEDDING_PROVIDER = "bge-m3";
process.env.R3MES_REQUIRE_REAL_EMBEDDINGS = "1";

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

const samples = [
  "KAP finansal tabloda net kar ve hasılat değişimi nasıl okunur?",
  "Finansal tabloda net kar, hasılat ve dönemsel değişim birlikte değerlendirilir.",
  "Okulda BEP planı için veli ve rehberlik servisiyle görüşme yapılır.",
];

function isBgeM3Model(value) {
  return typeof value === "string" && value.toLowerCase().includes("bge-m3");
}

try {
  const result = await embedTextsForQdrantWithDiagnostics(samples);
  const [queryVector, positiveVector, negativeVector] = result.vectors;
  const positiveSimilarity = cosineSimilarity(queryVector ?? [], positiveVector ?? []);
  const negativeSimilarity = cosineSimilarity(queryVector ?? [], negativeVector ?? []);
  const expectedDimension = getQdrantVectorSize();
  const passed =
    !result.diagnostics.fallbackUsed &&
    result.diagnostics.actualProvider === "bge-m3" &&
    isBgeM3Model(result.diagnostics.model) &&
    result.diagnostics.dimension === expectedDimension &&
    positiveSimilarity > negativeSimilarity;

  const report = {
    phase: "bge_m3_embedding_smoke",
    diagnostics: result.diagnostics,
    expectedDimension,
    positiveSimilarity: Number(positiveSimilarity.toFixed(6)),
    negativeSimilarity: Number(negativeSimilarity.toFixed(6)),
    passed,
  };
  console.log(JSON.stringify(report, null, 2));

  if (!passed) {
    console.error("BGE-M3 smoke failed: provider/model must be real bge-m3, dimension must match Qdrant, and positive similarity must beat negative similarity.");
    process.exit(1);
  }
} finally {
  if (previousProvider === undefined) {
    delete process.env.R3MES_EMBEDDING_PROVIDER;
  } else {
    process.env.R3MES_EMBEDDING_PROVIDER = previousProvider;
  }
  if (previousRequire === undefined) {
    delete process.env.R3MES_REQUIRE_REAL_EMBEDDINGS;
  } else {
    process.env.R3MES_REQUIRE_REAL_EMBEDDINGS = previousRequire;
  }
}
