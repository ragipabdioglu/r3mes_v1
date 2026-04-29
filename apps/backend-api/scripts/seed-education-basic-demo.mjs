import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const wallet =
  process.env.R3MES_DEV_WALLET ||
  "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const collectionId = "education-basic-demo";

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
    id: "education-exam-objection",
    title: "education-exam-objection",
    content: `# Education Knowledge Card: Sınav sonucuna itiraz

Topic: sınav sonucu itiraz süresi ve resmi kaynak kontrolü
Tags: education, eğitim, sınav, itiraz, süre, başvuru, resmi kaynak

Source Summary: Sınav sonucuna itirazda resmi kılavuz, ilan edilen başvuru süresi, başvuru kanalı ve dekont/belge koşulları kontrol edilmelidir.

Key Takeaway: İtiraz süreci okul, kurum veya sınav kılavuzuna göre değişebilir; süre ve başvuru yöntemi resmi kaynak üzerinden doğrulanmalıdır.

Safe Guidance: Kişi sonuç ekranı, kılavuz, duyuru, dekont ve başvuru belgelerini saklamalı; süre dolmadan okul veya ilgili kurumla iletişime geçmelidir.

Red Flags: Süre dolmak üzereyse, resmi kaynak belirsizse, sonuç ekranı değiştiyse veya başvuru kanalı kapanıyorsa hızlı kontrol gerekir.

Do Not Infer: İtiraz kesin kabul edilir, puan kesin değişir veya kurum kesin hata yapmıştır deme.`,
  },
  {
    id: "education-special-ram-bep",
    title: "education-special-ram-bep",
    content: `# Education Knowledge Card: RAM raporu ve BEP

Topic: özel eğitim değerlendirmesi, RAM raporu ve BEP planı
Tags: education, eğitim, özel eğitim, RAM, BEP, veli, değerlendirme

Source Summary: Özel eğitim sürecinde RAM değerlendirmesi, okul gözlemleri, veli bilgisi, uzman raporları ve BEP planı birlikte izlenmelidir.

Key Takeaway: BEP planı öğrencinin ihtiyacına göre hazırlanır; veli, okul ve rehberlik birimi düzenli değerlendirme ve güncelleme yapmalıdır.

Safe Guidance: Veli rapor, okul görüşmesi, gözlem notu ve BEP hedeflerini saklamalı; belirsizlikte rehberlik servisi veya RAM ile görüşmelidir.

Red Flags: Çocuğun güvenliği, eğitimden kopma, raporun yanlış uygulanması veya ciddi uyum sorunu varsa hızlı okul/RAM değerlendirmesi gerekir.

Do Not Infer: Kesin tanı koyma, tedavi önerme veya BEP kesin şu sonucu sağlar deme.`,
  },
  {
    id: "education-discipline-parent",
    title: "education-discipline-parent",
    content: `# Education Knowledge Card: Okul disiplin süreci

Topic: öğrenci disiplin süreci ve veli bilgilendirme
Tags: education, eğitim, okul, disiplin, öğrenci, veli, belge

Source Summary: Disiplin sürecinde olay tutanağı, öğrenci savunması, veli bilgilendirmesi, kurul kararı ve resmi okul kayıtları önemlidir.

Key Takeaway: Disiplin değerlendirmesi okul mevzuatı, somut olay, öğrencinin beyanı ve belgelerle birlikte yürütülmelidir.

Safe Guidance: Veli tutanak, karar, yazışma ve bildirimleri saklamalı; okul yönetimi ve rehberlik servisiyle yazılı ve sakin iletişim kurmalıdır.

Red Flags: Şiddet, zorbalık, güvenlik riski, savunma alınmaması veya belgesiz işlem varsa hızlı okul yönetimi değerlendirmesi gerekir.

Do Not Infer: Ceza kesin kalkar, öğrenci kesin haklıdır veya okul kesin haksızdır deme.`,
  },
  {
    id: "education-curriculum-plan",
    title: "education-curriculum-plan",
    content: `# Education Knowledge Card: Müfredat ve ders planı

Topic: müfredat kazanımı ve ders planı kontrolü
Tags: education, eğitim, müfredat, ders, kazanım, plan, resmi kaynak

Source Summary: Ders planı hazırlanırken resmi müfredat, kazanımlar, öğrenci düzeyi, süre, ölçme-değerlendirme ve materyal uyumu kontrol edilmelidir.

Key Takeaway: Ders planı tek başına içerik listesi değildir; kazanım, etkinlik, ölçme ve süre dengesi birlikte kurulmalıdır.

Safe Guidance: Öğretmen resmi kaynakları, kazanım listesini, ders süresini ve ölçme araçlarını kontrol ederek planı küçük doğrulanabilir adımlara bölebilir.

Red Flags: Resmi müfredatla uyumsuz konu, ölçme kriteri belirsizliği veya öğrenci düzeyine uygun olmayan hedefler plan riskidir.

Do Not Infer: Plan kesin başarı sağlar, her sınıfa aynen uygulanır veya resmi kaynak olmadan kesin müfredat bilgisi ver deme.`,
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
      name: "Education Basic Demo",
      visibility: "PRIVATE",
      publishedAt: null,
    },
    create: {
      id: collectionId,
      ownerId: user.id,
      name: "Education Basic Demo",
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
