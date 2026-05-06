import { describe, expect, it } from "vitest";

import { scoreKnowledgeProfileHealth } from "./knowledgeProfileHealth.js";

describe("scoreKnowledgeProfileHealth", () => {
  it("marks rich structured profiles as healthy", () => {
    const health = scoreKnowledgeProfileHealth({
      sourceQuality: "structured",
      profile: {
        version: 2,
        profileVersion: 7,
        domains: ["legal"],
        subtopics: ["divorce", "custody", "alimony"],
        keywords: Array.from({ length: 12 }, (_, index) => `keyword-${index}`),
        entities: ["velayet", "nafaka", "protokol", "mahkeme", "belge"],
        topicPhrases: Array.from({ length: 9 }, (_, index) => `topic phrase ${index}`),
        answerableConcepts: Array.from({ length: 12 }, (_, index) => `concept ${index}`),
        negativeHints: ["belge tek başına yeterli eşleşme değildir"],
        sampleQuestions: [
          "Boşanma davasında velayet için ne hazırlanmalı?",
          "Nafaka için hangi belgeler gerekir?",
          "Protokolde hangi başlıklar netleşmeli?",
          "Mal paylaşımı için hangi kayıtlar saklanmalı?",
        ],
        sourceQuality: "structured",
        confidence: "high",
        profileText: "Rich legal profile",
        summary: "Boşanma sürecinde belge hazırlığı.",
        lastProfiledAt: "2026-05-06T00:00:00.000Z",
        profileEmbedding: [1],
        summaryEmbedding: [1],
        sampleQuestionsEmbedding: [1],
        keywordsEmbedding: [1],
        entityEmbedding: [1],
      },
    });

    expect(health.level).toBe("healthy");
    expect(health.score).toBeGreaterThanOrEqual(78);
    expect(health.warnings).not.toContain("thin_source_quality");
  });

  it("marks thin profiles as weak with actionable warnings", () => {
    const health = scoreKnowledgeProfileHealth({
      sourceQuality: "thin",
      profile: {
        version: 2,
        domains: ["general"],
        keywords: ["belge"],
        sourceQuality: "thin",
        confidence: "low",
        summary: "",
      },
    });

    expect(health.level).toBe("weak");
    expect(health.warnings).toEqual(expect.arrayContaining([
      "thin_source_quality",
      "low_embedding_field_coverage",
      "low_answerable_concept_coverage",
      "missing_sample_questions",
    ]));
  });
});
