import { describe, expect, it } from "vitest";

import { extractEvidenceV2 } from "./evidenceExtractorOrchestrator.js";

describe("extractEvidenceV2", () => {
  it("extracts typed list evidence without data-specific literals", () => {
    const result = extractEvidenceV2({
      query: "Desteklenen özellikleri madde madde yaz.",
      cards: [
        {
          sourceId: "doc-list",
          title: "generic-list-doc",
          rawContent: [
            "Desteklenen özellikler:",
            "- Birinci özellik kaynakta açıklanır.",
            "- İkinci özellik kaynakta açıklanır.",
            "- Üçüncü özellik kaynakta açıklanır.",
          ].join("\n"),
        },
      ],
    });

    expect(result.evidenceBundle.diagnostics.extractorVersion).toBe("v2");
    expect(result.evidenceBundle.diagnostics.kindCounts.list_item).toBeGreaterThanOrEqual(3);
    expect(result.coverage.status).toBe("complete");
  });

  it("extracts code evidence from raw source context", () => {
    const result = extractEvidenceV2({
      query: "saveHandler içinde ne yapılıyor?",
      cards: [
        {
          sourceId: "doc-code",
          title: "generic-code-doc",
          rawContent: "function saveHandler() { if (input.value.length > 0) { list.push(input.value); } }",
        },
      ],
    });

    expect(result.evidenceBundle.diagnostics.kindCounts.code_fact).toBeGreaterThanOrEqual(1);
    expect(result.items.map((item) => item.provenance.extractor)).toContain("code-evidence-v2");
  });

  it("extracts table structured facts from raw context through the v2 orchestrator", () => {
    const result = extractEvidenceV2({
      query: "Net dönem kârı kaç?",
      cards: [
        {
          sourceId: "doc-table",
          title: "generic-finance-table",
          rawContent: "Tablo: 5. Net Dönem Kârı (=) 123.456.789 8. Dağıtılabilir Kâr 123.456.789",
        },
      ],
    });

    expect(result.structuredFacts.length).toBeGreaterThanOrEqual(1);
    expect(result.evidenceBundle.diagnostics.kindCounts.table_fact + result.evidenceBundle.diagnostics.kindCounts.numeric_fact).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.domainPackIds).toContain("finance-profit-distribution");
  });
});
