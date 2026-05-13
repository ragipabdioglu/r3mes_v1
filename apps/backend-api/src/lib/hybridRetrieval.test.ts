import { afterEach, describe, expect, it } from "vitest";

import { rankHybridCandidates } from "./hybridRetrieval.js";
import { embedKnowledgeText } from "./knowledgeEmbedding.js";

describe("hybrid retrieval scoring", () => {
  afterEach(() => {
    delete process.env.R3MES_HYBRID_LEXICAL_WEIGHT;
    delete process.env.R3MES_HYBRID_EMBEDDING_WEIGHT;
  });

  it("uses decision-config weights for fused candidate scoring", () => {
    process.env.R3MES_HYBRID_LEXICAL_WEIGHT = "1";
    process.env.R3MES_HYBRID_EMBEDDING_WEIGHT = "0";

    const [candidate] = rankHybridCandidates("production migration rollback", [
      {
        content: "Production migration öncesi rollback planı ve yedek kontrolü yapılır.",
        embedding: { values: embedKnowledgeText("Production migration rollback planı") },
      },
    ]);

    expect(candidate?.fusedScore).toBeCloseTo(candidate?.lexicalScore ?? 0);
  });

  it("can prefer embedding-only scoring without code changes", () => {
    process.env.R3MES_HYBRID_LEXICAL_WEIGHT = "0";
    process.env.R3MES_HYBRID_EMBEDDING_WEIGHT = "1";

    const [candidate] = rankHybridCandidates("production migration rollback", [
      {
        content: "Bu metin kasıtlı olarak kısa tutuldu.",
        embedding: { values: embedKnowledgeText("Production migration rollback planı") },
      },
    ]);

    expect(candidate?.fusedScore).toBeCloseTo(candidate?.embeddingScore ?? 0);
  });
});
