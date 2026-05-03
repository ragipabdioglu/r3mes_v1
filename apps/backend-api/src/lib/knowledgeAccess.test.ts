import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: {
    knowledgeCollection: {
      findMany: vi.fn(),
    },
  },
}));

describe("resolveAccessibleKnowledgeCollections", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("limits public discovery to owner collections and explicitly public collections", async () => {
    const { prisma } = await import("./prisma.js");
    const { resolveAccessibleKnowledgeCollections } = await import("./knowledgeAccess.js");

    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValueOnce([] as never);

    await resolveAccessibleKnowledgeCollections({
      walletAddress: "0xowner",
      includePublic: true,
    });

    expect(prisma.knowledgeCollection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { owner: { walletAddress: "0xowner" } },
            { visibility: "PUBLIC" },
          ],
        },
      }),
    );
  });

  it("keeps requested private collection ids constrained by wallet ownership", async () => {
    const { prisma } = await import("./prisma.js");
    const { resolveAccessibleKnowledgeCollections } = await import("./knowledgeAccess.js");

    vi.mocked(prisma.knowledgeCollection.findMany).mockResolvedValueOnce([] as never);

    await resolveAccessibleKnowledgeCollections({
      walletAddress: "0xattacker",
      requestedCollectionIds: ["private-victim-collection"],
      includePublic: false,
    });

    expect(prisma.knowledgeCollection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ owner: { walletAddress: "0xattacker" } }],
          id: { in: ["private-victim-collection"] },
        },
      }),
    );
  });
});

