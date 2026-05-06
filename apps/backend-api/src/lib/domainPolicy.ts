import type { AnswerDomain } from "./answerSchema.js";
import type { DomainRoutePlan } from "./queryRouter.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

export interface DomainPolicy {
  domain: AnswerDomain;
  assistantRole: string;
  answerLabels: {
    assessment: string;
    action: string;
    caution: string;
    summary: string;
  };
  rules: string[];
}

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

function hasAny(text: string, terms: string[]): boolean {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(normalize(term)));
}

export function inferAnswerDomain(opts: {
  userQuery: string;
  evidence: EvidenceExtractorOutput | null;
  contextText: string;
  routePlan?: DomainRoutePlan | null;
  selectedCollectionDomain?: AnswerDomain | null;
}): AnswerDomain {
  if (opts.selectedCollectionDomain) {
    return opts.selectedCollectionDomain;
  }
  if (opts.routePlan && opts.routePlan.confidence === "high") {
    return opts.routePlan.domain;
  }

  const evidenceText = [
    ...(opts.evidence?.usableFacts ?? []),
    ...(opts.evidence?.uncertainOrUnusable ?? []),
    ...(opts.evidence?.redFlags ?? []),
  ].join(" ");
  const haystack = `${opts.userQuery}\n${evidenceText}\n${opts.contextText}`;

  if (
    hasAny(haystack, [
      "eğitim",
      "egitim",
      "öğrenci",
      "ogrenci",
      "öğretmen",
      "ogretmen",
      "okul",
      "sınav",
      "sinav",
      "müfredat",
      "mufredat",
      "disiplin",
      "özel eğitim",
      "ozel egitim",
    ])
  ) {
    return "education";
  }

  if (
    hasAny(haystack, [
      "hukuk",
      "dava",
      "mahkeme",
      "avukat",
      "sözleşme",
      "sozlesme",
      "tazminat",
      "kanun",
      "yasa",
      "icra",
      "kiracı",
      "kiraci",
      "işçi",
      "isci",
      "tüketici",
      "tuketici",
      "ayıplı",
      "ayipli",
      "iade",
      "satıcı",
      "satici",
      "ceza",
    ])
  ) {
    return "legal";
  }

  if (
    hasAny(haystack, [
      "doktor",
      "muayene",
      "hastalık",
      "hastalik",
      "belirti",
      "semptom",
      "ilaç",
      "ilac",
      "tedavi",
      "smear",
      "hpv",
      "gebelik",
      "kanama",
      "ağrı",
      "agri",
    ])
  ) {
    return "medical";
  }

  if (
    hasAny(haystack, [
      "yatırım",
      "yatirim",
      "hisse",
      "borsa",
      "kripto",
      "faiz",
      "kredi",
      "portföy",
      "portfoy",
      "finans",
    ])
  ) {
    return "finance";
  }

  if (
    hasAny(haystack, [
      "kod",
      "api",
      "veritabanı",
      "veritabani",
      "sunucu",
      "deploy",
      "typescript",
      "python",
      "hata",
      "bug",
    ])
  ) {
    return "technical";
  }

  return "general";
}

export function getDomainPolicy(domain: AnswerDomain): DomainPolicy {
  if (domain === "medical") {
    return {
      domain,
      assistantRole: "dikkatli ve sade konuşan bir sağlık bilgi asistanı",
      answerLabels: {
        assessment: "Genel değerlendirme",
        action: "Ne yapmalı",
        caution: "Ne zaman doktora başvurmalı",
        summary: "Kısa özet",
      },
      rules: [
        "Tanı koyma, ilaç dozu veya tedavi başlatma önerisi verme.",
        "Alarm bulgusu varsa tıbbi değerlendirmeye yönlendir.",
        "Kaynakta olmayan test, hastalık adı veya risk çıkarımı ekleme.",
      ],
    };
  }

  if (domain === "legal") {
    return {
      domain,
      assistantRole: "dikkatli ve sade konuşan bir hukuk bilgi asistanı",
      answerLabels: {
        assessment: "Kaynağa göre durum",
        action: "Ne yapılabilir",
        caution: "Nelere dikkat edilmeli",
        summary: "Kısa özet",
      },
      rules: [
        "Kesin hukuki görüş, dava sonucu veya garanti ifade etme.",
        "Yargı alanı, tarih veya somut belge eksikse belirsizliği açık söyle.",
        "Gerekirse avukat veya yetkili kurumdan destek alınmasını öner.",
      ],
    };
  }

  if (domain === "finance") {
    return {
      domain,
      assistantRole: "dikkatli ve sade konuşan bir finans bilgi asistanı",
      answerLabels: {
        assessment: "Kaynağa göre durum",
        action: "Ne yapılabilir",
        caution: "Riskler",
        summary: "Kısa özet",
      },
      rules: [
        "Al/sat/tut gibi kişisel yatırım tavsiyesi verme.",
        "Getiri garantisi veya kesin piyasa tahmini yapma.",
        "Riskleri ve kişisel koşulların önemini belirt.",
      ],
    };
  }

  if (domain === "technical") {
    return {
      domain,
      assistantRole: "dikkatli ve pratik bir teknik bilgi asistanı",
      answerLabels: {
        assessment: "Kaynağa göre durum",
        action: "Ne yapılabilir",
        caution: "Dikkat edilmesi gerekenler",
        summary: "Kısa özet",
      },
      rules: [
        "Kaynakta olmayan sürüm, komut veya yapılandırma detayı uydurma.",
        "Belirsiz ortam varsayımlarını açık belirt.",
        "Riskli işlem varsa önce yedekleme veya kontrollü deneme öner.",
      ],
    };
  }

  if (domain === "education") {
    return {
      domain,
      assistantRole: "dikkatli ve sade konuşan bir eğitim bilgi asistanı",
      answerLabels: {
        assessment: "Kaynağa göre durum",
        action: "Ne yapılabilir",
        caution: "Dikkat edilmesi gerekenler",
        summary: "Kısa özet",
      },
      rules: [
        "Kaynakta olmayan yönetmelik, sınav tarihi veya kurum kararı uydurma.",
        "Öğrenciye özel karar için okul, rehberlik birimi veya yetkili kurum bilgisinin gerekebileceğini belirt.",
        "Belirsiz mevzuat veya yerel uygulama varsa bunu açık söyle.",
      ],
    };
  }

  return {
    domain,
    assistantRole: "dikkatli ve sade konuşan bir kaynak destekli bilgi asistanı",
    answerLabels: {
      assessment: "Kaynağa göre durum",
      action: "Ne yapılabilir",
      caution: "Nelere dikkat edilmeli",
      summary: "Kısa özet",
    },
    rules: [
      "Yalnızca verilen kaynakların desteklediği bilgiyi kullan.",
      "Bilgi yetersizse açıkça belirt.",
      "Kesinlik gerektiren iddialarda temkinli konuş.",
    ],
  };
}
