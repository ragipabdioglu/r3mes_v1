import { detectAnswerTask } from "./answerTaskDetector.js";
import type { RequestedField } from "./requestedFieldDetector.js";
import type { StructuredFact } from "./structuredFact.js";
import { normalizeConceptText } from "./conceptNormalizer.js";
import type { TableFact } from "./tableFact.js";
import { structuredFactFromTableFact } from "./tableFactBridge.js";

export interface TableNumericFactExtractionInput {
  query: string;
  facts: string[];
  sourceIds?: string[];
  tableFacts?: TableFact[];
}

function hashId(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function normalize(value: string): string {
  return normalizeConceptText(value.normalize("NFD").replace(/\p{Diacritic}/gu, "")).replace(/\s+/g, " ").trim();
}

function isLikelyStandaloneYear(value: string): boolean {
  if (!/^\d{4}$/u.test(value)) return false;
  const year = Number(value);
  return year >= 1900 && year <= 2100;
}

function extractNumbers(value: string): string[] {
  return Array.from(value.matchAll(/\d+[.,]\d{4,6}|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+/gu))
    .map((match) => match[0])
    .filter((number) => number.length > 1 && !isLikelyStandaloneYear(number));
}

function extractNumbersForField(value: string, field: RequestedField): string[] {
  const numbers = extractNumbers(value);
  if (!fieldSuggestsPercentValue(field)) return numbers;
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

function requestedShareGroups(query: string): string[] {
  const normalized = normalize(query);
  const groups = new Set<string>();
  const mentionsGroupContext = /\b(grub\w*|grup\w*|group\w*)\b/u.test(normalized);
  if (!mentionsGroupContext) return [];
  if (/\ba\b/u.test(normalized) || /\ba\s+grup\w*\b/u.test(normalized)) groups.add("A Grubu");
  if (/\bb\b/u.test(normalized) || /\bb\s+grup\w*\b/u.test(normalized)) groups.add("B Grubu");
  if (/\bc\b/u.test(normalized) || /\bc\s+grup\w*\b/u.test(normalized)) groups.add("C Grubu");
  return [...groups];
}

function isFieldAliasContextAllowed(normalizedFact: string, alias: string, field: RequestedField): boolean {
  const index = normalizedFact.indexOf(alias);
  if (index < 0) return false;
  const aliasTokens = alias.split(/\s+/u).filter(Boolean);
  const before = normalizedFact.slice(Math.max(0, index - 28), index);
  const longerRequestedAliasContainsThisAlias = [field.label, ...field.aliases]
    .map(normalize)
    .some((candidate) => candidate !== alias && candidate.endsWith(alias));
  if (
    aliasTokens.length <= 2 &&
    !longerRequestedAliasContainsThisAlias &&
    /\b(net|toplam|ara|nihai|final|dagitilabilir|dagitilmis|düşülmüş|dusulmus)\s*$/u.test(before)
  ) {
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

function tableFactSearchText(fact: TableFact): string {
  return normalize([
    fact.fieldId,
    fact.label,
    fact.rowLabel ?? "",
    fact.columnLabel ?? "",
    fact.headerPath.join(" "),
    fact.rawValue,
  ].join(" "));
}

function extractQueryTokens(query: string): string[] {
  const weakTerms = new Set([
    "nedir",
    "ne",
    "kac",
    "kaç",
    "hangi",
    "deger",
    "değer",
    "sadece",
    "kaynak",
    "ver",
    "yaz",
  ]);
  return normalize(query)
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !weakTerms.has(token));
}

function fieldSearchText(field: RequestedField): string {
  return normalize([field.id, field.label, ...field.aliases].join(" "));
}

function fieldSuggestsPercentValue(field: RequestedField): boolean {
  return /\b(oran\w*|rate\w*|ratio\w*|percent\w*|percentage\w*|yuzde\w*)\b/u.test(fieldSearchText(field));
}

function fieldSuggestsGroupedValue(field: RequestedField, query: string): boolean {
  const combined = `${fieldSearchText(field)} ${normalize(query)}`;
  return /\b(grub\w*|grup\w*|group\w*)\b/u.test(combined) &&
    /\b(tutar\w*|amount\w*|oran\w*|rate\w*|ratio\w*|cash\w*|nakit\w*|deger\w*|value\w*)\b/u.test(combined);
}

function tableFactMatchesRequestedField(fact: TableFact, field: RequestedField): boolean {
  if (normalize(fact.fieldId) === normalize(field.id)) return true;
  const haystack = tableFactSearchText(fact);
  return [field.label, ...field.aliases]
    .map(normalize)
    .filter((alias) => alias.length >= 3)
    .some((alias) => haystack.includes(alias));
}

function genericTableFactQueryScore(fact: TableFact, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const haystack = tableFactSearchText(fact);
  const matchedCount = queryTokens.filter((token) => haystack.includes(token)).length;
  if (matchedCount === 0) return 0;
  return matchedCount / Math.max(1, Math.min(queryTokens.length, 4));
}

function isTableNumericValue(fact: TableFact): boolean {
  return fact.valueType === "money" ||
    fact.valueType === "number" ||
    fact.valueType === "percentage" ||
    fact.valueType === "date";
}

function structuredFactsFromTableFacts(opts: {
  query: string;
  requestedFields: RequestedField[];
  tableFacts?: TableFact[];
  fallbackSourceId: string;
}): StructuredFact[] {
  const tableFacts = opts.tableFacts?.filter(isTableNumericValue) ?? [];
  if (tableFacts.length === 0) return [];
  const queryTokens = extractQueryTokens(opts.query);
  const matched = opts.requestedFields.length > 0
    ? tableFacts.filter((fact) => opts.requestedFields.some((field) => tableFactMatchesRequestedField(fact, field)))
    : tableFacts
        .map((fact) => ({ fact, score: genericTableFactQueryScore(fact, queryTokens) }))
        .filter((item) => item.score >= 0.34)
        .sort((left, right) => right.score - left.score || right.fact.provenance.confidence - left.fact.provenance.confidence)
        .map((item) => item.fact);
  const out: StructuredFact[] = [];
  const seen = new Set<string>();
  for (const fact of matched) {
    const structured = structuredFactFromTableFact(fact, {
      defaultSourceId: opts.fallbackSourceId,
      extractor: fact.provenance.extractor === "docling" ||
        fact.provenance.extractor === "excel" ||
        fact.provenance.extractor === "ocr" ||
        fact.provenance.extractor === "regex_fallback"
        ? fact.provenance.extractor
        : undefined,
    });
    const key = [
      structured.sourceId,
      structured.field ?? "",
      structured.value ?? "",
      structured.table?.title ?? "",
      structured.table?.rawRow ?? "",
    ].join("|").toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(structured);
  }
  return out;
}

function extractShareGroupFacts(opts: {
  query: string;
  facts: string[];
  field: RequestedField;
  fallbackSourceId: string;
}): StructuredFact[] {
  if (!fieldSuggestsGroupedValue(opts.field, opts.query)) return [];
  const groups = requestedShareGroups(opts.query);
  if (groups.length === 0) return [];
  const out: StructuredFact[] = [];
  const seen = new Set<string>();
  for (const fact of opts.facts) {
    const sourceId = sourceIdForFact(fact, opts.fallbackSourceId);
    for (const group of groups) {
      const groupLetter = group[0];
      const pattern = new RegExp(
        `\\b${groupLetter}\\s*(?:Grubu|Group)?\\s+((?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d+[.,]\\d+|\\d+)\\s+){2,6}`,
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
        field: `${group} Grouped Numeric Values`,
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
  const detection = detectAnswerTask(input.query);
  const requestedFields = detection.requestedFields;
  const fallbackSourceId = input.sourceIds?.[0] ?? "unknown-source";
  const tableFactStructuredFacts = structuredFactsFromTableFacts({
    query: input.query,
    requestedFields,
    tableFacts: input.tableFacts,
    fallbackSourceId,
  });
  if (tableFactStructuredFacts.length > 0) return tableFactStructuredFacts;
  if (requestedFields.length === 0 || input.facts.length === 0) return [];

  const desiredColumn = desiredColumnLabel(input.query);
  const structuredFacts: StructuredFact[] = [];
  const seen = new Set<string>();

  for (const field of requestedFields) {
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
    let best: { fact: string; alias: string; numbers: string[]; sourceId: string; columnLabel?: string; score: number } | null = null;
    for (const fact of input.facts) {
      const normalizedFact = normalize(fact);
      const alias = bestAliasMatch(normalizedFact, field);
      if (!alias) continue;
      const snippet = alias ? sliceAroundAlias(fact, normalizedFact, alias) : fact.slice(0, 520);
      const numbers = extractNumbersForField(snippet, field).slice(0, 4);
      if (numbers.length === 0) continue;
      const sourceId = sourceIdForFact(fact, fallbackSourceId);
      const inferredColumn = inferColumnLabel(fact);
      if (desiredColumn && inferredColumn && inferredColumn !== desiredColumn) continue;
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
