import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, "..", "..");
const manifestDir = resolve(repoRoot, argValue("--manifest-dir", "infrastructure/evals/real-data-certification/datasets"));
const outFile = resolve(repoRoot, argValue("--out", "artifacts/evals/real-data-certification/dataset-manifest-report.json"));
const markdownFile = resolve(repoRoot, argValue("--markdown", "artifacts/evals/real-data-certification/dataset-manifest-report.md"));

const REQUIRED_STRING_FIELDS = ["schemaVersion", "id", "displayName", "status", "datasetType", "sourceKind", "privacyClass"];
const REQUIRED_ARRAY_FIELDS = ["domains", "sourceTypes", "expectedArtifacts", "certificationBuckets", "evalSuites"];
const VALID_STATUSES = new Set(["active", "planned", "retired"]);
const VALID_DATASET_TYPES = new Set(["real_documents", "synthetic_eval"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(path, extensions) {
  const entries = await readdir(path, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(child, extensions);
    } else if (extensions.size === 0 || extensions.has(extname(entry.name).toLowerCase().replace(/^\./, ""))) {
      count += 1;
    }
  }
  return count;
}

function pushIssue(issues, severity, code, message, detail = {}) {
  issues.push({ severity, code, message, ...detail });
}

async function validateManifest(manifestPath) {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  const issues = [];

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      pushIssue(issues, "fail", "missing_string_field", `Missing required string field: ${field}`, { field });
    }
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(parsed[field]) || parsed[field].length === 0) {
      pushIssue(issues, "fail", "missing_array_field", `Missing required non-empty array field: ${field}`, { field });
    }
  }

  if (parsed.schemaVersion !== "DatasetManifest.v1") {
    pushIssue(issues, "fail", "schema_version_mismatch", "Dataset manifest schemaVersion must be DatasetManifest.v1");
  }
  if (!VALID_STATUSES.has(parsed.status)) {
    pushIssue(issues, "fail", "invalid_status", "Dataset status must be active, planned, or retired", { status: parsed.status });
  }
  if (!VALID_DATASET_TYPES.has(parsed.datasetType)) {
    pushIssue(issues, "fail", "invalid_dataset_type", "Dataset type must be real_documents or synthetic_eval", { datasetType: parsed.datasetType });
  }

  let actualDocumentCount = 0;
  if (parsed.datasetType === "real_documents") {
    if (typeof parsed.dataPath !== "string" || !parsed.dataPath.trim()) {
      pushIssue(issues, "fail", "missing_data_path", "Real document datasets must define dataPath");
    } else {
      const dataPath = resolve(repoRoot, parsed.dataPath);
      if (!(await exists(dataPath))) {
        pushIssue(issues, "fail", "data_path_missing", "Dataset dataPath does not exist", { dataPath: parsed.dataPath });
      } else {
        actualDocumentCount = await countFiles(dataPath, new Set(asArray(parsed.sourceTypes).map((item) => String(item).toLowerCase())));
        if (actualDocumentCount < Number(parsed.documentCountExpected ?? 0)) {
          pushIssue(issues, "fail", "document_count_below_expected", "Actual document count is below manifest expectation", {
            expected: parsed.documentCountExpected,
            actual: actualDocumentCount,
          });
        }
      }
    }
  }

  const evalSuites = asArray(parsed.evalSuites).map((suite) => {
    const suiteIssues = [];
    if (typeof suite.id !== "string" || !suite.id.trim()) {
      suiteIssues.push({ severity: "fail", code: "eval_suite_missing_id" });
    }
    if (typeof suite.path !== "string" || !suite.path.trim()) {
      suiteIssues.push({ severity: "fail", code: "eval_suite_missing_path" });
    }
    if (!["active", "planned", "retired"].includes(suite.status)) {
      suiteIssues.push({ severity: "fail", code: "eval_suite_invalid_status" });
    }
    const suitePath = typeof suite.path === "string" ? resolve(repoRoot, suite.path) : "";
    return {
      id: suite.id ?? "missing",
      path: suite.path ?? null,
      status: suite.status ?? "missing",
      modes: asArray(suite.modes),
      exists: suitePath ? null : false,
      issues: suiteIssues,
    };
  });

  for (const suite of evalSuites) {
    if (suite.path) suite.exists = await exists(resolve(repoRoot, suite.path));
    if (suite.status === "active" && !suite.exists) {
      pushIssue(issues, "fail", "active_eval_suite_missing", "Active eval suite path does not exist", { suiteId: suite.id, path: suite.path });
    }
    if (suite.status === "planned" && !suite.exists) {
      pushIssue(issues, "warn", "planned_eval_suite_missing", "Planned eval suite path does not exist yet", { suiteId: suite.id, path: suite.path });
    }
    for (const issue of suite.issues) pushIssue(issues, issue.severity, issue.code, `Eval suite ${suite.id} has invalid contract`);
  }

  return {
    id: parsed.id ?? "missing",
    displayName: parsed.displayName ?? "missing",
    status: parsed.status ?? "missing",
    datasetType: parsed.datasetType ?? "missing",
    sourceKind: parsed.sourceKind ?? "missing",
    dataPath: parsed.dataPath ?? null,
    privacyClass: parsed.privacyClass ?? "missing",
    domains: asArray(parsed.domains),
    sourceTypes: asArray(parsed.sourceTypes),
    expectedArtifacts: asArray(parsed.expectedArtifacts),
    certificationBuckets: asArray(parsed.certificationBuckets),
    documentCountExpected: Number(parsed.documentCountExpected ?? 0),
    actualDocumentCount,
    evalSuites,
    issueCount: issues.length,
    failCount: issues.filter((issue) => issue.severity === "fail").length,
    warnCount: issues.filter((issue) => issue.severity === "warn").length,
    issues,
  };
}

