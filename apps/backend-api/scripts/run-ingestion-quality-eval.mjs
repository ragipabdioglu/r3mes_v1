import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const backendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultFile = resolve(root, "infrastructure/evals/ingestion-quality/golden.jsonl");
const defaultOut = resolve(root, "artifacts/evals/ingestion-quality/latest.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseArgs() {
  return {
    file: resolve(root, argValue("--file", process.env.R3MES_INGESTION_QUALITY_EVAL_FILE || defaultFile)),
    out: resolve(root, argValue("--out", process.env.R3MES_INGESTION_QUALITY_EVAL_OUT || defaultOut)),
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

function incrementCount(acc, key) {
  const normalized = String(key ?? "missing");
  acc[normalized] = (acc[normalized] ?? 0) + 1;
  return acc;
}

function warningCounts(rows, getWarnings) {
  return rows.reduce((acc, row) => {
    for (const warning of getWarnings(row) ?? []) incrementCount(acc, warning);
    return acc;
  }, {});
}

function uniqueStrings(...values) {
  return [...new Set(values.flat().filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function numericValue(...values) {
  for (const value of values) {
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function arrayValue(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function sourceQualityFor(parseQuality) {
  if (parseQuality.level === "clean") return "structured";
  if (parseQuality.level === "usable") return "inferred";
  return "thin";
}

function fallbackAnswerReadiness(ingestionQuality) {
  if (!ingestionQuality) return "failed";
  if (ingestionQuality.ocrRisk === "high" || ingestionQuality.thinSource) return "needs_review";
  if (ingestionQuality.tableRisk === "high" || !ingestionQuality.strictRouteEligible) return "partial";
  return "ready";
}

function fallbackDocumentUnderstandingQuality(parsed, chunks, parseQuality, ingestionQuality) {
  return {
    version: 1,
    source: "fallback",
    structuredTableCount: 0,
    answerReadiness: fallbackAnswerReadiness(ingestionQuality),
    artifactCount: parsed?.artifacts?.length ?? 0,
    chunkCount: chunks?.length ?? 0,
    signals: {
      artifactCount: parsed?.artifacts?.length ?? 0,
      structuredTableCount: 0,
    },
    warnings: [...new Set([...(parseQuality?.warnings ?? []), ...(ingestionQuality?.warnings ?? [])])],
  };
}

function structuredArtifactsFor(parsed) {
  return [
    ...arrayValue(parsed?.structuredArtifacts),
    ...arrayValue(parsed?.structuredDocumentArtifacts),
    ...arrayValue(parsed?.artifacts).flatMap((artifact) => arrayValue(artifact?.structuredArtifacts, artifact?.metadata?.structuredArtifacts)),
    ...arrayValue(parsed?.artifacts).map((artifact) => artifact?.metadata?.structuredArtifact).filter(Boolean),
  ];
}

async function loadDocumentUnderstandingQuality() {
  try {
    return await import(pathToFileURL(resolve(backendRoot, "dist/lib/documentUnderstandingQuality.js")).href);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND") return null;
    return null;
  }
}

function buildDocumentUnderstandingQuality(module, parsed, chunks, parseQuality, ingestionQuality) {
  if (module?.scoreDocumentUnderstandingQuality) {
    return normalizeDocumentUnderstandingQuality(
      module.scoreDocumentUnderstandingQuality({ parsed, chunks, parseQuality, ingestionQuality }),
    );
  }
  if (module?.buildDocumentUnderstandingQuality) {
    return normalizeDocumentUnderstandingQuality(module.buildDocumentUnderstandingQuality({
      parseQuality,
      artifacts: parsed.artifacts,
      structuredArtifacts: structuredArtifactsFor(parsed),
      parserWarnings: parsed.diagnostics?.warnings ?? [],
      tableWarnings: ingestionQuality?.tableRisk && ingestionQuality.tableRisk !== "none" ? ingestionQuality.warnings : [],
      ocrWarnings: ingestionQuality?.ocrRisk && ingestionQuality.ocrRisk !== "none" ? ingestionQuality.warnings : [],
      sourceType: parsed.sourceType,
    }));
  }
  return normalizeDocumentUnderstandingQuality(fallbackDocumentUnderstandingQuality(parsed, chunks, parseQuality, ingestionQuality));
}

function normalizeDocumentUnderstandingQuality(value) {
  if (!value || typeof value !== "object") {
    return {
      version: 1,
      source: "invalid_quality_shape",
      structuredTableCount: 0,
      artifactCount: 0,
      chunkCount: 0,
      answerReadiness: "failed",
      warnings: ["document_understanding_quality_missing"],
      blockers: ["document_understanding_quality_missing"],
      signals: {
        artifactCount: 0,
        structuredArtifactCount: 0,
        tableCount: 0,
        structuredTableCount: 0,
        tableCellCount: 0,
        parserFallbackUsed: false,
        parseWarningCount: 0,
        ocrSpanCount: 0,
      },
    };
  }
  const signals = value.signals && typeof value.signals === "object" ? value.signals : {};
  const tables = value.tables && typeof value.tables === "object" ? value.tables : {};
  const readiness = value.readiness && typeof value.readiness === "object" ? value.readiness : {};
  const structuredTables = arrayValue(value.structuredTables, value.tables?.structuredTables);
  const warnings = uniqueStrings(value.warnings, readiness.warnings, tables.warnings);
  const blockers = uniqueStrings(value.blockers, readiness.blockers);
  const structuredTableCount = numericValue(
    value.structuredTableCount,
    signals.structuredTableCount,
    tables.structuredTableCount,
    structuredTables.length,
  ) ?? 0;
  const artifactCount = numericValue(value.artifactCount, signals.artifactCount) ?? 0;
  const chunkCount = numericValue(value.chunkCount, signals.chunkCount) ?? 0;
  return {
    ...value,
    structuredTableCount,
    artifactCount,
    chunkCount,
    answerReadiness: value.answerReadiness ?? readiness.answerReadiness ?? readiness.status ?? "partial",
    warnings,
    blockers,
    signals: {
      ...signals,
      artifactCount,
      chunkCount,
      tableCount: numericValue(signals.tableCount, tables.tableCount, value.tableCount) ?? 0,
      structuredArtifactCount: numericValue(signals.structuredArtifactCount, value.structuredArtifactCount) ?? 0,
      structuredTableCount,
      tableCellCount: numericValue(signals.tableCellCount, tables.tableCellCount, value.tableCellCount) ?? 0,
      parserFallbackUsed: signals.parserFallbackUsed ?? value.parserFallbackUsed ?? false,
      parseWarningCount: numericValue(signals.parseWarningCount, value.parseWarningCount, warnings.length) ?? 0,
      ocrSpanCount: numericValue(signals.ocrSpanCount, value.ocrSpanCount) ?? 0,
    },
  };
}

function actualStructuredTableCount(result) {
  return result.documentUnderstanding?.structuredTableCount
    ?? result.documentUnderstanding?.signals?.structuredTableCount
    ?? null;
}

function expectationFailures(caseItem, result) {
  const failures = [];
  if (caseItem.expectedParseFailure === true && result.parseStatus !== "failed") {
    failures.push(`parse_status:${result.parseStatus}!=failed`);
  }
  if (caseItem.expectedParseFailure === false && result.parseStatus !== "parsed") {
    failures.push(`parse_status:${result.parseStatus}!=parsed`);
  }
  if (Array.isArray(caseItem.expectedParseStatusAny) && !caseItem.expectedParseStatusAny.includes(result.parseStatus)) {
    failures.push(`parse_status:${result.parseStatus} not in ${caseItem.expectedParseStatusAny.join(",")}`);
  }
  if (caseItem.expectedLevel && result.parseQuality?.level !== caseItem.expectedLevel) {
    failures.push(`level:${result.parseQuality?.level ?? "missing"}!=${caseItem.expectedLevel}`);
  }
  if (Number.isFinite(Number(caseItem.minScore)) && (result.parseQuality?.score ?? -1) < Number(caseItem.minScore)) {
    failures.push(`score:${result.parseQuality?.score ?? "missing"}<${caseItem.minScore}`);
  }
  if (Number.isFinite(Number(caseItem.maxScore)) && (result.parseQuality?.score ?? 101) > Number(caseItem.maxScore)) {
    failures.push(`score:${result.parseQuality?.score ?? "missing"}>${caseItem.maxScore}`);
  }
  for (const warning of caseItem.expectedWarnings ?? []) {
    if (!result.parseQuality?.warnings?.includes(warning)) failures.push(`missing_warning:${warning}`);
  }
  for (const warning of caseItem.forbiddenWarnings ?? []) {
    if (result.parseQuality?.warnings?.includes(warning)) failures.push(`forbidden_warning:${warning}`);
  }
  if (caseItem.expectedOcrRisk && result.ingestionQuality?.ocrRisk !== caseItem.expectedOcrRisk) {
    failures.push(`ocr_risk:${result.ingestionQuality?.ocrRisk ?? "missing"}!=${caseItem.expectedOcrRisk}`);
  }
  if (caseItem.expectedTableRisk && result.ingestionQuality?.tableRisk !== caseItem.expectedTableRisk) {
    failures.push(`table_risk:${result.ingestionQuality?.tableRisk ?? "missing"}!=${caseItem.expectedTableRisk}`);
  }
  if (typeof caseItem.expectedThinSource === "boolean" && result.ingestionQuality?.thinSource !== caseItem.expectedThinSource) {
    failures.push(`thin_source:${result.ingestionQuality?.thinSource ?? "missing"}!=${caseItem.expectedThinSource}`);
  }
  if (typeof caseItem.expectedStrictRouteEligible === "boolean" && result.ingestionQuality?.strictRouteEligible !== caseItem.expectedStrictRouteEligible) {
    failures.push(`strict_route:${result.ingestionQuality?.strictRouteEligible ?? "missing"}!=${caseItem.expectedStrictRouteEligible}`);
  }
  if (Number.isFinite(Number(caseItem.expectedStructuredTableCount)) && actualStructuredTableCount(result) !== Number(caseItem.expectedStructuredTableCount)) {
    failures.push(`structured_table_count:${actualStructuredTableCount(result) ?? "missing"}!=${caseItem.expectedStructuredTableCount}`);
  }
  if (Number.isFinite(Number(caseItem.minStructuredTableCount)) && (actualStructuredTableCount(result) ?? 0) < Number(caseItem.minStructuredTableCount)) {
    failures.push(`structured_table_count:${actualStructuredTableCount(result) ?? "missing"}<${caseItem.minStructuredTableCount}`);
  }
  if (Number.isFinite(Number(caseItem.maxStructuredTableCount)) && (actualStructuredTableCount(result) ?? 0) > Number(caseItem.maxStructuredTableCount)) {
    failures.push(`structured_table_count:${actualStructuredTableCount(result) ?? "missing"}>${caseItem.maxStructuredTableCount}`);
  }
  if (caseItem.expectedAnswerReadiness && result.documentUnderstanding?.answerReadiness !== caseItem.expectedAnswerReadiness) {
    failures.push(`answer_readiness:${result.documentUnderstanding?.answerReadiness ?? "missing"}!=${caseItem.expectedAnswerReadiness}`);
  }
  if (
    Array.isArray(caseItem.expectedAnswerReadinessAny) &&
    !caseItem.expectedAnswerReadinessAny.includes(result.documentUnderstanding?.answerReadiness)
  ) {
    failures.push(`answer_readiness:${result.documentUnderstanding?.answerReadiness ?? "missing"} not in ${caseItem.expectedAnswerReadinessAny.join(",")}`);
  }
  return failures;
}

function failedExpectation(caseItem, result) {
  if (Array.isArray(caseItem.acceptedOutcomes) && caseItem.acceptedOutcomes.length > 0) {
    const outcomes = caseItem.acceptedOutcomes.map((outcome) => ({
      name: outcome.name ?? "unnamed",
      failures: expectationFailures({ ...caseItem, ...outcome, acceptedOutcomes: undefined }, result),
    }));
    if (outcomes.some((outcome) => outcome.failures.length === 0)) return [];
    return outcomes.map((outcome) => `outcome:${outcome.name}:${outcome.failures.join("|")}`);
  }
  return expectationFailures(caseItem, result);
}

async function main() {
  const opts = parseArgs();
  const started = Date.now();
  const [
    { parseKnowledgeBuffer, chunkParsedKnowledgeDocument },
    { scoreKnowledgeParseQuality },
    { buildIngestionQualityReport },
    documentUnderstandingModule,
  ] = await Promise.all([
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeText.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeParseQuality.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeAutoMetadata.js")).href),
    loadDocumentUnderstandingQuality(),
  ]);
  const cases = await readJsonl(opts.file);
  const results = await Promise.all(cases.map(async (caseItem) => {
    const fixturePath = resolve(root, caseItem.fixturePath);
    const filename = caseItem.filename ?? basename(fixturePath);
    const result = {
      id: caseItem.id,
      bucket: caseItem.bucket ?? "default",
      fixturePath,
      filename,
      parseStatus: "parsed",
      parser: null,
      sourceType: null,
      diagnostics: null,
      parserDiagnostics: null,
      artifactCount: 0,
      structuredArtifactCount: 0,
      chunkCount: 0,
      parseQuality: null,
      ingestionQuality: null,
      documentUnderstanding: null,
      error: null,
      passed: false,
      failures: [],
    };

    try {
      const buffer = await readFile(fixturePath);
      const parsed = parseKnowledgeBuffer(filename, buffer);
      const chunks = chunkParsedKnowledgeDocument(parsed);
      const parseQuality = scoreKnowledgeParseQuality({
        filename,
        sourceType: parsed.sourceType,
        text: parsed.text,
        chunks,
      });
      const ingestionQuality = buildIngestionQualityReport({
        parseQuality,
        sourceQuality: caseItem.sourceQuality ?? sourceQualityFor(parseQuality),
      });
      const documentUnderstanding = buildDocumentUnderstandingQuality(
        documentUnderstandingModule,
        parsed,
        chunks,
        parseQuality,
        ingestionQuality,
      );
      Object.assign(result, {
        parser: parsed.parser,
        sourceType: parsed.sourceType,
        diagnostics: parsed.diagnostics,
        parserDiagnostics: {
          parserId: parsed.parser?.id ?? null,
          parserVersion: parsed.parser?.version ?? null,
          warnings: parsed.diagnostics?.warnings ?? [],
          originalBytes: parsed.diagnostics?.originalBytes ?? null,
          normalizedChars: parsed.diagnostics?.normalizedChars ?? null,
        },
        artifactCount: parsed.artifacts?.length ?? 0,
        structuredArtifactCount: structuredArtifactsFor(parsed).length,
        chunkCount: chunks.length,
        parseQuality,
        ingestionQuality,
        documentUnderstanding,
      });
    } catch (error) {
      Object.assign(result, {
        parseStatus: "failed",
        documentUnderstanding: {
          version: 1,
          source: "parse_failure",
          structuredTableCount: 0,
          answerReadiness: "failed",
          artifactCount: 0,
          chunkCount: 0,
          warnings: ["parse_failed"],
        },
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const failures = failedExpectation(caseItem, result);
    result.failures = failures;
    result.passed = failures.length === 0;
    return result;
  }));

  const failed = results.filter((result) => !result.passed);
  const scores = results
    .map((result) => result.parseQuality?.score)
    .filter((score) => Number.isFinite(score))
    .sort((a, b) => a - b);
  const summary = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    passRate: results.length === 0 ? 0 : Number(((results.length - failed.length) / results.length).toFixed(3)),
    ok: failed.length === 0,
    durationMs: Date.now() - started,
    parseStatusCounts: countBy(results, (result) => result.parseStatus),
    readinessCounts: countBy(results, (result) => result.documentUnderstanding?.answerReadiness),
    structuredTableCount: results.reduce((sum, result) => sum + (actualStructuredTableCount(result) ?? 0), 0),
    levelCounts: countBy(results.filter((result) => result.parseQuality), (result) => result.parseQuality.level),
    bucketCounts: countBy(results, (result) => result.bucket),
    parserCounts: countBy(results, (result) => result.parser?.id),
    sourceTypeCounts: countBy(results, (result) => result.sourceType),
    warningCounts: {
      parseQuality: warningCounts(results, (result) => result.parseQuality?.warnings),
      ingestionQuality: warningCounts(results, (result) => result.ingestionQuality?.warnings),
      documentUnderstanding: warningCounts(results, (result) => result.documentUnderstanding?.warnings),
      parserDiagnostics: warningCounts(results, (result) => result.parserDiagnostics?.warnings),
      combined: results.reduce((acc, result) => {
        for (const warning of uniqueStrings(
          result.parseQuality?.warnings,
          result.ingestionQuality?.warnings,
          result.documentUnderstanding?.warnings,
          result.parserDiagnostics?.warnings,
        )) {
          incrementCount(acc, warning);
        }
        return acc;
      }, {}),
    },
    ingestionRiskCounts: {
      ocr: countBy(results.filter((result) => result.ingestionQuality), (result) => result.ingestionQuality.ocrRisk),
      table: countBy(results.filter((result) => result.ingestionQuality), (result) => result.ingestionQuality.tableRisk),
      thinSource: countBy(results.filter((result) => result.ingestionQuality), (result) => String(result.ingestionQuality.thinSource)),
      strictRouteEligible: countBy(results.filter((result) => result.ingestionQuality), (result) => String(result.ingestionQuality.strictRouteEligible)),
    },
    scoreDistribution: {
      min: scores[0] ?? null,
      p50: scores[Math.floor((scores.length - 1) * 0.5)] ?? null,
      max: scores.at(-1) ?? null,
    },
    failures: failed.map((result) => ({
      id: result.id,
      bucket: result.bucket,
      failures: result.failures,
      parseStatus: result.parseStatus,
      error: result.error,
      actualLevel: result.parseQuality?.level ?? null,
      score: result.parseQuality?.score ?? null,
      ingestionQuality: result.ingestionQuality,
      documentUnderstanding: result.documentUnderstanding,
      parserDiagnostics: result.parserDiagnostics,
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
