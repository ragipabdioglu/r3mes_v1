export type TableFactValueType = "money" | "number" | "date" | "text" | "percentage" | "boolean" | "empty";

export type TableFactExtractor = "docling" | "excel" | "ocr" | "regex_fallback" | "manual" | "unknown";

export type TableFactConfidence = "low" | "medium" | "high";

export interface TableCellAddress {
  rowIndex: number;
  columnIndex: number;
  page?: number;
  sheetName?: string;
}

export interface TableBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number;
}

export interface TableFieldCandidate {
  fieldId: string;
  label: string;
  aliases?: string[];
  headerPath?: string[];
  valueType?: TableFactValueType;
  confidence: number;
  matchedBy: "header" | "alias" | "domain_pack" | "cell_context" | "fallback";
  domainPackId?: string;
}

export interface TableProfile {
  tableId: string;
  sourceId: string;
  documentId?: string;
  title?: string;
  page?: number;
  sheetName?: string;
  rowCount?: number;
  columnCount?: number;
  headers: string[];
  headerPaths?: string[][];
  fieldCandidates?: TableFieldCandidate[];
  valueTypes?: TableFactValueType[];
  domains?: string[];
  confidence: number;
}

export interface NormalizedTableFactValue {
  raw: string;
  text: string;
  value?: string | number | boolean;
  valueType: TableFactValueType;
  unit?: string;
}

export interface TableFact {
  id?: string;
  tableId: string;
  sourceId: string;
  documentId?: string;
  address: TableCellAddress;
  headerPath: string[];
  fieldId: string;
  label: string;
  rawValue: string;
  normalizedValue?: NormalizedTableFactValue["value"];
  valueType: TableFactValueType;
  unit?: string;
  rowLabel?: string;
  columnLabel?: string;
  provenance: {
    extractor: TableFactExtractor;
    confidence: number;
    bbox?: TableBoundingBox;
    quote?: string;
  };
}

export interface TableFactConfidenceInput {
  fieldCandidateConfidence?: number;
  extractorConfidence?: number;
  valueNormalized?: boolean;
  hasHeaderPath?: boolean;
  hasCellAddress?: boolean;
  hasBoundingBox?: boolean;
  extractor?: TableFactExtractor;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function compactWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function parseLocaleNumber(value: string): number | undefined {
  const compact = value.replace(/\s+/g, "");
  const withoutCurrency = compact.replace(/[^\d,.\-()]/g, "");
  if (!/\d/u.test(withoutCurrency)) return undefined;
  const negative = withoutCurrency.includes("-") || (withoutCurrency.startsWith("(") && withoutCurrency.endsWith(")"));
  const unsigned = withoutCurrency.replace(/[()\-]/g, "");
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : lastDot > lastComma ? "." : undefined;
  const normalized = decimalSeparator
    ? `${unsigned.slice(0, decimalSeparator === "," ? lastComma : lastDot).replace(/[,.]/g, "")}.${unsigned.slice(
        (decimalSeparator === "," ? lastComma : lastDot) + 1,
      )}`
    : unsigned.replace(/[,.]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return negative ? -parsed : parsed;
}

function inferUnit(value: string): string | undefined {
  if (/%/u.test(value)) return "%";
  if (/\b(?:try|tl)\b|₺/iu.test(value)) return "TRY";
  if (/\b(?:usd|dolar)\b|\$/iu.test(value)) return "USD";
  if (/\b(?:eur|euro)\b|€/iu.test(value)) return "EUR";
  return undefined;
}

function inferValueType(value: string): TableFactValueType {
  const normalized = compactWhitespace(value);
  if (normalized.length === 0) return "empty";
  if (/%/u.test(normalized)) return "percentage";
  if (/\b(?:try|tl|usd|eur|euro|dolar)\b|[₺$€]/iu.test(normalized)) return "money";
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/u.test(normalized)) return "date";
  if (/^(?:true|false|evet|hayir|hayır|yes|no)$/iu.test(normalized)) return "boolean";
  if (parseLocaleNumber(normalized) !== undefined) return "number";
  return "text";
}

export function normalizeTableFactValue(
  rawValue: string | number | boolean | null | undefined,
  expectedType?: TableFactValueType,
): NormalizedTableFactValue {
  const raw = rawValue == null ? "" : String(rawValue);
  const text = compactWhitespace(raw);
  const valueType = expectedType ?? inferValueType(text);
  const unit = inferUnit(text);

  if (valueType === "empty" || text.length === 0) return { raw, text, valueType: "empty", unit };
  if (valueType === "boolean") {
    if (/^(?:true|evet|yes)$/iu.test(text)) return { raw, text, value: true, valueType, unit };
    if (/^(?:false|hayir|hayır|no)$/iu.test(text)) return { raw, text, value: false, valueType, unit };
  }
  if (valueType === "money" || valueType === "number" || valueType === "percentage") {
    const parsed = parseLocaleNumber(text);
    if (parsed !== undefined) return { raw, text, value: parsed, valueType, unit };
  }
  return { raw, text, value: text, valueType, unit };
}

export function scoreTableFactConfidence(input: TableFactConfidenceInput): number {
  const fieldScore = input.fieldCandidateConfidence == null ? 0.5 : clampConfidence(input.fieldCandidateConfidence);
  const extractorScore = input.extractorConfidence == null ? 0.5 : clampConfidence(input.extractorConfidence);
  let score = fieldScore * 0.45 + extractorScore * 0.35;
  if (input.valueNormalized) score += 0.08;
  if (input.hasHeaderPath) score += 0.05;
  if (input.hasCellAddress) score += 0.04;
  if (input.hasBoundingBox) score += 0.03;
  if (input.extractor === "regex_fallback") score -= 0.12;
  if (input.extractor === "unknown") score -= 0.08;
  return clampConfidence(score);
}

export function tableFactConfidenceLevel(score: number): TableFactConfidence {
  const clamped = clampConfidence(score);
  if (clamped >= 0.78) return "high";
  if (clamped >= 0.48) return "medium";
  return "low";
}

export function summarizeTableFact(fact: TableFact): string {
  const location = [
    fact.documentId ? `document=${fact.documentId}` : undefined,
    `source=${fact.sourceId}`,
    `table=${fact.tableId}`,
    fact.address.sheetName ? `sheet=${fact.address.sheetName}` : undefined,
    fact.address.page == null ? undefined : `page=${fact.address.page}`,
    `row=${fact.address.rowIndex}`,
    `col=${fact.address.columnIndex}`,
  ]
    .filter(Boolean)
    .join(", ");
  const header = fact.headerPath.length > 0 ? fact.headerPath.join(" > ") : fact.label;
  const value = fact.normalizedValue == null ? compactWhitespace(fact.rawValue) : String(fact.normalizedValue);
  const unit = fact.unit ? ` ${fact.unit}` : "";
  return `${fact.label}: ${value}${unit} (${header}; ${location}; extractor=${fact.provenance.extractor}; confidence=${fact.provenance.confidence.toFixed(
    2,
  )})`;
}
