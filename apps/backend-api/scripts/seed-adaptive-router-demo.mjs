import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { embedKnowledgeText } from "../dist/lib/knowledgeEmbedding.js";

const prisma = new PrismaClient();
const wallet =
  process.env.R3MES_DEV_WALLET ||
  "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const collectionId = "adaptive-router-education-traffic-demo";
const timestamp = "2026-05-03T00:00:00.000Z";

const content = `# Education Knowledge Card: Trafik eğitim atölyesi

Topic: trafik eğitim atölyesinde öğrenci güvenliği
Tags: education, eğitim, trafik eğitimi, atölye, öğrenci güvenliği, hazırlık

Source Summary: Trafik eğitim atölyesi öncesinde alan güvenliği, ekipman kontrolü, görev paylaşımı ve öğrenci bilgilendirmesi hazırlanmalıdır.

Key Takeaway: Bu konu trafik cezası veya hukuki itiraz değil; okul içi eğitim etkinliği ve öğrenci güvenliği hazırlığıdır.

Safe Guidance: Öğretmen alanı kontrol etmeli, materyalleri önceden hazırlamalı, riskli noktaları kapatmalı ve öğrencilerle kısa güvenlik kurallarını paylaşmalıdır.

Red Flags: Kalabalık alan, gözetimsiz istasyon, bozuk ekipman, açık kablo veya acil durum planının olmaması güvenlik riskidir.

Do Not Infer: Hukuki trafik cezası, itiraz süresi veya tebligat bilgisi çıkarma; kaynak yalnız eğitim atölyesi güvenliği hakkındadır.`;

function tokenCount(text) {
  return text
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.trim().length > 0).length;
}

function profileText(profile) {
  return [
    `Domains: ${profile.domains.join(", ")}`,
    `Subtopics: ${profile.subtopics.join(", ")}`,
    `Keywords: ${profile.keywords.join(", ")}`,
    `Entities: ${profile.entities.join(", ")}`,
    `Topic phrases: ${profile.topicPhrases.join(", ")}`,
    `Answerable concepts: ${profile.answerableConcepts.join(", ")}`,
    `Negative hints: ${profile.negativeHints.join(", ")}`,
    `Document types: ${profile.documentTypes.join(", ")}`,
    `Audiences: ${profile.audiences.join(", ")}`,
    `Sample questions: ${profile.sampleQuestions.join(", ")}`,
    `Summary: ${profile.summary}`,
    `Risk level: ${profile.riskLevel}`,
    `Source quality: ${profile.sourceQuality}`,
    `Confidence: ${profile.confidence}`,
  ].join("\n");
}

function buildMetadata() {
  const baseProfile = {
    domains: ["education"],
    subtopics: ["trafik_egitimi", "atolye_guvenligi", "ogrenci_guvenligi"],
    keywords: ["trafik eğitimi", "atölye", "öğrenci güvenliği", "hazırlık", "ekipman", "gözetim"],
    entities: ["trafik eğitim atölyesi", "öğrenci güvenliği"],
    topicPhrases: ["trafik eğitim atölyesi", "öğrenci güvenliği", "atölye hazırlığı", "okul içi güvenlik"],
    answerableConcepts: [
      "trafik eğitim atölyesi hazırlığı",
      "öğrenci güvenliği kontrol listesi",
      "atölyede ekipman ve gözetim kontrolü",
    ],
    negativeHints: ["trafik tek başına hukuki trafik cezası anlamına gelmez"],
    documentTypes: ["runbook"],
    audiences: ["teacher"],
    sampleQuestions: [
      "Trafik eğitim atölyesinde öğrenci güvenliği için hangi hazırlıklar yapılmalı?",
      "Okulda trafik eğitimi etkinliği öncesi ne kontrol edilmeli?",
    ],
    summary:
      "Trafik eğitim atölyesinde öğrenci güvenliği, ekipman kontrolü, alan hazırlığı ve öğretmen gözetimi için uygulanabilir hazırlık adımları.",
    riskLevel: "medium",
    sourceQuality: "structured",
    confidence: "high",
  };
  const text = profileText(baseProfile);
  const profile = {
    version: 2,
    profileVersion: 1,
    ...baseProfile,
    profileText: text,
    profileTextHash: createHash("sha256").update(text, "utf8").digest("hex"),
    profileEmbedding: embedKnowledgeText(text),
    summaryEmbedding: embedKnowledgeText(baseProfile.summary),
    sampleQuestionsEmbedding: embedKnowledgeText(baseProfile.sampleQuestions.join(" ")),
    keywordsEmbedding: embedKnowledgeText(baseProfile.keywords.join(" ")),
    entityEmbedding: embedKnowledgeText(baseProfile.entities.join(" ")),
    lastProfiledAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    domain: "education",
    subtopics: profile.subtopics,
    keywords: profile.keywords,
    entities: profile.entities,
    documentType: "runbook",
    audience: "teacher",
    riskLevel: "medium",
    summary: profile.summary,
    questionsAnswered: profile.sampleQuestions,
    sourceQuality: "structured",
    profile,
  };
}

async function main() {
  const user = await prisma.user.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet },
  });
  const autoMetadata = buildMetadata();

  await prisma.knowledgeCollection.upsert({
    where: { id: collectionId },
    update: {
      ownerId: user.id,
      name: "Adaptive Router Education Traffic Demo",
      visibility: "PRIVATE",
      publishedAt: null,
      autoMetadata,
    },
    create: {
      id: collectionId,
      ownerId: user.id,
      name: "Adaptive Router Education Traffic Demo",
      visibility: "PRIVATE",
      autoMetadata,
    },
  });

  const document = await prisma.knowledgeDocument.upsert({
    where: { id: "adaptive-router-education-traffic-doc" },
    update: {
      collectionId,
      title: "adaptive-router-education-traffic-doc",
      sourceType: "MARKDOWN",
      parseStatus: "READY",
      errorMessage: null,
      autoMetadata,
    },
    create: {
      id: "adaptive-router-education-traffic-doc",
      collectionId,
      title: "adaptive-router-education-traffic-doc",
      sourceType: "MARKDOWN",
      parseStatus: "READY",
      autoMetadata,
    },
  });

  const chunk = await prisma.knowledgeChunk.upsert({
    where: { documentId_chunkIndex: { documentId: document.id, chunkIndex: 0 } },
    update: {
      content,
      tokenCount: tokenCount(content),
      autoMetadata,
    },
    create: {
      documentId: document.id,
      chunkIndex: 0,
      content,
      tokenCount: tokenCount(content),
      autoMetadata,
    },
  });

  await prisma.knowledgeEmbedding.upsert({
    where: { chunkId: chunk.id },
    update: { values: embedKnowledgeText(content) },
    create: { chunkId: chunk.id, values: embedKnowledgeText(content) },
  });

  console.log(JSON.stringify({ collectionId, documents: 1, sourceQuality: "structured" }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
