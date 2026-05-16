import { describe, expect, it } from "vitest";

import { buildQdrantPayloadMetadata } from "./qdrantStore.js";

describe("buildQdrantPayloadMetadata", () => {
  it("projects collection profile into Qdrant payload metadata", () => {
    const metadata = buildQdrantPayloadMetadata({
      collectionMetadata: {
        domain: "general",
        keywords: ["eski"],
        profile: {
          profileVersion: 3,
          domains: ["legal"],
          subtopics: ["bosanma", "velayet"],
          keywords: ["nafaka", "protokol"],
          entities: ["aile mahkemesi"],
          summary: "Boşanma ve velayet arşivi.",
          profileText: "Domains: legal\nSubtopics: bosanma, velayet",
          profileTextHash: "abc123",
          lastProfiledAt: "2026-04-30T10:00:00.000Z",
          sourceQuality: "structured",
          confidence: "high",
        },
      },
      documentMetadata: {
        subtopics: ["dilekce"],
        keywords: ["delil"],
        riskLevel: "medium",
        ingestionQuality: {
          tableRisk: "high",
          ocrRisk: "none",
          thinSource: false,
          strictRouteEligible: true,
        },
        documentUnderstanding: {
          version: 1,
          answerReadiness: "needs_review",
          strictAnswerEligible: false,
          tableQuality: "text_only",
          structureQuality: "partial",
        },
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
    expect(metadata.tableRisk).toBe("high");
    expect(metadata.ocrRisk).toBe("none");
    expect(metadata.thinSource).toBe(false);
    expect(metadata.strictRouteEligible).toBe(false);
    expect(metadata.answerReadiness).toBe("needs_review");
    expect(metadata.strictAnswerEligible).toBe(false);
    expect(metadata.tableQuality).toBe("text_only");
    expect(metadata.structureQuality).toBe("partial");
    expect(metadata.metadataConfidence).toBe("high");
    expect(metadata.collectionProfileVersion).toBe(3);
    expect(metadata.collectionProfileTextHash).toBe("abc123");
    expect(metadata.collectionLastProfiledAt).toBe("2026-04-30T10:00:00.000Z");
    expect(metadata.collectionProfileText).toContain("Domains: legal");
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
      tableRisk: "none",
      ocrRisk: "none",
      thinSource: false,
      strictRouteEligible: true,
      metadataConfidence: "low",
      collectionProfileVersion: 0,
      collectionProfileTextHash: "",
      riskLevel: "low",
    });
  });

  it("marks noisy ingestion metadata as not eligible for strict route payloads", () => {
    const metadata = buildQdrantPayloadMetadata({
      documentMetadata: {
        sourceQuality: "inferred",
        ingestionQuality: {
          tableRisk: "low",
          ocrRisk: "high",
          thinSource: true,
          strictRouteEligible: false,
        },
      },
      fallbackDomain: "medical",
    });

    expect(metadata).toMatchObject({
      sourceQuality: "inferred",
      tableRisk: "low",
      ocrRisk: "high",
      thinSource: true,
      strictRouteEligible: false,
    });
  });

  it("uses document understanding readiness to lower strict answer eligibility without blocking payload creation", () => {
    const metadata = buildQdrantPayloadMetadata({
      documentMetadata: {
        sourceQuality: "structured",
        documentUnderstanding: {
          version: 1,
          answerReadiness: "needs_review",
          strictAnswerEligible: false,
          tableQuality: "text_only",
          structureQuality: "partial",
        },
      },
      fallbackDomain: "finance",
    });

    expect(metadata).toMatchObject({
      sourceQuality: "structured",
      answerReadiness: "needs_review",
      strictAnswerEligible: false,
      tableQuality: "text_only",
      structureQuality: "partial",
      strictRouteEligible: false,
    });
  });
});
