import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkKnowledgeText } from "./knowledgeText.js";
import {
  buildLexicalCorpusStats,
  scoreLexicalMatch,
  retrieveKnowledgeContext,
} from "./knowledgeRetrieval.js";
import { prisma } from "./prisma.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chunkKnowledgeText", () => {
  it("keeps generated doctor markdown records as separate chunks", () => {
    const markdown = `
# Doktor bilgi paketi: aile-hekimligi

Bu dosya R3MES RAG knowledge yuklemesi icin uretildi. Uzmanlik: aile-hekimligi.

## Kayıt 1
Doktor unvanı: Uzm. Dr.
Uzmanlık: aile-hekimligi

Soru:
cocuklarda bogaz agrisi icin ne yapmaliyim

Yanıt:
once muayene, sonra uygun tedavi planlanmali.

## Kayıt 2
Doktor unvanı: Uzm. Dr.
Uzmanlık: aile-hekimligi

Soru:
hamilelikte demir ilaci ne zaman kullanilir

Yanıt:
takip eden hekimin önerisi ile kullanilmalidir.
`.trim();

    const chunks = chunkKnowledgeText(markdown, 220);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toContain("## Kayıt 1");
    expect(chunks[0]?.content).not.toContain("## Kayıt 2");
    expect(chunks[1]?.content).toContain("## Kayıt 2");
  });

  it("preserves record header and metadata when a single record must be split", () => {
    const markdown = `
## Kayıt 1
Doktor unvanı: Op. Dr.
Uzmanlık: jinekolojik-onkoloji

Soru:
rahim agzi kanseri tedavisi sonrasinda takip suresi ve kontrol sikligi hakkinda ayrintili bilgi almak istiyorum ve belirtiler tekrar ederse hangi durumda acil basvurmam gerektigini ogrenmek istiyorum.

Yanıt:
takip plani hastanin evresi ve uygulanan tedaviye gore degisir, ancak yeni kanama, siddetli agrı ve hizli genel durum bozulmasi durumunda gecikmeden tekrar degerlendirme gerekir.
`.trim();

    const chunks = chunkKnowledgeText(markdown, 210);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain("## Kayıt 1");
      expect(chunk.content).toContain("Uzmanlık: jinekolojik-onkoloji");
    }
  });
});

describe("scoreLexicalMatch", () => {
  it("prefers exact medical phrase matches over loose token overlap", () => {
    const query = "rahim ağzı kanseri tedavisi";
    const exact =
      "Rahim ağzı kanseri tedavisi sonrası kontrol planı hastanın evresine göre düzenlenir.";
    const loose =
      "Kanser tedavisi anlatılır, rahim ile ilgili ayrı bir not vardır ve ağız bakımı önerilir.";
    const stats = buildLexicalCorpusStats([exact, loose]);

    expect(scoreLexicalMatch(query, exact, stats)).toBeGreaterThan(
      scoreLexicalMatch(query, loose, stats),
    );
  });
});

