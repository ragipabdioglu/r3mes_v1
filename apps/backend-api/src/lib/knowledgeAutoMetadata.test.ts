import { describe, expect, it } from "vitest";

import {
  buildKnowledgeCollectionProfile,
  enrichKnowledgeChunkWithAutoMetadata,
  inferKnowledgeAutoMetadata,
  mergeKnowledgeAutoMetadata,
} from "./knowledgeAutoMetadata.js";

describe("enrichKnowledgeChunkWithAutoMetadata", () => {
  it("adds route metadata to plain uploaded knowledge chunks", () => {
    const enriched = enrichKnowledgeChunkWithAutoMetadata(
      {
        chunkIndex: 0,
        content: "Production veritabanında migration çalıştırmadan önce yedek alınmalı ve rollback planı hazırlanmalıdır.",
        tokenCount: 10,
      },
      { title: "db migration runbook" },
    );

    expect(enriched.content).toContain("Topic: migration");
    expect(enriched.content).toContain("Tags: technical");
    expect(enriched.content).toContain("Source Summary:");
    expect(enriched.content).toContain("rollback planı");
  });

  it("does not duplicate metadata when chunk is already a structured knowledge card", () => {
    const original = `Topic: kira depozitosu
Tags: legal, kira, depozito

Source Summary: Depozito iadesi için belgeler saklanmalıdır.`;
    const enriched = enrichKnowledgeChunkWithAutoMetadata(
      { chunkIndex: 0, content: original, tokenCount: 20 },
      { title: "legal card" },
    );

    expect(enriched.content).toBe(original);
  });

  it("adds education route metadata for education uploads", () => {
    const enriched = enrichKnowledgeChunkWithAutoMetadata(
      {
        chunkIndex: 0,
        content: "Öğrenci sınav sonucuna itiraz etmek istiyorsa resmi kılavuzdaki süre ve başvuru adımlarını kontrol etmelidir.",
        tokenCount: 12,
      },
      { title: "sınav itiraz rehberi" },
    );

    expect(enriched.content).toContain("Topic: sinav");
    expect(enriched.content).toContain("Tags: education");
    expect(enriched.content).toContain("sınav");
  });

  it("returns structured auto metadata for uploaded chunks", () => {
    const metadata = inferKnowledgeAutoMetadata({
      title: "bebek terlemesi notu",
      content: "Bebek çok terliyorsa ateş, oda sıcaklığı ve beslenme durumu birlikte değerlendirilmelidir.",
    });

    expect(metadata.domain).toBe("medical");
    expect(metadata.subtopics).toContain("pediatri_terleme");
    expect(metadata.keywords).toEqual(expect.arrayContaining(["bebek", "terleme"]));
    expect(metadata.questionsAnswered.length).toBeGreaterThan(0);
  });

  it("merges chunk metadata into a collection-level metadata profile", () => {
    const first = inferKnowledgeAutoMetadata({
      title: "migration runbook",
      content: "Production veritabanında migration öncesi yedek ve rollback planı hazırlanmalıdır.",
    });
    const second = inferKnowledgeAutoMetadata({
      title: "migration log kontrol",
      content: "Migration sırasında loglar izlenmeli ve staging çıktısı doğrulanmalıdır.",
    });

    const merged = mergeKnowledgeAutoMetadata([first, second]);

    expect(merged?.domain).toBe("technical");
    expect(merged?.subtopics).toContain("migration");
    expect(merged?.keywords).toEqual(expect.arrayContaining(["migration", "yedek", "rollback"]));
    expect(merged?.profile?.domains).toContain("technical");
    expect(merged?.profile?.subtopics).toContain("migration");
    expect(merged?.profile?.topicPhrases).toEqual(expect.arrayContaining(["migration"]));
    expect(merged?.profile?.answerableConcepts).toEqual(expect.arrayContaining(["migration", "yedek", "rollback"]));
    expect(merged?.profile?.sampleQuestions.length).toBeGreaterThan(0);
    expect(merged?.profile?.profileVersion).toBe(1);
    expect(merged?.profile?.profileText).toContain("Domains: technical");
    expect(merged?.profile?.profileTextHash).toHaveLength(64);
    expect(merged?.profile?.profileEmbedding).toHaveLength(256);
    expect(merged?.profile?.summaryEmbedding).toHaveLength(256);
    expect(merged?.profile?.sampleQuestionsEmbedding).toHaveLength(256);
    expect(merged?.profile?.keywordsEmbedding).toHaveLength(256);
    expect(merged?.profile?.entityEmbedding).toHaveLength(256);
  });

  it("builds a weighted collection profile for adaptive routing", () => {
    const legal = inferKnowledgeAutoMetadata({
      title: "boşanma hazırlık",
      content: "Boşanma davası için protokol, velayet, nafaka ve gelir belgeleri avukatla değerlendirilmelidir.",
    });
    const legalSecond = inferKnowledgeAutoMetadata({
      title: "velayet nafaka",
      content: "Velayet ve nafaka için çocuğun üstün yararı, gelir gider belgeleri ve mahkeme süreci önemlidir.",
    });

    const profile = buildKnowledgeCollectionProfile([legal, legalSecond], {
      now: new Date("2026-04-29T00:00:00.000Z"),
    });

    expect(profile?.version).toBe(2);
    expect(profile?.profileVersion).toBe(1);
    expect(profile?.domains[0]).toBe("legal");
    expect(profile?.keywords).toEqual(expect.arrayContaining(["boşanma", "velayet", "nafaka"]));
    expect(profile?.topicPhrases).toEqual(expect.arrayContaining(["boşanma", "velayet", "nafaka"]));
    expect(profile?.answerableConcepts).toEqual(expect.arrayContaining(["boşanma", "velayet", "nafaka"]));
    expect(profile?.confidence).toBe("high");
    expect(profile?.profileText).toContain("Subtopics:");
    expect(profile?.profileText).toContain("Topic phrases:");
    expect(profile?.profileText).toContain("Answerable concepts:");
    expect(profile?.profileTextHash).toHaveLength(64);
    expect(profile?.profileEmbedding).toHaveLength(256);
    expect(profile?.summaryEmbedding).toHaveLength(256);
    expect(profile?.sampleQuestionsEmbedding).toHaveLength(256);
    expect(profile?.keywordsEmbedding).toHaveLength(256);
    expect(profile?.entityEmbedding).toHaveLength(256);
    expect(profile?.lastProfiledAt).toBe("2026-04-29T00:00:00.000Z");
    expect(profile?.updatedAt).toBe("2026-04-29T00:00:00.000Z");
  });

  it("keeps profile version stable until profile content changes", () => {
    const first = inferKnowledgeAutoMetadata({
      title: "db migration",
      content: "Migration öncesinde yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
    });
    const second = inferKnowledgeAutoMetadata({
      title: "log kontrol",
      content: "Migration sırasında loglar izlenmeli ve doğrulama çıktıları kayıt altına alınmalıdır.",
    });

    const initial = buildKnowledgeCollectionProfile([first], {
      now: new Date("2026-04-29T00:00:00.000Z"),
    });
    const unchanged = buildKnowledgeCollectionProfile([first], {
      now: new Date("2026-04-30T00:00:00.000Z"),
      previousProfile: initial,
    });
    const changed = buildKnowledgeCollectionProfile([first, second], {
      now: new Date("2026-05-01T00:00:00.000Z"),
      previousProfile: initial,
    });

    expect(initial?.profileVersion).toBe(1);
    expect(unchanged?.profileVersion).toBe(1);
    expect(unchanged?.lastProfiledAt).toBe("2026-04-30T00:00:00.000Z");
    expect(changed?.profileVersion).toBe(2);
  });
});
