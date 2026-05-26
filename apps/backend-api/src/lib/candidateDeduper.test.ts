import { describe, expect, it } from "vitest";

import { dedupeCandidatesIdentitySafe } from "./candidateDeduper.js";
import type { HybridKnowledgeCandidate } from "./hybridKnowledgeRetrieval.js";

function candidate(input: {
  id: string;
  documentId: string;
  chunkIndex?: number;
  content?: string;
  sources: HybridKnowledgeCandidate["sources"];
  vectorScore?: number;
  lexicalScore?: number;
}): HybridKnowledgeCandidate {
  return {
    chunk: {
      id: input.id,
      documentId: input.documentId,
      chunkIndex: input.chunkIndex ?? 0,
      content: input.content ?? "Shared normalized content.",
      document: { title: input.documentId, collectionId: "collection-1" },
    },
    card: {
      topic: "generic",
      tags: [],
      patientSummary: "",
      clinicalTakeaway: "",
      safeGuidance: "",
      redFlags: "",
      doNotInfer: "",
    },
    sources: input.sources,
    vectorScore: input.vectorScore,
    lexicalScore: input.lexicalScore,
    preRankScore: 1,
  };
}

describe("identity-safe candidate deduplication", () => {
  it("merges qdrant and prisma candidates for the exact same chunk and preserves sources", () => {
    const result = dedupeCandidatesIdentitySafe([
      candidate({ id: "chunk-1", documentId: "doc-1", sources: ["qdrant"], vectorScore: 0.8 }),
      candidate({ id: "chunk-1", documentId: "doc-1", sources: ["prisma"], lexicalScore: 3.2 }),
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sources.sort()).toEqual(["prisma", "qdrant"]);
    expect(result.candidates[0]?.vectorScore).toBe(0.8);
    expect(result.candidates[0]?.lexicalScore).toBe(3.2);
    expect(result.diagnostics.merges[0]).toMatchObject({ rule: "exact_chunk_identity", documentId: "doc-1" });
  });

  it("keeps identical normalized content from different documents distinct", () => {
    const result = dedupeCandidatesIdentitySafe([
      candidate({ id: "chunk-a", documentId: "doc-a", sources: ["qdrant"] }),
      candidate({ id: "chunk-b", documentId: "doc-b", sources: ["prisma"], content: " shared NORMALIZED content. " }),
    ]);

    expect(result.candidates.map((item) => item.chunk.documentId)).toEqual(["doc-a", "doc-b"]);
    expect(result.diagnostics).toMatchObject({
      inputCandidateCount: 2,
      outputCandidateCount: 2,
      mergedCandidateCount: 0,
      merges: [],
    });
  });

  it("merges identical normalized content within one document with an explicit fallback reason", () => {
    const result = dedupeCandidatesIdentitySafe([
      candidate({ id: "chunk-1", documentId: "doc-1", chunkIndex: 0, sources: ["qdrant"] }),
      candidate({ id: "chunk-2", documentId: "doc-1", chunkIndex: 1, sources: ["prisma"], content: " SHARED normalized content. " }),
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      inputCandidateCount: 2,
      outputCandidateCount: 1,
      mergedCandidateCount: 1,
    });
    expect(result.diagnostics.merges[0]).toMatchObject({
      rule: "same_document_identical_content",
      retainedChunkId: "chunk-1",
      mergedChunkId: "chunk-2",
      documentId: "doc-1",
      reason: "Distinct chunks in the same document carry identical normalized content.",
      outputSources: ["qdrant", "prisma"],
    });
  });
});
