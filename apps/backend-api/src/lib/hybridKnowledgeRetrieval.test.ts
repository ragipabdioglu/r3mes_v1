import { describe, expect, it, vi } from "vitest";

import {
  candidateMatchesRouteScope,
  dedupeHybridKnowledgeCandidates,
  preRankHybridKnowledgeCandidates,
  retrieveKnowledgeContextTrueHybrid,
  type HybridKnowledgeCandidate,
} from "./hybridKnowledgeRetrieval.js";
import { prisma } from "./prisma.js";
import { searchQdrantKnowledge } from "./qdrantStore.js";

vi.mock("./qdrantStore.js", () => ({
  searchQdrantKnowledge: vi.fn(),
}));

vi.mock("./qdrantEmbedding.js", () => ({
  embedTextForQdrant: vi.fn(async () => [0, 1, 0]),
}));

function candidate(overrides: Partial<HybridKnowledgeCandidate> & {
  id: string;
  documentId?: string;
  content: string;
  title?: string;
  sources?: Array<"qdrant" | "prisma">;
}): HybridKnowledgeCandidate {
  return {
    chunk: {
      id: overrides.id,
      documentId: overrides.documentId ?? `doc-${overrides.id}`,
      chunkIndex: 0,
      content: overrides.content,
      document: {
        title: overrides.title ?? `title-${overrides.id}`,
        collectionId: "kc-1",
      },
      embedding: null,
    },
    card: {
      topic: overrides.title ?? `topic-${overrides.id}`,
      tags: [],
      patientSummary: overrides.content,
      clinicalTakeaway: overrides.content,
      safeGuidance: "",
      redFlags: "",
      doNotInfer: "",
    },
    sources: overrides.sources ?? ["prisma"],
    vectorScore: overrides.vectorScore,
    lexicalScore: overrides.lexicalScore,
    preRankScore: overrides.preRankScore ?? 0,
  };
}

