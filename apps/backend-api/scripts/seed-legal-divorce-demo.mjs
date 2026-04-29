import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const wallet =
  process.env.R3MES_DEV_WALLET ||
  "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const collectionId = "legal-divorce-demo";

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
  for (const token of tokens) {
    values[hashToken(token) % EMBEDDING_DIMENSIONS] += 1;
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    values[hashToken(`${tokens[i]}_${tokens[i + 1]}`) % EMBEDDING_DIMENSIONS] += 0.5;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? values : values.map((value) => value / norm);
}

const cards = [
  {
    id: "legal-divorce-agreed-protocol",
    title: "legal-divorce-agreed-protocol",
    content: `# Legal Knowledge Card: Anlaşmalı boşanma protokolü

Topic: anlaşmalı boşanma ve protokol kontrolü
Tags: legal, hukuk, boşanma, anlaşmalı boşanma, protokol, belge

Source Summary: Anlaşmalı boşanma protokolünde velayet, nafaka, mal paylaşımı, kişisel ilişki, masraf ve taraf iradeleri açık yazılmalıdır.

Key Takeaway: Protokolün eksik veya belirsiz olması süreçte uyuşmazlık doğurabilir; imza öncesi belgeler ve anlaşma maddeleri birlikte kontrol edilmelidir.

Safe Guidance: Kişi protokol taslağını, kimlik ve evlilik belgelerini, gelir bilgilerini ve varsa çocukla ilgili belgeleri düzenlemeli; hak kaybı riski varsa avukata danışmalıdır.

Red Flags: Baskı altında imza, belirsiz nafaka/velayet maddesi, mal paylaşımı anlaşmazlığı veya kısa süreli mahkeme tarihi varsa hukuki destek geciktirilmemelidir.

Do Not Infer: Kaynakta açık dayanak yoksa boşanma kesin gerçekleşir, protokol kesin kabul edilir veya taraflardan biri kesin haklıdır deme.`,
  },
  {
    id: "legal-divorce-custody",
    title: "legal-divorce-custody",
    content: `# Legal Knowledge Card: Boşanmada velayet

Topic: velayet değerlendirmesi ve çocuk yararı
Tags: legal, hukuk, boşanma, velayet, çocuk, belge

Source Summary: Velayet değerlendirmesinde çocuğun üstün yararı, bakım düzeni, okul/sağlık kayıtları, ebeveynlerin koşulları ve somut belgeler önemlidir.

Key Takeaway: Velayet tek bir genel kuralla belirlenmez; mahkeme somut olay, çocuk yararı, ebeveynlerin bakım kapasitesi ve belgeleri birlikte değerlendirir.

Safe Guidance: Kişi okul, sağlık, bakım, iletişim ve masraf kayıtlarını düzenlemeli; çocuğu ilgilendiren ihtilaflarda avukattan hukuki değerlendirme almalıdır.

Red Flags: Şiddet iddiası, çocuğun güvenliği, kaçırma riski, görüş engelleme veya acil tedbir ihtiyacı varsa hızlı hukuki destek gerekir.

Do Not Infer: Velayet kesin anneye verilir, kesin babaya verilir veya mahkeme kesin şu yönde karar verir deme.`,
  },
  {
    id: "legal-divorce-alimony",
    title: "legal-divorce-alimony",
    content: `# Legal Knowledge Card: Boşanmada nafaka

Topic: nafaka talebi ve gelir gider belgeleri
Tags: legal, hukuk, boşanma, nafaka, gelir, gider, belge

Source Summary: Nafaka talebinde tarafların gelir durumu, giderleri, ihtiyaçları, çocukla ilgili masraflar ve ödeme gücü belgelerle desteklenmelidir.

Key Takeaway: Nafaka miktarı her olayda otomatik belirlenmez; gelir/gider belgeleri, yaşam koşulları ve talebin türü birlikte değerlendirilir.

Safe Guidance: Kişi maaş bordrosu, banka kaydı, kira, okul, sağlık ve düzenli gider belgelerini toparlamalı; talebin türü ve tutarı için avukata danışmalıdır.

Red Flags: Gelir gizleme iddiası, ödeme gücü tartışması, çocuk masrafları, icra riski veya geçici tedbir ihtiyacı varsa hızlı hukuki değerlendirme gerekir.

Do Not Infer: Kişi kesin nafaka alır, kesin ödemez veya belirli bir tutar kesin uygundur deme.`,
  },
  {
    id: "legal-divorce-property",
    title: "legal-divorce-property",
    content: `# Legal Knowledge Card: Boşanmada mal paylaşımı

Topic: boşanmada mal paylaşımı ve kayıt toplama
Tags: legal, hukuk, boşanma, mal paylaşımı, tapu, banka, belge

Source Summary: Mal paylaşımı değerlendirmesinde edinim tarihi, tapu/kayıt bilgisi, banka hareketleri, borçlar ve katkı iddiaları önemlidir.

Key Takeaway: Mal paylaşımı yalnız malın adına göre değil, edinim zamanı, mal rejimi, ödeme kaynakları ve belgelerle birlikte değerlendirilir.

Safe Guidance: Kişi tapu, ruhsat, banka, kredi, borç, ödeme ve katkı belgelerini düzenlemeli; mal rejimi etkisi için avukattan hukuki destek almalıdır.

Red Flags: Mal kaçırma şüphesi, yüksek bedelli varlık, borç baskısı, belge saklama veya ihtiyati tedbir ihtimali varsa gecikmeden değerlendirme gerekir.

Do Not Infer: Malın kesin yarısı alınır, kesin pay yoktur veya dava kesin kazanılır deme.`,
  },
];

async function main() {
  const user = await prisma.user.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet },
  });

  await prisma.knowledgeCollection.upsert({
    where: { id: collectionId },
    update: {
      ownerId: user.id,
      name: "Legal Divorce Demo",
      visibility: "PRIVATE",
      publishedAt: null,
    },
    create: {
      id: collectionId,
      ownerId: user.id,
      name: "Legal Divorce Demo",
      visibility: "PRIVATE",
    },
  });

  for (const card of cards) {
    const document = await prisma.knowledgeDocument.upsert({
      where: { id: card.id },
      update: {
        collectionId,
        title: card.title,
        sourceType: "MARKDOWN",
        parseStatus: "READY",
        errorMessage: null,
      },
      create: {
        id: card.id,
        collectionId,
        title: card.title,
        sourceType: "MARKDOWN",
        parseStatus: "READY",
      },
    });

    const chunk = await prisma.knowledgeChunk.upsert({
      where: { documentId_chunkIndex: { documentId: document.id, chunkIndex: 0 } },
      update: {
        content: card.content,
        tokenCount: tokenizeKnowledgeText(card.content).length,
      },
      create: {
        documentId: document.id,
        chunkIndex: 0,
        content: card.content,
        tokenCount: tokenizeKnowledgeText(card.content).length,
      },
    });

    await prisma.knowledgeEmbedding.upsert({
      where: { chunkId: chunk.id },
      update: { values: embedKnowledgeText(card.content) },
      create: { chunkId: chunk.id, values: embedKnowledgeText(card.content) },
    });
  }

  console.log(JSON.stringify({ collectionId, documents: cards.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
