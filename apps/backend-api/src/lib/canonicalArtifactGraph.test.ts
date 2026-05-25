import { describe, expect, it } from "vitest";

import { buildCanonicalArtifactGraph } from "./canonicalArtifactGraph.js";
import type { ParsedKnowledgeDocument } from "./knowledgeText.js";

function parsedFixture(overrides: Partial<ParsedKnowledgeDocument> = {}): ParsedKnowledgeDocument {
  return {
    schemaVersion: 2,
    sourceType: "MARKDOWN",
    text: "Reference document",
    artifacts: [],
    parser: { id: "fixture-parser", version: 1 },
    parserRun: {
      id: "fixture-parser",
      version: 1,
      profile: "built_in",
      fallbackUsed: false,
      outputSchemaVersion: 2,
      warnings: [],
    },
    diagnostics: { originalBytes: 18, normalizedChars: 18, warnings: [] },
    ...overrides,
  };
}

describe("buildCanonicalArtifactGraph", () => {
  it("passes through source artifacts and represents list items as children", () => {
    const graph = buildCanonicalArtifactGraph(parsedFixture({
      artifacts: [
        {
          id: "section-1",
          kind: "heading",
          text: "Operations",
          answerabilityScore: 12,
        },
        {
          id: "list-1",
          kind: "list",
          text: "- Prepare\n- Verify",
          items: ["Prepare", "Verify"],
          title: "Steps",
          page: 2,
          answerabilityScore: 82,
        },
      ],
    }));

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "section-1", kind: "heading", origin: "document_artifact" }),
      expect.objectContaining({ id: "list-1", kind: "list", origin: "document_artifact", depth: 0 }),
      expect.objectContaining({ id: "list-1:item:1", kind: "list_item", parentId: "list-1", text: "Prepare" }),
      expect.objectContaining({ id: "list-1:item:2", kind: "list_item", parentId: "list-1", text: "Verify" }),
    ]));
    expect(graph.edges).toEqual([
      { fromId: "list-1", toId: "list-1:item:1", relation: "has_item" },
      { fromId: "list-1", toId: "list-1:item:2", relation: "has_item" },
    ]);
    expect(graph.diagnostics.kindCounts).toMatchObject({ heading: 1, list: 1, list_item: 2 });
    expect(graph.diagnostics.orphanStructuredArtifactCount).toBe(0);
  });

  it("attaches structured table rows and cells to the matching source artifact with provenance", () => {
    const graph = buildCanonicalArtifactGraph(parsedFixture({
      artifacts: [
        {
          id: "table-source",
          kind: "table",
          text: "| Metric | Value |",
          answerabilityScore: 94,
        },
      ],
      structuredArtifacts: [
        {
          version: 1,
          kind: "table",
          tableId: "structured-table",
          headers: [
            { columnId: "metric", text: "Metric", normalizedText: "metric" },
            { columnId: "value", text: "Value", normalizedText: "value" },
          ],
          rows: [{
            rowId: "row-1",
            label: "Status",
            cells: [
              { columnId: "metric", text: "Status", normalizedText: "status" },
              { columnId: "value", text: "Ready", normalizedText: "ready", confidence: 0.98 },
            ],
          }],
          provenance: {
            parserId: "structured-parser",
            parserVersion: 3,
            artifactId: "table-source",
          },
        },
      ],
    }));

    expect(graph.rootIds).toEqual(["table-source"]);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "table-source:row:row-1", kind: "table_row", parentId: "table-source" }),
      expect.objectContaining({
        id: "table-source:row:row-1:cell:value",
        kind: "table_cell",
        text: "Ready",
        confidence: 0.98,
        provenance: expect.objectContaining({ parserId: "structured-parser", parserVersion: 3 }),
      }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      { fromId: "table-source", toId: "table-source:row:row-1", relation: "has_row" },
      { fromId: "table-source:row:row-1", toId: "table-source:row:row-1:cell:value", relation: "has_cell" },
    ]));
    expect(graph.diagnostics.kindCounts).toMatchObject({ table: 1, table_row: 1, table_cell: 2 });
    expect(graph.diagnostics.orphanStructuredArtifactCount).toBe(0);
  });

  it("retains unmatched structured artifacts as diagnosed roots", () => {
    const graph = buildCanonicalArtifactGraph(parsedFixture({
      structuredArtifacts: [
        {
          version: 1,
          kind: "key_value",
          key: "State",
          normalizedKey: "state",
          value: "Active",
          confidence: 0.9,
        },
        {
          version: 1,
          kind: "ocr_span",
          text: "Scanned heading",
          confidence: 0.7,
          provenance: { parserId: "ocr-parser", parserVersion: 1 },
        },
      ],
    }));

    expect(graph.rootIds).toHaveLength(2);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "key_value", text: "State: Active", origin: "structured_artifact" }),
      expect.objectContaining({ kind: "ocr_span", text: "Scanned heading", origin: "structured_artifact" }),
    ]));
    expect(graph.diagnostics).toMatchObject({
      inputArtifactCount: 0,
      structuredArtifactCount: 2,
      orphanStructuredArtifactCount: 2,
      rootCount: 2,
      kindCounts: { key_value: 1, ocr_span: 1 },
      warnings: ["orphan_structured_artifacts"],
    });
  });

  it("represents ordered procedures as step children", () => {
    const graph = buildCanonicalArtifactGraph(parsedFixture({
      artifacts: [{
        id: "procedure-1",
        kind: "procedure",
        text: "1. Prepare\n2. Confirm",
        items: ["Prepare", "Confirm"],
        answerabilityScore: 84,
      }],
    }));

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "procedure-1:item:1", kind: "procedure_step", text: "Prepare" }),
      expect.objectContaining({ id: "procedure-1:item:2", kind: "procedure_step", text: "Confirm" }),
    ]));
    expect(graph.edges).toEqual([
      { fromId: "procedure-1", toId: "procedure-1:item:1", relation: "has_step" },
      { fromId: "procedure-1", toId: "procedure-1:item:2", relation: "has_step" },
    ]);
  });
});