describe("retrieveKnowledgeContext", () => {
  it("builds a grounded brief that avoids unrelated markers when query is specific", async () => {
    const findMany = vi.spyOn(prisma.knowledgeChunk, "findMany").mockResolvedValue([
      {
        content: `# Clinical Card

Topic: smear sonucu ve servikal tarama
Tags: smear, kasik agrisi

Patient Summary: Smear sonucum temiz çıktı ama ara ara kasık ağrım oluyor.

Clinical Takeaway: Temiz smear iyi bir bulgudur, ancak kasık ağrısını tek başına açıklamaz.

Safe Guidance: Ağrı sürüyor veya artıyorsa kadın hastalıkları değerlendirmesi uygundur.

Red Flags: Şiddetli ağrı, ateş, anormal kanama varsa daha hızlı değerlendirme gerekir.

Do Not Infer: Soruda açık dayanak yoksa CA-125 veya ileri tetkik gerekliliği çıkarma.`,
        chunkIndex: 0,
        documentId: "doc-1",
        document: { title: "gyn-onco-record-001", collectionId: "col-1" },
        embedding: { values: [] },
      } as never,
    ]);

    const result = await retrieveKnowledgeContext({
      query: "Smear sonucum temiz çıktı ama ara ara kasık ağrım oluyor",
      accessibleCollectionIds: ["col-1"],
      limit: 1,
    });

    expect(result.contextText).toContain("KULLANILABILIR GERCEKLER:");
    expect(result.contextText).toContain("BELIRSIZ / KULLANILAMAYAN:");
    expect(result.contextText).toContain("YANIT KURALLARI:");
    expect(result.contextText).not.toContain("Ca 125");
    expect(result.contextText).toContain("Temiz smear iyi bir bulgudur");
    expect(["low", "medium", "high"]).toContain(result.groundingConfidence);
    expect(result.lowGroundingConfidence).toBe(result.groundingConfidence === "low");

    findMany.mockRestore();
  });

  it("keeps compact RAG context as the default and allows detailed brief by env", async () => {
    const chunk = {
      content: `# Clinical Card

Topic: smear sonucu ve servikal tarama
Tags: medical, smear

Clinical Takeaway: Temiz smear iyi bir bulgudur, ancak kasık ağrısını tek başına açıklamaz.

Safe Guidance: Ağrı sürüyor veya artıyorsa kadın hastalıkları değerlendirmesi uygundur.

Red Flags: Şiddetli ağrı veya ateş varsa daha hızlı değerlendirme gerekir.

Do Not Infer: Soruda açık dayanak yoksa CA-125 çıkarımı yapma.`,
      chunkIndex: 0,
      documentId: "doc-compact",
      document: { title: "compact-card", collectionId: "col-1" },
      embedding: { values: [] },
    } as never;
    const findMany = vi.spyOn(prisma.knowledgeChunk, "findMany").mockResolvedValue([chunk]);

    const compact = await retrieveKnowledgeContext({
      query: "Smear temiz ama kasık ağrım var",
      accessibleCollectionIds: ["col-1"],
      limit: 1,
    });

    vi.stubEnv("R3MES_RAG_CONTEXT_MODE", "detailed");
    const detailed = await retrieveKnowledgeContext({
      query: "Smear temiz ama kasık ağrım var",
      accessibleCollectionIds: ["col-1"],
      limit: 1,
    });

    expect(compact.contextText).toContain("KULLANILABILIR GERCEKLER:");
    expect(compact.contextText).not.toContain("CEVAP NIYETI:");
    expect(detailed.contextText).toContain("CEVAP NIYETI:");
    expect(detailed.contextText).toContain("DOGRUDAN CEVAP KANITLARI:");

    findMany.mockRestore();
  });

  it("uses route scope to keep mixed-domain retrieval on the selected subtopic", async () => {
    const makeChunk = (documentId: string, title: string, content: string) => ({
      content,
      chunkIndex: 0,
      documentId,
      document: { title, collectionId: "col-1" },
      embedding: { values: [] },
    });
    const findMany = vi.spyOn(prisma.knowledgeChunk, "findMany").mockResolvedValue([
      makeChunk(
        "tech-1",
        "multi-technical-db-migration",
        `# Generic Knowledge Card

Topic: veritabanı migration öncesi kontrol
Tags: technical, migration, veritabanı, yedek, rollback

Source Summary: Migration çalıştırmadan önce yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.

Key Takeaway: Üretim veritabanında migration doğrudan denenmemeli; önce yedek, test ve geri dönüş adımı net olmalıdır.

Safe Guidance: Logları izleyin ve küçük doğrulanabilir adımlarla ilerleyin.`,
      ),
      makeChunk(
        "legal-1",
        "multi-legal-rent-deposit",
        `# Generic Knowledge Card

Topic: kira depozitosu iadesi
Tags: legal, kira, depozito

Source Summary: Kira depozitosu için belge ve yazışmalar saklanmalıdır.

Key Takeaway: Gerekirse hukuki destek alınmalıdır.`,
      ),
      makeChunk(
        "finance-1",
        "multi-finance-risk-profile",
        `# Generic Knowledge Card

Topic: yatırım riski
Tags: finance, yatırım, risk

Source Summary: Yatırım kararında risk profili ve vade dikkate alınmalıdır.`,
      ),
    ] as never);

    const result = await retrieveKnowledgeContext({
      query: "Production veritabanında migration çalıştırmadan önce ne yapmalıyım?",
      accessibleCollectionIds: ["col-1"],
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
    });

    expect(result.sources.map((source) => source.documentId)).toEqual(["tech-1"]);
    expect(result.contextText).toContain("Migration çalıştırmadan önce yedek");
    expect(result.contextText).not.toContain("kira depozitosu");
    expect(result.contextText).not.toContain("Yatırım kararında");

    findMany.mockRestore();
  });
});
