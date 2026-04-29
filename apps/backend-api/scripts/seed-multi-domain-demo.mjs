import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const wallet =
  process.env.R3MES_DEV_WALLET ||
  "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const collectionId = "multi-domain-demo";

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
    id: "multi-legal-rent-deposit",
    title: "multi-legal-rent-deposit",
    content: `# Generic Knowledge Card: Kira depozitosu

Topic: kira depozitosu iadesi
Tags: legal, kira, depozito, sözleşme, belge

Source Summary: Kiracı depozitonun iadesi için sözleşme, ödeme dekontu, teslim tutanağı ve yazışmaları saklamalıdır.

Key Takeaway: Depozito uyuşmazlığında sözleşme hükümleri, hasar tespiti, ödeme kaydı ve teslim tarihi birlikte değerlendirilir.

Safe Guidance: Kişi belgeleri düzenlemeli, yazılı başvuru yapmalı ve hak kaybı riski varsa avukat veya yetkili kurumdan destek almalıdır.

Red Flags: İcra tehdidi, kısa süreli ihtar, yüksek bedel veya belge eksikliği varsa hızlı hukuki değerlendirme gerekir.

Do Not Infer: Kaynakta açık dayanak yoksa depozito kesin iade edilir, kesin kesilir veya dava kesin kazanılır deme.`,
  },
  {
    id: "multi-finance-risk-profile",
    title: "multi-finance-risk-profile",
    content: `# Generic Knowledge Card: Yatırım risk profili

Topic: yatırım kararı ve risk profili
Tags: finance, yatırım, risk, portföy, vade

Source Summary: Yatırım kararı verirken kişinin risk profili, vade beklentisi, nakit ihtiyacı ve ürün maliyetleri birlikte düşünülmelidir.

Key Takeaway: Tek bir ürün herkes için uygun değildir; risk, vade ve çeşitlendirme yatırım kararında temel değişkenlerdir.

Safe Guidance: Kişi karar vermeden önce ürün koşullarını okumalı, kayıp ihtimalini değerlendirmeli ve gerekiyorsa lisanslı yatırım danışmanından destek almalıdır.

Red Flags: Getiri garantisi, borçla yatırım, anlamadığı ürüne para yatırma veya kısa vadede yüksek kazanç vaadi ciddi risk işaretidir.

Do Not Infer: Kaynakta açık dayanak yoksa al/sat/tut tavsiyesi, kesin getiri veya kişiye özel portföy önerisi verme.`,
  },
  {
    id: "multi-technical-db-migration",
    title: "multi-technical-db-migration",
    content: `# Generic Knowledge Card: Veritabanı migration güvenliği

Topic: veritabanı migration öncesi kontrol
Tags: technical, veritabanı, migration, yedek, log

Source Summary: Migration çalıştırmadan önce yedek alınmalı, staging ortamında denenmeli, rollback planı hazırlanmalı ve loglar izlenmelidir.

Key Takeaway: Üretim veritabanında migration doğrudan denenmemeli; önce yedek, test ve geri dönüş adımı net olmalıdır.

Safe Guidance: Küçük ve doğrulanabilir adımlarla ilerlemek, migration çıktısını kontrol etmek ve kritik tabloları işlem öncesi yedeklemek gerekir.

Red Flags: Yedeksiz işlem, uzun kilit süresi, belirsiz rollback veya veri silen komutlar yüksek risklidir.

Do Not Infer: Kaynakta açık dayanak yoksa yıkıcı komut, kesin sürüm veya ortama özel bağlantı ayarı uydurma.`,
  },
  {
    id: "multi-general-travel-document",
    title: "multi-general-travel-document",
    content: `# Generic Knowledge Card: Seyahat belge kontrolü

Topic: seyahat öncesi belge kontrolü
Tags: general, seyahat, belge, planlama, kontrol

Source Summary: Seyahat öncesinde kimlik, pasaport, rezervasyon, sigorta ve ulaşım saatleri kontrol edilmelidir.

Key Takeaway: Eksik belge veya yanlış saat bilgisi yolculukta aksama yaratabileceği için hazırlık listesi önceden doğrulanmalıdır.

Safe Guidance: Belgelerin dijital ve basılı kopyasını saklamak, resmi kaynaklardan güncel şartları kontrol etmek ve zaman payı bırakmak gerekir.

Red Flags: Süresi dolmuş belge, yanlış isim, eksik rezervasyon veya son dakika değişikliği risk oluşturabilir.

Do Not Infer: Kaynakta açık dayanak yoksa ülke özelinde vize zorunluluğu, ücret veya kesin giriş şartı söyleme.`,
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
      name: "Multi Domain Demo",
      visibility: "PRIVATE",
      publishedAt: null,
    },
    create: {
      id: collectionId,
      ownerId: user.id,
      name: "Multi Domain Demo",
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
