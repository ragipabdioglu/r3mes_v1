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
});
