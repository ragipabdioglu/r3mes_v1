import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultSource = resolve(root, "artifacts/evals/answer-quality/latest.json");
const defaultOut = resolve(root, "artifacts/evals/quality-trends/latest-baseline.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasArg(name) {
  return process.argv.includes(name);
}

function resolveFromRoot(value) {
  return resolve(root, value);
}

function printHelp() {
  console.log(`Usage: node apps/backend-api/scripts/update-eval-baseline.mjs [--from <eval-summary.json>] [--out <baseline.json>] [--yes]

Copies an eval run summary into the quality-trend baseline.

Defaults:
  --from  artifacts/evals/answer-quality/latest.json
  --out   artifacts/evals/quality-trends/latest-baseline.json

Safety:
  Pass --yes to write the baseline. Without --yes this script prints the planned update only.`);
}

function readSummary(sourcePath, parsed) {
  if (parsed?.summary && typeof parsed.summary === "object") return parsed.summary;
  if (parsed?.answerQualityTrends || parsed?.answerQualityFailureRate != null) return parsed;
  throw new Error(`Input does not contain a summary object: ${sourcePath}`);
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    printHelp();
    return;
  }

  const sourcePath = resolveFromRoot(argValue("--from", defaultSource));
  const outPath = resolveFromRoot(argValue("--out", defaultOut));
  const write = hasArg("--yes");
  const parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  const summary = readSummary(sourcePath, parsed);
  const baseline = {
    version: 1,
    source: sourcePath,
    updatedAt: new Date().toISOString(),
    summary,
    answerQualityTrends: summary.answerQualityTrends ?? null,
  };

  if (!write) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      source: sourcePath,
      out: outPath,
      message: "Pass --yes to write this baseline.",
      baseline,
    }, null, 2));
    return;
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    source: sourcePath,
    out: outPath,
    answerQualityTrends: baseline.answerQualityTrends,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
