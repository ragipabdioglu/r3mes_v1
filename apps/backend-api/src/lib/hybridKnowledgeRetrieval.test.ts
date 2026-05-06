import { describe, expect, it, vi } from "vitest";

import {
  alignHybridKnowledgeCandidates,
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
    expect(result.diagnostics.budget).toMatchObject({
      budgetMode: "normal_rag",
      requestedSourceLimit: 3,
      finalSourceLimit: 3,
      finalSourceCount: 0,
      evidenceUsableFactLimit: expect.any(Number),
    });

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

  it("drops chunks with explicit card domain tags that contradict the query route", () => {
    const routePlan = {
      domain: "technical" as const,
      subtopics: ["migration"],
      riskLevel: "high" as const,
      retrievalHints: ["veritabanı migration", "yedek rollback staging"],
      mustIncludeTerms: ["migration", "yedek", "rollback", "staging"],
      mustExcludeTerms: [],
      confidence: "high" as const,
    };
    const legal = candidate({
      id: "legal-rent",
      title: "kira depozitosu",
      content: "Kira depozitosu için yazılı başvuru ve belgeler saklanmalıdır.",
    });
    legal.card.tags = ["legal", "kira", "depozito"];
    legal.chunk.autoMetadata = {
      domain: "technical",
      subtopics: ["migration"],
      keywords: ["yedek", "rollback", "staging"],
    };

    expect(candidateMatchesRouteScope(legal.card, legal.chunk, routePlan)).toBe(false);
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

  it("records caller-provided retrieval budget mode in diagnostics", async () => {
    const result = await retrieveKnowledgeContextTrueHybrid({
      query: "test",
      accessibleCollectionIds: [],
      limit: 2,
      budgetMode: "fast_grounded",
      routePlan: null,
    });

    expect(result.diagnostics.budget).toMatchObject({
      budgetMode: "fast_grounded",
      requestedSourceLimit: 2,
      finalSourceLimit: 2,
    });
  });

  it("drops same-domain wrong-topic candidates before evidence extraction", () => {
    vi.stubEnv("R3MES_ALIGNMENT_MIN_SCORE", "0.34");
    vi.stubEnv("R3MES_ALIGNMENT_WEAK_SCORE", "0.5");
    const routePlan = {
      domain: "medical" as const,
      subtopics: [],
      riskLevel: "medium" as const,
      retrievalHints: ["ağrı değerlendirmesi"],
      mustIncludeTerms: ["ağrı"],
      mustExcludeTerms: [],
      confidence: "medium" as const,
    };
    const result = alignHybridKnowledgeCandidates({
      query: "Başım ağrıyor, ne yapmalıyım?",
      routePlan,
      candidates: [
        candidate({
          id: "abdominal-pain",
          title: "karın ağrısı genel triyaj",
          content: "Karın ağrısı, mide ve göbek bölgesi şikayetlerinde ateş ve kusma değerlendirilir.",
        }),
        candidate({
          id: "headache",
          title: "baş ağrısı genel triyaj",
          content: "Baş ağrısı şiddeti, süresi, ateş ve nörolojik bulgularla birlikte değerlendirilir.",
        }),
      ],
    });

    expect(result.candidates.map((item) => item.chunk.id)).toEqual(["headache"]);
    expect(result.diagnostics.droppedCandidateCount).toBe(1);
    expect(result.diagnostics.fastFailed).toBe(false);
  });

  it("fast-fails when every retrieved candidate only matches generic terms", () => {
    vi.stubEnv("R3MES_ALIGNMENT_FAST_FAIL_ENABLED", "1");
    const result = alignHybridKnowledgeCandidates({
      query: "Başım ağrıyor, ne yapmalıyım?",
      candidates: [
        candidate({
          id: "abdominal-pain",
          title: "karın ağrısı genel triyaj",
          content: "Karın ağrısı, mide ve göbek bölgesi şikayetlerinde ateş ve kusma değerlendirilir.",
        }),
        candidate({
          id: "pelvic-pain",
          title: "kasık ağrısı genel triyaj",
          content: "Kasık ağrısı ve pelvik ağrı yakınmasında kanama ve ateş değerlendirilir.",
        }),
      ],
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.fastFailed).toBe(true);
    expect(result.diagnostics.mismatchCandidateCount).toBe(2);
  });

  it("drops weak same-domain candidates when the route has a specific high-confidence subtopic", () => {
    vi.stubEnv("R3MES_ALIGNMENT_MIN_SCORE", "0.34");
    vi.stubEnv("R3MES_ALIGNMENT_WEAK_SCORE", "0.5");
    const result = alignHybridKnowledgeCandidates({
      query: "Trafik cezasına itiraz süresini kaçırmamak için hangi tarihe ve belgelere bakmalıyım?",
      routePlan: {
        domain: "legal",
        subtopics: ["trafik"],
        riskLevel: "medium",
        retrievalHints: ["trafik cezası itiraz", "süre ve belge"],
        mustIncludeTerms: ["trafik", "ceza", "itiraz", "süre", "belge"],
        mustExcludeTerms: [],
        confidence: "high",
      },
      candidates: [
        candidate({
          id: "divorce-protocol",
          title: "anlaşmalı boşanma protokolü",
          content:
            "Anlaşmalı boşanma protokolünde velayet, nafaka, mal paylaşımı, belge ve kısa süreli mahkeme tarihi değerlendirilir.",
        }),
      ],
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.fastFailed).toBe(true);
    expect(result.diagnostics.droppedCandidateCount).toBe(1);
  });
});
