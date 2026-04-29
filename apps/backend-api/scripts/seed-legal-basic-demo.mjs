import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const wallet = process.env.R3MES_DEV_WALLET || "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const collectionId = "legal-basic-demo";

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
    id: "legal-card-lease-termination",
    title: "legal-card-lease-termination",
    content: `# Legal Card: Kira sözleşmesi feshi

Topic: kira sözleşmesi feshi
Tags: hukuk, kira, sözleşme, fesih, tahliye

Patient Summary: Kiracı veya ev sahibi kira sözleşmesinin hemen sona erip ermeyeceğini soruyor.

Clinical Takeaway: Kira sözleşmesinin feshi; sözleşme maddeleri, bildirim süresi, kanuni gerekçe ve somut olay tarihine göre değerlendirilir.

Safe Guidance: Taraflar yazılı bildirimleri, sözleşme hükümlerini ve süreleri saklamalı; hak kaybı riski varsa avukata danışmalıdır.

Red Flags: Tahliye tehdidi, kısa süreli bildirim, icra/mahkeme evrakı veya süreli ihtar varsa gecikmeden hukuki destek alınmalıdır.

Do Not Infer: Kaynakta açık dayanak yoksa kesin tahliye olur, dava kesin kazanılır veya sözleşme kesin geçersizdir deme.`,
  },
  {
    id: "legal-card-overtime",
    title: "legal-card-overtime",
    content: `# Legal Card: Fazla mesai ücreti

Topic: fazla mesai ücreti ve kanıt
Tags: hukuk, işçi, fazla mesai, ücret, kanıt

Patient Summary: Çalışan fazla mesai ücretini alamadığını ve ilk adımı soruyor.

Clinical Takeaway: Fazla mesai uyuşmazlıklarında çalışma kayıtları, bordro, yazışma, tanık ve işyeri uygulaması gibi kanıtlar önemlidir.

Safe Guidance: Kişi belgelerini saklamalı, tarihleri not etmeli ve süre kaybı yaşamamak için avukat veya yetkili kurumdan destek almalıdır.

Red Flags: İşten çıkarma, baskı, imza zorlaması veya zamanaşımı riski varsa hızlı hukuki değerlendirme gerekir.

Do Not Infer: Kesin tazminat alınır, dava kesin kazanılır veya işveren kesin haksızdır deme.`,
  },
  {
    id: "legal-card-defective-product",
    title: "legal-card-defective-product",
    content: `# Legal Card: Ayıplı ürün

Topic: ayıplı ürün ve tüketici başvurusu
Tags: hukuk, tüketici, ayıplı ürün, iade, belge

Patient Summary: Tüketici ayıplı ürün aldığını ve satıcının iade kabul etmediğini söylüyor.

Clinical Takeaway: Ayıplı ürün uyuşmazlığında fatura, garanti belgesi, yazışmalar, fotoğraf ve başvuru tarihleri önemlidir.

Safe Guidance: Tüketici belgeleri saklayarak satıcıya yazılı başvuru yapmalı; sonuç alamazsa yetkili tüketici merciine başvuru seçeneklerini değerlendirmelidir.

Red Flags: Sürelerin kaçması, ürünün delil niteliğinin kaybolması veya yüksek bedelli uyuşmazlıkta profesyonel destek gerekebilir.

Do Not Infer: Başvuru kesin kazanılır, satıcı kesin suçludur veya iade her durumda zorunludur deme.`,
  },
  {
    id: "legal-card-traffic-fine",
    title: "legal-card-traffic-fine",
    content: `# Legal Card: Trafik cezasına itiraz

Topic: trafik cezasına itiraz süresi
Tags: hukuk, trafik cezası, itiraz, süre, belge

Patient Summary: Kişi trafik cezasına itiraz etmek istiyor ve süreye dikkat etmek istiyor.

Clinical Takeaway: Trafik cezasına itirazda tebliğ tarihi, başvuru süresi, ceza tutanağı ve deliller belirleyicidir.

Safe Guidance: Tebliğ tarihini not etmek, ceza tutanağını ve delilleri saklamak ve süre dolmadan yetkili mercie başvuru yolunu araştırmak gerekir.

Red Flags: Süre dolmak üzereyse veya tebligat tarihi belirsizse hızlı hukuki değerlendirme yapılmalıdır.

Do Not Infer: Ceza kesin iptal olur, itiraz kesin kabul edilir veya ödeme her durumda hakkı düşürür deme.`,
  },
  {
    id: "legal-card-contract-penalty",
    title: "legal-card-contract-penalty",
    content: `# Legal Card: Sözleşmede cezai şart

Topic: sözleşmede cezai şart
Tags: hukuk, sözleşme, cezai şart, borç, belge

Patient Summary: Kişi sözleşmedeki cezai şartın otomatik uygulanıp uygulanmayacağını soruyor.

Clinical Takeaway: Cezai şartın uygulanması sözleşme metni, ihlal iddiası, tarafların yükümlülükleri ve olayın koşullarına göre değerlendirilir.

Safe Guidance: Sözleşme metni, ek protokoller, yazışmalar ve ödeme/teslim belgeleri birlikte incelenmeli; önemli sonuç doğuruyorsa avukata danışılmalıdır.

Red Flags: Yüksek bedel, icra tehdidi, imza baskısı veya kısa cevap süresi varsa gecikmeden hukuki destek alınmalıdır.

Do Not Infer: Cezai şart kesin uygulanır, kesin uygulanmaz veya mahkeme kesin şu yönde karar verir deme.`,
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
      name: "Legal Basic Demo",
      visibility: "PRIVATE",
      publishedAt: null,
    },
    create: {
      id: collectionId,
      ownerId: user.id,
      name: "Legal Basic Demo",
      visibility: "PRIVATE",
    },
  });

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
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
