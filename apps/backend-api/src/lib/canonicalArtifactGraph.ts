import type { DocumentArtifact, DocumentArtifactKind, ParsedKnowledgeDocument } from "./knowledgeText.js";
import {
  structuredTableToPlainText,
  type StructuredDocumentArtifact,
  type StructuredTableArtifact,
} from "./structuredDocumentArtifact.js";

export type CanonicalArtifactKind =
  | DocumentArtifactKind
  | "list_item"
  | "table_row"
  | "table_cell"
  | "key_value"
  | "ocr_span";

export type CanonicalArtifactOrigin = "document_artifact" | "structured_artifact";

export type ArtifactGraphRelation = "contains" | "has_item" | "has_step" | "has_row" | "has_cell";

export interface CanonicalArtifact {
  id: string;
  kind: CanonicalArtifactKind;
  text: string;
  origin: CanonicalArtifactOrigin;
  sourceArtifactId?: string;
  parentId?: string;
  title?: string | null;
  page?: number | null;
  order: number;
  depth: number;
  answerabilityScore?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
  provenance?: {
    parserId?: string;
    parserVersion?: number;
    bbox?: [number, number, number, number];
  };
}

export interface ArtifactGraphEdge {
  fromId: string;
  toId: string;
  relation: ArtifactGraphRelation;
}

export interface ArtifactGraphDiagnostics {
  inputArtifactCount: number;
  structuredArtifactCount: number;
  nodeCount: number;
  edgeCount: number;
  rootCount: number;
  orphanStructuredArtifactCount: number;
  duplicateArtifactIdCount: number;
  kindCounts: Partial<Record<CanonicalArtifactKind, number>>;
  warnings: string[];
}

