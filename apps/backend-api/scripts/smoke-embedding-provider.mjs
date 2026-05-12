import { embedTextsForQdrantWithDiagnostics } from "../dist/lib/qdrantEmbedding.js";

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
  "Trafik cezasına itiraz etmeden önce hangi süre ve belgeleri kontrol etmeliyim?",
  "Trafik cezasına itiraz için tebliğ tarihi, başvuru süresi, deliller ve ödeme kayıtları kontrol edilmelidir.",
  "Rahatsız eden baş ağrısı, ateş veya nörolojik belirti varsa sağlık uzmanıyla görüşülmelidir.",
];

try {
  const result = await embedTextsForQdrantWithDiagnostics(samples);
  const [queryVector, positiveVector, negativeVector] = result.vectors;
  const positiveSimilarity = cosineSimilarity(queryVector ?? [], positiveVector ?? []);
  const negativeSimilarity = cosineSimilarity(queryVector ?? [], negativeVector ?? []);
  const requireRealProvider = process.env.R3MES_REQUIRE_REAL_EMBEDDINGS === "1";
  const passed = positiveSimilarity > negativeSimilarity && (!requireRealProvider || !result.diagnostics.fallbackUsed);

  const report = {
    diagnostics: result.diagnostics,
    positiveSimilarity: Number(positiveSimilarity.toFixed(6)),
    negativeSimilarity: Number(negativeSimilarity.toFixed(6)),
    passed,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!passed) {
    if (requireRealProvider && result.diagnostics.fallbackUsed) {
      console.error("Embedding smoke failed: real embedding provider was required but deterministic fallback was used.");
    } else {
      console.error("Embedding smoke failed: positive sample did not score above negative sample.");
    }
    process.exit(1);
  }
} catch (error) {
  console.error(JSON.stringify({
    passed: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
