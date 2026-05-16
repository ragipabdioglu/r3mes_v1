import type { DocumentArtifact } from "./knowledgeText.js";
import type { StructuredDocumentArtifact, StructuredTableArtifact, StructuredTableCell } from "./structuredDocumentArtifact.js";

export interface SpreadsheetParseResult {
  text: string;
  artifacts: DocumentArtifact[];
  structuredArtifacts: StructuredDocumentArtifact[];
  warnings: string[];
}

const CSV_PARSER_ID = "csv-spreadsheet-v1";
const CSV_PARSER_VERSION = 1;

function normalizeCellText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: string): string {
  return normalizeCellText(value).toLocaleLowerCase("tr-TR");
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function sourceCell(rowIndex: number, columnIndex: number): string {
  return `${columnName(columnIndex)}${rowIndex + 1}`;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(raw: string): string {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 12);
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestScore = -1;
  for (const delimiter of candidates) {
    const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter));
    const nonZero = counts.filter((count) => count > 0);
    const score = nonZero.reduce((sum, count) => sum + count, 0) + nonZero.length * 2 - new Set(nonZero).size;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function parseCsvRecords(raw: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && raw[i + 1] === "\n") i += 1;
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows.map((values) => values.map(normalizeCellText));
}

function parseTypedValue(text: string, delimiter: string): Pick<StructuredTableCell, "value" | "valueType"> {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, valueType: "empty" };
  const lower = trimmed.toLocaleLowerCase("tr-TR");
  if (lower === "true" || lower === "false") return { value: lower === "true", valueType: "boolean" };
  if (lower === "evet" || lower === "hayır" || lower === "hayir") {
    return { value: lower === "evet", valueType: "boolean" };
  }
  if (/^\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?$/u.test(trimmed) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u.test(trimmed)) {
    return { value: trimmed, valueType: "date" };
  }

  const numericCandidate = trimmed.replace(/\s+/g, "");
  const normalizedNumber =
    /^-?\d{1,3}(?:\.\d{3})+,\d+$/u.test(numericCandidate)
      ? numericCandidate.replace(/\./g, "").replace(",", ".")
      : /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(numericCandidate)
        ? numericCandidate.replace(/,/g, "")
        : delimiter !== "," && /^-?\d+,\d+$/u.test(numericCandidate)
          ? numericCandidate.replace(",", ".")
          : numericCandidate;
  if (/^-?(?:\d+|\d*\.\d+)$/u.test(normalizedNumber)) {
    const number = Number(normalizedNumber);
    if (Number.isFinite(number)) return { value: number, valueType: "number" };
  }

  return { value: trimmed, valueType: "string" };
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function tableToMarkdown(table: StructuredTableArtifact): string {
  const lines = [
    table.headers.map((header) => markdownCell(header.text)).join(" | "),
    table.headers.map(() => "---").join(" | "),
  ];
  for (const row of table.rows) {
    const cellsByColumn = new Map(row.cells.map((cell) => [cell.columnId, cell.text]));
    lines.push(table.headers.map((header) => markdownCell(cellsByColumn.get(header.columnId) ?? "")).join(" | "));
  }
  return lines.map((line) => `| ${line} |`).join("\n");
}

export function parseCsvSpreadsheet(raw: string, filename: string): SpreadsheetParseResult {
  const delimiter = detectDelimiter(raw);
  const parsedRows = parseCsvRecords(raw, delimiter).filter((row) => row.some((cell) => cell.length > 0));
  if (parsedRows.length === 0) {
    return { text: "", artifacts: [], structuredArtifacts: [], warnings: ["csv_empty"] };
  }

  const columnCount = Math.max(...parsedRows.map((row) => row.length));
  const headerRow = parsedRows[0] ?? [];
  const headers = Array.from({ length: columnCount }, (_, index) => {
    const text = headerRow[index] || `Column ${index + 1}`;
    return {
      columnId: `c${index + 1}`,
      text,
      normalizedText: normalizeHeader(text),
      sourceCell: sourceCell(0, index),
    };
  });

  const rows = parsedRows.slice(1).map((values, rowIndex) => ({
    rowId: `r${rowIndex + 1}`,
    sourceRow: rowIndex + 2,
    cells: headers.map((header, columnIndex) => {
      const text = values[columnIndex] ?? "";
      return {
        columnId: header.columnId,
        text,
        normalizedText: normalizeCellText(text),
        ...parseTypedValue(text, delimiter),
        sourceCell: sourceCell(rowIndex + 1, columnIndex),
        confidence: 1,
      };
    }),
  })).filter((row) => row.cells.some((cell) => cell.text.length > 0));

  const table: StructuredTableArtifact = {
    version: 1,
    kind: "table",
    tableId: "csv-table-1",
    title: filename,
    sheetName: "CSV",
    headers,
    rows,
    provenance: {
      parserId: CSV_PARSER_ID,
      parserVersion: CSV_PARSER_VERSION,
      artifactId: "csv-table-1",
    },
  };
  const text = tableToMarkdown(table);
  const warnings = rows.length === 0 ? ["csv_header_only"] : [];

  return {
    text,
    artifacts: [{
      id: "csv-table-1",
      kind: "table",
      text,
      title: filename,
      metadata: {
        delimiter,
        structuredArtifactId: table.tableId,
        sourceFormat: "csv",
      },
      answerabilityScore: 88,
    }],
    structuredArtifacts: rows.length > 0 ? [table] : [],
    warnings,
  };
}
