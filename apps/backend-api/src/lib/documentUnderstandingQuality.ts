import type { KnowledgeParseQualityLevel } from "./knowledgeParseQuality.js";
import {
  countStructuredTableCells,
  readStructuredDocumentArtifact,
  readStructuredTableArtifact,
  type StructuredDocumentArtifact,
} from "./structuredDocumentArtifact.js";

export type DocumentStructureQuality = "strong" | "partial" | "weak";
export type DocumentTableQuality = "none" | "text_only" | "structured";
export type DocumentSpreadsheetQuality = "none" | "structured" | "partial" | "failed";
export type DocumentOcrQuality = "none" | "usable" | "weak";
export type DocumentAnswerReadiness = "ready" | "partial" | "needs_review" | "failed";

export interface DocumentUnderstandingQuality {
  version: 1;
  parseQuality: KnowledgeParseQualityLevel;
  structureQuality: DocumentStructureQuality;
  tableQuality: DocumentTableQuality;
  spreadsheetQuality: DocumentSpreadsheetQuality;
  ocrQuality: DocumentOcrQuality;
  answerReadiness: DocumentAnswerReadiness;
  strictAnswerEligible: boolean;
  blockers: string[];
  warnings: string[];
  signals: {
    artifactCount: number;
    structuredArtifactCount: number;
    tableCount: number;
    structuredTableCount: number;
    tableCellCount: number;
    pageCount?: number;
    parserFallbackUsed: boolean;
    parseWarningCount: number;
    ocrSpanCount: number;
  };
}

