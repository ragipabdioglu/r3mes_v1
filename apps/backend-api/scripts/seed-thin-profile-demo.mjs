import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const wallet =
  process.env.R3MES_DEV_WALLET ||
  "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const collectionId = "thin-contract-demo";
const EMBEDDING_DIMENSIONS = 256;

function normalizeKnowledgeText(text) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

function tokenizeKnowledgeText(text) {
  return text
    ? normalizeKnowledgeText(text)
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 1 || /\d/.test(part))
    : [];
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function embedKnowledgeText(text) {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = tokenizeKnowledgeText(text);
  for (const token of tokens) values[hashToken(token) % EMBEDDING_DIMENSIONS] += 1;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    values[hashToken(`${tokens[i]}_${tokens[i + 1]}`) % EMBEDDING_DIMENSIONS] += 0.5;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? values : values.map((value) => value / norm);
}

function buildThinMetadata() {
  const profileText = [
    "Domains: legal",
    "Subtopics: sozlesme, fesih, odeme",
    "Keywords: sözleşme, fesih, ödeme, dekont, yazışma, ihtar, avukat",
    "Summary: Kullanıcının yüklediği ham sözleşme notları ödeme gecikmesi, fesih bildirimi, dekont ve yazışma saklama konularına değinir.",
    "Source quality: thin",
    "Confidence: low",
  ].join("\n");
  const profileTextHash = createHash("sha256").update(profileText, "utf8").digest("hex");
  const timestamp = "2026-04-30T00:00:00.000Z";
  return {
    domain: "legal",
    subtopics: ["sozlesme", "fesih", "odeme"],
    keywords: ["sözleşme", "fesih", "ödeme", "dekont", "yazışma", "ihtar", "avukat"],
    entities: ["sözleşme notları"],
    documentType: "raw_note",
    audience: "client",
    riskLevel: "medium",
    summary: "Ham sözleşme notları ödeme gecikmesi ve fesih bildirimi için belge kontrolü yapılmasını anlatır.",
    questionsAnswered: [
      "Sözleşmede fesih ve ödeme gecikmesi için hangi belgeler kontrol edilmeli?",
      "Dekont ve yazışmalar neden saklanmalı?",
    ],
    sourceQuality: "thin",
    profile: {
      version: 1,
      profileVersion: 1,
      domains: ["legal"],
      subtopics: ["sozlesme", "fesih", "odeme"],
      keywords: ["sözleşme", "fesih", "ödeme", "dekont", "yazışma", "ihtar", "avukat"],
      entities: ["sözleşme notları"],
      documentTypes: ["raw_note"],
      audiences: ["client"],
      sampleQuestions: [
        "Sözleşmede fesih ve ödeme gecikmesi için hangi belgeler kontrol edilmeli?",
        "Dekont ve yazışmalar neden saklanmalı?",
      ],
      summary: "Ham sözleşme notları ödeme gecikmesi ve fesih bildirimi için belge kontrolü yapılmasını anlatır.",
      riskLevel: "medium",
      sourceQuality: "thin",
      confidence: "low",
      profileText,
      profileTextHash,
      profileEmbedding: embedKnowledgeText(profileText),
      summaryEmbedding: embedKnowledgeText("Ham sözleşme notları ödeme gecikmesi ve fesih bildirimi için belge kontrolü yapılmasını anlatır."),
      sampleQuestionsEmbedding: embedKnowledgeText("Sözleşmede fesih ve ödeme gecikmesi için hangi belgeler kontrol edilmeli? Dekont ve yazışmalar neden saklanmalı?"),
      keywordsEmbedding: embedKnowledgeText("sözleşme fesih ödeme dekont yazışma ihtar avukat"),
      entityEmbedding: embedKnowledgeText("sözleşme notları"),
      lastProfiledAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

const content = `Sözleşme notları: ödeme gecikmesi olursa önce sözleşmedeki fesih ve ihtar maddesi, ödeme tarihi, dekont, e-posta ve yazışmalar birlikte kontrol edilmeli. Kesin sonuç söylenmeden önce belge tarihleri netleştirilmeli; hak kaybı riski varsa avukat veya yetkili kurumdan destek alınmalı.`;

async function main() {
  const user = await prisma.user.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet },
  });
  const autoMetadata = buildThinMetadata();

  await prisma.knowledgeCollection.upsert({
    where: { id: collectionId },
    update: {
      ownerId: user.id,
      name: "Thin Contract Demo",
      visibility: "PRIVATE",
      publishedAt: null,
      autoMetadata,
    },
    create: {
      id: collectionId,
      ownerId: user.id,
      name: "Thin Contract Demo",
      visibility: "PRIVATE",
      autoMetadata,
    },
  });

  const document = await prisma.knowledgeDocument.upsert({
    where: { id: "thin-contract-demo-doc" },
    update: {
      collectionId,
      title: "thin-contract-demo-doc",
      sourceType: "TEXT",
      parseStatus: "READY",
      errorMessage: null,
      autoMetadata,
    },
    create: {
      id: "thin-contract-demo-doc",
      collectionId,
      title: "thin-contract-demo-doc",
      sourceType: "TEXT",
      parseStatus: "READY",
      autoMetadata,
    },
  });

  const chunk = await prisma.knowledgeChunk.upsert({
    where: { documentId_chunkIndex: { documentId: document.id, chunkIndex: 0 } },
    update: {
      content,
      tokenCount: tokenizeKnowledgeText(content).length,
      autoMetadata,
    },
    create: {
      documentId: document.id,
      chunkIndex: 0,
      content,
      tokenCount: tokenizeKnowledgeText(content).length,
      autoMetadata,
    },
  });

  await prisma.knowledgeEmbedding.upsert({
    where: { chunkId: chunk.id },
    update: { values: embedKnowledgeText(content) },
    create: { chunkId: chunk.id, values: embedKnowledgeText(content) },
  });

  console.log(JSON.stringify({ collectionId, sourceQuality: autoMetadata.sourceQuality, documents: 1 }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
