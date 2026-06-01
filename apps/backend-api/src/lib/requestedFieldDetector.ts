import { normalizeConceptText } from "./conceptNormalizer.js";

export type RequestedFieldOutputHint = "number" | "text" | "bullet" | "table";

export interface RequestedField {
  id: string;
  label: string;
  aliases: string[];
  required: boolean;
  outputHint: RequestedFieldOutputHint;
  confidence: "low" | "medium" | "high";
  matchedAliases: string[];
}

export interface RequestedFieldDetection {
  requestedFields: RequestedField[];
  constraints: {
    maxWords?: number;
    forbidCaution: boolean;
    noRawTableDump: boolean;
    format: "bullets" | "short" | "table" | "freeform";
  };
  diagnostics: {
    normalizedQuery: string;
    matchedFieldCount: number;
    constraintReasons: string[];
  };
}

interface CandidatePhrase {
  phrase: string;
  confidence: RequestedField["confidence"];
  outputHint: RequestedFieldOutputHint;
}

const MAX_REQUESTED_FIELDS = 8;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalize(value: string): string {
  return normalizeConceptText(value.normalize("NFD").replace(/\p{Diacritic}/gu, ""));
}

function slugifyFieldId(value: string): string {
  const slug = normalize(value.normalize("NFD").replace(/\p{Diacritic}/gu, ""))
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
  return slug || "requested_field";
}

