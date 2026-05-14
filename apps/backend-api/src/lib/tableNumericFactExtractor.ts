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
  return Array.from(value.matchAll(/\d+[.,]\d{4,6}|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+/gu))
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

function extractRowNumberedValues(value: string, field: RequestedField): string[] {
  const rowNumberByField: Record<string, string> = {
    donem_kari: "3",
    net_donem_kari: "5",
    net_dagitilabilir_donem_kari: "8",
  };
  const rowNumber = rowNumberByField[field.id];
  if (!rowNumber) return [];
  const rowPattern = new RegExp(
    `(?:^|\\s)${rowNumber}\\.?\\s+(?:[^\\d\\n]{0,90})?((?:\\(?\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?\\)?\\s*){1,3})`,
    "u",
  );
  const match = value.match(rowPattern);
  return match?.[1] ? extractNumbers(match[1]).slice(0, 3) : [];
}

function sourceIdForFact(fact: string, fallback: string): string {
  const prefix = fact.split(":")[0]?.trim();
  if (prefix && prefix.length <= 120 && !/\d{1,3}(?:[.,]\d{3})/u.test(prefix)) return prefix;
  return fallback;
}

function requestedShareGroups(query: string): string[] {
  const normalized = normalize(query);
  const groups = new Set<string>();
  if (/\ba(?:\s+grubu)?\b/u.test(normalized)) groups.add("A Grubu");
  if (/\bb(?:\s+grubu)?\b/u.test(normalized)) groups.add("B Grubu");
  if (/\bc(?:\s+grubu)?\b/u.test(normalized)) groups.add("C Grubu");
  return [...groups];
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

function desiredColumnLabel(query: string): string | undefined {
  const normalized = normalize(query);
  if (normalized.includes("spk ya gore") || normalized.includes("spkya gore")) return "SPK'ya Göre";
  if (normalized.includes("yasal kayitlara gore")) return "Yasal Kayıtlara Göre";
  return undefined;
}

function columnScore(columnLabel: string | undefined, desiredColumn: string | undefined): number {
  if (!desiredColumn) return 0;
  if (columnLabel === desiredColumn) return 100;
  if (columnLabel) return -80;
  return 0;
}

function extractShareGroupFacts(opts: {
  query: string;
  facts: string[];
  field: RequestedField;
  fallbackSourceId: string;
}): StructuredFact[] {
  if (opts.field.id !== "nakit_tutar_oran") return [];
  const groups = requestedShareGroups(opts.query);
  if (groups.length === 0) return [];
  const out: StructuredFact[] = [];
  const seen = new Set<string>();
  for (const fact of opts.facts) {
    const sourceId = sourceIdForFact(fact, opts.fallbackSourceId);
    for (const group of groups) {
      const groupLetter = group[0];
      const pattern = new RegExp(
        `\\b${groupLetter}\\s*(?:Grubu)?\\s+((?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d+[.,]\\d+|\\d+)\\s+){2,6}`,
        "iu",
      );
      const match = fact.match(pattern);
      if (!match?.[0]) continue;
      const numbers = extractNumbers(match[0]).slice(0, 6);
      if (numbers.length < 2) continue;
      const key = `${sourceId}|${group}|${numbers.join("/")}`.toLocaleLowerCase("tr-TR");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `sf_${hashId(key)}`,
        kind: "table_row",
        sourceId,
        field: `${group} Nakit Tutar ve Oran`,
        value: numbers.join(" / "),
        unit: unitForValue(numbers.join(" / ")),
        confidence: numbers.length >= 4 ? "high" : "medium",
        table: {
          rowLabel: group,
          rawRow: match[0].trim(),
        },
        provenance: {
          quote: fact.slice(0, 520),
          extractor: "share-group-table-v1",
        },
      });
    }
  }
  return out;
}

export function extractTableNumericFacts(input: TableNumericFactExtractionInput): StructuredFact[] {
  const detection = detectRequestedFields(input.query);
  const requestedFields = detection.requestedFields.filter((field) => field.outputHint === "number");
  if (requestedFields.length === 0 || input.facts.length === 0) return [];

  const fallbackSourceId = input.sourceIds?.[0] ?? "unknown-source";
  const desiredColumn = desiredColumnLabel(input.query);
  const structuredFacts: StructuredFact[] = [];
  const seen = new Set<string>();

  for (const field of requestedFields) {
    if (field.id === "nakit_tutar_oran") {
      const groupFacts = extractShareGroupFacts({
        query: input.query,
        facts: input.facts,
        field,
        fallbackSourceId,
      });
      for (const fact of groupFacts) {
        const key = `${fact.field}|${fact.sourceId}|${fact.value}`.toLocaleLowerCase("tr-TR");
        if (seen.has(key)) continue;
        seen.add(key);
        structuredFacts.push(fact);
      }
      if (groupFacts.length > 0) continue;
    }
    let best: { fact: string; alias: string; numbers: string[]; sourceId: string; columnLabel?: string; score: number } | null = null;
    for (const fact of input.facts) {
      const normalizedFact = normalize(fact);
      const alias = bestAliasMatch(normalizedFact, field);
      const numberedValues = extractRowNumberedValues(fact, field);
      if (!alias && numberedValues.length === 0) continue;
      const snippet = alias ? sliceAroundAlias(fact, normalizedFact, alias) : fact.slice(0, 520);
      const numbers = (numberedValues.length > 0 ? numberedValues : extractNumbersForField(snippet, field)).slice(0, 4);
      if (numbers.length === 0) continue;
      const sourceId = sourceIdForFact(fact, fallbackSourceId);
      const inferredColumn = inferColumnLabel(fact);
      const score = columnScore(inferredColumn, desiredColumn) + numbers.length * 8 + Math.min(fact.length / 100, 12);
      if (!best || score > best.score) {
        best = { fact, alias: alias ?? `row:${field.id}`, numbers, sourceId, columnLabel: inferredColumn, score };
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
        columnLabel: best.columnLabel,
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