export interface ArtifactGraphV2 {
  version: 2;
  documentSchemaVersion: ParsedKnowledgeDocument["schemaVersion"];
  parserId: string;
  nodes: CanonicalArtifact[];
  edges: ArtifactGraphEdge[];
  rootIds: string[];
  diagnostics: ArtifactGraphDiagnostics;
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function artifactNode(artifact: DocumentArtifact, order: number): CanonicalArtifact {
  return {
    id: artifact.id,
    kind: artifact.kind,
    text: artifact.text,
    origin: "document_artifact",
    sourceArtifactId: artifact.id,
    title: artifact.title,
    page: artifact.page,
    order,
    depth: 0,
    answerabilityScore: artifact.answerabilityScore,
    metadata: artifact.metadata,
  };
}

function structuredParentArtifactId(artifact: StructuredDocumentArtifact): string | undefined {
  if (artifact.kind === "table") return artifact.provenance.artifactId ?? artifact.tableId;
  if (artifact.kind === "key_value") return artifact.provenance?.artifactId;
  return undefined;
}

function structuredProvenance(artifact: StructuredDocumentArtifact): CanonicalArtifact["provenance"] {
  if (artifact.kind === "table") {
    return {
      parserId: artifact.provenance.parserId,
      parserVersion: artifact.provenance.parserVersion,
      bbox: artifact.provenance.bbox,
    };
  }
  if (artifact.kind === "key_value") return artifact.provenance;
  return artifact.provenance;
}

function structuredRootId(artifact: StructuredDocumentArtifact, index: number): string {
  if (artifact.kind === "table") return artifact.tableId;
  if (artifact.kind === "key_value") return `structured:key_value:${index}`;
  return `structured:ocr_span:${index}`;
}

function addTableChildren(
  table: StructuredTableArtifact,
  parentId: string,
  addNode: (node: Omit<CanonicalArtifact, "order">) => string,
  edges: ArtifactGraphEdge[],
): void {
  for (const [rowIndex, row] of table.rows.entries()) {
    const rowId = addNode({
      id: `${parentId}:row:${row.rowId}`,
      kind: "table_row",
      text: cleanText(row.cells.map((cell) => cell.text).join(" | ")),
      origin: "structured_artifact",
      sourceArtifactId: table.provenance.artifactId ?? table.tableId,
      parentId,
      page: table.page,
      depth: 1,
      metadata: {
        rowId: row.rowId,
        rowIndex,
        label: row.label,
        sourceRow: row.sourceRow,
      },
      provenance: structuredProvenance(table),
    });
    edges.push({ fromId: parentId, toId: rowId, relation: "has_row" });

    for (const [cellIndex, cell] of row.cells.entries()) {
      const cellId = addNode({
        id: `${rowId}:cell:${cell.columnId}`,
        kind: "table_cell",
        text: cell.text,
        origin: "structured_artifact",
        sourceArtifactId: table.provenance.artifactId ?? table.tableId,
        parentId: rowId,
        page: table.page,
        depth: 2,
        confidence: cell.confidence,
        metadata: {
          cellIndex,
          columnId: cell.columnId,
          value: cell.value,
          valueType: cell.valueType,
          unit: cell.unit,
          sourceCell: cell.sourceCell,
        },
        provenance: structuredProvenance(table),
      });
      edges.push({ fromId: rowId, toId: cellId, relation: "has_cell" });
    }
  }
}

export function buildCanonicalArtifactGraph(parsed: ParsedKnowledgeDocument): ArtifactGraphV2 {
  const nodes: CanonicalArtifact[] = [];
  const edges: ArtifactGraphEdge[] = [];
  const rootIds: string[] = [];
  const idCounts = new Map<string, number>();
  const documentNodeBySourceId = new Map<string, string>();
  let duplicateArtifactIdCount = 0;
  let orphanStructuredArtifactCount = 0;

  const addNode = (input: Omit<CanonicalArtifact, "order">): string => {
    const seen = idCounts.get(input.id) ?? 0;
    const id = seen === 0 ? input.id : `${input.id}#${seen + 1}`;
    idCounts.set(input.id, seen + 1);
    if (seen > 0) duplicateArtifactIdCount += 1;
    nodes.push({ ...input, id, order: nodes.length });
    return id;
  };

  for (const artifact of parsed.artifacts) {
    const id = addNode(artifactNode(artifact, nodes.length));
    if (!documentNodeBySourceId.has(artifact.id)) documentNodeBySourceId.set(artifact.id, id);
    rootIds.push(id);

    if (artifact.kind === "list" || artifact.kind === "procedure") {
      for (const [itemIndex, item] of (artifact.items ?? []).entries()) {
        const itemId = addNode({
          id: `${id}:item:${itemIndex + 1}`,
          kind: artifact.kind === "procedure" ? "procedure_step" : "list_item",
          text: item,
          origin: "document_artifact",
          sourceArtifactId: artifact.id,
          parentId: id,
          title: artifact.title,
          page: artifact.page,
          depth: 1,
          answerabilityScore: artifact.answerabilityScore,
          metadata: { itemIndex },
        });
        edges.push({ fromId: id, toId: itemId, relation: artifact.kind === "procedure" ? "has_step" : "has_item" });
      }
    }
  }

  for (const [structuredIndex, structuredArtifact] of (parsed.structuredArtifacts ?? []).entries()) {
    const sourceArtifactId = structuredParentArtifactId(structuredArtifact);
    let parentId = sourceArtifactId ? documentNodeBySourceId.get(sourceArtifactId) : undefined;
    if (!parentId) {
      orphanStructuredArtifactCount += 1;
      parentId = addNode({
        id: structuredRootId(structuredArtifact, structuredIndex),
        kind: structuredArtifact.kind,
        text: structuredArtifact.kind === "table"
          ? structuredTableToPlainText(structuredArtifact)
          : structuredArtifact.kind === "key_value"
            ? `${structuredArtifact.key}: ${structuredArtifact.value}`
            : structuredArtifact.text,
        origin: "structured_artifact",
        sourceArtifactId,
        title: structuredArtifact.kind === "table" ? structuredArtifact.title : undefined,
        page: structuredArtifact.page,
        depth: 0,
        confidence: structuredArtifact.kind === "table" ? undefined : structuredArtifact.confidence,
        provenance: structuredProvenance(structuredArtifact),
      });
      rootIds.push(parentId);
    }

    if (structuredArtifact.kind === "table") {
      addTableChildren(structuredArtifact, parentId, addNode, edges);
      continue;
    }

    if (structuredArtifact.kind === "key_value" && documentNodeBySourceId.has(structuredArtifact.provenance?.artifactId ?? "")) {
      const valueId = addNode({
        id: `${parentId}:key_value:${structuredIndex + 1}`,
        kind: "key_value",
        text: `${structuredArtifact.key}: ${structuredArtifact.value}`,
        origin: "structured_artifact",
        sourceArtifactId,
        parentId,
        page: structuredArtifact.page,
        depth: 1,
        confidence: structuredArtifact.confidence,
        provenance: structuredProvenance(structuredArtifact),
      });
      edges.push({ fromId: parentId, toId: valueId, relation: "contains" });
    }
  }

  const kindCounts = nodes.reduce<Partial<Record<CanonicalArtifactKind, number>>>((counts, node) => {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
    return counts;
  }, {});
  const warnings = [
    ...(orphanStructuredArtifactCount > 0 ? ["orphan_structured_artifacts"] : []),
    ...(duplicateArtifactIdCount > 0 ? ["duplicate_artifact_ids"] : []),
  ];

  return {
    version: 2,
    documentSchemaVersion: parsed.schemaVersion,
    parserId: parsed.parserRun.id,
    nodes,
    edges,
    rootIds,
    diagnostics: {
      inputArtifactCount: parsed.artifacts.length,
      structuredArtifactCount: parsed.structuredArtifacts?.length ?? 0,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      rootCount: rootIds.length,
      orphanStructuredArtifactCount,
      duplicateArtifactIdCount,
      kindCounts,
      warnings,
    },
  };
}