export interface BuildDocumentUnderstandingQualityInput {
  parseQuality?: KnowledgeParseQualityLevel | { level?: unknown; warnings?: unknown; signals?: unknown } | null;
  artifacts?: unknown[] | null;
  structuredArtifacts?: unknown[] | null;
  parserFallbackUsed?: boolean | null;
  parserWarnings?: unknown[] | null;
  ocrWarnings?: unknown[] | null;
  tableWarnings?: unknown[] | null;
  sourceType?: string | null;
  pageCount?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQualityLevel(value: unknown): KnowledgeParseQualityLevel {
  if (value === "clean" || value === "usable" || value === "noisy") return value;
  return "usable";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function artifactKind(value: unknown): string | null {
  return isRecord(value) && typeof value.kind === "string" ? value.kind : null;
}

function hasTextOnlyTableSignal(artifacts: unknown[], parseWarnings: string[], tableWarnings: string[], parseSignals: Record<string, unknown> | null): boolean {
  if (artifacts.some((artifact) => artifactKind(artifact) === "table")) return true;
  if ([...parseWarnings, ...tableWarnings].some((warning) => warning.includes("table"))) return true;
  const tableSignalCount = typeof parseSignals?.tableSignalCount === "number" ? parseSignals.tableSignalCount : 0;
  return tableSignalCount > 0;
}

function hasHighOcrRisk(parseQuality: KnowledgeParseQualityLevel, warnings: string[], parseSignals: Record<string, unknown> | null): boolean {
  const ocrRiskScore = typeof parseSignals?.ocrRiskScore === "number" ? parseSignals.ocrRiskScore : 0;
  return parseQuality === "noisy" || warnings.includes("ocr_risk_high") || ocrRiskScore >= 35;
}

function readPageCount(input: BuildDocumentUnderstandingQualityInput): number | undefined {
  return typeof input.pageCount === "number" && Number.isInteger(input.pageCount) && input.pageCount > 0
    ? input.pageCount
    : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildDocumentUnderstandingQuality(input: BuildDocumentUnderstandingQualityInput = {}): DocumentUnderstandingQuality {
  const parseQualityInput = input.parseQuality;
  const parseQuality = parseQualityLevel(isRecord(parseQualityInput) ? parseQualityInput.level : parseQualityInput);
  const parseSignals = isRecord(parseQualityInput) && isRecord(parseQualityInput.signals) ? parseQualityInput.signals : null;
  const parseWarnings = isRecord(parseQualityInput) ? stringArray(parseQualityInput.warnings) : [];
  const parserWarnings = stringArray(input.parserWarnings);
  const ocrWarnings = stringArray(input.ocrWarnings);
  const tableWarnings = stringArray(input.tableWarnings);
  const allWarnings = unique([...parseWarnings, ...parserWarnings, ...ocrWarnings, ...tableWarnings]);
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  const structuredArtifacts = (Array.isArray(input.structuredArtifacts) ? input.structuredArtifacts : [])
    .map(readStructuredDocumentArtifact)
    .filter((artifact): artifact is StructuredDocumentArtifact => artifact !== null);
  const structuredTables = structuredArtifacts
    .map(readStructuredTableArtifact)
    .filter((artifact) => artifact !== null);
  const structuredTableCount = structuredTables.length;
  const tableCellCount = structuredTables.reduce((sum, table) => sum + countStructuredTableCells(table), 0);
  const textOnlyTable = hasTextOnlyTableSignal(artifacts, parseWarnings, tableWarnings, parseSignals);
  const tableCount = artifacts.filter((artifact) => artifactKind(artifact) === "table").length + structuredTableCount;
  const tableQuality: DocumentTableQuality = structuredTableCount > 0 ? "structured" : textOnlyTable ? "text_only" : "none";
  const sourceType = input.sourceType?.toLowerCase() ?? "";
  const spreadsheetLike = sourceType.includes("spreadsheet") || sourceType === "csv" || sourceType === "xlsx" || sourceType === "xls";
  const spreadsheetQuality: DocumentSpreadsheetQuality = spreadsheetLike
    ? structuredTableCount > 0
      ? "structured"
      : textOnlyTable
        ? "partial"
        : "failed"
    : structuredTables.some((table) => table.sheetName)
      ? "structured"
      : "none";
  const highOcrRisk = hasHighOcrRisk(parseQuality, allWarnings, parseSignals);
  const ocrSpanCount = structuredArtifacts.filter((artifact) => artifact.kind === "ocr_span").length;
  const ocrQuality: DocumentOcrQuality = highOcrRisk ? "weak" : ocrSpanCount > 0 || allWarnings.some((warning) => warning.includes("ocr")) ? "usable" : "none";
  const parserFallbackUsed = input.parserFallbackUsed === true || allWarnings.includes("parser_fallback_used");

  const blockers: string[] = [];
  const warnings: string[] = [...allWarnings];
  if (parseQuality === "noisy") blockers.push("parse_quality_noisy");
  if (highOcrRisk) blockers.push("ocr_risk_high");
  if (tableQuality === "text_only") warnings.push("table_text_only");
  if (parserFallbackUsed) warnings.push("parser_fallback_used");
  if (spreadsheetQuality === "failed") blockers.push("spreadsheet_structure_missing");

  const structureQuality: DocumentStructureQuality =
    structuredArtifactCount(structuredArtifacts, tableCellCount) > 0
      ? "strong"
      : artifacts.length > 0 || textOnlyTable
        ? "partial"
        : "weak";
  const answerReadiness: DocumentAnswerReadiness = blockers.length > 0
    ? "needs_review"
    : tableQuality === "text_only" || parserFallbackUsed || structureQuality === "weak"
      ? "partial"
      : "ready";

  return {
    version: 1,
    parseQuality,
    structureQuality,
    tableQuality,
    spreadsheetQuality,
    ocrQuality,
    answerReadiness,
    strictAnswerEligible: answerReadiness === "ready" && !parserFallbackUsed && !highOcrRisk,
    blockers: unique(blockers),
    warnings: unique(warnings),
    signals: {
      artifactCount: artifacts.length,
      structuredArtifactCount: structuredArtifacts.length,
      tableCount,
      structuredTableCount,
      tableCellCount,
      pageCount: readPageCount(input),
      parserFallbackUsed,
      parseWarningCount: parseWarnings.length,
      ocrSpanCount,
    },
  };
}

function structuredArtifactCount(artifacts: StructuredDocumentArtifact[], tableCellCount: number): number {
  return artifacts.length + (tableCellCount > 0 ? 1 : 0);
}
