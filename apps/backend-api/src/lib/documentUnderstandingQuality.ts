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
export type DocumentTaskKind = "definition" | "list" | "table" | "code" | "procedure" | "visual_layout";
export type DocumentTaskReadinessLevel = "ready" | "partial" | "needs_review" | "unsupported";

export interface DocumentTaskReadiness {
  level: DocumentTaskReadinessLevel;
  evidenceArtifactCount: number;
  structuredEvidenceCount: number;
  warnings: string[];
}

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
  taskReadiness?: Record<DocumentTaskKind, DocumentTaskReadiness>;
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
    definitionArtifactCount?: number;
    listArtifactCount?: number;
    codeArtifactCount?: number;
    procedureArtifactCount?: number;
    visualLayoutArtifactCount?: number;
    visualHintArtifactCount?: number;
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

function countArtifactsByKind(artifacts: unknown[], acceptedKinds: string[]): number {
  const accepted = new Set(acceptedKinds);
  return artifacts.filter((artifact) => {
    const kind = artifactKind(artifact);
    return kind !== null && accepted.has(kind);
  }).length;
}

function taskReadiness(opts: {
  evidenceArtifactCount: number;
  structuredEvidenceCount?: number;
  blockers: string[];
  restricted: boolean;
  partialEvidence?: boolean;
  missingWarning: string;
  partialWarning?: string;
}): DocumentTaskReadiness {
  const structuredEvidenceCount = opts.structuredEvidenceCount ?? 0;
  if (opts.evidenceArtifactCount === 0 && structuredEvidenceCount === 0) {
    return {
      level: "unsupported",
      evidenceArtifactCount: 0,
      structuredEvidenceCount: 0,
      warnings: [opts.missingWarning],
    };
  }
  if (opts.blockers.length > 0) {
    return {
      level: "needs_review",
      evidenceArtifactCount: opts.evidenceArtifactCount,
      structuredEvidenceCount,
      warnings: unique([...opts.blockers, "document_requires_review"]),
    };
  }
  if (opts.restricted || opts.partialEvidence) {
    return {
      level: "partial",
      evidenceArtifactCount: opts.evidenceArtifactCount,
      structuredEvidenceCount,
      warnings: unique([
        ...(opts.restricted ? ["parser_fallback_used"] : []),
        ...(opts.partialEvidence && opts.partialWarning ? [opts.partialWarning] : []),
      ]),
    };
  }
  return {
    level: "ready",
    evidenceArtifactCount: opts.evidenceArtifactCount,
    structuredEvidenceCount,
    warnings: [],
  };
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
  const definitionArtifactCount = countArtifactsByKind(artifacts, ["definition"]);
  const listArtifactCount = countArtifactsByKind(artifacts, ["list", "list_item"]);
  const codeArtifactCount = countArtifactsByKind(artifacts, ["code", "code_block"]);
  const procedureArtifactCount = countArtifactsByKind(artifacts, ["procedure", "procedure_step"]);
  const visualLayoutArtifactCount = countArtifactsByKind(artifacts, ["visual_layout", "layout"]);
  const visualHintArtifactCount = countArtifactsByKind(artifacts, ["visual_layout", "layout", "image", "figure", "image_caption"]);
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
  const restrictedByParser = parserFallbackUsed;
  const taskReadinessSummary: Record<DocumentTaskKind, DocumentTaskReadiness> = {
    definition: taskReadiness({
      evidenceArtifactCount: definitionArtifactCount,
      blockers,
      restricted: restrictedByParser,
      missingWarning: "definition_artifact_missing",
    }),
    list: taskReadiness({
      evidenceArtifactCount: listArtifactCount,
      blockers,
      restricted: restrictedByParser,
      missingWarning: "list_artifact_missing",
    }),
    table: taskReadiness({
      evidenceArtifactCount: tableCount,
      structuredEvidenceCount: structuredTableCount,
      blockers,
      restricted: restrictedByParser,
      partialEvidence: tableQuality === "text_only",
      missingWarning: "table_artifact_missing",
      partialWarning: "table_text_only",
    }),
    code: taskReadiness({
      evidenceArtifactCount: codeArtifactCount,
      blockers,
      restricted: restrictedByParser,
      missingWarning: "code_artifact_missing",
    }),
    procedure: taskReadiness({
      evidenceArtifactCount: procedureArtifactCount,
      blockers,
      restricted: restrictedByParser,
      missingWarning: "procedure_artifact_missing",
    }),
    visual_layout: taskReadiness({
      evidenceArtifactCount: visualHintArtifactCount,
      blockers,
      restricted: restrictedByParser,
      partialEvidence: visualHintArtifactCount > 0 && visualLayoutArtifactCount === 0,
      missingWarning: "visual_layout_artifact_missing",
      partialWarning: "visual_layout_hint_only",
    }),
  };

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
    taskReadiness: taskReadinessSummary,
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
      definitionArtifactCount,
      listArtifactCount,
      codeArtifactCount,
      procedureArtifactCount,
      visualLayoutArtifactCount,
      visualHintArtifactCount,
    },
  };
}

function structuredArtifactCount(artifacts: StructuredDocumentArtifact[], tableCellCount: number): number {
  return artifacts.length + (tableCellCount > 0 ? 1 : 0);
}