function titleLabel(value: string): string {
  return value
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/^['"“”‘’]+|['"“”‘’]+$/gu, "");
}

function splitFieldList(value: string): string[] {
  return unique(
    value
      .split(/\s*(?:,|;|\bve\b|\bile\b|\band\b)\s*/u)
      .map((part) => cleanupCandidatePhrase(part)),
  ).filter((part) => part.length >= 3);
}

function cleanupCandidatePhrase(value: string): string {
  let cleaned = normalize(value)
    .replace(/\b(?:hangi\s+)?(?:rakamlarla|rakamlar|sayilarla|sayılarla|degerlerle|değerlerle|geciyor|geçiyor)\b.*$/u, "")
    .replace(/\b(?:hangi\s+)?(?:satirlarda|satırlarda|satirda|satırda)\b.*$/u, "")
    .replace(/\b(?:nedir|ne\s+demek|ne\s+kadar|ne|kac\w*|kaç\w*)\b.*$/u, "")
    .replace(/\b(?:kayna(?:ga|ğa)|kaynaklara|ders\s+notlarina|ders\s+notlarına)\s+gore\b/gu, " ")
    .replace(/\b(?:tek\s+satir\s+cevap|tek\s+satır\s+cevap|tek\s+satir|tek\s+satır)\b.*$/u, " ")
    .replace(/\b(?:karistirma|karıştırma|kullanma|ekleme|katma|ham\s+tablo\s+basma)\b.*$/u, " ")
    .replace(/\b(?:kisa|kısa)?\s*(?:maddelerle|maddeler\s+halinde|madde\s+madde|liste\s+halinde)\b.*$/u, " ")
    .replace(/\b(?:bu|su|şu)\s+(?:iki|uc|üç|dort|dört|\d+)\s+\w+\b.*$/u, " ")
    .replace(/\b(?:sadece|kisa|kısa|madde\s+madde|tablo\s+halinde|listele|yaz|ver|acikla|açıkla)\b/gu, " ")
    .replace(/\b(?:nedir|ne\s+demek|ne\s+kadar|nelerdir|neler)\b/gu, " ")
    .replace(/[?.!]+$/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  // Drop broad context prefixes without knowing any domain vocabulary.
  cleaned = cleaned.replace(
    /^.{0,100}\b(?:gore|göre|hakkinda|hakkında|konusunda|icin|için|icinde|içinde|uzerinden|üzerinden|dosyasinda|dosyasında|belgesinde|tablosunda|kaynakta)\s+/u,
    "",
  );
  cleaned = cleaned.replace(/^.{0,100}\b[\p{L}0-9_]+(?:da|de|ta|te|nda|nde|inda|inde|unda|unde)\s+/u, "");
  return cleaned.trim();
}

function detectOutputHint(normalizedQuery: string, phrase: string): RequestedFieldOutputHint {
  const around = `${normalizedQuery} ${phrase}`;
  if (/\b(tablo|table|satir|satır|sutun|sütun)\b/u.test(around)) return "table";
  if (/\b(tutar\w*|oran\w*|yuzde|yüzde|deger\w*|değer\w*|miktar\w*|sayi\w*|sayı\w*|adet|rakam\w*|kac\w*|kaç\w*|kar\w*|kâr\w*|numeric)\b/u.test(around)) return "number";
  if (/\b(madde|liste|bullet)\b/u.test(around)) return "bullet";
  return "text";
}

function phraseLooksLikeField(phrase: string): boolean {
  const tokens = phrase.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 9) return false;
  if (tokens.every((token) => token.length <= 2)) return false;
  if (/^(bu|su|şu|hangi|neden|nasil|nasıl|kaynak|belge|dosya|ders|notlar)$/u.test(phrase)) return false;
  if (/^(?:bu|su|şu)\s+(?:iki|uc|üç|dort|dört|\d+)\s+\w+(?:\s+\w+)?$/u.test(phrase)) return false;
  const instructionTokens = new Set([
    "bu",
    "su",
    "şu",
    "iki",
    "uc",
    "üç",
    "rakam",
    "rakami",
    "rakamlari",
    "rakamlarini",
    "sorulan",
    "sayi",
    "sayisi",
    "sayilari",
    "deger",
    "degeri",
    "madde",
    "maddelerle",
    "liste",
    "kisa",
    "kisaca",
    "karistirma",
    "karıştırma",
    "kullanma",
    "cevap",
    "tablo",
  ]);
  if (tokens.every((token) => instructionTokens.has(token))) return false;
  return tokens.some((token) => token.length >= 4 || /\d/u.test(token));
}

function extractQuotedCandidates(query: string, normalizedQuery: string): CandidatePhrase[] {
  const candidates: CandidatePhrase[] = [];
  for (const match of query.matchAll(/["“”'‘’]([^"“”'‘’]{3,120})["“”'‘’]/gu)) {
    const phrase = cleanupCandidatePhrase(match[1] ?? "");
    if (!phraseLooksLikeField(phrase)) continue;
    candidates.push({
      phrase,
      confidence: "high",
      outputHint: detectOutputHint(normalizedQuery, phrase),
    });
  }
  return candidates;
}

function extractCueBasedCandidates(normalizedQuery: string): CandidatePhrase[] {
  const candidates: CandidatePhrase[] = [];
  const cuePatterns = [
    /\b(?:hangi|istenen|sorulan)\s+(.{3,160}?)\s+(?:tutari|tutarı|orani|oranı|degeri|değeri|miktari|miktarı|sayisi|sayısı|alanlari|alanları|bilgileri)\b/gu,
    /\b(?:icin|için)\s+(.{3,180}?)\s+(?:hangi\s+)?(?:satir\w*|satır\w*)\b/gu,
    /(.{3,180}?)\s+(?:hangi\s+)?(?:rakamlarla|rakamlar|sayilarla|sayılarla|degerlerle|değerlerle)\b/gu,
    /(.{3,180}?)\s+(?:tutari|tutarı|orani|oranı|degeri|değeri|miktari|miktarı|sayisi|sayısı)\s+(?:nedir|ne\s+kadar|yaz|ver)?\b/gu,
    /(.{3,180}\bve\b.{3,180}?)\s+(?:yaz|ver|listele)\b/gu,
    /(.{3,180}?)\s+(?:nedir|ne\s+demek|ne\s+kadar)\b/gu,
    /(.{3,180}?)\s+(?:ne|kac(?:tir|tır|dir|dır)?|kaç(?:tir|tır|dir|dır)?)\b/gu,
    /\bsadece\s+(.{3,180}?)\s+(?:yaz|ver|listele)\b/gu,
  ];

  for (const pattern of cuePatterns) {
    for (const match of normalizedQuery.matchAll(pattern)) {
      const raw = match[1] ?? "";
      if (/\bne\s+(?:yap|et|olur|olmali|olmalı)\w*/u.test(normalizedQuery)) continue;
      const numericCue = /\b(tutar\w*|oran\w*|yuzde|yüzde|deger\w*|değer\w*|miktar\w*|sayi\w*|sayı\w*|adet|rakam\w*|kac\w*|kaç\w*|kar\w*|kâr\w*|profit)\b/u.test(raw);
      const listCue = /\bve\b/u.test(raw);
      const queryAsksForFieldValue = /\bsadece\s+(?:sorulan|rakam|rakamlari|rakamları|sayi|sayı|sayilari|sayıları|deger|değer)\b/u.test(normalizedQuery);
      const broadQuestionCue = pattern.source.includes("nedir") || pattern.source.includes("(?:ne|kac");
      if (broadQuestionCue && !numericCue && !queryAsksForFieldValue) continue;
      if (!numericCue && !listCue && pattern.source.includes("(?:ne|kac|kaç)")) continue;
      for (const phrase of splitFieldList(raw)) {
        if (!phraseLooksLikeField(phrase)) continue;
        candidates.push({
          phrase,
          confidence: /\b(tutar|oran|deger|değer|miktar|sayi|sayı|rakam)\b/u.test(normalizedQuery) ? "high" : "medium",
          outputHint: detectOutputHint(normalizedQuery, phrase),
        });
      }
    }
  }
  return candidates;
}

function suppressNestedFieldMatches(fields: RequestedField[]): RequestedField[] {
  return fields;
}

function toRequestedFields(candidates: CandidatePhrase[]): RequestedField[] {
  const byId = new Map<string, RequestedField>();
  for (const candidate of candidates) {
    const label = titleLabel(candidate.phrase);
    const id = slugifyFieldId(label);
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      label,
      aliases: [label],
      required: true,
      outputHint: candidate.outputHint,
      confidence: candidate.confidence,
      matchedAliases: [label],
    });
    if (byId.size >= MAX_REQUESTED_FIELDS) break;
  }
  return suppressNestedFieldMatches([...byId.values()]);
}

