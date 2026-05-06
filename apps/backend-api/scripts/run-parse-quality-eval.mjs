import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const backendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultFile = resolve(root, "infrastructure/evals/parse-quality/golden.jsonl");
const defaultOut = resolve(root, "artifacts/evals/parse-quality/latest.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseArgs() {
  return {
    file: resolve(root, argValue("--file", process.env.R3MES_PARSE_QUALITY_EVAL_FILE || defaultFile)),
    out: resolve(root, argValue("--out", process.env.R3MES_PARSE_QUALITY_EVAL_OUT || defaultOut)),
  };
}

async function readJsonl(file) {
  const raw = await readFile(file, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1} invalid jsonl: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = String(getKey(row) ?? "missing");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function failedExpectation(caseItem, quality) {
  const failures = [];
  if (caseItem.expectedLevel && quality.level !== caseItem.expectedLevel) {
    failures.push(`level:${quality.level}!=${caseItem.expectedLevel}`);
  }
  if (Number.isFinite(Number(caseItem.minScore)) && quality.score < Number(caseItem.minScore)) {
    failures.push(`score:${quality.score}<${caseItem.minScore}`);
  }
  if (Number.isFinite(Number(caseItem.maxScore)) && quality.score > Number(caseItem.maxScore)) {
    failures.push(`score:${quality.score}>${caseItem.maxScore}`);
  }
  for (const warning of caseItem.expectedWarnings ?? []) {
    if (!quality.warnings.includes(warning)) failures.push(`missing_warning:${warning}`);
  }
  for (const warning of caseItem.forbiddenWarnings ?? []) {
    if (quality.warnings.includes(warning)) failures.push(`forbidden_warning:${warning}`);
  }
  return failures;
}

async function main() {
  const opts = parseArgs();
  const started = Date.now();
  const [{ scoreKnowledgeParseQuality }, { chunkKnowledgeText }] = await Promise.all([
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeParseQuality.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeText.js")).href),
  ]);
  const cases = await readJsonl(opts.file);
  const results = cases.map((caseItem) => {
    const chunks = chunkKnowledgeText(caseItem.text);
    const quality = scoreKnowledgeParseQuality({
      filename: caseItem.filename,
      sourceType: caseItem.sourceType,
      text: caseItem.text,
      chunks,
    });
    const failures = failedExpectation(caseItem, quality);
    return {
      id: caseItem.id,
      bucket: caseItem.bucket ?? "default",
      filename: caseItem.filename,
      expectedLevel: caseItem.expectedLevel ?? null,
      actualLevel: quality.level,
      score: quality.score,
      warnings: quality.warnings,
      signals: quality.signals,
      passed: failures.length === 0,
      failures,
    };
  });
  const failed = results.filter((result) => !result.passed);
  const scores = results.map((result) => result.score).sort((a, b) => a - b);
  const summary = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    passRate: results.length === 0 ? 0 : Number(((results.length - failed.length) / results.length).toFixed(3)),
    ok: failed.length === 0,
    durationMs: Date.now() - started,
    levelCounts: countBy(results, (result) => result.actualLevel),
    bucketCounts: countBy(results, (result) => result.bucket),
    warningCounts: results.reduce((acc, result) => {
      for (const warning of result.warnings) acc[warning] = (acc[warning] ?? 0) + 1;
      return acc;
    }, {}),
    scoreDistribution: {
      min: scores[0] ?? null,
      p50: scores[Math.floor((scores.length - 1) * 0.5)] ?? null,
      max: scores.at(-1) ?? null,
    },
    failures: failed.map((result) => ({
      id: result.id,
      bucket: result.bucket,
      failures: result.failures,
      actualLevel: result.actualLevel,
      score: result.score,
      warnings: result.warnings,
    })),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    input: {
      file: opts.file,
    },
    summary,
    results,
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`wrote ${opts.out}`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
