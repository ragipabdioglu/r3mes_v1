import { describe, expect, it } from "vitest";

import { buildKnowledgeRouteDecision } from "./knowledgeAccess.js";
import { buildRouteDecisionLogEvent } from "./routeDecisionLog.js";
import { routeQuery } from "./queryRouter.js";

describe("buildRouteDecisionLogEvent", () => {
  it("logs route decisions without storing raw user query text", () => {
    const query = "Production veritabanında migration çalıştırmadan önce ne yapmalıyım?";
    const routePlan = routeQuery(query);
    const routeDecision = buildKnowledgeRouteDecision({
      routePlan,
      requestedCollectionIds: ["technical-db"],
      accessibleCollectionIds: ["technical-db"],
      usedCollectionIds: ["technical-db"],
      unusedSelectedCollectionIds: [],
      suggestedCollections: [],
      metadataRouteCandidates: [],
      hasSources: true,
    });

    const event = buildRouteDecisionLogEvent({
      query,
      routePlan,
      sourceSelection: {
        selectionMode: "selected",
        requestedCollectionIds: ["technical-db"],
        accessibleCollectionIds: ["technical-db"],
        usedCollectionIds: ["technical-db"],
        unusedSelectedCollectionIds: [],
        suggestedCollections: [],
        metadataRouteCandidates: [],
        includePublic: false,
        hasSources: true,
        warning: null,
        routeDecision,
      },
      retrievalDiagnostics: { finalCandidateCount: 1 },
      quality: {
        sourceCount: 1,
        directFactCount: 3,
        riskFactCount: 1,
        hasUsableGrounding: true,
      },
    });

    expect(event.event).toBe("knowledge_route_decision");
    expect(event.queryHash).toHaveLength(16);
    expect(JSON.stringify(event)).not.toContain(query);
    expect(event.route.domain).toBe("technical");
    expect(event.decision.mode).toBe("strict");
    expect(event.sourceSelection.usedCollectionIds).toEqual(["technical-db"]);
    expect(event.retrievalDiagnostics).toEqual({ finalCandidateCount: 1 });
  });

  it("keeps candidate scores compact for structured logs", () => {
    const query = "Boşanma davasında velayet için ne hazırlamalıyım?";
    const routePlan = routeQuery(query);
    const routeDecision = buildKnowledgeRouteDecision({
      routePlan,
      requestedCollectionIds: [],
      accessibleCollectionIds: ["divorce"],
      usedCollectionIds: [],
      unusedSelectedCollectionIds: [],
      suggestedCollections: [{ id: "divorce", name: "Boşanma", reason: "Metadata eşleşmesi" }],
      metadataRouteCandidates: [
        {
          id: "divorce",
          name: "Boşanma",
          score: 87.348,
          domain: "legal",
          subtopics: ["bosanma"],
          matchedTerms: ["velayet"],
          reason: "Metadata eşleşmesi",
          sourceQuality: "structured",
        },
      ],
      hasSources: false,
    });

    const event = buildRouteDecisionLogEvent({
      query,
      routePlan,
      sourceSelection: {
        selectionMode: "public",
        requestedCollectionIds: [],
        accessibleCollectionIds: ["divorce"],
        usedCollectionIds: [],
        unusedSelectedCollectionIds: [],
        suggestedCollections: [{ id: "divorce", name: "Boşanma", reason: "Metadata eşleşmesi" }],
        metadataRouteCandidates: [
          {
            id: "divorce",
            name: "Boşanma",
            score: 87.348,
            domain: "legal",
            subtopics: ["bosanma"],
            matchedTerms: ["velayet"],
            reason: "Metadata eşleşmesi",
            sourceQuality: "structured",
          },
        ],
        includePublic: true,
        hasSources: false,
        warning: "Seçilen/erişilebilir kaynaklardan bu soru için yeterli kanıt bulunamadı.",
        routeDecision,
      },
    });

    expect(event.sourceSelection.metadataRouteCandidates).toEqual([
      {
        id: "divorce",
        score: 87.35,
        domain: "legal",
        sourceQuality: "structured",
        matchedTerms: ["velayet"],
      },
    ]);
    expect(event.decision.mode).toBe("suggest");
  });
});
