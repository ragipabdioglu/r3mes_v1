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

interface FieldPattern {
  id: string;
  label: string;
  aliases: string[];
  outputHint: RequestedFieldOutputHint;
}

const FINANCE_TABLE_FIELDS: FieldPattern[] = [
  {
    id: "diger_kaynaklar",
    label: "Dağıtılması Öngörülen Diğer Kaynaklar",
    aliases: [
      "dağıtılması öngörülen diğer kaynaklar",
      "dagitilmasi ongorulen diger kaynaklar",
      "öngörülen diğer kaynaklar",
      "ongorulen diger kaynaklar",
      "diğer kaynaklar",
      "diger kaynaklar",
    ],
    outputHint: "number",
  },
  {
    id: "olaganustu_yedekler",
    label: "Olağanüstü Yedekler",
    aliases: [
      "olağanüstü yedekler",
      "olaganustu yedekler",
      "olağanüstü yedek",
      "olaganustu yedek",
    ],
    outputHint: "number",
  },
  {
    id: "net_donem_kari",
    label: "Net Dönem Kârı",
    aliases: [
      "net dönem kârı",
      "net dönem karı",
      "net donem kari",
      "net profit for the period",
    ],
    outputHint: "number",
  },
  {
    id: "donem_kari",
    label: "Dönem Kârı",
    aliases: [
      "dönem kârı",
      "dönem karı",
      "donem kari",
      "profit for the period",
    ],
    outputHint: "number",
  },
  {
    id: "stopaj_orani",
    label: "Stopaj Oranı",
    aliases: [
      "stopaj oranı",
      "stopaj orani",
      "stopaj",
      "withholding rate",
      "withholding tax",
    ],
    outputHint: "number",
  },
  {
    id: "nakit_tutar_oran",
    label: "Nakit Tutar ve Oran",
    aliases: [
      "nakit tutar",
      "nakit oran",
      "nakit tutarı",
      "cash amount",
      "cash rate",
      "oran satırları",
      "oran satirlari",
    ],
    outputHint: "number",
  },
  {
    id: "bagislar",
    label: "Yıl İçinde Yapılan Bağışlar",
    aliases: [
      "yıl içinde yapılan bağışlar",
      "yil icinde yapilan bagislar",
      "bağışlar",
      "bagislar",
      "donations",
    ],
    outputHint: "number",
  },
  {
    id: "net_dagitilabilir_donem_kari",
    label: "Net Dağıtılabilir Dönem Kârı",
    aliases: [
      "net dağıtılabilir dönem kârı",
      "net dagitilabilir donem kari",
      "dağıtılabilir dönem kârı",
      "dagitilabilir donem kari",
      "net distributable period profit",
    ],
    outputHint: "number",
  },
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value: string): string {
  return normalizeConceptText(value);
}

function includesAlias(normalizedQuery: string, alias: string): boolean {
  const normalizedAlias = normalize(alias);
  if (!normalizedAlias || normalizedAlias.length < 3) return false;
  if (isNegatedAlias(normalizedQuery, normalizedAlias)) return false;
  return normalizedQuery.includes(normalizedAlias);
}

function isNegatedAlias(normalizedQuery: string, normalizedAlias: string): boolean {
  const index = normalizedQuery.indexOf(normalizedAlias);
  if (index < 0) return false;
  const before = normalizedQuery.slice(Math.max(0, index - 36), index);
  const after = normalizedQuery.slice(index + normalizedAlias.length, index + normalizedAlias.length + 42);
  return (
    /\b(degil|değil|haric|hariç|yerine|disinda|dışında)\b/u.test(before) ||
    /^\s*(?:satiri\w*|satırı\w*|ile|veya)?\s*(?:karistirma|karıştırma|kullanma|alma|cevap\s+sanma|dahil\s+etme)\b/u.test(after)
  );
}

function detectFormat(normalizedQuery: string): RequestedFieldDetection["constraints"]["format"] {
  if (/\b(madde\w*|bullet|liste\w*)\b/u.test(normalizedQuery)) return "bullets";
  if (/\b(tablo|table)\b/u.test(normalizedQuery)) return "table";
  if (/\b(kisa|kısa|tek cumle|tek cümle|sadece)\b/u.test(normalizedQuery)) return "short";
  return "freeform";
}

function detectMaxWords(normalizedQuery: string): number | undefined {
  if (/\btek cumle|tek cümle\b/u.test(normalizedQuery)) return 32;
  if (/\bkisa|kısa|sadece\b/u.test(normalizedQuery)) return 80;
  return undefined;
}

function detectsCautionSuppression(normalizedQuery: string): boolean {
  return (
    /\b(risk|alarm|uyari|uyarı|yorum|tavsiye)\s+(yorumu\s+)?(ekleme|katma|yazma|verme)\b/u.test(normalizedQuery) ||
    /\bsadece\s+(sorulan|rakam|rakamlari|rakamları|sayi|sayı|sayilari|sayıları|deger|değer)\b/u.test(normalizedQuery)
  );
}

export function detectRequestedFields(query: string): RequestedFieldDetection {
  const normalizedQuery = normalize(query);
  const requestedFields = suppressNestedFieldMatches(normalizedQuery, FINANCE_TABLE_FIELDS
    .map((field): RequestedField | null => {
      const matchedAliases = unique(field.aliases.filter((alias) => includesAlias(normalizedQuery, alias)));
      if (matchedAliases.length === 0) return null;
      return {
        id: field.id,
        label: field.label,
        aliases: field.aliases,
        required: true,
        outputHint: field.outputHint,
        confidence: matchedAliases.length >= 2 ? "high" : "medium",
        matchedAliases,
      };
    })
    .filter((field): field is RequestedField => Boolean(field)));
  const constraintReasons: string[] = [];
  const forbidCaution = detectsCautionSuppression(normalizedQuery);
  if (forbidCaution) constraintReasons.push("query_suppresses_caution");
  const noRawTableDump = requestedFields.some((field) => field.outputHint === "number") || /\bsadece\b/u.test(normalizedQuery);
  if (noRawTableDump) constraintReasons.push("numeric_or_only_query");
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

function suppressNestedFieldMatches(normalizedQuery: string, fields: RequestedField[]): RequestedField[] {
  const ids = new Set(fields.map((field) => field.id));
  const explicitlyRequestsGenericPeriodProfit =
    /\bdonem k[âa]ri\s+ve\s+net donem k[âa]ri\b/u.test(normalizedQuery) ||
    /\bdonem k[âa]ri.*\bnet donem k[âa]ri\b/u.test(normalizedQuery);
  return fields.filter((field) => {
    if (
      field.id === "donem_kari" &&
      !explicitlyRequestsGenericPeriodProfit &&
      (ids.has("net_donem_kari") || ids.has("net_dagitilabilir_donem_kari"))
    ) {
      return false;
    }
    return true;
  });
}
