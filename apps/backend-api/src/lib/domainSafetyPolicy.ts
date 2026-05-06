import type { AnswerDomain } from "./answerSchema.js";

export interface DomainSafetyPolicy {
  domain: AnswerDomain;
  riskyCertaintyPatterns: RegExp[];
  redFlagTerms: string[];
  requiredGuidanceTerms: string[];
  fallbackGuidance: {
    action: string;
    caution: string;
    summary: string;
  };
}

const COMMON_RISKY_CERTAINTY_PATTERNS = [
  /(?<![\p{L}])kesin(?:likle)?(?![\p{L}])(?![^.!?\n]{0,100}(?:değil|degil|doğru olmaz|dogru olmaz|önermek doğru olmaz|onermek dogru olmaz|yerine|söylenemez|soylenemez|söylenmemeli|soylenmemeli|sunulmamalı|sunulmamali|göstermez|gostermez|anlamına gelmez|anlamina gelmez|karar vermeden|çıkarılmamalı|cikarilmamali))/iu,
  /(?<![\p{L}])mutlaka(?![\p{L}])(?![^.!?\n]{0,80}(?:değil|degil|gerekmez))/iu,
  /(?<![\p{L}])net\s+olarak(?![\p{L}])(?![^.!?\n]{0,80}(?:söylenemez|soylenemez|belirtilemez))/iu,
  /\bhiç\s+gerek\s+yok\b/iu,
  /\btek\s+yapman(?:ız)?\s+gereken\b/iu,
];

const COMMON_GUIDANCE_TERMS = [
  "başvur",
  "basvur",
  "kontrol",
  "değerlendirme",
  "degerlendirme",
  "uzman",
  "yetkili",
];

