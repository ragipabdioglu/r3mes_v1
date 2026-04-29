import { describe, expect, it } from "vitest";

import { buildQdrantPayloadMetadata } from "./qdrantStore.js";

describe("buildQdrantPayloadMetadata", () => {
  it("projects collection profile into Qdrant payload metadata", () => {
    const metadata = buildQdrantPayloadMetadata({
      collectionMetadata: {
        domain: "general",
        keywords: ["eski"],
        profile: {
          domains: ["legal"],
          subtopics: ["bosanma", "velayet"],
          keywords: ["nafaka", "protokol"],
          entities: ["aile mahkemesi"],
          summary: "Boşanma ve velayet arşivi.",
          sourceQuality: "structured",
          confidence: "high",
        },
      },
      documentMetadata: {
        subtopics: ["dilekce"],
        keywords: ["delil"],
        riskLevel: "medium",
      },
      chunkMetadata: {
        keywords: ["gelir belgesi"],
      },
      fallbackDomain: "general",
      fallbackSubtopics: ["hukuk"],
      fallbackTags: ["fallback"],
    });

    expect(metadata.domain).toBe("legal");
    expect(metadata.domains).toEqual(["legal", "general"]);
    expect(metadata.profileSubtopics).toEqual(["bosanma", "velayet"]);
    expect(metadata.subtopics).toEqual(expect.arrayContaining(["bosanma", "velayet", "dilekce", "hukuk"]));
    expect(metadata.keywords).toEqual(expect.arrayContaining(["nafaka", "protokol", "delil", "gelir belgesi"]));
    expect(metadata.entities).toEqual(["aile mahkemesi"]);
    expect(metadata.sourceQuality).toBe("structured");
    expect(metadata.metadataConfidence).toBe("high");
    expect(metadata.riskLevel).toBe("medium");
    expect(metadata.profileSummary).toBe("Boşanma ve velayet arşivi.");
  });

  it("keeps fallback metadata for thin or legacy records", () => {
    const metadata = buildQdrantPayloadMetadata({
      fallbackDomain: "technical",
      fallbackSubtopics: ["migration"],
      fallbackTags: ["rollback"],
    });

    expect(metadata).toMatchObject({
      domain: "technical",
      domains: ["technical"],
      subtopics: ["migration"],
      tags: ["rollback"],
      sourceQuality: "thin",
      metadataConfidence: "low",
      riskLevel: "low",
    });
  });
});
