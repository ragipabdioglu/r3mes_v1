import type { StructuredFact, StructuredFactKind } from "./structuredFact.js";
import type { TableFact, TableFactExtractor, TableBoundingBox } from "./tableFact.js";
import { tableFactConfidenceLevel } from "./tableFact.js";

export interface TableFactToStructuredFactOptions {
  defaultSourceId: string;
  extractor?: Extract<TableFactExtractor, "docling" | "excel" | "ocr" | "regex_fallback">;
}

function hashId(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function compactWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function bboxSummary(bbox: TableBoundingBox | undefined): string | undefined {
  if (!bbox) return undefined;
  return [
    bbox.page == null ? undefined : `bboxPage=${bbox.page}`,
    `x=${bbox.x}`,
    `y=${bbox.y}`,
    `w=${bbox.width}`,
    `h=${bbox.height}`,
  ].filter(Boolean).join(",");
}

function valueForStructuredFact(fact: TableFact): string {
  const rawValue = compactWhitespace(fact.rawValue);
  if (rawValue) return rawValue;
  if (fact.normalizedValue == null) return "";
  return String(fact.normalizedValue);
}

function kindForTableFact(fact: TableFact): StructuredFactKind {
  return fact.valueType === "text" || fact.valueType === "boolean" || fact.valueType === "empty"
    ? "table_cell"
    : "numeric_value";
}

function quoteForTableFact(fact: TableFact, extractor: string): string {
  const location = [
    fact.documentId ? `document=${fact.documentId}` : undefined,
    `source=${fact.sourceId}`,
    `table=${fact.tableId}`,
    fact.address.sheetName ? `sheet=${fact.address.sheetName}` : undefined,
    fact.address.page == null ? undefined : `page=${fact.address.page}`,
    `row=${fact.address.rowIndex}`,
    `column=${fact.address.columnIndex}`,
    bboxSummary(fact.provenance.bbox),
  ].filter(Boolean).join("; ");
  const header = fact.headerPath.length > 0 ? fact.headerPath.join(" > ") : fact.label;
  const value = valueForStructuredFact(fact);
  const unit = fact.unit ? ` ${fact.unit}` : "";
  const quoted = fact.provenance.quote ? `; quote=${compactWhitespace(fact.provenance.quote).slice(0, 240)}` : "";
  return `${fact.label}: ${value}${unit} (${header}; ${location}; extractor=${extractor}${quoted})`;
}

function rawRowForTableFact(fact: TableFact): string {
  const parts = [
    `table=${fact.tableId}`,
    `row=${fact.address.rowIndex}`,
    `column=${fact.address.columnIndex}`,
    fact.address.page == null ? undefined : `page=${fact.address.page}`,
    fact.address.sheetName ? `sheet=${fact.address.sheetName}` : undefined,
    bboxSummary(fact.provenance.bbox),
    `field=${fact.fieldId}`,
    `value=${valueForStructuredFact(fact)}`,
  ];
  return parts.filter(Boolean).join("; ");
}

export function structuredFactFromTableFact(
  fact: TableFact,
  opts: TableFactToStructuredFactOptions,
): StructuredFact {
  const sourceId = fact.sourceId || opts.defaultSourceId;
  const extractor = opts.extractor ?? fact.provenance.extractor;
  const value = valueForStructuredFact(fact);
  const id = fact.id ?? `sf_table_${hashId([
    sourceId,
    fact.documentId ?? "",
    fact.tableId,
    fact.address.rowIndex,
    fact.address.columnIndex,
    fact.fieldId,
    value,
  ].join("|"))}`;

  return {
    id,
    kind: kindForTableFact(fact),
    sourceId,
    subject: fact.rowLabel ?? fact.tableId,
    field: fact.label,
    value,
    unit: fact.unit,
    confidence: tableFactConfidenceLevel(fact.provenance.confidence),
    table: {
      title: fact.tableId,
      rowLabel: fact.rowLabel,
      columnLabel: fact.columnLabel,
      headers: fact.headerPath,
      rawRow: rawRowForTableFact(fact),
    },
    provenance: {
      quote: quoteForTableFact(fact, extractor),
      extractor: `table-fact:${extractor}`,
    },
  };
}
