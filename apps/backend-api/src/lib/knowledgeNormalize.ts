import { normalizeKnowledgeText } from "./knowledgeEmbedding.js";

const STRUCTURED_LABELS = [
  "Topic:",
  "Tags:",
  "Source Summary:",
  "Key Takeaway:",
  "Patient Summary:",
  "Clinical Takeaway:",
  "Safe Guidance:",
  "Red Flags:",
  "Do Not Infer:",
  "Başlık:",
  "Etiketler:",
  "Temel Bilgi:",
  "Triage:",
  "Uyarı Bulguları:",
  "Çıkarım Yapma:",
];

type KnowledgeDomain = "medical" | "legal" | "finance" | "technical" | "education" | "general";

interface NormalizedChunk {
  domain: KnowledgeDomain;
  topic: string;
  tags: string[];
  claim: string;
  guidance: string;
  riskFlags: string;
  limits: string;
}

function hasStructuredKnowledgeFields(content: string): boolean {
  return STRUCTURED_LABELS.some((label) => new RegExp(`^\\s*${escapeRegExp(label)}`, "im").test(content));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return compact(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasAny(text: string, terms: string[]): boolean {
  const normalized = normalizeKnowledgeText(text);
  return terms.some((term) => normalized.includes(normalizeKnowledgeText(term)));
}

function inferDomain(text: string): KnowledgeDomain {
  if (
    hasAny(text, [
      "hukuk",
      "dava",
      "mahkeme",
      "avukat",
      "sözleşme",
      "tazminat",
      "tüketici",
      "itiraz",
      "ceza",
      "icra",
      "kira",
    ])
  ) {
    return "legal";
  }

  if (
    hasAny(text, [
      "doktor",
      "hekim",
      "muayene",
      "tedavi",
      "ilaç",
      "hastalık",
      "belirti",
      "ağrı",
      "kanama",
      "hpv",
      "smear",
    ])
  ) {
    return "medical";
  }

  if (hasAny(text, ["yatırım", "hisse", "borsa", "kripto", "kredi", "faiz", "portföy"])) {
    return "finance";
  }

  if (hasAny(text, ["api", "kod", "hata", "sunucu", "deploy", "veritabanı", "typescript", "python"])) {
    return "technical";
  }

  if (
    hasAny(text, [
      "eğitim",
      "öğrenci",
      "öğretmen",
      "okul",
      "sınav",
      "müfredat",
      "disiplin",
      "özel eğitim",
      "rehberlik",
      "veli",
    ])
  ) {
    return "education";
  }

  return "general";
}

function inferTopic(title: string, text: string): string {
  const heading = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return compact(title || heading || "Knowledge note").slice(0, 120);
}

function selectSentence(parts: string[], terms: string[], fallback: string): string {
  return parts.find((sentence) => hasAny(sentence, terms)) ?? fallback;
}

function normalizeChunk(content: string, title: string): NormalizedChunk {
  const parts = sentences(content);
  const fallback = compact(content).slice(0, 500);
  const domain = inferDomain(content);
  const topic = inferTopic(title, content);

  const domainTerms: Record<KnowledgeDomain, string[]> = {
    medical: ["önemli", "değerlendiril", "muayene", "tedavi", "belirti", "risk", "acil"],
    legal: ["önemli", "süre", "belge", "delil", "başvuru", "avukat", "yetkili", "sözleşme"],
    finance: ["risk", "vade", "getiri", "maliyet", "yatırım", "karar"],
    technical: ["hata", "sürüm", "komut", "ayar", "yapılandırma", "log"],
    education: ["öğrenci", "okul", "sınav", "müfredat", "başvuru", "veli", "rehberlik"],
    general: ["önemli", "dikkat", "gerekir", "önerilir"],
  };

  const guidanceTerms: Record<KnowledgeDomain, string[]> = {
    medical: ["başvur", "muayene", "doktor", "hekim", "kontrol", "değerlendir"],
    legal: ["avukat", "hukuki", "yetkili", "başvuru", "süre", "belge", "sakla"],
    finance: ["risk", "danışman", "kişisel", "vade", "araştır"],
    technical: ["kontrol", "log", "test", "yedek", "sürüm", "doğrula"],
    education: ["okul", "rehberlik", "veli", "başvuru", "resmi", "kontrol"],
    general: ["kontrol", "doğrula", "kaynak", "uzman", "yetkili"],
  };

  const riskTerms = [
    "acil",
    "risk",
    "hak kaybı",
    "hak kaybi",
    "süre",
    "sure",
    "zamanaşımı",
    "zamanaşimi",
    "tehlike",
    "şiddetli",
    "siddetli",
    "garanti",
    "kesin",
    "veri kaybı",
    "veri kaybi",
  ];

  const claim = selectSentence(parts, domainTerms[domain], fallback);
  const guidance = selectSentence(parts, guidanceTerms[domain], "");
  const riskFlags = selectSentence(parts, riskTerms, "");

  const limitsByDomain: Record<KnowledgeDomain, string> = {
    medical: "Kaynakta açık dayanak yoksa kesin tanı, ilaç dozu veya tedavi gerekliliği çıkarma.",
    legal: "Kaynakta açık dayanak yoksa kesin dava sonucu, kesin tazminat veya otomatik hukuki sonuç çıkarma.",
    finance: "Kaynakta açık dayanak yoksa al/sat/tut tavsiyesi, getiri garantisi veya kesin piyasa tahmini çıkarma.",
    technical: "Kaynakta açık dayanak yoksa sürüm, komut veya yıkıcı işlem önerisi çıkarma.",
    education: "Kaynakta açık dayanak yoksa yönetmelik, sınav tarihi, kurum kararı veya öğrenciye özel sonuç çıkarma.",
    general: "Kaynakta açık dayanak yoksa kesin sonuç veya kaynak dışı ayrıntı çıkarma.",
  };

  return {
    domain,
    topic,
    tags: Array.from(
      new Set([domain, ...normalizeKnowledgeText(topic).split(/\s+/).filter((part) => part.length > 3).slice(0, 6)]),
    ),
    claim,
    guidance,
    riskFlags,
    limits: limitsByDomain[domain],
  };
}

export function normalizeKnowledgeChunkContent(content: string, opts: { title?: string } = {}): string {
  const trimmed = content.trim();
  if (!trimmed || hasStructuredKnowledgeFields(trimmed)) return trimmed;

  const normalized = normalizeChunk(trimmed, opts.title ?? "");
  return [
    `# Generic Knowledge Card: ${normalized.topic}`,
    "",
    `Topic: ${normalized.topic}`,
    `Tags: ${normalized.tags.join(", ")}`,
    "",
    `Source Summary: ${compact(trimmed).slice(0, 500)}`,
    "",
    `Key Takeaway: ${normalized.claim}`,
    "",
    `Safe Guidance: ${normalized.guidance || "Kaynak sınırlıysa ilgili uzman veya yetkili kurumla değerlendirme yapılmalıdır."}`,
    "",
    `Red Flags: ${normalized.riskFlags || "Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."}`,
    "",
    `Do Not Infer: ${normalized.limits}`,
  ].join("\n");
}
