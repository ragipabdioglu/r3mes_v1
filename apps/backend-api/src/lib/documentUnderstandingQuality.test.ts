import { describe, expect, it } from "vitest";

import { buildDocumentUnderstandingQuality } from "./documentUnderstandingQuality.js";

const structuredTable = {
  version: 1,
  kind: "table",
  tableId: "sheet1-table",
  sheetName: "Sheet1",
  headers: [
    { columnId: "metric", text: "Metric" },
    { columnId: "value", text: "Value" },
  ],
  rows: [
    {
      rowId: "r1",
      cells: [
        { columnId: "metric", text: "Revenue" },
        { columnId: "value", text: "1,640,000", value: 1640000, valueType: "number" },
      ],
    },
  ],
  provenance: { parserId: "spreadsheet-parser", parserVersion: 1 },
};

describe("buildDocumentUnderstandingQuality", () => {
  it("marks text-only table sources as partial and needing strict review", () => {
    const quality = buildDocumentUnderstandingQuality({
      parseQuality: {
        level: "clean",
        warnings: ["table_like_content"],
        signals: { tableSignalCount: 2 },
      },
      artifacts: [{ kind: "table", text: "| A | B |\n| 1 | 2 |" }],
    });

    expect(quality.parseQuality).toBe("clean");
    expect(quality.tableQuality).toBe("text_only");
    expect(quality.structureQuality).toBe("partial");
    expect(quality.answerReadiness).toBe("partial");
    expect(quality.strictAnswerEligible).toBe(false);
    expect(quality.warnings).toContain("table_text_only");
  });

  it("marks structured spreadsheet sources ready", () => {
    const quality = buildDocumentUnderstandingQuality({
      parseQuality: { level: "clean", warnings: [], signals: { tableSignalCount: 1 } },
      sourceType: "xlsx",
      structuredArtifacts: [structuredTable],
      artifacts: [{ kind: "table", text: "Metric | Value" }],
    });

    expect(quality.tableQuality).toBe("structured");
    expect(quality.spreadsheetQuality).toBe("structured");
    expect(quality.structureQuality).toBe("strong");
    expect(quality.answerReadiness).toBe("ready");
    expect(quality.strictAnswerEligible).toBe(true);
    expect(quality.signals.structuredTableCount).toBe(1);
    expect(quality.signals.tableCellCount).toBe(2);
  });

  it("blocks strict answers for noisy OCR", () => {
    const quality = buildDocumentUnderstandingQuality({
      parseQuality: {
        level: "noisy",
        warnings: ["ocr_risk_high", "replacement_char_detected"],
        signals: { ocrRiskScore: 62 },
      },
      structuredArtifacts: [{ version: 1, kind: "ocr_span", text: "R3v3nue 1�4O", confidence: 0.42 }],
      ocrWarnings: ["ocr_risk_high"],
    });

    expect(quality.ocrQuality).toBe("weak");
    expect(quality.answerReadiness).toBe("needs_review");
    expect(quality.strictAnswerEligible).toBe(false);
    expect(quality.blockers).toContain("parse_quality_noisy");
    expect(quality.blockers).toContain("ocr_risk_high");
  });
});
