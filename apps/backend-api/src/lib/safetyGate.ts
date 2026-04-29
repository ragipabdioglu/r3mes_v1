import type { ChatSourceCitation } from "@r3mes/shared-types";

import type { GroundedMedicalAnswer } from "./answerSchema.js";
import { hasLowLanguageQuality } from "./answerQuality.js";

export interface SafetyGateResult {
  pass: boolean;
  blockedReasons: string[];
  requiredRewrite: boolean;
  safeFallback?: string;
}

const RISKY_CERTAINTY_PATTERNS = [
  /\bkesin(?:likle)?\s+kanser(?:dir|sin|siniz)?\b/iu,
  /\bkanser\s+olduğun(?:u|uz)\s+kesin\b/iu,
  /\bmutlaka\s+ameliyat\b/iu,
  /\bila[cç]\s+ba[sş]la\b/iu,
  /\bantibiyotik\s+kullan\b/iu,
  /\btedaviye\s+ba[sş]la\b/iu,
  /\bbu\s+hastal[ıi]kt[ıi]r\b/iu,
  /\bdavay[ıi]\s+kesin\s+kazan[ıi]rs[ıi]n(?:[ıi]z)?\b/iu,
  /\bkesin\s+tazminat\s+al[ıi]rs[ıi]n(?:[ıi]z)?\b/iu,
  /\bkesin\s+al\b/iu,
  /\bkesin\s+sat\b/iu,
  /\bgarantili\s+getiri\b/iu,
];

const LOW_GROUNDING_OVERCONFIDENCE_PATTERNS = [
  /\bkesin(?:likle)?\b(?![^.!?\n]{0,80}(?:değil|degil|doğru olmaz|dogru olmaz|söylenemez|soylenemez|göstermez|gostermez|anlamına gelmez|anlamina gelmez))/iu,
  /\bmutlaka\b(?![^.!?\n]{0,80}(?:değil|degil|gerekmez))/iu,
  /\bnet\s+olarak\b(?![^.!?\n]{0,80}(?:söylenemez|soylenemez|belirtilemez))/iu,
  /\bhiç\s+gerek\s+yok\b/iu,
  /\btek\s+yapman(?:ız)?\s+gereken\b/iu,
];

const RED_FLAG_TERMS = [
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
];

const URGENT_GUIDANCE_TERMS = [
  "başvur",
  "basvur",
  "acil",
  "gecikmeden",
  "daha hızlı",
  "daha hizli",
  "değerlendirme",
  "degerlendirme",
];

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

function includesAny(text: string, terms: string[]): boolean {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(normalize(term)));
}

function hasSourceMetadataMismatch(answer: GroundedMedicalAnswer, sources: ChatSourceCitation[]): boolean {
  if (answer.used_source_ids.length === 0 || sources.length === 0) return false;
  const available = new Set(
    sources.flatMap((source) => [
      source.documentId,
      source.title,
      `${source.documentId}`,
      `${source.title}`,
    ].filter(Boolean)),
  );
  return answer.used_source_ids.some((id) => !available.has(id));
}

