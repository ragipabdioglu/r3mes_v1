import { describe, expect, it } from "vitest";

import { adaptKnowledgeChunkDraftsToV2 } from "./knowledgeChunkV2.js";
import type { KnowledgeChunkDraft } from "./knowledgeText.js";

describe("adaptKnowledgeChunkDraftsToV2", () => {
  it("creates a backward-compatible V2 view without transforming chunk content", () => {
    const input: KnowledgeChunkDraft[] = [
      {
        chunkIndex: 0,
        content: "A measured claim with its supporting context.",
        tokenCount: 11,
        artifactId: "artifact-1",
        artifactKind: "paragraph",
        artifactSplitIndex: 0,
        sectionTitle: "Overview",
        pageNumber: 2,
        answerabilityScore: 81,
      },
    ];

    const result = adaptKnowledgeChunkDraftsToV2(input, {
      collectionId: "collection-1",
      documentId: "document-1",
      sourceType: "PDF",
      filename: "source.pdf",
    });

    expect(result.chunks[0]).toMatchObject({
      schemaVersion: 2,
      content: input[0]?.content,
      embeddingText: input[0]?.content,
      rerankText: input[0]?.content,
      evidenceText: input[0]?.content,
      chunkKind: "paragraph",
      splitReason: "artifact_boundary",
      source: {
        collectionId: "collection-1",
        documentId: "document-1",
        sourceType: "PDF",
        filename: "source.pdf",
        artifactId: "artifact-1",
        artifactKind: "paragraph",
        sectionTitle: "Overview",
        pageNumber: 2,
      },
      integrityWarnings: [],
    });
    expect(input[0]).not.toHaveProperty("schemaVersion");
    expect(result.diagnostics).toMatchObject({
      runtimeBehaviorChanged: false,
      sourceChunkCount: 1,
      adaptedChunkCount: 1,
      artifactBackedChunkCount: 1,
      untypedTextChunkCount: 0,
      splitContinuationCount: 0,
      kindCounts: { paragraph: 1 },
      warnings: [],
    });
  });

  it("reports artifact continuations while preserving each split content exactly", () => {
    const input: KnowledgeChunkDraft[] = [
      {
        chunkIndex: 0,
        content: "Header | Value\nA | 1",
        tokenCount: 6,
        artifactId: "artifact-table",
        artifactKind: "table",
        artifactSplitIndex: 0,
      },
      {
        chunkIndex: 1,
        content: "Header | Value\nB | 2",
        tokenCount: 6,
        artifactId: "artifact-table",
        artifactKind: "table",
        artifactSplitIndex: 1,
      },
    ];

    const result = adaptKnowledgeChunkDraftsToV2(input);

    expect(result.chunks.map((chunk) => chunk.content)).toEqual(input.map((chunk) => chunk.content));
    expect(result.chunks.map((chunk) => chunk.splitReason)).toEqual([
      "artifact_boundary",
      "artifact_continuation",
    ]);
    expect(result.diagnostics).toMatchObject({
      artifactBackedChunkCount: 2,
      splitContinuationCount: 1,
      kindCounts: { table: 2 },
      integrity: { contiguousIndexes: true },
    });
  });

  it("keeps legacy text chunks valid and identifies untyped baseline usage", () => {
    const result = adaptKnowledgeChunkDraftsToV2([
      {
        chunkIndex: 0,
        content: "A plain legacy content segment.",
        tokenCount: 8,
      },
    ]);

    expect(result.chunks[0]).toMatchObject({
      chunkKind: "untyped_text",
      splitReason: "legacy_text_chunk",
      integrityWarnings: [],
    });
    expect(result.diagnostics).toMatchObject({
      artifactBackedChunkCount: 0,
      untypedTextChunkCount: 1,
      kindCounts: { untyped_text: 1 },
    });
  });

  it("surfaces integrity warnings without repairing or dropping draft data", () => {
    const input: KnowledgeChunkDraft[] = [
      {
        chunkIndex: 2,
        content: "",
        tokenCount: 0,
        artifactSplitIndex: 1,
      },
      {
        chunkIndex: 2,
        content: "Partial artifact reference.",
        tokenCount: 4,
        artifactId: "artifact-partial",
      },
    ];

    const result = adaptKnowledgeChunkDraftsToV2(input);

    expect(result.chunks[0]?.content).toBe("");
    expect(result.chunks[0]?.integrityWarnings).toEqual(
      expect.arrayContaining([
        "empty_content",
        "invalid_token_count",
        "duplicate_chunk_index",
        "non_contiguous_chunk_index",
        "orphan_artifact_split_index",
      ]),
    );
    expect(result.chunks[1]?.integrityWarnings).toEqual(
      expect.arrayContaining([
        "duplicate_chunk_index",
        "non_contiguous_chunk_index",
        "artifact_reference_incomplete",
        "artifact_split_index_missing",
      ]),
    );
    expect(result.diagnostics.integrity).toMatchObject({
      contiguousIndexes: false,
      emptyContentCount: 1,
      invalidTokenCount: 1,
      warningCounts: {
        empty_content: 1,
        invalid_token_count: 1,
        duplicate_chunk_index: 2,
        non_contiguous_chunk_index: 2,
        artifact_reference_incomplete: 1,
        artifact_split_index_missing: 1,
        orphan_artifact_split_index: 1,
      },
    });
  });
});
