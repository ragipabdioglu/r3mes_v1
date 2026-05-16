export type StructuredDocumentArtifact =
  | StructuredTableArtifact
  | StructuredKeyValueArtifact
  | StructuredOcrSpanArtifact;

export interface StructuredTableHeader {
  columnId: string;
  text: string;
  normalizedText: string;
  sourceCell?: string;
}

export interface StructuredTableCell {
  columnId: string;
  text: string;
  normalizedText: string;
  value?: string | number | boolean | null;
  valueType?: "string" | "number" | "date" | "boolean" | "empty";
  unit?: string;
  sourceCell?: string;
  confidence?: number;
}

export interface StructuredTableRow {
  rowId: string;
  label?: string;
  sourceRow?: number;
  cells: StructuredTableCell[];
}

export interface StructuredTableProvenance {
  parserId: string;
  parserVersion: number;
  artifactId?: string;
  bbox?: [number, number, number, number];
}

export interface StructuredTableArtifact {
  version: 1;
  kind: "table";
  tableId: string;
  title?: string | null;
  page?: number | null;
  sheetName?: string | null;
  headers: StructuredTableHeader[];
  rows: StructuredTableRow[];
  provenance: StructuredTableProvenance;
}

export interface StructuredKeyValueArtifact {
  version: 1;
  kind: "key_value";
  key: string;
  normalizedKey: string;
  value: string;
  page?: number | null;
  confidence?: number;
  provenance?: {
    parserId?: string;
    parserVersion?: number;
    artifactId?: string;
  };
}