function buildFallback(answer: GroundedMedicalAnswer, sources: ChatSourceCitation[]): string {
  const sourceNote =
    sources.length > 0
      ? "Eldeki kaynaklar bu soruya sınırlı dayanak sağlıyor."
      : "Bu soru için yeterli güvenilir kaynak bulunamadı.";
  const queryNote = answer.user_query
    ? `Sorunuz: ${answer.user_query}`
    : "Sorunuzdaki bilgi sınırlı.";

  if (answer.answer_domain === "legal") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      "2. Ne yapılabilir: Kesin hukuki görüş vermek doğru olmaz; ilgili belge, tarih ve yargı alanı netleştirilmelidir.",
      "3. Nelere dikkat edilmeli: Hak kaybı riski varsa süreleri kaçırmadan avukat veya yetkili kurumdan destek alın.",
      `4. Kısa özet: ${queryNote} Kaynak yetersizse hukuki sonucu kesinleştirmemek gerekir.`,
    ].join("\n");
  }

  if (answer.answer_domain === "finance") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      "2. Ne yapılabilir: Kişisel yatırım tavsiyesi vermek doğru olmaz; karar öncesi risk, vade ve kişisel koşullar değerlendirilmelidir.",
      "3. Riskler: Getiri garantisi veya kesin piyasa tahmini yapılamaz.",
      `4. Kısa özet: ${queryNote} Finansal karar için kaynak ve risk analizi birlikte ele alınmalıdır.`,
    ].join("\n");
  }

  if (answer.answer_domain === "technical") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      "2. Ne yapılabilir: Ortam ve sürüm bilgisi netleşmeden riskli komut veya yapılandırma önermek doğru olmaz.",
      "3. Dikkat edilmesi gerekenler: Değişiklikleri önce kontrollü ortamda ve yedekle deneyin.",
      `4. Kısa özet: ${queryNote} Eksik teknik ayrıntılar netleşmeden kesin uygulama adımı verilmemelidir.`,
    ].join("\n");
  }

  if (answer.answer_domain === "education") {
    return [
      `1. Kaynağa göre durum: ${sourceNote}`,
      "2. Ne yapılabilir: Öğrenciye özel kesin karar vermeden önce okul, rehberlik birimi veya yetkili kurum bilgisi netleştirilmelidir.",
      "3. Dikkat edilmesi gerekenler: Kaynakta olmayan yönetmelik, sınav tarihi veya kurum kararı uydurulmamalıdır.",
      `4. Kısa özet: ${queryNote} Eğitim konusunda kaynak ve resmi süreç birlikte değerlendirilmelidir.`,
    ].join("\n");
  }

  return [
    `1. Genel değerlendirme: ${sourceNote}`,
    "2. Ne yapmalı: Kesin tanı veya tedavi önermek doğru olmaz; yakınma sürüyorsa uygun bir sağlık profesyoneliyle görüşün.",
    "3. Ne zaman doktora başvurmalı: Şiddetli ağrı, ateş, kusma, bayılma, anormal kanama veya hızla kötüleşme varsa gecikmeden başvurun.",
    `4. Kısa özet: ${queryNote} Güvenli ilerlemek için belirtilerin süresi, şiddeti ve eşlik eden bulgular değerlendirilmelidir.`,
  ].join("\n");
}

export function evaluateSafetyGate(opts: {
  answerText: string;
  answer: GroundedMedicalAnswer;
  sources: ChatSourceCitation[];
  retrievalWasUsed: boolean;
}): SafetyGateResult {
  const blockedReasons: string[] = [];
  const answerText = opts.answerText.trim();
  const query = opts.answer.user_query;
  const combined = [answerText, opts.answer.answer, opts.answer.condition_context, opts.answer.safe_action].join(" ");

  if (!answerText) {
    blockedReasons.push("EMPTY_ANSWER");
  }

  if (opts.retrievalWasUsed && opts.sources.length === 0) {
    blockedReasons.push("MISSING_SOURCES");
  }

  if (RISKY_CERTAINTY_PATTERNS.some((pattern) => pattern.test(combined))) {
    blockedReasons.push("RISKY_CERTAINTY_OR_TREATMENT");
  }

  if (hasLowLanguageQuality(answerText)) {
    blockedReasons.push("LOW_LANGUAGE_QUALITY");
  }

  if (
    opts.retrievalWasUsed &&
    opts.answer.grounding_confidence === "low" &&
    LOW_GROUNDING_OVERCONFIDENCE_PATTERNS.some((pattern) => pattern.test(answerText))
  ) {
    blockedReasons.push("LOW_GROUNDING_OVERCONFIDENCE");
  }

  if (opts.retrievalWasUsed && hasSourceMetadataMismatch(opts.answer, opts.sources)) {
    blockedReasons.push("SOURCE_METADATA_MISMATCH");
  }

  if (
    includesAny(query, RED_FLAG_TERMS) &&
    !includesAny(answerText, URGENT_GUIDANCE_TERMS)
  ) {
    blockedReasons.push("RED_FLAG_WITHOUT_URGENT_GUIDANCE");
  }

  if (answerText.length < 40 && opts.retrievalWasUsed) {
    blockedReasons.push("ANSWER_TOO_THIN");
  }

  const pass = blockedReasons.length === 0;
  return {
    pass,
    blockedReasons,
    requiredRewrite: !pass,
    safeFallback: pass ? undefined : buildFallback(opts.answer, opts.sources),
  };
}
