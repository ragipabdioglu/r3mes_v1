import { describe, expect, it, vi } from "vitest";

import {
  alignHybridKnowledgeCandidates,
  buildPrunedEvidenceInput,
  buildPrunedEvidenceInputWithDiagnostics,
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
  embedTextForQdrantWithDiagnostics: vi.fn(async () => ({
    vector: [0, 1, 0],
    diagnostics: {
      requestedProvider: "deterministic",
      actualProvider: "deterministic",
      fallbackUsed: false,
      dimension: 3,
    },
  })),
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
    expect(result.diagnostics.qdrantEmbedding).toMatchObject({
      requestedProvider: "deterministic",
      actualProvider: "deterministic",
      fallbackUsed: false,
      dimension: 3,
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

  it("prunes evidence input to query-relevant structured facts before extraction", () => {
    vi.stubEnv("R3MES_EVIDENCE_FAST_MAX_CHARS", "260");
    const result = buildPrunedEvidenceInputWithDiagnostics({
      query: "Production migration öncesi yedek ve rollback için ne kontrol edilmeli?",
      budgetMode: "fast_grounded",
      candidate: candidate({
        id: "migration-long",
        title: "migration güvenliği",
        content: [
          "Topic: migration güvenliği",
          "Tags: technical, migration, yedek, rollback",
          "Source Summary: Production migration öncesinde yedek alınmalı ve rollback planı hazırlanmalıdır.",
          "Key Takeaway: Staging ortamında deneme, log kontrolü ve geri dönüş planı net olmalıdır.",
          "Red Flags: Yedeksiz işlem ve belirsiz rollback yüksek risklidir.",
          "Bu paragraf alakasız bakım penceresi ayrıntılarıyla çok uzundur ve modele gereksiz ham doküman taşımamalıdır.".repeat(12),
        ].join("\n"),
      }),
    });
    const input = result.text;

    expect(input.length).toBeLessThanOrEqual(260);
    expect(input).toContain("yedek");
    expect(input).toContain("rollback");
    expect(input).not.toContain("alakasız bakım");
    expect(result.diagnostics.mode).toBe("pruned");
    expect(result.diagnostics.selectedSentenceCount).toBeGreaterThan(0);
    expect(result.diagnostics.droppedSentenceCount).toBeGreaterThan(0);
  });

  it("does not expand already-small evidence chunks while pruning", () => {
    const raw = "Topic: migration\nTags: technical, migration\nYedek ve rollback planı kontrol edilmelidir.";
    const input = buildPrunedEvidenceInput({
      query: "migration öncesi yedek?",
      budgetMode: "fast_grounded",
      candidate: candidate({
        id: "small",
        title: "migration",
        content: raw,
      }),
    });

    expect(input).toBe(raw);
  });

  it("keeps query-matching numbered financial table rows while pruning", () => {
    vi.stubEnv("R3MES_EVIDENCE_FAST_MAX_CHARS", "520");
    const result = buildPrunedEvidenceInputWithDiagnostics({
      query: "Dönem kârı ve net dönem kârı kaç?",
      budgetMode: "fast_grounded",
      candidate: candidate({
        id: "kap-table",
        title: "KCHOL kar payı dağıtım tablosu",
        content:
          "Source Summary: SPK'ya Göre Yasal Kayıtlara Göre 1. Ödenmiş Sermaye 7.000.000.000 5.762.623.738 2. Genel Kanuni Yedek Akçe 3.112.991.000 3. Dönem Kârı 87.713.503.000,00 44.999.997.398,02 4. Vergiler 65.713.002.000,00 1.787.670.432,02 5. Net Dönem Kârı (=) 22.000.501.000,00 43.212.326.966,00 8. NET DAĞITILABİLİR DÖNEM KÂRI (=) 22.000.501.000,00 43.212.326.966,00 " +
          "Bu dipnot alakasız genel kurul açıklamaları, dağıtım takvimi ve prosedür metniyle uzar. ".repeat(12),
      }),
    });

    expect(result.text).toContain("3. Dönem Kârı");
    expect(result.text).toContain("87.713.503.000");
    expect(result.text).toContain("5. Net Dönem Kârı");
    expect(result.text).toContain("22.000.501.000");
    expect(result.diagnostics.mode).toBe("pruned");
  });

  it("diversifies multilingual disclosure sources by document language and dedupes citations", async () => {
    vi.stubEnv("R3MES_RERANKER_MODE", "deterministic");
    vi.stubEnv("R3MES_RAG_MIN_RERANK_SCORE", "0.1");
    vi.stubEnv("R3MES_RAG_RELATIVE_SCORE_FLOOR", "0.1");
    const collectionId = "multi-kap-test";
    const docs = [
      {
        id: "en-1",
        documentId: "eregl-1576833-en",
        chunkIndex: 0,
        content: "Topic: EREGL 1576833 Profit Distribution Table\nTags: eregl, 1576833, english\nSource Summary: Profit distribution table.",
        tokenCount: 20,
        autoMetadata: { domain: "finance", keywords: ["EREGL", "1576833", "profit", "distribution"] },
        document: {
          title: "EREGL 1576833 Kar Payı Dağıtım İşlemlerine İlişkin Bildirim Erdemir 2025 Profit Distribution Table.pdf",
          collectionId,
          autoMetadata: { domain: "finance", keywords: ["EREGL", "1576833", "english"] },
        },
        embedding: { values: [] },
      },
      {
        id: "en-2",
        documentId: "eregl-1576833-en",
        chunkIndex: 1,
        content: "Topic: EREGL 1576833 Profit Distribution Table\nTags: eregl, 1576833, english\nSource Summary: Net Profit for the Period.",
        tokenCount: 20,
        autoMetadata: { domain: "finance", keywords: ["EREGL", "1576833", "profit"] },
        document: {
          title: "EREGL 1576833 Kar Payı Dağıtım İşlemlerine İlişkin Bildirim Erdemir 2025 Profit Distribution Table.pdf",
          collectionId,
          autoMetadata: { domain: "finance", keywords: ["EREGL", "1576833", "english"] },
        },
        embedding: { values: [] },
      },
      {
        id: "tr-1",
        documentId: "eregl-1576833-tr",
        chunkIndex: 0,
        content: "Topic: EREGL 1576833 Kar Payı Dağıtım Tablosu\nTags: eregl, 1576833, turkce\nSource Summary: Kar payı dağıtım tablosu.",
        tokenCount: 20,
        autoMetadata: { domain: "finance", keywords: ["EREGL", "1576833", "kar", "payı"] },
        document: {
          title: "EREGL 1576833 Kar Payı Dağıtım İşlemlerine İlişkin Bildirim Erdemir 2025 Yılı Kar Dağıtım Tablosu.pdf",
          collectionId,
          autoMetadata: { domain: "finance", keywords: ["EREGL", "1576833", "turkce"] },
        },
        embedding: { values: [] },
      },
    ];
    const findMany = vi.spyOn(prisma.knowledgeChunk, "findMany").mockResolvedValue(docs as never);
    const qdrant = vi.mocked(searchQdrantKnowledge).mockResolvedValue([]);
    const query =
      "EREGL 1576833 için Türkçe kar dağıtım tablosu ile İngilizce profit distribution table aynı bildirim indeksine mi ait?";
    const result = await retrieveKnowledgeContextTrueHybrid({
      query,
      evidenceQuery: query,
      accessibleCollectionIds: [collectionId],
      limit: 3,
      budgetMode: "deep_rag",
    });

    const titles = result.sources.map((source) => source.title).join(" ");
    expect(result.sources.length).toBeLessThanOrEqual(3);
    expect(titles).toContain("1576833");
    expect(titles).toContain("Kar Payı Dağıtım");
    expect(titles).toContain("Profit Distribution");
    findMany.mockRestore();
    qdrant.mockRestore();
  });

  it("keeps pruning diagnostics generic for noisy mixed-domain evidence", () => {
    vi.stubEnv("R3MES_EVIDENCE_FAST_MAX_CHARS", "240");
    const result = buildPrunedEvidenceInputWithDiagnostics({
      query: "Velayet ve nafaka için boşanma protokolünde ne kontrol edilmeli?",
      budgetMode: "fast_grounded",
      candidate: candidate({
        id: "legal-mixed",
        title: "hukuk karışık notlar",
        content: [
          "Topic: boşanma protokolü",
          "Tags: legal, velayet, nafaka, protokol",
          "Source Summary: Anlaşmalı boşanmada velayet, nafaka ve protokol maddeleri net yazılmalıdır.",
          "Key Takeaway: Tarafların anlaşması, çocuğun yararı ve ödeme düzeni kaynakta birlikte değerlendirilir.",
          "Bu teknik not migration rollback ve log izleme hakkındadır.".repeat(8),
          "Bu sağlık notu kasık ağrısı ve smear takibi hakkındadır.".repeat(8),
        ].join("\n"),
      }),
    });

    expect(result.text).toContain("velayet");
    expect(result.text).toContain("nafaka");
    expect(result.text).not.toContain("migration rollback");
    expect(result.text).not.toContain("kasık ağrısı");
    expect(result.diagnostics.droppedSentenceCount).toBeGreaterThan(0);
  });
});
