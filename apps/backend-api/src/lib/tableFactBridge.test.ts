import { describe, expect, it } from "vitest";

import type { TableFact } from "./tableFact.js";
import { structuredFactFromTableFact } from "./tableFactBridge.js";
import { extractTableNumericFacts } from "./tableNumericFactExtractor.js";

function maintenanceDowntimeFact(): TableFact {
  return {
    id: "tf-maintenance-1",
    tableId: "maintenance-summary",
    sourceId: "maintenance-doc",
    documentId: "doc-42",
    address: {
      rowIndex: 4,
      columnIndex: 3,
      page: 2,
      sheetName: "April",
    },
    headerPath: ["Bakım Özeti", "Maksimum Duruş Süresi"],
    fieldId: "max_downtime",
    label: "Maksimum Duruş Süresi",
    rawValue: "42 dk",
    normalizedValue: 42,
    valueType: "number",
    unit: "dk",
    rowLabel: "Hat 3",
    columnLabel: "Süre",
    provenance: {
      extractor: "docling",
      confidence: 0.91,
      bbox: {
        x: 100,
        y: 220,
        width: 80,
        height: 18,
        page: 2,
      },
      quote: "Hat 3 | Maksimum Duruş Süresi | 42 dk",
    },
  };
}

describe("structuredFactFromTableFact", () => {
  it("converts a generic table fact into a structured fact with cell provenance", () => {
    const structuredFact = structuredFactFromTableFact(maintenanceDowntimeFact(), {
      defaultSourceId: "fallback-source",
      extractor: "docling",
    });

    expect(structuredFact).toMatchObject({
      id: "tf-maintenance-1",
      kind: "numeric_value",
      sourceId: "maintenance-doc",
      subject: "Hat 3",
      field: "Maksimum Duruş Süresi",
      value: "42 dk",
      unit: "dk",
      confidence: "high",
      table: {
        title: "maintenance-summary",
        rowLabel: "Hat 3",
        columnLabel: "Süre",
        headers: ["Bakım Özeti", "Maksimum Duruş Süresi"],
      },
      provenance: {
        extractor: "table-fact:docling",
      },
    });
    expect(structuredFact.table?.rawRow).toContain("row=4");
    expect(structuredFact.table?.rawRow).toContain("column=3");
    expect(structuredFact.table?.rawRow).toContain("page=2");
    expect(structuredFact.provenance.quote).toContain("table=maintenance-summary");
    expect(structuredFact.provenance.quote).toContain("bboxPage=2");
  });
});

describe("extractTableNumericFacts with table facts", () => {
  it("extracts a non-KAP table fact without adding domain-specific aliases", () => {
    const structuredFacts = extractTableNumericFacts({
      query: "Bakım raporunda maksimum duruş süresi nedir? Sadece değeri ve kaynağı ver.",
      facts: [],
      sourceIds: ["maintenance-doc"],
      tableFacts: [maintenanceDowntimeFact()],
    });

    expect(structuredFacts).toHaveLength(1);
    expect(structuredFacts[0]).toMatchObject({
      sourceId: "maintenance-doc",
      field: "Maksimum Duruş Süresi",
      value: "42 dk",
      provenance: {
        extractor: "table-fact:docling",
      },
    });
  });
});