describe("rankSuggestedKnowledgeCollections", () => {
  it("prioritizes route domain and subtopic metadata over raw recency/order", async () => {
    const { rankSuggestedKnowledgeCollections } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const routePlan = routeQuery("Boşanma davasında hangi belgeleri hazırlamalıyım?");
    const ranked = rankSuggestedKnowledgeCollections({
      routePlan,
      collections: [
        {
          id: "technical",
          name: "Technical DB Notes",
          visibility: "PUBLIC",
          documents: [
            {
              title: "Migration",
              chunks: [{ content: "Topic: migration\nTags: technical, rollback, staging" }],
            },
          ],
        },
        {
          id: "legal-divorce",
          name: "Büro boşanma notları",
          visibility: "PRIVATE",
          documents: [
            {
              title: "Boşanma dava belgeleri",
              chunks: [
                {
                  content:
                    "Topic: boşanma\nTags: legal, bosanma, dava, belge\nSource Summary: Boşanma davası için belge hazırlığı.",
                },
              ],
            },
          ],
        },
        {
          id: "medical",
          name: "Jinekoloji kayıtları",
          visibility: "PUBLIC",
          documents: [
            {
              title: "Smear",
              chunks: [{ content: "Topic: smear\nTags: medical, smear, takip" }],
            },
          ],
        },
      ],
      limit: 2,
    });

    expect(ranked.map((collection) => collection.id)).toEqual(["legal-divorce"]);
  });

  it("does not suggest explicitly excluded collections", async () => {
    const { rankSuggestedKnowledgeCollections } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const routePlan = routeQuery("Production veritabanında migration öncesi ne yapmalıyım?");
    const ranked = rankSuggestedKnowledgeCollections({
      routePlan,
      excludedIds: new Set(["technical-primary"]),
      collections: [
        {
          id: "technical-primary",
          name: "Technical primary",
          visibility: "PRIVATE",
          documents: [
            {
              title: "Migration",
              chunks: [{ content: "Topic: migration\nTags: technical, migration, rollback, staging" }],
            },
          ],
        },
        {
          id: "technical-secondary",
          name: "Technical secondary",
          visibility: "PUBLIC",
          documents: [
            {
              title: "Deploy",
              chunks: [{ content: "Topic: deploy\nTags: technical, deploy, rollback, log" }],
            },
          ],
        },
      ],
      limit: 3,
    });

    expect(ranked.map((collection) => collection.id)).toEqual(["technical-secondary"]);
  });

  it("uses structured autoMetadata as the strongest source routing signal", async () => {
    const { rankSuggestedKnowledgeCollections } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const routePlan = routeQuery("Bebeğim çok terliyor neden olabilir?");
    const ranked = rankSuggestedKnowledgeCollections({
      routePlan,
      collections: [
        {
          id: "gyn",
          name: "Jinekoloji kayıtları",
          visibility: "PRIVATE",
          autoMetadata: {
            domain: "medical",
            subtopics: ["kasik_agrisi", "smear"],
            keywords: ["jinekoloji", "kasık", "smear"],
            entities: [],
            summary: "Jinekolojik kasık ağrısı ve smear takip notları.",
            questionsAnswered: [],
          },
          documents: [],
        },
        {
          id: "pediatric",
          name: "Yeni yüklenen pediatri notları",
          visibility: "PUBLIC",
          autoMetadata: {
            domain: "medical",
            subtopics: ["pediatri_terleme"],
            keywords: ["bebek", "terleme", "ateş", "oda sıcaklığı"],
            entities: ["bebek terlemesi"],
            summary: "Bebeklerde terleme ateş, oda sıcaklığı ve beslenme ile birlikte değerlendirilir.",
            questionsAnswered: ["Bebek terlemesi hakkında ne bilinmeli?"],
          },
          documents: [],
        },
      ],
      limit: 2,
    });

    expect(ranked.map((collection) => collection.id)).toEqual(["pediatric"]);
  });

  it("uses collection profile as the primary adaptive routing signal", async () => {
    const { rankMetadataRouteCandidates, rankSuggestedKnowledgeCollections } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const routePlan = routeQuery("Boşanma davasında velayet ve nafaka için ne hazırlamalıyım?");
    const collections = [
      {
        id: "generic-legal",
        name: "Genel hukuk notları",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          domain: "legal",
          subtopics: ["sozlesme"],
          keywords: ["hukuk", "sözleşme"],
          entities: [],
          summary: "Genel sözleşme hukuku notları.",
          questionsAnswered: [],
        },
        documents: [],
      },
      {
        id: "profile-divorce",
        name: "Yeni büro boşanma arşivi",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          domain: "general",
          subtopics: [],
          keywords: [],
          entities: [],
          summary: "",
          questionsAnswered: [],
          profile: {
            version: 1,
            domains: ["legal"],
            subtopics: ["bosanma", "velayet", "nafaka"],
            keywords: ["boşanma", "velayet", "nafaka", "protokol", "gelir belgesi"],
            entities: ["boşanma davası"],
            documentTypes: ["document"],
            audiences: ["client"],
            sampleQuestions: ["Boşanma davasında velayet için ne hazırlanmalı?"],
            summary: "Boşanma, velayet ve nafaka hazırlık notları.",
            riskLevel: "medium",
            sourceQuality: "structured",
            confidence: "high",
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
    ];

    const ranked = rankSuggestedKnowledgeCollections({ routePlan, collections, limit: 2 });
    const metadataCandidates = rankMetadataRouteCandidates({ routePlan, collections, limit: 2 });

    expect(ranked.map((collection) => collection.id)[0]).toBe("profile-divorce");
    expect(metadataCandidates[0]).toMatchObject({
      id: "profile-divorce",
      domain: "legal",
      sourceQuality: "structured",
    });
    expect(metadataCandidates[0]?.matchedTerms).toEqual(expect.arrayContaining(["bosanma", "velayet", "nafaka"]));
  });

  it("uses field-level profile embeddings for natural-language collection suggestions", async () => {
    const { rankMetadataRouteCandidates, rankSuggestedKnowledgeCollections } = await import("./knowledgeAccess.js");
    const { embedKnowledgeText } = await import("./knowledgeEmbedding.js");
    const { routeQuery } = await import("./queryRouter.js");

    const query = "RAM raporu sonrası BEP planını okulda nasıl konuşmalıyım?";
    const routePlan = routeQuery(query);
    const collections = [
      {
        id: "education-exam",
        name: "Sınav itiraz arşivi",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          profile: {
            version: 1,
            domains: ["education"],
            subtopics: ["sinav"],
            keywords: [],
            entities: [],
            documentTypes: ["knowledge_note"],
            audiences: ["student_or_parent"],
            sampleQuestions: [],
            summary: "Sınav sonucuna itiraz süresi ve resmi başvuru kanalı notları.",
            riskLevel: "medium",
            sourceQuality: "structured",
            confidence: "high",
            sampleQuestionsEmbedding: embedKnowledgeText("sınav sonucuna itiraz süresi resmi kılavuz başvuru"),
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
      {
        id: "education-bep",
        name: "Yeni BEP ve RAM arşivi",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          profile: {
            version: 1,
            domains: ["education"],
            subtopics: ["ozel_egitim"],
            keywords: [],
            entities: [],
            documentTypes: ["knowledge_note"],
            audiences: ["student_or_parent"],
            sampleQuestions: [],
            summary: "Özel eğitim desteğinde RAM raporu, BEP planı ve okul rehberlik görüşmesi notları.",
            riskLevel: "medium",
            sourceQuality: "structured",
            confidence: "high",
            sampleQuestionsEmbedding: embedKnowledgeText("RAM raporu sonrası BEP planını okulda nasıl konuşmalıyım"),
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
    ];

    const ranked = rankSuggestedKnowledgeCollections({ routePlan, query, collections, limit: 2 });
    const metadataCandidates = rankMetadataRouteCandidates({ routePlan, query, collections, limit: 2 });

    expect(ranked.map((collection) => collection.id)[0]).toBe("education-bep");
    expect(metadataCandidates.map((collection) => collection.id)[0]).toBe("education-bep");
    expect(metadataCandidates[0]?.score ?? 0).toBeGreaterThan(metadataCandidates[1]?.score ?? 0);
  });

  it("explains profile-backed suggestions with quality and score", async () => {
    const { explainCollectionRouteSuggestion } = await import("./knowledgeAccess.js");
    const { embedKnowledgeText } = await import("./knowledgeEmbedding.js");
    const { routeQuery } = await import("./queryRouter.js");

    const query = "RAM raporu sonrası BEP planını okulda nasıl konuşmalıyım?";
    const reason = explainCollectionRouteSuggestion(
      {
        id: "education-bep",
        name: "Yeni BEP ve RAM arşivi",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          profile: {
            version: 1,
            domains: ["education"],
            subtopics: ["ozel_egitim"],
            keywords: ["BEP", "RAM", "rehberlik"],
            entities: ["RAM raporu"],
            documentTypes: ["knowledge_note"],
            audiences: ["student_or_parent"],
            sampleQuestions: ["RAM raporu sonrası BEP planını okulda nasıl konuşmalıyım?"],
            summary: "Özel eğitim desteğinde RAM raporu, BEP planı ve okul rehberlik görüşmesi notları.",
            riskLevel: "medium",
            sourceQuality: "structured",
            confidence: "high",
            sampleQuestionsEmbedding: embedKnowledgeText(query),
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
      routeQuery(query),
      query,
    );

    expect(reason).toContain("Profile eşleşmesi");
    expect(reason).toContain("structured profile");
    expect(reason).toContain("skor");
  });

  it("uses profile metadata for suggestions even when the query router has no known domain", async () => {
    const { rankMetadataRouteCandidates, rankSuggestedKnowledgeCollections } = await import("./knowledgeAccess.js");
    const { embedKnowledgeText } = await import("./knowledgeEmbedding.js");
    const { routeQuery } = await import("./queryRouter.js");

    const query = "Yeni personel onboarding sürecinde hangi hesaplar açılmalı?";
    const routePlan = routeQuery(query);
    const collections = [
      {
        id: "medical-generic",
        name: "Sağlık notları",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          profile: {
            version: 1,
            domains: ["medical"],
            subtopics: ["kasik_agrisi"],
            keywords: ["ağrı", "kontrol"],
            entities: [],
            documentTypes: ["knowledge_note"],
            audiences: ["patient"],
            sampleQuestions: [],
            summary: "Genel sağlık kontrol notları.",
            riskLevel: "medium",
            sourceQuality: "structured",
            confidence: "high",
            profileEmbedding: embedKnowledgeText("genel sağlık kontrol ağrı hasta"),
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
      {
        id: "hr-onboarding",
        name: "HR onboarding arşivi",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          profile: {
            version: 1,
            domains: ["hr"],
            subtopics: ["onboarding", "hesap_acilisi"],
            keywords: ["personel", "onboarding", "hesap", "erişim", "ekipman"],
            entities: ["onboarding"],
            documentTypes: ["runbook"],
            audiences: ["operator"],
            sampleQuestions: ["Yeni personel onboarding sürecinde hangi hesaplar açılmalı?"],
            summary: "Yeni personel için hesap açılışı, erişim yetkileri ve ekipman hazırlığı.",
            riskLevel: "low",
            sourceQuality: "structured",
            confidence: "high",
            profileEmbedding: embedKnowledgeText("yeni personel onboarding hesap açılışı erişim ekipman"),
            sampleQuestionsEmbedding: embedKnowledgeText(query),
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
    ];

    expect(routePlan.domain).toBe("general");

    const ranked = rankSuggestedKnowledgeCollections({ routePlan, query, collections, limit: 2 });
    const metadataCandidates = rankMetadataRouteCandidates({ routePlan, query, collections, limit: 2 });

    expect(ranked.map((collection) => collection.id)[0]).toBe("hr-onboarding");
    expect(metadataCandidates.map((collection) => collection.id)[0]).toBe("hr-onboarding");
    expect(metadataCandidates[0]?.reason).toContain("Query-profile");
  });

  it("lets strong query-profile metadata override a misleading route hint for suggestions", async () => {
    const { rankMetadataRouteCandidates, rankSuggestedKnowledgeCollections } = await import("./knowledgeAccess.js");
    const { embedKnowledgeText } = await import("./knowledgeEmbedding.js");
    const { routeQuery } = await import("./queryRouter.js");

    const query = "Trafik eğitim atölyesinde öğrenci güvenliği için hangi hazırlıklar yapılmalı?";
    const routePlan = routeQuery(query);
    const collections = [
      {
        id: "legal-traffic",
        name: "Trafik cezası hukuk arşivi",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          profile: {
            version: 1,
            domains: ["legal"],
            subtopics: ["trafik"],
            keywords: ["trafik cezası", "itiraz", "tebligat"],
            entities: [],
            documentTypes: ["knowledge_note"],
            audiences: ["client"],
            sampleQuestions: ["Trafik cezasına nasıl itiraz edilir?"],
            summary: "Trafik cezası itirazı için süre, tebligat ve belge kontrolü.",
            riskLevel: "medium",
            sourceQuality: "structured",
            confidence: "high",
            profileEmbedding: embedKnowledgeText("trafik cezası itiraz tebligat belge hukuk"),
            sampleQuestionsEmbedding: embedKnowledgeText("Trafik cezasına nasıl itiraz edilir?"),
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
      {
        id: "education-traffic-workshop",
        name: "Trafik eğitim atölyesi",
        visibility: "PRIVATE" as const,
        autoMetadata: {
          profile: {
            version: 1,
            domains: ["education"],
            subtopics: ["atolye_guvenligi", "trafik_egitimi"],
            keywords: ["öğrenci", "güvenlik", "atölye", "trafik eğitimi", "hazırlık"],
            entities: ["trafik eğitim atölyesi"],
            topicPhrases: ["öğrenci güvenliği", "trafik eğitim atölyesi", "atölye hazırlığı"],
            answerableConcepts: ["trafik eğitim atölyesi hazırlığı", "öğrenci güvenliği kontrol listesi"],
            documentTypes: ["runbook"],
            audiences: ["teacher"],
            sampleQuestions: ["Trafik eğitim atölyesinde öğrenci güvenliği için hangi hazırlıklar yapılmalı?"],
            summary: "Trafik eğitim atölyesi öncesinde öğrenci güvenliği, ekipman kontrolü ve öğretmen hazırlık adımları.",
            riskLevel: "medium",
            sourceQuality: "structured",
            confidence: "high",
            profileEmbedding: embedKnowledgeText("trafik eğitim atölyesi öğrenci güvenliği ekipman hazırlık öğretmen"),
            sampleQuestionsEmbedding: embedKnowledgeText(query),
            updatedAt: "2026-04-29T00:00:00.000Z",
          },
        },
        documents: [],
      },
    ];

    expect(routePlan.domain).toBe("legal");

    const ranked = rankSuggestedKnowledgeCollections({ routePlan, query, collections, limit: 2 });
    const metadataCandidates = rankMetadataRouteCandidates({ routePlan, query, collections, limit: 2 });

    expect(ranked.map((collection) => collection.id)[0]).toBe("education-traffic-workshop");
    expect(metadataCandidates.map((collection) => collection.id)[0]).toBe("education-traffic-workshop");
    expect(metadataCandidates[0]?.reason).toContain("Query-profile");
    expect(metadataCandidates[0]?.matchedTerms).toEqual(expect.arrayContaining(["trafik eğitim", "öğrenci güvenliği"]));
  });

  it("marks thin profile suggestions as cautious instead of strict evidence", async () => {
    const { explainCollectionRouteSuggestion, rankMetadataRouteCandidates } = await import("./knowledgeAccess.js");
    const { embedKnowledgeText } = await import("./knowledgeEmbedding.js");
    const { routeQuery } = await import("./queryRouter.js");

    const query = "Sözleşmedeki cezai şart için hangi belgeye bakmalıyım?";
    const routePlan = routeQuery(query);
    const collection = {
      id: "thin-contract-upload",
      name: "Yeni yüklenen sözleşme notu",
      visibility: "PRIVATE" as const,
      autoMetadata: {
        profile: {
          version: 1,
          domains: ["legal"],
          subtopics: ["sozlesme"],
          keywords: ["sözleşme", "cezai şart"],
          entities: [],
          documentTypes: ["document"],
          audiences: ["client"],
          sampleQuestions: [],
          summary: "Kısa sözleşme notu; profil henüz az veriyle oluştu.",
          riskLevel: "medium",
          sourceQuality: "thin",
          confidence: "medium",
          keywordsEmbedding: embedKnowledgeText("sözleşme cezai şart belge"),
          updatedAt: "2026-04-29T00:00:00.000Z",
        },
      },
      documents: [],
    };

    const candidates = rankMetadataRouteCandidates({ routePlan, query, collections: [collection], limit: 1 });
    const reason = explainCollectionRouteSuggestion(collection, routePlan, query);

    expect(candidates[0]).toMatchObject({ id: "thin-contract-upload", sourceQuality: "thin" });
    expect(reason).toContain("thin profile");
    expect(reason).toContain("temkinli");
  });
});

describe("collectionHasSpecificRouteSupport", () => {
  it("does not treat a broad gynecology collection as support for pediatric sweating", async () => {
    const { collectionHasSpecificRouteSupport } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const routePlan = routeQuery("Bebeğim çok terliyor neden olabilir?");

    expect(
      collectionHasSpecificRouteSupport(
        {
          id: "gyn",
          name: "Jinekoloji klinik kartları",
          visibility: "PRIVATE",
          documents: [
            {
              title: "Kasık ağrısı",
              chunks: [
                {
                  content:
                    "Topic: kasık ağrısı\nTags: medical, jinekoloji, kasik-agri, smear\nPatient Summary: Kullanıcı jinekolojik kasık ağrısını soruyor.",
                },
              ],
            },
          ],
        },
        routePlan,
      ),
    ).toBe(false);
  });

  it("accepts a collection with pediatric sweating metadata", async () => {
    const { collectionHasSpecificRouteSupport } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const routePlan = routeQuery("Bebeğim çok terliyor neden olabilir?");

    expect(
      collectionHasSpecificRouteSupport(
        {
          id: "pediatric",
          name: "Pediatri bebek terlemesi notları",
          visibility: "PRIVATE",
          documents: [
            {
              title: "Bebek terlemesi",
              chunks: [
                {
                  content:
                    "Topic: bebek terlemesi\nTags: medical, pediatri, bebek, terleme, ateş\nSource Summary: Bebeklerde terleme oda sıcaklığı, ateş ve beslenme durumuyla birlikte değerlendirilir.",
                },
              ],
            },
          ],
        },
        routePlan,
      ),
    ).toBe(true);
  });
});

describe("buildKnowledgeRouteDecision", () => {
  it("returns strict when selected sources produce grounded evidence", async () => {
    const { buildKnowledgeRouteDecision } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const routePlan = routeQuery("Production veritabanında migration çalıştırmadan önce ne yapmalıyım?");
    const decision = buildKnowledgeRouteDecision({
      routePlan,
      requestedCollectionIds: ["technical-db"],
      accessibleCollectionIds: ["technical-db"],
      usedCollectionIds: ["technical-db"],
      unusedSelectedCollectionIds: [],
      suggestedCollections: [],
      metadataRouteCandidates: [],
      hasSources: true,
    });

    expect(decision).toMatchObject({
      mode: "strict",
      primaryDomain: "technical",
      confidence: routePlan.confidence,
      selectedCollectionIds: ["technical-db"],
      usedCollectionIds: ["technical-db"],
      rejectedCollectionIds: [],
    });
  });

  it("returns suggest when selected sources miss but metadata candidates exist", async () => {
    const { buildKnowledgeRouteDecision } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const decision = buildKnowledgeRouteDecision({
      routePlan: routeQuery("Boşanma davasında velayet için ne hazırlamalıyım?"),
      requestedCollectionIds: ["generic-legal"],
      accessibleCollectionIds: ["generic-legal"],
      usedCollectionIds: [],
      unusedSelectedCollectionIds: ["generic-legal"],
      suggestedCollections: [{ id: "divorce-law", name: "Boşanma arşivi", reason: "Metadata eşleşmesi" }],
      metadataRouteCandidates: [
        {
          id: "divorce-law",
          name: "Boşanma arşivi",
          score: 130,
          domain: "legal",
          subtopics: ["bosanma", "velayet"],
          matchedTerms: ["bosanma", "velayet"],
          reason: "Metadata eşleşmesi: bosanma, velayet",
          sourceQuality: "structured",
        },
      ],
      hasSources: false,
    });

    expect(decision.mode).toBe("suggest");
    expect(decision.suggestedCollectionIds).toEqual(["divorce-law"]);
    expect(decision.rejectedCollectionIds).toEqual(["generic-legal"]);
    expect(decision.reasons[0]).toContain("daha uyumlu kaynak");
  });

  it("does not return strict when the used source only has a thin profile", async () => {
    const { buildKnowledgeRouteDecision } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const decision = buildKnowledgeRouteDecision({
      routePlan: routeQuery("Yeni yüklenen sözleşme notlarında cezai şart için neye bakmalıyım?"),
      requestedCollectionIds: ["thin-contract-notes"],
      accessibleCollectionIds: ["thin-contract-notes"],
      usedCollectionIds: ["thin-contract-notes"],
      unusedSelectedCollectionIds: [],
      suggestedCollections: [],
      metadataRouteCandidates: [
        {
          id: "thin-contract-notes",
          name: "Thin contract notes",
          score: 42,
          domain: "legal",
          subtopics: ["sozlesme"],
          matchedTerms: ["sözleşme"],
          reason: "Metadata eşleşmesi: sözleşme",
          sourceQuality: "thin",
        },
      ],
      thinProfileCollectionIds: ["thin-contract-notes"],
      hasSources: true,
    });

    expect(decision.mode).toBe("broad");
    expect(decision.confidence).toBe("medium");
    expect(decision.reasons[0]).toContain("thin profile");
  });

  it("returns no_source when there is no usable source or suggestion", async () => {
    const { buildKnowledgeRouteDecision } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const decision = buildKnowledgeRouteDecision({
      routePlan: routeQuery("Bebeklerde terleme için hangi durumlarda doktora gidilmeli?"),
      requestedCollectionIds: [],
      accessibleCollectionIds: [],
      usedCollectionIds: [],
      unusedSelectedCollectionIds: [],
      suggestedCollections: [],
      metadataRouteCandidates: [],
      hasSources: false,
    });

    expect(decision).toMatchObject({
      mode: "no_source",
      confidence: "low",
      selectedCollectionIds: [],
      usedCollectionIds: [],
      suggestedCollectionIds: [],
    });
  });

  it("keeps suggest mode when an explicitly selected source is rejected even without alternatives", async () => {
    const { buildKnowledgeRouteDecision } = await import("./knowledgeAccess.js");
    const { routeQuery } = await import("./queryRouter.js");

    const decision = buildKnowledgeRouteDecision({
      routePlan: routeQuery("Başım ağrıyor, kısa ve sakin ne yapmalıyım?"),
      requestedCollectionIds: ["pelvic-pain"],
      accessibleCollectionIds: ["pelvic-pain"],
      usedCollectionIds: [],
      unusedSelectedCollectionIds: ["pelvic-pain"],
      suggestedCollections: [],
      metadataRouteCandidates: [],
      hasSources: false,
    });

    expect(decision.mode).toBe("suggest");
    expect(decision.confidence).toBe("low");
    expect(decision.rejectedCollectionIds).toEqual(["pelvic-pain"]);
  });
});
