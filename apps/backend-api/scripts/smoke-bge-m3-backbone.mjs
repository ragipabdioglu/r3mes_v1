import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));

const result = spawnSync(
  process.execPath,
  ["--env-file=.env", "scripts/reindex-qdrant.mjs", "--status", "--verify-count"],
  {
    cwd: backendRoot,
    env: process.env,
    encoding: "utf8",
  },
);

if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  throw new Error(`BGE-M3 backbone smoke failed: qdrant status exited with ${result.status ?? "unknown"}`);
}

let status;
try {
  status = JSON.parse(result.stdout);
} catch (error) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  throw new Error(`BGE-M3 backbone smoke failed: invalid qdrant status JSON (${error.message})`);
}

const audit = status.payloadAudit ?? {};
const failures = [
  status.bgeM3BackboneReady === true ? null : "bge_m3_backbone_not_ready",
  status.countMatches === true ? null : "qdrant_point_count_mismatch",
  audit.deterministicProviderPointCount === 0 ? null : "deterministic_provider_points_present",
  audit.fallbackUsedPointCount === 0 ? null : "embedding_fallback_points_present",
  audit.missingModelPointCount === 0 ? null : "embedding_model_missing",
  audit.wrongVectorSizePointCount === 0 ? null : "wrong_vector_size_points_present",
].filter(Boolean);

if (failures.length > 0) {
  console.log(JSON.stringify({
    ok: false,
    failures,
    status,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  phase: "bge_m3_backbone_smoke",
  collection: status.collection,
  totalChunks: status.totalChunks,
  qdrantPointCount: status.qdrantPointCount,
  vectorSize: status.vectorSize,
  requestedEmbeddingProvider: status.requestedEmbeddingProvider,
  sampleEmbeddingModels: audit.sampleEmbeddingModels ?? [],
  bgeM3ModelPointCount: audit.bgeM3ModelPointCount,
  deterministicFallbackPointCount: status.deterministicFallbackPointCount,
}, null, 2));
