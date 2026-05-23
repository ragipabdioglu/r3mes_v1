const output = {
  sourceType: "PDF",
  text: [
    "# Quarterly Metrics Report",
    "",
    "This external parser fixture represents a clean PDF table envelope. It includes enough narrative context for parse quality scoring while keeping the structured table as the main answer-ready artifact.",
    "The report summarizes quarterly finance metrics extracted by an external parser. The table preserves headers, row labels, numeric cells, source cells, and parser provenance.",
    "Gelir and gider values are intentionally present in the table text so ingestion quality can identify table-heavy financial content without using product-code literals.",
    "",
    "| Metric | Q1 | Q2 |",
    "| --- | ---: | ---: |",
    "| Gelir | 1200 | 1350 |",
    "| Gider | 800 | 840 |",
    "| Net Result | 400 | 510 |",
    "| Customer Count | 42 | 48 |",
    "| Renewal Rate | 91% | 93% |",
  ].join("\n"),
  artifacts: [
    {
      id: "table-quarterly-metrics",
      kind: "table",
      title: "Quarterly Metrics",
      page: 1,
      text: [
        "| Metric | Q1 | Q2 |",
        "| --- | ---: | ---: |",
        "| Gelir | 1200 | 1350 |",
        "| Gider | 800 | 840 |",
        "| Net Result | 400 | 510 |",
        "| Customer Count | 42 | 48 |",
        "| Renewal Rate | 91% | 93% |",
      ].join("\n"),
      metadata: {
        parserBlockId: "block-table-1",
      },
    },
  ],
  structuredArtifacts: [
    {
      version: 1,
      kind: "table",
      tableId: "table-quarterly-metrics",
      title: "Quarterly Metrics",
      page: 1,
      headers: [
        { columnId: "metric", text: "Metric", normalizedText: "metric", sourceCell: "A1" },
        { columnId: "q1", text: "Q1", normalizedText: "q1", sourceCell: "B1" },
        { columnId: "q2", text: "Q2", normalizedText: "q2", sourceCell: "C1" },
      ],
      rows: [
        {
          rowId: "r1",
          label: "Gelir",
          cells: [
            { columnId: "metric", text: "Gelir", normalizedText: "gelir", value: "Gelir", valueType: "string", sourceCell: "A2" },
            { columnId: "q1", text: "1200", normalizedText: "1200", value: 1200, valueType: "number", sourceCell: "B2" },
            { columnId: "q2", text: "1350", normalizedText: "1350", value: 1350, valueType: "number", sourceCell: "C2" },
          ],
        },
        {
          rowId: "r2",
          label: "Gider",
          cells: [
            { columnId: "metric", text: "Gider", normalizedText: "gider", value: "Gider", valueType: "string", sourceCell: "A3" },
            { columnId: "q1", text: "800", normalizedText: "800", value: 800, valueType: "number", sourceCell: "B3" },
            { columnId: "q2", text: "840", normalizedText: "840", value: 840, valueType: "number", sourceCell: "C3" },
          ],
        },
        {
          rowId: "r3",
          label: "Net Result",
          cells: [
            { columnId: "metric", text: "Net Result", normalizedText: "net result", value: "Net Result", valueType: "string", sourceCell: "A4" },
            { columnId: "q1", text: "400", normalizedText: "400", value: 400, valueType: "number", sourceCell: "B4" },
            { columnId: "q2", text: "510", normalizedText: "510", value: 510, valueType: "number", sourceCell: "C4" },
          ],
        },
        {
          rowId: "r4",
          label: "Customer Count",
          cells: [
            { columnId: "metric", text: "Customer Count", normalizedText: "customer count", value: "Customer Count", valueType: "string", sourceCell: "A5" },
            { columnId: "q1", text: "42", normalizedText: "42", value: 42, valueType: "number", sourceCell: "B5" },
            { columnId: "q2", text: "48", normalizedText: "48", value: 48, valueType: "number", sourceCell: "C5" },
          ],
        },
        {
          rowId: "r5",
          label: "Renewal Rate",
          cells: [
            { columnId: "metric", text: "Renewal Rate", normalizedText: "renewal rate", value: "Renewal Rate", valueType: "string", sourceCell: "A6" },
            { columnId: "q1", text: "91%", normalizedText: "91%", value: "91%", valueType: "string", sourceCell: "B6" },
            { columnId: "q2", text: "93%", normalizedText: "93%", value: "93%", valueType: "string", sourceCell: "C6" },
          ],
        },
      ],
      provenance: {
        parserId: "external-structured-table-fixture",
        parserVersion: 1,
        artifactId: "table-quarterly-metrics",
      },
    },
  ],
};

console.log(JSON.stringify(output));
