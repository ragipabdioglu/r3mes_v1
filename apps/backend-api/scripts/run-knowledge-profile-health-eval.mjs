import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultOut = resolve(root, "artifacts/evals/profile-health/latest.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseArgs() {
  return {
    baseUrl: argValue("--base-url", process.env.R3MES_BACKEND_URL || "http://127.0.0.1:3000"),
    out: resolve(root, argValue("--out", process.env.R3MES_PROFILE_HEALTH_EVAL_OUT || defaultOut)),
    wallet: argValue("--wallet", process.env.R3MES_DEV_WALLET || "0xdevlocal"),
    minUsableRatio: Number(argValue("--min-usable-ratio", process.env.R3MES_PROFILE_HEALTH_MIN_USABLE_RATIO || "0.75")),
    maxWeakRatio: Number(argValue("--max-weak-ratio", process.env.R3MES_PROFILE_HEALTH_MAX_WEAK_RATIO || "0.35")),
    minAverageScore: Number(argValue("--min-average-score", process.env.R3MES_PROFILE_HEALTH_MIN_AVERAGE_SCORE || "45")),
  };
}

function authHeaders(wallet) {
  return {
    "x-wallet-address": wallet,
    "x-message": JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      address: wallet,
    }),
    "x-signature": "dev-profile-health-skip-wallet-auth",
  };
}

function increment(acc, key, amount = 1) {
  const safeKey = String(key ?? "missing");
  acc[safeKey] = (acc[safeKey] ?? 0) + amount;
  return acc;
}

function percentile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

function fallbackHealth(collection) {
  const quality = collection.sourceQuality ?? null;
  const confidence = collection.profileConfidence ?? null;
  const score =
    quality === "structured"
      ? confidence === "low" ? 68 : 76
      : quality === "inferred"
        ? 56
        : quality === "thin"
          ? 32
          : 0;
  const level = score >= 78 ? "healthy" : score >= 48 ? "usable" : "weak";
  const warnings = [];
  if (quality === "thin") warnings.push("thin_source_quality");
  if (quality === "inferred") warnings.push("inferred_source_quality");
  if (!collection.profileVersion) warnings.push("missing_profile_health_fields");
  if (!collection.lastProfiledAt) warnings.push("missing_last_profiled_at");
  return {
    score,
    level,
    warnings,
    fallbackUsed: collection.profileHealthScore == null || collection.profileHealthLevel == null,
  };
}

function collectionHealth(collection) {
  if (Number.isFinite(Number(collection.profileHealthScore)) && collection.profileHealthLevel) {
    return {
      score: Number(collection.profileHealthScore),
      level: collection.profileHealthLevel,
      warnings: collection.profileHealthWarnings ?? [],
      fallbackUsed: false,
    };
  }
  return fallbackHealth(collection);
}

async function fetchCollections(opts) {
  const response = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/v1/knowledge?scope=all&limit=100`, {
    headers: authHeaders(opts.wallet),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`knowledge list failed: ${response.status} ${text.slice(0, 240)}`);
  }
  const json = await response.json();
  return Array.isArray(json?.data) ? json.data : [];
}

function summarizeCollections(collections, opts) {
  const healthRows = collections.map((collection) => ({
    collection,
    health: collectionHealth(collection),
  }));
  const scores = collections
    .map((collection) => collectionHealth(collection).score)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const levelCounts = healthRows.reduce((acc, row) => increment(acc, row.health.level), {});
  const sourceQualityCounts = collections.reduce((acc, collection) => increment(acc, collection.sourceQuality), {});
  const warningCounts = healthRows.reduce((acc, row) => {
    for (const warning of row.health.warnings ?? []) increment(acc, warning);
    return acc;
  }, {});
  const weakCollections = healthRows
    .filter((row) => row.health.level === "weak" || Number(row.health.score ?? 0) < 48)
    .map((row) => ({
      id: row.collection.id,
      name: row.collection.name,
      sourceQuality: row.collection.sourceQuality ?? null,
      score: row.health.score,
      level: row.health.level,
      warnings: row.health.warnings,
      fallbackUsed: row.health.fallbackUsed,
    }));
  const usableCount = healthRows.filter((row) =>
    row.health.level === "healthy" || row.health.level === "usable",
  ).length;
  const weakCount = healthRows.filter((row) => row.health.level === "weak").length;
  const fallbackCount = healthRows.filter((row) => row.health.fallbackUsed).length;
  const averageScore =
    scores.length === 0 ? 0 : Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3));
  const usableRatio = collections.length === 0 ? 0 : Number((usableCount / collections.length).toFixed(3));
  const weakRatio = collections.length === 0 ? 0 : Number((weakCount / collections.length).toFixed(3));
  const failures = [];
  if (collections.length === 0) failures.push("collection_count:0");
  if (usableRatio < opts.minUsableRatio) failures.push(`usable_ratio:${usableRatio}<${opts.minUsableRatio}`);
  if (weakRatio > opts.maxWeakRatio) failures.push(`weak_ratio:${weakRatio}>${opts.maxWeakRatio}`);
  if (averageScore < opts.minAverageScore) failures.push(`average_score:${averageScore}<${opts.minAverageScore}`);

  return {
    total: collections.length,
    passed: failures.length === 0 ? 1 : 0,
    failed: failures.length === 0 ? 0 : 1,
    passRate: failures.length === 0 ? 1 : 0,
    ok: failures.length === 0,
    failures,
    thresholds: {
      minUsableRatio: opts.minUsableRatio,
      maxWeakRatio: opts.maxWeakRatio,
      minAverageScore: opts.minAverageScore,
    },
    averageScore,
    usableRatio,
    weakRatio,
    scoreDistribution: {
      min: scores[0] ?? null,
      p50: percentile(scores, 0.5),
      p90: percentile(scores, 0.9),
      max: scores.at(-1) ?? null,
    },
    levelCounts,
    sourceQualityCounts,
    warningCounts,
    weakCollections,
    profileHealthFieldCoverage: {
      withNativeHealthFields: collections.length - fallbackCount,
      fallbackUsed: fallbackCount,
      fallbackRatio: collections.length === 0 ? 0 : Number((fallbackCount / collections.length).toFixed(3)),
    },
  };
}

async function main() {
  const opts = parseArgs();
  const started = Date.now();
  const collections = await fetchCollections(opts);
  const summary = summarizeCollections(collections, opts);
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      ...summary,
      durationMs: Date.now() - started,
    },
    collections: collections.map((collection) => ({
      ...(() => {
        const health = collectionHealth(collection);
        return {
          profileHealthScore: health.score,
          profileHealthLevel: health.level,
          profileHealthWarnings: health.warnings,
          profileHealthFallbackUsed: health.fallbackUsed,
        };
      })(),
      id: collection.id,
      name: collection.name,
      visibility: collection.visibility,
      sourceQuality: collection.sourceQuality ?? null,
      profileConfidence: collection.profileConfidence ?? null,
      profileVersion: collection.profileVersion ?? null,
      lastProfiledAt: collection.lastProfiledAt ?? null,
      inferredDomain: collection.inferredDomain ?? null,
      inferredTopic: collection.inferredTopic ?? null,
    })),
  };
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`wrote ${opts.out}`);
  console.log(JSON.stringify(report.summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