function detectFormat(normalizedQuery: string): RequestedFieldDetection["constraints"]["format"] {
  if (/\b(madde\w*|bullet|liste\w*|sirala|sırala)\b/u.test(normalizedQuery)) return "bullets";
  if (/\b(tablo|table)\b/u.test(normalizedQuery)) return "table";
  if (/\b(kisa|kısa|tek cumle|tek cümle|sadece)\b/u.test(normalizedQuery)) return "short";
  return "freeform";
}

function detectMaxWords(normalizedQuery: string): number | undefined {
  if (/\btek cumle|tek cümle\b/u.test(normalizedQuery)) return 32;
  if (/\ben fazla\s+(\d+)\s+(?:kelime|word)\b/u.test(normalizedQuery)) {
    const value = Number(normalizedQuery.match(/\ben fazla\s+(\d+)\s+(?:kelime|word)\b/u)?.[1]);
    if (Number.isFinite(value) && value > 0) return Math.min(240, value);
  }
  if (/\bkisa|kısa|sadece\b/u.test(normalizedQuery)) return 80;
  return undefined;
}

function detectsCautionSuppression(normalizedQuery: string): boolean {
  return (
    /\b(risk|alarm|uyari|uyarı|yorum|tavsiye)\s+(yorumu\s+)?(ekleme|katma|yazma|verme)\b/u.test(normalizedQuery) ||
    /\bsadece\s+(sorulan|rakam|rakamlari|rakamları|sayi|sayı|sayilari|sayıları|deger|değer|tanim|tanım|madde|maddeleri?)\b/u.test(normalizedQuery)
  );
}

export function detectRequestedFields(query: string): RequestedFieldDetection {
  const normalizedQuery = normalize(query);
  const isComparisonQuery = /\b(fark|farki|farkı|karsilastir|karşılaştır|ayni sey mi|aynı şey mi|arasindaki|arasındaki)\b/u.test(normalizedQuery);
  const requestedFields = toRequestedFields([
    ...(isComparisonQuery ? [] : extractQuotedCandidates(query, normalizedQuery)),
    ...(isComparisonQuery ? [] : extractCueBasedCandidates(normalizedQuery)),
  ]);
  const constraintReasons: string[] = [];
  const forbidCaution = detectsCautionSuppression(normalizedQuery);
  if (forbidCaution) constraintReasons.push("query_suppresses_caution");
  const noRawTableDump =
    requestedFields.some((field) => field.outputHint === "number" || field.outputHint === "table") ||
    /\bsadece\b/u.test(normalizedQuery);
  if (noRawTableDump) constraintReasons.push("field_or_only_query");
  const format = detectFormat(normalizedQuery);
  if (format !== "freeform") constraintReasons.push(`format_${format}`);
  const maxWords = detectMaxWords(normalizedQuery);
  if (typeof maxWords === "number") constraintReasons.push(`max_words_${maxWords}`);

  return {
    requestedFields,
    constraints: {
      maxWords,
      forbidCaution,
      noRawTableDump,
      format,
    },
    diagnostics: {
      normalizedQuery,
      matchedFieldCount: requestedFields.length,
      constraintReasons,
    },
  };
}
