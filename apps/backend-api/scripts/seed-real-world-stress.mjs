import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const defaultWallet =
  process.env.R3MES_DEV_WALLET ||
  "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const privateOtherWallet = "0xstressprivate0000000000000000000000000000000000000000000000000001";
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

const collections = [
  {
    id: "stress-clean-medical-cervix",
    name: "Stress Clean Medical Cervix",
    ownerWallet: defaultWallet,
    cards: [
      {
        id: "stress-medical-cervix-screening",
        title: "official-medical-cervix-screening",
        content: `# Official Knowledge Card: Rahim ağzı taraması

Topic: smear hpv rahim ağzı kanseri taraması
Tags: medical, smear, hpv, rahim-agzi, tarama, jinekoloji
Source: HSGM / Saglik Bakanligi rahim agzi kanseri tarama bilgilendirmeleri
Source URL: https://hsgm.saglik.gov.tr/tr/haberler-kanser/farkinda-ol-taramani-yaptir-kanseri-engelle.html

Source Summary: Smear ve HPV taramaları rahim ağzı kanseri riskini erken fark etmeye yardım eder; normal tarama sonucu mevcut ağrı veya kanama yakınmasını tek başına açıklamaz.

Key Takeaway: Smear sonucu temiz olsa bile kasık ağrısı, beklenmeyen kanama, kötü kokulu akıntı, ateş veya şiddetlenen ağrı ayrı klinik değerlendirme gerektirebilir.

Safe Guidance: Kişi sonucu ve yakınmasını kadın hastalıkları uzmanıyla paylaşmalı; ağrı şiddetli veya ateş/kanama eşlik ediyorsa gecikmeden sağlık kuruluşuna başvurmalıdır.

Red Flags: Şiddetli kasık ağrısı, bayılma, ateş, yoğun kanama, gebelik şüphesi veya hızla kötüleşme acil değerlendirme gerektirebilir.

Do Not Infer: Kaynakta açık dayanak yoksa kanser tanısı, ilaç, CA-125 takibi veya kesin neden çıkarma.`,
      },
      {
        id: "stress-medical-hpv-followup",
        title: "official-medical-hpv-followup",
        content: `# Official Knowledge Card: HPV ve smear sonucu sonrası takip

Topic: hpv smear sonucu takip
Tags: medical, hpv, smear, takip, doktor, tarama
Source: Saglik Bakanligi smear testi ve HPV testi bilgilendirmesi
Source URL: https://fekedh.saglik.gov.tr/TR%2C221779/smear-testi-hpv-testi-ve-rahim-agzi-kanseri.html

Source Summary: Rahim ağzı taraması kişide riskin erken saptanması için kullanılır; sonuçların anlamı kişinin yaşı, öyküsü ve muayene bulgularıyla birlikte değerlendirilir.

Key Takeaway: Temiz smear sonucu rahatlatıcı olabilir ama yeni veya süren şikayetlerin ayrıca değerlendirilmesini ortadan kaldırmaz.

Safe Guidance: Sonuç raporu, varsa HPV sonucu ve devam eden yakınmalar aynı randevuda hekime gösterilmelidir.

Red Flags: Sonuçtan bağımsız olarak yoğun kanama, kötüleşen ağrı, ateş veya gebelik ihtimali varsa beklenmemelidir.

Do Not Infer: Kaynakta açık dayanak yoksa kişinin kesin sağlıklı olduğunu veya hiçbir kontrole gerek olmadığını söyleme.`,
      },
    ],
  },
  {
    id: "stress-clean-education-bep",
    name: "Stress Clean Education BEP",
    ownerWallet: defaultWallet,
    cards: [
      {
        id: "stress-education-bep-plan",
        title: "official-education-bep-plan",
        content: `# Official Knowledge Card: BEP ve okul destek planı

Topic: bireysellestirilmis egitim plani bep ram okul rehberlik
Tags: education, bep, ram, ozel-egitim, rehberlik, veli
Source: MEB ozel egitim hizmetleri ve ilgili yonetmelik dokumanlari
Source URL: https://orgm.meb.gov.tr/meb_iys_dosyalar/2021_09/13143029_TURKYYEYDE_OZEL_EYYTYM_HYZMETLERY.pdf?CHK=0e5adca2d14d91254ec76181b869804f

Source Summary: Özel eğitim ihtiyacı olan öğrenci için okul, rehberlik birimi ve ilgili kurul süreçleriyle bireyselleştirilmiş destek planı hazırlanabilir.

Key Takeaway: BEP görüşmesinde öğrencinin ihtiyacı, mevcut performansı, hedefler, destek hizmetleri, ölçme yöntemi ve sorumlular netleştirilmelidir.

Safe Guidance: Veli, RAM raporu veya okul değerlendirmeleri, öğretmen gözlemleri ve önceki destek kayıtlarıyla toplantıya hazırlanmalıdır.

Red Flags: Planın yazılı olmaması, hedeflerin ölçülemez olması veya ailenin süreçten habersiz bırakılması takip edilmelidir.

Do Not Infer: Kaynakta açık dayanak yoksa kesin yerleştirme, kesin tanı veya okul adına bağlayıcı karar söyleme.`,
      },
    ],
  },
  {
    id: "stress-clean-technical-postgres",
    name: "Stress Clean Technical Postgres",
    ownerWallet: defaultWallet,
    cards: [
      {
        id: "stress-technical-postgres-backup",
        title: "official-technical-postgres-backup",
        content: `# Official Knowledge Card: PostgreSQL migration öncesi yedek

Topic: postgresql backup restore migration rollback
Tags: technical, postgres, postgresql, migration, backup, restore, rollback
Source: PostgreSQL documentation backup and rollback references
Source URL: https://www.postgresql.org/docs/17/backup.html

Source Summary: PostgreSQL bakım veya migration öncesi yedek stratejisi, geri dönüş planı ve restore doğrulaması planlanmalıdır.

Key Takeaway: Production migration öncesinde güncel yedek alınmalı, staging ortamında denenmeli, geri dönüş adımı yazılı olmalı ve işlem logları izlenmelidir.

Safe Guidance: Kritik tablolar için yedek, migration süresi, kilit riski, restore testi ve rollback komutlarının kapsamı ayrı ayrı kontrol edilmelidir.

Red Flags: Yedeksiz migration, veri silen komut, restore testi olmaması veya rollback planının belirsiz olması yüksek risktir.

Do Not Infer: Kaynakta açık dayanak yoksa ortama özel komut, bağlantı bilgisi veya veri silen işlem önerme.`,
      },
    ],
  },
  {
    id: "stress-clean-kvkk-inventory",
    name: "Stress Clean KVKK Inventory",
    ownerWallet: defaultWallet,
    cards: [
      {
        id: "stress-kvkk-inventory",
        title: "official-kvkk-inventory",
        content: `# Official Knowledge Card: KVKK veri işleme envanteri

Topic: kisisel veri isleme envanteri kvkk
Tags: legal, kvkk, veri-envanteri, kisisel-veri, saklama, alici-grubu
Source: KVKK Kisisel Veri Isleme Envanteri Hazirlama Rehberi
Source URL: https://www.kvkk.gov.tr/Icerik/5445/Kisisel-Veri-Isleme-Envanteri-Hazirlama-Rehberi-Kurum-Internet-Sayfasinda-Yayinlanmistir

Source Summary: Veri işleme envanteri, kişisel veri işleme faaliyetlerini amaç, veri kategorisi, alıcı grubu, saklama süresi, hukuki sebep ve güvenlik tedbirleriyle görünür hale getirir.

Key Takeaway: Envanter hazırlanırken faaliyet bazında amaç, ilgili kişi grubu, veri kategorisi, aktarım, saklama ve teknik/idari tedbirler ayrı ayrı yazılmalıdır.

Safe Guidance: Kurum kendi süreçlerini çıkarıp ilgili birimlerle doğrulamalı; belirsiz hukuki yorumlarda uzman desteği almalıdır.

Red Flags: Saklama süresi yazılmaması, alıcıların belirsiz olması, özel nitelikli veri tedbirlerinin atlanması veya faaliyetlerin çok genel yazılması risktir.

Do Not Infer: Kaynakta açık dayanak yoksa kesin hukuki görüş, ceza sonucu veya kurum özelinde yükümlülük sonucu verme.`,
      },
    ],
  },
  {
    id: "stress-dirty-user-docs",
    name: "Stress Dirty User Docs",
    ownerWallet: defaultWallet,
    cards: [
      {
        id: "stress-dirty-ocr-cervix",
        title: "dirty-ocr-smear-note",
        content: `PDF COPY >>> Kadın doğum poliklinik notu / tarama sonucu

TABLO|bulgu|yorum
smear: normal gorunuyor | hpv: yazilmamis | yakinma: ara ara kasik agrisi
OCR HATASI: kasik agriyo / kasigim agriyor / alt karin sancisi ayni yakinma olarak kaydedilmis olabilir.

Ozet: Tarama sonucu normal olsa bile agrinin nedeni bu rapordan kesin cikarilamaz. Siklik, siddet, gebelik ihtimali, ates, kanama ve akinti sorulmalidir.

Guvenli not: Kisiye tani veya ilac soyleme; sikayet surerse kadin hastaliklari muayenesi oner. Siddetli agri, ates, yogun kanama veya bayilma varsa acil basvuru gerekir.`,
      },
      {
        id: "stress-dirty-table-bep",
        title: "dirty-table-bep-meeting",
        content: `SCAN TABLE >>> OKUL TOPLANTI FORMU

ogrenci ihtiyaci | destek | izlem
okuma guclugu | bep hedefi kucuk parcalara bol | ayda bir kontrol
dikkat daginikligi | sinif ici duzenleme | veli-ogretmen gorusmesi

Not: Belge kirli OCR olabilir. BEP icin hedef, sorumlu kisi, olcme yontemi ve izleme tarihi yazili hale getirilmelidir. RAM raporu varsa okulla paylasilir.`,
      },
    ],
  },
  {
    id: "stress-contradictory-docs",
    name: "Stress Contradictory Docs",
    ownerWallet: defaultWallet,
    cards: [
      {
        id: "stress-contradiction-migration-safe",
        title: "contradiction-migration-safe",
        content: `# Internal Runbook A: Migration güvenliği

Topic: production migration rollback
Tags: technical, migration, backup, rollback, staging

Source Summary: Production migration öncesinde yedek almak, staging denemesi yapmak, rollback planını yazmak ve logları izlemek gerekir.

Key Takeaway: Rollback planı olmadan production migration çalıştırılmamalıdır.

Red Flags: Yedek yoksa, rollback belirsizse veya veri silen komut varsa işlem ertelenmelidir.`,
      },
      {
        id: "stress-contradiction-migration-unsafe",
        title: "contradiction-migration-unsafe",
        content: `# Internal Runbook B: Eski ve guvenilmez not

Topic: production migration hizli gecis
Tags: technical, migration, no-backup, rollback-yok

Source Summary: Eski not, küçük migrationlarda yedek ve rollback planına gerek olmadığını iddia eder.

Key Takeaway: Rollback planı production migration için gerekli değildir iddiası bu koleksiyondaki diğer kaynakla çelişir.

Red Flags: Bu not güncel doğrulama olmadan kullanılmamalıdır; yedeksiz işlem güvenli kabul edilmemelidir.`,
      },
    ],
  },
  {
    id: "stress-private-office-docs",
    name: "Stress Private Office Docs",
    ownerWallet: privateOtherWallet,
    cards: [
      {
        id: "stress-private-client-note",
        title: "private-client-confidential-note",
        content: `# Confidential Office Note

Topic: gizli muvekkil sozlesme feshi
Tags: legal, private, confidential, client

Private Summary: Müvekkil Deniz Yılmaz için sözleşme feshi, ödeme gecikmesi ve karşı tarafa gönderilecek ihtar taslağı konuşulmuştur.

Do Not Leak: Deniz Yılmaz adı, dosya notları ve özel strateji başka cüzdanlara gösterilmemelidir.`,
      },
    ],
  },
];

async function upsertOwner(wallet) {
  return prisma.user.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet },
  });
}

async function upsertCard(collectionId, card) {
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

async function main() {
  const results = [];
  for (const collection of collections) {
    const user = await upsertOwner(collection.ownerWallet);
    await prisma.knowledgeCollection.upsert({
      where: { id: collection.id },
      update: {
        ownerId: user.id,
        name: collection.name,
        visibility: "PRIVATE",
        publishedAt: null,
      },
      create: {
        id: collection.id,
        ownerId: user.id,
        name: collection.name,
        visibility: "PRIVATE",
      },
    });

    for (const card of collection.cards) {
      await upsertCard(collection.id, card);
    }

    results.push({
      collectionId: collection.id,
      ownerWallet: collection.ownerWallet === defaultWallet ? "default" : "other",
      documents: collection.cards.length,
    });
  }

  console.log(JSON.stringify({ collections: results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
