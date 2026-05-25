import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const backendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

async function readJsonl(file) {
  return (await readFile(file, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function missingValues(expected, actual) {
  const available = new Set(actual);
  return (expected ?? []).filter((value) => !available.has(value));
}

async function main() {
  const focus = argValue("--focus", "artifact");
  const file = resolve(root, argValue("--file", "infrastructure/evals/document-intelligence/golden.jsonl"));
  const out = resolve(root, argValue("--out", `artifacts/evals/document-intelligence/${focus}.latest.json`));
  const [
    { parseKnowledgeBuffer, chunkParsedKnowledgeDocument },
    { buildCanonicalArtifactGraph },
    { adaptKnowledgeChunkDraftsToV2 },
    { buildDocumentUnderstandingQuality },
    { scoreKnowledgeParseQuality },
  ] = await Promise.all([
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeText.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/canonicalArtifactGraph.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeChunkV2.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/documentUnderstandingQuality.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeParseQuality.js")).href),
  ]);
  const started = Date.now();
  const cases = await readJsonl(file);
  const results = cases.map((caseItem) => {
    const parsed = parseKnowledgeBuffer(caseItem.filename, Buffer.from(caseItem.content, "utf8"));
    const chunks = chunkParsedKnowledgeDocument(parsed);
    const graph = buildCanonicalArtifactGraph(parsed);
    const chunkV2 = adaptKnowledgeChunkDraftsToV2(chunks, { filename: caseItem.filename, sourceType: parsed.sourceType });
    const parseQuality = scoreKnowledgeParseQuality({
      filename: caseItem.filename,
      sourceType: parsed.sourceType,
      text: parsed.text,
      chunks,
    });
    const quality = buildDocumentUnderstandingQuality({
      parseQuality,
      artifacts: parsed.artifacts,
      structuredArtifacts: parsed.structuredArtifacts,
      parserWarnings: parsed.diagnostics.warnings,
      sourceType: parsed.sourceType,
    });
    const failures = [];
    if (focus === "artifact") {
      for (const missing of missingValues(caseItem.expectedArtifactKinds, parsed.artifacts.map((artifact) => artifact.kind))) {
        failures.push(`missing_artifact_kind:${missing}`);
      }
      for (const missing of missingValues(caseItem.expectedGraphKinds, graph.nodes.map((node) => node.kind))) {
        failures.push(`missing_graph_kind:${missing}`);
      }
      if ((caseItem.maxGraphWarnings ?? 0) < graph.diagnostics.warnings.length) failures.push("graph_warnings_exceeded");
    }
    if (focus === "readiness") {
      for (const [kind, level] of Object.entries(caseItem.expectedTaskReadiness ?? {})) {
        if (quality.taskReadiness?.[kind]?.level !== level) {
          failures.push(`task_readiness:${kind}:${quality.taskReadiness?.[kind]?.level ?? "missing"}!=${level}`);
        }
      }
    }
    if (focus === "chunking") {
      for (const missing of missingValues(caseItem.expectedChunkKinds, chunkV2.chunks.map((chunk) => chunk.chunkKind))) {
        failures.push(`missing_chunk_kind:${missing}`);
      }
      if (caseItem.requireIntegrityClean === true && chunkV2.diagnostics.warnings.length > 0) {
        failures.push(`chunk_integrity:${chunkV2.diagnostics.warnings.join(",")}`);
      }
    }
    return {
      id: caseItem.id,
      focus,
      passed: failures.length === 0,
      failures,
      artifactKinds: parsed.artifacts.map((artifact) => artifact.kind),
      graphDiagnostics: graph.diagnostics,
      taskReadiness: quality.taskReadiness,
      chunkingDiagnostics: chunkV2.diagnostics,
    };
  });
  const failed = results.filter((result) => !result.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    input: { focus, file },
    summary: {
      focus,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      ok: failed.length === 0,
      durationMs: Date.now() - started,
      failures: failed.map((result) => ({ id: result.id, failures: result.failures })),
    },
    results,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`wrote ${out}`);
  console.log(JSON.stringify(report.summary, null, 2));
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
