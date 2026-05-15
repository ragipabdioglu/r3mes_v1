import { describe, expect, it } from "vitest";

import {
  buildKnowledgeArtifactCreateManyInput,
  buildKnowledgeArtifactKey,
  buildKnowledgeArtifactPersistencePayloads,
  buildKnowledgeArtifactRowId,
  buildKnowledgeChunkCreateManyInput,
  buildKnowledgeDocumentVersionCreateInput,
} from "./knowledgeArtifactPersistence.js";
import type { KnowledgeChunkDraft, ParsedKnowledgeDocument } from "./knowledgeText.js";

function parsedFixture(overrides: Partial<ParsedKnowledgeDocument> = {}): ParsedKnowledgeDocument {
  return {
    sourceType: "PDF",
    text: "KAP financial table\nRevenue | 123",
    artifacts: [],
    parser: {
      id: "docling-v1",
      version: 3,
    },
    diagnostics: {
      originalBytes: 2048,
      normalizedChars: 33,
      warnings: [],
    },
    ...overrides,
  };
}

describe("knowledgeArtifactPersistence", () => {
  it("builds version, artifact, and chunk payloads with table provenance", () => {
    const documentId = "doc_1";
    const versionId = "ver_1";
    const parsed = parsedFixture({
      artifacts: [
        {
          id: "artifact-table-001",
          kind: "table",
          text: "| Metric | Value |\n| --- | --- |\n| Revenue | 123 |",
          title: "KAP financials",
          page: 7,
          level: null,
          metadata: {
            columns: ["Metric", "Value"],
            rowCount: 1,
            source: { sheet: "Summary" },
          },
          answerabilityScore: 84,
        },
      ],
    });
    const chunks: KnowledgeChunkDraft[] = [
      {
        chunkIndex: 0,
        content: "Revenue is 123.",
        tokenCount: 4,
        artifactId: "artifact-table-001",
        artifactKind: "table",
        artifactSplitIndex: 0,
      },
    ];

    const payloads = buildKnowledgeArtifactPersistencePayloads({
      documentId,
      versionId,
      version: 1,
      contentHash: "sha256:raw-file",
      parsed,
      chunks,
      metadata: { upload: "private" },
    });
    const expectedArtifactRowId = buildKnowledgeArtifactRowId({
      documentId,
      versionId,
      artifactId: "artifact-table-001",
    });
    const expectedArtifactKey = buildKnowledgeArtifactKey({
      documentId,
      versionId,
      artifactId: "artifact-table-001",
    });

    expect(payloads.version).toMatchObject({
      id: versionId,
      documentId,
      version: 1,
      versionIndex: 1,
      sourceType: "PDF",
      parserId: "docling-v1",
      parserVersion: 3,
      contentHash: "sha256:raw-file",
      originalBytes: 2048,
      normalizedChars: 33,
      metadata: { upload: "private" },
    });
    expect(payloads.version.textHash).toHaveLength(64);
    expect(payloads.artifacts).toEqual([
      {
        id: expectedArtifactRowId,
        documentId,
        versionId,
        artifactId: "artifact-table-001",
        artifactKey: expectedArtifactKey,
        ordinal: 0,
        kind: "table",
        page: 7,
        pageNumber: 7,
        title: "KAP financials",
        level: null,
        text: "| Metric | Value |\n| --- | --- |\n| Revenue | 123 |",
        answerabilityScore: 84,
        metadata: {
          columns: ["Metric", "Value"],
          rowCount: 1,
          source: { sheet: "Summary" },
        },
      },
    ]);
    expect(payloads.chunks).toEqual([
      {
        documentId,
        versionId,
        chunkIndex: 0,
        content: "Revenue is 123.",
        tokenCount: 4,
        artifactId: "artifact-table-001",
        artifactRowId: expectedArtifactRowId,
        artifactSplitIndex: 0,
      },
    ]);
  });

  it("preserves page artifact metadata without requiring a version id", () => {
    const documentId = "doc_2";
    const parsed = parsedFixture({
      sourceType: "DOCX",
      text: "Policy page text",
      artifacts: [
        {
          id: "artifact-page-12",
          kind: "paragraph",
          text: "Allowed overtime requires manager approval.",
          title: "Overtime Policy",
          page: 12,
          level: 2,
          items: ["manager approval"],
          metadata: {
            pageLabel: "12",
            boundingBox: { x: 10, y: 20, width: 300, height: 80 },
            ignored: undefined,
          },
          answerabilityScore: 68,
        },
      ],
    });
    const chunks: KnowledgeChunkDraft[] = [
      {
        chunkIndex: 4,
        content: "Allowed overtime requires manager approval.",
        tokenCount: 6,
        artifactId: "artifact-page-12",
        artifactKind: "paragraph",
        artifactSplitIndex: 1,
        pageNumber: 12,
        sectionTitle: "Overtime Policy",
      },
    ];

    const artifacts = buildKnowledgeArtifactCreateManyInput({ documentId, parsed });
    const chunkPayloads = buildKnowledgeChunkCreateManyInput({ documentId, chunks });
    const expectedArtifactRowId = buildKnowledgeArtifactRowId({
      documentId,
      artifactId: "artifact-page-12",
    });
    const expectedArtifactKey = buildKnowledgeArtifactKey({
      documentId,
      artifactId: "artifact-page-12",
    });

    expect(artifacts[0]).toMatchObject({
      id: expectedArtifactRowId,
      documentId,
      artifactId: "artifact-page-12",
      artifactKey: expectedArtifactKey,
      ordinal: 0,
      kind: "paragraph",
      page: 12,
      pageNumber: 12,
      title: "Overtime Policy",
      level: 2,
      text: "Allowed overtime requires manager approval.",
      answerabilityScore: 68,
      metadata: {
        pageLabel: "12",
        boundingBox: { x: 10, y: 20, width: 300, height: 80 },
        items: ["manager approval"],
      },
    });
    expect(artifacts[0]).not.toHaveProperty("versionId");
    expect(chunkPayloads[0]).toMatchObject({
      documentId,
      chunkIndex: 4,
      artifactId: "artifact-page-12",
      artifactRowId: expectedArtifactRowId,
      artifactSplitIndex: 1,
    });
    expect(chunkPayloads[0]).not.toHaveProperty("versionId");
  });

  it("rejects invalid version numbers before Prisma writes", () => {
    expect(() => buildKnowledgeDocumentVersionCreateInput({
      documentId: "doc_3",
      version: 0,
      parsed: parsedFixture(),
    })).toThrow("positive integer");
  });
});