const SAFETY_POLICIES: Record<AnswerDomain, DomainSafetyPolicy> = {
  medical: {
    domain: "medical",
    riskyCertaintyPatterns: [
      ...COMMON_RISKY_CERTAINTY_PATTERNS,
      /\bkesin(?:likle)?\s+kanser(?:dir|sin|siniz)?\b/iu,
      /\bkanser\s+olduğun(?:u|uz)\s+kesin\b/iu,
      /\bmutlaka\s+ameliyat\b/iu,
      /\bila[cç]\s+ba[sş]la\b/iu,
      /\bantibiyotik\s+kullan\b/iu,
      /\btedaviye\s+ba[sş]la\b/iu,
      /\bbu\s+hastal[ıi]kt[ıi]r\b/iu,
    ],
    redFlagTerms: [
      "şiddetli",
      "siddetli",
      "ateş",
      "ates",
      "kusma",
      "bayılma",
      "bayilma",
      "kanama",
      "gebelik",
      "hamile",
      "nefes darlığı",
      "nefes darligi",
    ],
    requiredGuidanceTerms: [
      "başvur",
      "basvur",
      "acil",
      "gecikmeden",
      "daha hızlı",
      "daha hizli",
      "değerlendirme",
      "degerlendirme",
    ],
    fallbackGuidance: {
      action: "Kesin tanı veya tedavi önermek doğru olmaz; yakınma sürüyorsa uygun bir sağlık profesyoneliyle görüşün.",
      caution:
        "Şiddetli ağrı, ateş, kusma, bayılma, anormal kanama veya hızla kötüleşme varsa gecikmeden başvurun.",
      summary: "Güvenli ilerlemek için belirtilerin süresi, şiddeti ve eşlik eden bulgular değerlendirilmelidir.",
    },
  },
  legal: {
    domain: "legal",
    riskyCertaintyPatterns: [
      ...COMMON_RISKY_CERTAINTY_PATTERNS,
      /\bdavay[ıi]\s+kesin\s+kazan[ıi]rs[ıi]n(?:[ıi]z)?\b/iu,
      /\bkesin\s+tazminat\s+al[ıi]rs[ıi]n(?:[ıi]z)?\b/iu,
      /(?<![\p{L}])kesin\s+sonu[cç]\s+(?:al[ıi]rs[ıi]n(?:[ıi]z)?|[cç][ıi]kar|garanti)(?![\p{L}])/iu,
      /\bavukata\s+gerek\s+yok\b/iu,
    ],
    redFlagTerms: ["süre", "itiraz", "tebligat", "icra", "dava", "mahkeme", "hak kaybı", "hak kaybi"],
    requiredGuidanceTerms: ["avukat", "yetkili", "süre", "sure", "belge", "başvuru", "basvuru", "kurum"],
    fallbackGuidance: {
      action:
        "Kesin hukuki görüş vermek doğru olmaz; ilgili belge, tarih ve yargı alanı netleştirilmelidir.",
      caution: "Hak kaybı riski varsa süreleri kaçırmadan avukat veya yetkili kurumdan destek alın.",
      summary: "Kaynak yetersizse hukuki sonucu kesinleştirmemek gerekir.",
    },
  },
  finance: {
    domain: "finance",
    riskyCertaintyPatterns: [
      ...COMMON_RISKY_CERTAINTY_PATTERNS,
      /\bkesin\s+al\b/iu,
      /\bkesin\s+sat\b/iu,
      /\bgarantili\s+getiri\b/iu,
      /\bzarar\s+etmezsin(?:iz)?\b/iu,
      /\bkesin\s+kazan[ıi]rs[ıi]n(?:[ıi]z)?\b/iu,
    ],
    redFlagTerms: ["yatırım", "yatirim", "hisse", "kripto", "kredi", "borç", "borc", "risk", "getiri"],
    requiredGuidanceTerms: ["risk", "vade", "maliyet", "danışman", "danisman", "kişisel", "kisisel"],
    fallbackGuidance: {
      action:
        "Kişisel yatırım tavsiyesi vermek doğru olmaz; karar öncesi risk, vade, kişisel koşullar ve lisanslı danışman desteği değerlendirilmelidir.",
      caution: "Getiri garantisi veya kesin piyasa tahmini yapılamaz.",
      summary: "Finansal karar için kaynak ve risk analizi birlikte ele alınmalıdır.",
    },
  },
  technical: {
    domain: "technical",
    riskyCertaintyPatterns: [
      ...COMMON_RISKY_CERTAINTY_PATTERNS,
      /\bproduction(?:da)?\s+doğrudan\s+(?:sil|drop|truncate|delete|çalıştır|calistir)/iu,
      /\byedek(?:leme)?\s+almadan\s+(?:sil|drop|truncate|delete|deploy|migration)/iu,
      /\brollback(?:e)?\s+gerek\s+yok\b/iu,
    ],
    redFlagTerms: ["production", "prod", "migration", "delete", "drop", "truncate", "deploy", "veri sil"],
    requiredGuidanceTerms: ["yedek", "backup", "rollback", "staging", "test", "log", "kontrollü", "kontrollu"],
    fallbackGuidance: {
      action: "Ortam ve sürüm bilgisi netleşmeden riskli komut veya yapılandırma önermek doğru olmaz.",
      caution: "Değişiklikleri önce kontrollü ortamda ve yedekle deneyin.",
      summary: "Eksik teknik ayrıntılar netleşmeden kesin uygulama adımı verilmemelidir.",
    },
  },
  education: {
    domain: "education",
    riskyCertaintyPatterns: [
      ...COMMON_RISKY_CERTAINTY_PATTERNS,
      /(?<![\p{L}])kesin\s+ge[cç]er(?:sin|siniz)?(?![\p{L}])/iu,
      /(?<![\p{L}])kesin\s+yerle[sş]ir(?:sin|siniz)?(?![\p{L}])/iu,
      /\bkurula?\s+gerek\s+yok\b/iu,
    ],
    redFlagTerms: ["disiplin", "sınav", "sinav", "devamsızlık", "devamsizlik", "bep", "ram", "özel eğitim", "ozel egitim"],
    requiredGuidanceTerms: ["okul", "rehberlik", "resmi", "kurum", "yönetmelik", "yonetmelik", "veli"],
    fallbackGuidance: {
      action:
        "Öğrenciye özel kesin karar vermeden önce okul, rehberlik birimi veya yetkili kurum bilgisi netleştirilmelidir.",
      caution: "Kaynakta olmayan yönetmelik, sınav tarihi veya kurum kararı uydurulmamalıdır.",
      summary: "Eğitim konusunda kaynak ve resmi süreç birlikte değerlendirilmelidir.",
    },
  },
  general: {
    domain: "general",
    riskyCertaintyPatterns: COMMON_RISKY_CERTAINTY_PATTERNS,
    redFlagTerms: ["acil", "risk", "zarar", "tehlike"],
    requiredGuidanceTerms: COMMON_GUIDANCE_TERMS,
    fallbackGuidance: {
      action: "Karar vermeden önce güncel ve yetkili kaynakla doğrulama yapın.",
      caution: "Kaynakta açık dayanak yoksa kesin hüküm kurulmamalıdır.",
      summary: "Kaynak desteği sınırlıysa temkinli ilerlemek gerekir.",
    },
  },
};

export function getDomainSafetyPolicy(domain: AnswerDomain): DomainSafetyPolicy {
  return SAFETY_POLICIES[domain] ?? SAFETY_POLICIES.general;
}

export function getRiskyCertaintyPatterns(domain: AnswerDomain): RegExp[] {
  return getDomainSafetyPolicy(domain).riskyCertaintyPatterns;
}