export interface StructuredOcrSpanArtifact {
  version: 1;
  kind: "ocr_span";
  text: string;
  page?: number | null;
  confidence?: number;
  language?: string;
  provenance?: {
    parserId?: string;
    parserVersion?: number;
    bbox?: [number, number, number, number];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = compactWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

function readOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  return readString(value) ?? undefined;
}

function readOptionalNullableString(value: unknown): string | null | undefined {
  if (value == null) return value === null ? null : undefined;
  return readString(value) ?? undefined;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalPositiveInteger(value: unknown): number | null | undefined {
  if (value == null) return value === null ? null : undefined;
  const number = readNumber(value);
  if (number == null || !Number.isInteger(number) || number < 1) return undefined;
  return number;
}

function readConfidence(value: unknown): number | undefined {
  const number = readNumber(value);
  if (number == null) return undefined;
  return Math.max(0, Math.min(1, number));
}

function readBbox(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const parts = value.map(readNumber);
  if (parts.some((part) => part == null)) return undefined;
  return parts as [number, number, number, number];
}

function readHeader(value: unknown): StructuredTableHeader | null {
  if (!isRecord(value)) return null;
  const columnId = readString(value.columnId);
  const text = readString(value.text);
  if (!columnId || !text) return null;
  return {
    columnId,
    text,
    normalizedText: readString(value.normalizedText) ?? compactWhitespace(text).toLocaleLowerCase("tr-TR"),
    sourceCell: readOptionalString(value.sourceCell),
  };
}

function readCell(value: unknown, headerIds: Set<string>): StructuredTableCell | null {
  if (!isRecord(value)) return null;
  const columnId = readString(value.columnId);
  if (!columnId || !headerIds.has(columnId)) return null;
  const text = readString(value.text) ?? "";
  const valueType = readOptionalString(value.valueType);
  const allowedValueType =
    valueType === "string" || valueType === "number" || valueType === "date" || valueType === "boolean" || valueType === "empty"
      ? valueType
      : undefined;
  const rawValue = value.value;
  const typedValue =
    typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean" || rawValue === null
      ? rawValue
      : undefined;
  return {
    columnId,
    text,
    normalizedText: readString(value.normalizedText) ?? compactWhitespace(text),
    value: typedValue,
    valueType: allowedValueType,
    unit: readOptionalString(value.unit),
    sourceCell: readOptionalString(value.sourceCell),
    confidence: readConfidence(value.confidence),
  };
}

function readRow(value: unknown, headerIds: Set<string>): StructuredTableRow | null {
  if (!isRecord(value)) return null;
  const rowId = readString(value.rowId);
  if (!rowId || !Array.isArray(value.cells)) return null;
  const cells = value.cells
    .map((cell) => readCell(cell, headerIds))
    .filter((cell): cell is StructuredTableCell => cell !== null);
  if (cells.length === 0) return null;
  const sourceRow = readNumber(value.sourceRow);
  return {
    rowId,
    label: readOptionalString(value.label),
    sourceRow: sourceRow != null && Number.isInteger(sourceRow) && sourceRow >= 1 ? sourceRow : undefined,
    cells,
  };
}

function readProvenance(value: unknown): StructuredTableProvenance | null {
  if (!isRecord(value)) return null;
  const parserId = readString(value.parserId);
  const parserVersion = readNumber(value.parserVersion);
  if (!parserId || parserVersion == null || !Number.isInteger(parserVersion) || parserVersion < 1) return null;
  return {
    parserId,
    parserVersion,
    artifactId: readOptionalString(value.artifactId),
    bbox: readBbox(value.bbox),
  };
}

export function readStructuredTableArtifact(value: unknown): StructuredTableArtifact | null {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "table") return null;
  const tableId = readString(value.tableId);
  if (!tableId || !Array.isArray(value.headers) || !Array.isArray(value.rows)) return null;
  const headers = value.headers
    .map(readHeader)
    .filter((header): header is StructuredTableHeader => header !== null);
  const headerIds = new Set(headers.map((header) => header.columnId));
  if (headers.length === 0 || headerIds.size !== headers.length) return null;
  const rows = value.rows
    .map((row) => readRow(row, headerIds))
    .filter((row): row is StructuredTableRow => row !== null);
  if (rows.length === 0) return null;
  const provenance = readProvenance(value.provenance);
  if (!provenance) return null;
  return {
    version: 1,
    kind: "table",
    tableId,
    title: readOptionalNullableString(value.title),
    page: readOptionalPositiveInteger(value.page),
    sheetName: readOptionalNullableString(value.sheetName),
    headers,
    rows,
    provenance,
  };
}

export function isStructuredTableArtifact(value: unknown): value is StructuredTableArtifact {
  return readStructuredTableArtifact(value) !== null;
}

export function countStructuredTableCells(table: StructuredTableArtifact): number {
  return table.rows.reduce((sum, row) => sum + row.cells.length, 0);
}

export function structuredTableToPlainText(table: StructuredTableArtifact): string {
  const lines: string[] = [];
  const titleParts = [table.title, table.sheetName ? `sheet: ${table.sheetName}` : undefined, table.page ? `page: ${table.page}` : undefined]
    .filter(Boolean)
    .join(" | ");
  if (titleParts) lines.push(titleParts);
  lines.push(table.headers.map((header) => header.text).join(" | "));
  for (const row of table.rows) {
    const cellsByColumn = new Map(row.cells.map((cell) => [cell.columnId, cell]));
    const values = table.headers.map((header) => cellsByColumn.get(header.columnId)?.text ?? "");
    lines.push(values.join(" | "));
  }
  return lines.join("\n");
}

export function readStructuredKeyValueArtifact(value: unknown): StructuredKeyValueArtifact | null {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "key_value") return null;
  const key = readString(value.key);
  const rawValue = readString(value.value);
  if (!key || rawValue == null) return null;
  const provenance = isRecord(value.provenance)
    ? {
        parserId: readOptionalString(value.provenance.parserId),
        parserVersion: readNumber(value.provenance.parserVersion) ?? undefined,
        artifactId: readOptionalString(value.provenance.artifactId),
      }
    : undefined;
  return {
    version: 1,
    kind: "key_value",
    key,
    normalizedKey: readString(value.normalizedKey) ?? key.toLocaleLowerCase("tr-TR"),
    value: rawValue,
    page: readOptionalPositiveInteger(value.page),
    confidence: readConfidence(value.confidence),
    provenance,
  };
}

export function readStructuredOcrSpanArtifact(value: unknown): StructuredOcrSpanArtifact | null {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "ocr_span") return null;
  const text = readString(value.text);
  if (!text) return null;
  const provenance = isRecord(value.provenance)
    ? {
        parserId: readOptionalString(value.provenance.parserId),
        parserVersion: readNumber(value.provenance.parserVersion) ?? undefined,
        bbox: readBbox(value.provenance.bbox),
      }
    : undefined;
  return {
    version: 1,
    kind: "ocr_span",
    text,
    page: readOptionalPositiveInteger(value.page),
    confidence: readConfidence(value.confidence),
    language: readOptionalString(value.language),
    provenance,
  };
}

export function readStructuredDocumentArtifact(value: unknown): StructuredDocumentArtifact | null {
  return readStructuredTableArtifact(value)
    ?? readStructuredKeyValueArtifact(value)
    ?? readStructuredOcrSpanArtifact(value);
}
