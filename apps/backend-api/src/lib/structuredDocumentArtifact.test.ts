import { describe, expect, it } from "vitest";

import {
  countStructuredTableCells,
  isStructuredTableArtifact,
  readStructuredTableArtifact,
  structuredTableToPlainText,
} from "./structuredDocumentArtifact.js";

describe("structured document artifacts", () => {
  it("normalizes, validates, counts cells, and renders table text", () => {
    const table = readStructuredTableArtifact({
      version: 1,
      kind: "table",
      tableId: " income-table ",
      title: " Income Statement ",
      page: 2,
      sheetName: " Sheet 1 ",
      headers: [
        { columnId: "line", text: " Line item " },
        { columnId: "y2025", text: " 2025 ", normalizedText: "2025" },
      ],
      rows: [
        {
          rowId: "r1",
          label: "Revenue",
          sourceRow: 4,
          cells: [
            { columnId: "line", text: "Revenue" },
            { columnId: "y2025", text: "1,640,000 TL", value: 1640000, valueType: "number", unit: "TL", confidence: 0.98 },
          ],
        },
        {
          rowId: "r2",
          cells: [
            { columnId: "line", text: "Net profit" },
            { columnId: "y2025", text: "305,000 TL", value: 305000, valueType: "number", unit: "TL" },
          ],
        },
      ],
      provenance: { parserId: "spreadsheet-parser", parserVersion: 1, bbox: [0, 1, 2, 3] },
    });

    expect(table).not.toBeNull();
    expect(isStructuredTableArtifact(table)).toBe(true);
    expect(table?.tableId).toBe("income-table");
    expect(table?.headers[0]?.normalizedText).toBe("line item");
    expect(table ? countStructuredTableCells(table) : 0).toBe(4);
    expect(table ? structuredTableToPlainText(table) : "").toContain("Income Statement | sheet: Sheet 1 | page: 2");
    expect(table ? structuredTableToPlainText(table) : "").toContain("Revenue | 1,640,000 TL");
  });

  it("returns null for invalid input instead of throwing", () => {
    expect(readStructuredTableArtifact(null)).toBeNull();
    expect(readStructuredTableArtifact({ version: 1, kind: "table", tableId: "x" })).toBeNull();
    expect(readStructuredTableArtifact({
      version: 1,
      kind: "table",
      tableId: "x",
      headers: [{ columnId: "a", text: "A" }],
      rows: [{ rowId: "r1", cells: [{ columnId: "missing", text: "bad" }] }],
      provenance: { parserId: "parser", parserVersion: 1 },
    })).toBeNull();
  });
});
