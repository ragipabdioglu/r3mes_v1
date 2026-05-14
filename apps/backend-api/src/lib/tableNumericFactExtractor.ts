import { detectRequestedFields, type RequestedField } from "./requestedFieldDetector.js";
import type { StructuredFact } from "./structuredFact.js";
import { normalizeConceptText } from "./conceptNormalizer.js";

export interface TableNumericFactExtractionInput {
  query: string;
  facts: string[];
  sourceIds?: string[];
}

const NOISE_NUMBERS = new Set(["20", "21", "2025", "1578858"]);

function hashId(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function normalize(value: string): string {
  return normalizeConceptText(value).replace(/\s+/g, " ").trim();
}

function extractNumbers(value: string): string[] {
  return Array.from(value.matchAll(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+/gu))
    .map((match) => match[0])
    .filter((number) => number.length > 1 && !NOISE_NUMBERS.has(number));
}

function extractNumbersForField(value: string, field: RequestedField): string[] {
  const numbers = extractNumbers(value);
  if (field.id !== "stopaj_orani") return numbers;
  const percentLike = numbers.filter((number) => {
    const normalizedNumber = Number(number.replace(/\./gu, "").replace(",", "."));
    return Number.isFinite(normalizedNumber) && normalizedNumber >= 0 && normalizedNumber <= 100;
  });
  return percentLike;
}

function sourceIdForFact(fact: string, fallback: string): string {
  const prefix = fact.split(":")[0]?.trim();
  if (prefix && prefix.length <= 120 && !/\d{1,3}(?:[.,]\d{3})/u.test(prefix)) return prefix;
  return fallback;
}

function isFieldAliasContextAllowed(normalizedFact: string, alias: string, field: RequestedField): boolean {
  const index = normalizedFact.indexOf(alias);
  if (index < 0) return false;
  const before = normalizedFact.slice(Math.max(0, index - 28), index);
  if (field.id === "donem_kari" && /\b(net|dagitilabilir|dagitilmis|düşülmüş|dusulmus)\s*$/u.test(before)) {
    return false;
  }
  return true;
}

function bestAliasMatch(normalizedFact: string, field: RequestedField): string | null {
  const aliases = [field.label, ...field.aliases]
    .map(normalize)
    .filter((alias) => alias.length >= 3)
    .sort((left, right) => right.length - left.length);
  return aliases.find((alias) => isFieldAliasContextAllowed(normalizedFact, alias, field)) ?? null;
}

function sliceAroundAlias(fact: string, normalizedFact: string, normalizedAlias: string): string {
  const searchable = fact
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}.,:%\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliasIndex = normalizedFact.indexOf(normalizedAlias);
  if (aliasIndex < 0) return searchable.slice(0, 420);
  return searchable.slice(aliasIndex, aliasIndex + 420);
}

function confidenceFor(numbers: string[], field: RequestedField): StructuredFact["confidence"] {
  if (numbers.length >= 2 && field.confidence === "high") return "high";
  if (numbers.length > 0) return "medium";
  return "low";
}

function unitForValue(value: string): string | undefined {
  return value.includes("%") ? "%" : undefined;
}

function inferColumnLabel(fact: string): string | undefined {
  const normalized = normalize(fact);
  if (normalized.includes("spk ya gore") || normalized.includes("spkya gore")) return "SPK'ya Göre";
  if (normalized.includes("yasal kayitlara gore")) return "Yasal Kayıtlara Göre";
  return undefined;
}

export function extractTableNumericFacts(input: TableNumericFactExtractionInput): StructuredFact[] {
  const detection = detectRequestedFields(input.query);
  const requestedFields = detection.requestedFields.filter((field) => field.outputHint === "number");
  if (requestedFields.length === 0 || input.facts.length === 0) return [];

  const fallbackSourceId = input.sourceIds?.[0] ?? "unknown-source";
  const structuredFacts: StructuredFact[] = [];
  const seen = new Set<string>();

  for (const field of requestedFields) {
    let best: { fact: string; alias: string; numbers: string[]; sourceId: string } | null = null;
    for (const fact of input.facts) {
      const normalizedFact = normalize(fact);
      const alias = bestAliasMatch(normalizedFact, field);
      if (!alias) continue;
      const snippet = sliceAroundAlias(fact, normalizedFact, alias);
      const numbers = extractNumbersForField(snippet, field).slice(0, 4);
      if (numbers.length === 0) continue;
      const sourceId = sourceIdForFact(fact, fallbackSourceId);
      if (!best || numbers.length > best.numbers.length || fact.length > best.fact.length) {
        best = { fact, alias, numbers, sourceId };
      }
    }
    if (!best) continue;

    const value = best.numbers.join(" / ");
    const key = `${field.id}|${best.sourceId}|${value}`.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);

    structuredFacts.push({
      id: `sf_${hashId(key)}`,
      kind: best.numbers.length > 1 ? "table_row" : "table_cell",
      sourceId: best.sourceId,
      field: field.label,
      value,
      unit: unitForValue(value),
      confidence: confidenceFor(best.numbers, field),
      table: {
        rowLabel: field.label,
        columnLabel: inferColumnLabel(best.fact),
        rawRow: best.fact,
      },
      provenance: {
        quote: best.fact.slice(0, 520),
        extractor: "table-numeric-v1",
      },
    });
  }

  return structuredFacts;
}