function toMarkdown(report) {
  const lines = [
    "# Real Data Dataset Manifest Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Manifest dir: ${report.manifestDir}`,
    "",
    "## Summary",
    "",
    `- Status: ${report.status}`,
    `- Dataset count: ${report.datasetCount}`,
    `- Fail count: ${report.failCount}`,
    `- Warning count: ${report.warnCount}`,
    "",
    "## Datasets",
    "",
  ];
  for (const dataset of report.datasets) {
    lines.push(`### ${dataset.id}`);
    lines.push(`- Name: ${dataset.displayName}`);
    lines.push(`- Type: ${dataset.datasetType}`);
    lines.push(`- Privacy: ${dataset.privacyClass}`);
    lines.push(`- Documents: ${dataset.actualDocumentCount}/${dataset.documentCountExpected}`);
    lines.push(`- Artifacts: ${dataset.expectedArtifacts.join(", ")}`);
    lines.push(`- Buckets: ${dataset.certificationBuckets.join(", ")}`);
    lines.push(`- Eval suites: ${dataset.evalSuites.map((suite) => `${suite.id}:${suite.status}${suite.exists ? "" : ":missing"}`).join(", ")}`);
    if (dataset.issues.length > 0) {
      lines.push("- Issues:");
      for (const issue of dataset.issues) {
        lines.push(`  - ${issue.severity}: ${issue.code} - ${issue.message}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const files = (await readdir(manifestDir))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => resolve(manifestDir, name));
  const datasets = [];
  const ids = new Set();
  const globalIssues = [];
  for (const file of files) {
    const result = await validateManifest(file);
    if (ids.has(result.id)) {
      pushIssue(globalIssues, "fail", "duplicate_dataset_id", "Dataset id must be unique", { id: result.id });
    }
    ids.add(result.id);
    datasets.push(result);
  }
  const failCount = datasets.reduce((sum, item) => sum + item.failCount, 0) + globalIssues.filter((issue) => issue.severity === "fail").length;
  const warnCount = datasets.reduce((sum, item) => sum + item.warnCount, 0) + globalIssues.filter((issue) => issue.severity === "warn").length;
  const report = {
    schemaVersion: "DatasetManifestReport.v1",
    generatedAt: new Date().toISOString(),
    manifestDir,
    status: failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass",
    datasetCount: datasets.length,
    failCount,
    warnCount,
    globalIssues,
    datasets,
    note: "Dataset manifests describe certification coverage only. They do not change runtime behavior.",
  };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(dirname(markdownFile), { recursive: true });
  await writeFile(markdownFile, toMarkdown(report), "utf8");
  console.log(JSON.stringify({
    outFile,
    markdownFile,
    status: report.status,
    datasetCount: report.datasetCount,
    failCount: report.failCount,
    warnCount: report.warnCount,
  }, null, 2));
  if (failCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
