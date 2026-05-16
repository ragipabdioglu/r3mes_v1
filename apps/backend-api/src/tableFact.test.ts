import { describe, expect, it } from "vitest";
import {
  normalizeTableFactValue,
  scoreTableFactConfidence,
  summarizeTableFact,
  tableFactConfidenceLevel,
  type TableFact,
} from "./lib/tableFact.js";
import { findTableDomainFieldAliases, type TableDomainPack } from "./lib/tableDomainPack.js";

describe("table fact helpers", () => {
  it("normalizes locale numeric values without domain-specific aliases", () => {
    expect(normalizeTableFactValue("1.234.567,89 TL")).toMatchObject({
      value: 1234567.89,
      valueType: "money",
      unit: "TRY",
    });
    expect(normalizeTableFactValue("%12,5")).toMatchObject({
      value: 12.5,
      valueType: "percentage",
      unit: "%",
    });
  });

  it("scores confidence from generic table evidence signals", () => {
    const score = scoreTableFactConfidence({
      fieldCandidateConfidence: 0.9,
      extractorConfidence: 0.85,
      valueNormalized: true,
      hasHeaderPath: true,
      hasCellAddress: true,
      extractor: "docling",
    });

    expect(score).toBeGreaterThan(0.8);
    expect(tableFactConfidenceLevel(score)).toBe("high");
  });

  it("summarizes facts with provenance and table address", () => {
    const fact: TableFact = {
      tableId: "t1",
      sourceId: "source-a",
      documentId: "doc-a",
      address: { rowIndex: 3, columnIndex: 2, page: 7 },
      headerPath: ["Financials", "Amount"],
      fieldId: "amount",
      label: "Amount",
      rawValue: "10",
      normalizedValue: 10,
      valueType: "number",
      provenance: {
        extractor: "excel",
        confidence: 0.91,
      },
    };

    expect(summarizeTableFact(fact)).toContain("Amount: 10");
    expect(summarizeTableFact(fact)).toContain("table=t1");
    expect(summarizeTableFact(fact)).toContain("confidence=0.91");
  });

  it("keeps table domain packs as pluggable alias containers", () => {
    const packs: TableDomainPack[] = [
      {
        id: "example-finance-v1",
        version: "1",
        domain: "finance",
        fieldAliases: [{ fieldId: "net_profit", label: "Net Profit", aliases: ["net income"], valueType: "money" }],
      },
    ];

    expect(findTableDomainFieldAliases(packs, "net_profit")).toEqual([
      {
        domainPackId: "example-finance-v1",
        fieldId: "net_profit",
        label: "Net Profit",
        aliases: ["net income"],
        valueType: "money",
      },
    ]);
  });
});