describe("true hybrid retrieval helpers", () => {
  it("dedupes matching chunks while preserving producer provenance", () => {
    const deduped = dedupeHybridKnowledgeCandidates([
      candidate({
        id: "chunk-1",
        documentId: "doc-1",
        content: "Migration öncesi yedek alınmalı ve rollback planı hazırlanmalıdır.",
        sources: ["qdrant"],
        vectorScore: 0.8,
      }),
      candidate({
        id: "chunk-1",
        documentId: "doc-1",
        content: "Migration öncesi yedek alınmalı ve rollback planı hazırlanmalıdır.",
        sources: ["prisma"],
        lexicalScore: 3.2,
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.sources.sort()).toEqual(["prisma", "qdrant"]);
    expect(deduped[0]?.vectorScore).toBe(0.8);
    expect(deduped[0]?.lexicalScore).toBe(3.2);
  });

  it("returns no context instead of falling back to unrelated raw candidates under strict route scope", async () => {
    const findMany = vi.spyOn(prisma.knowledgeChunk, "findMany").mockResolvedValue([
      {
        id: "gyn-1",
        documentId: "doc-gyn",
        chunkIndex: 0,
        content: "Topic: kasık ağrısı\nTags: medical, kasik_agrisi, smear\nJinekoloji kasık ağrısı notu.",
        tokenCount: 10,
        autoMetadata: {
          domain: "medical",
          subtopics: ["kasik_agrisi", "smear"],
          keywords: ["jinekoloji", "kasık", "smear"],
        },
        document: {
          title: "gyn",
          collectionId: "col-gyn",
          autoMetadata: {
            domain: "medical",
            subtopics: ["kasik_agrisi"],
            keywords: ["jinekoloji"],
          },
        },
        embedding: { values: [] },
      },
    ] as never);
    const qdrant = vi.mocked(searchQdrantKnowledge).mockResolvedValue([
      {
        id: "q1",
        score: 0.95,
        payload: {
          ownerWallet: "0x1",
          visibility: "PRIVATE",
          collectionId: "col-gyn",
          documentId: "doc-gyn",
          chunkId: "gyn-1",
          chunkIndex: 0,
          title: "gyn",
          domain: "medical",
          subtopics: ["kasik_agrisi"],
          tags: ["medical", "jinekoloji", "kasık"],
          content: "Topic: kasık ağrısı\nTags: medical, kasik_agrisi\nJinekoloji kasık ağrısı notu.",
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    const result = await retrieveKnowledgeContextTrueHybrid({
      query: "Bebeğim çok terliyor neden olabilir?",
      accessibleCollectionIds: ["col-gyn"],
      routePlan: {
        domain: "medical",
        subtopics: ["pediatri_terleme"],
        riskLevel: "medium",
        retrievalHints: ["bebek terlemesi", "ateş kontrolü"],
        mustIncludeTerms: ["bebek", "terleme", "ateş", "çocuk doktoru"],
        mustExcludeTerms: [],
        confidence: "high",
      },
    });

    expect(result.contextText).toBe("");
    expect(result.sources).toEqual([]);
    expect(result.lowGroundingConfidence).toBe(true);

    findMany.mockRestore();
    qdrant.mockRestore();
  });

  it("requires subtopic metadata support when route is specific", () => {
    const routePlan = {
      domain: "medical" as const,
      subtopics: ["pediatri_terleme"],
      riskLevel: "medium" as const,
      retrievalHints: ["bebek terlemesi", "ateş kontrolü"],
      mustIncludeTerms: ["bebek", "terleme", "ateş", "çocuk doktoru"],
      mustExcludeTerms: [],
      confidence: "high" as const,
    };
    const gyn = candidate({
      id: "gyn-1",
      title: "jinekoloji kasık ağrısı",
      content: "Kasık ağrısı ve smear takibi jinekoloji değerlendirmesiyle ele alınır.",
    });
    gyn.chunk.autoMetadata = {
      domain: "medical",
      subtopics: ["kasik_agrisi", "smear"],
      keywords: ["jinekoloji", "kasık", "smear"],
    };
    const pediatric = candidate({
      id: "ped-1",
      title: "bebek terlemesi",
      content: "Bebeklerde terleme ateş ve oda sıcaklığı ile birlikte değerlendirilir.",
    });
    pediatric.chunk.autoMetadata = {
      domain: "medical",
      subtopics: ["pediatri_terleme"],
      keywords: ["bebek", "terleme", "ateş"],
    };

    expect(candidateMatchesRouteScope(gyn.card, gyn.chunk, routePlan)).toBe(false);
    expect(candidateMatchesRouteScope(pediatric.card, pediatric.chunk, routePlan)).toBe(true);
  });

  it("pre-ranks by query/route relevance before expensive model rerank", () => {
    const ranked = preRankHybridKnowledgeCandidates({
      query: "Production veritabanında migration çalıştırmadan önce ne yapmalıyım?",
      limit: 2,
      routePlan: {
        domain: "technical",
        subtopics: ["migration"],
        riskLevel: "high",
        retrievalHints: ["veritabanı migration", "yedek rollback staging"],
        mustIncludeTerms: ["migration", "yedek", "rollback", "staging", "log"],
        mustExcludeTerms: [],
        confidence: "high",
      },
      candidates: [
        candidate({
          id: "tech-1",
          title: "migration güvenliği",
          content: "Production migration öncesinde yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
          sources: ["qdrant", "prisma"],
        }),
        candidate({
          id: "legal-1",
          title: "kira depozitosu",
          content: "Kira depozitosu için yazışmalar ve belgeler saklanmalıdır.",
        }),
        candidate({
          id: "tech-2",
          title: "deploy log kontrolü",
          content: "Deploy sırasında log kontrolü yapılmalı ve küçük doğrulanabilir adımlarla ilerlenmelidir.",
        }),
      ],
    });

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.chunk.id).toBe("tech-1");
    expect(ranked.map((item) => item.chunk.id)).not.toContain("legal-1");
  });
});
