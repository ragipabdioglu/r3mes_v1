import type { AnswerTaskType } from "./answerTaskDetector.js";
import type { StructuredFact } from "./structuredFact.js";

export type EvidenceItemKind =
  | "text_fact"
  | "definition"
  | "list_item"
  | "comparison_point"
  | "code_fact"
  | "table_fact"
  | "numeric_fact"
  | "procedure_step"
  | "source_limit"
  | "contradiction";

export const EVIDENCE_ITEM_KINDS = [
  "text_fact",
  "definition",
  "list_item",
  "comparison_point",
  "code_fact",
  "table_fact",
  "numeric_fact",
  "procedure_step",
  "source_limit",
  "contradiction",
] as const satisfies readonly EvidenceItemKind[];

export type EvidenceItemConfidence = "low" | "medium" | "high";
export type TextEvidenceItemKind =
  | "text_fact"
  | "definition"
  | "list_item"
  | "comparison_point"
  | "code_fact"
  | "procedure_step";

export interface EvidenceItem {
  id: string;
  kind: EvidenceItemKind;
  sourceId: string;
  documentId?: string;
  chunkId?: string;
  quote: string;
  normalizedClaim?: string;
  structuredFactId?: string;
  tableFactId?: string;
  confidence: EvidenceItemConfidence;
  provenance: {
    extractor: string;
    sourceSpan?: { start?: number; end?: number };
    page?: number;
    bbox?: [number, number, number, number];
  };
}

export interface EvidenceBundleDiagnostics {
  stringFactCount: number;
  structuredFactCount: number;
  tableFactCount: number;
  contradictionCount: number;
  sourceLimitCount: number;
  kindCounts: Record<EvidenceItemKind, number>;
}

export interface EvidenceBundle {
  userQuery: string;
  items: EvidenceItem[];
  sourceIds: string[];
  requestedFieldIds: string[];
  diagnostics: EvidenceBundleDiagnostics;
}

export interface BuildEvidenceBundleInput {
  userQuery: string;
  textFacts?: string[];
  riskFacts?: string[];
  notSupported?: string[];
  structuredFacts?: StructuredFact[];
  sourceIds?: string[];
  requestedFieldIds?: string[];
  extractor?: string;
  taskType?: AnswerTaskType | "grounded_summary";
  evidenceType?: TextEvidenceItemKind;
}

const CONTRADICTION_PATTERN = /(çeliş|celis|contradict|conflict|tutarsız|tutarsiz|uyuşmuyor|uyusmuyor)/i;

function stableId(prefix: string, value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `${prefix}_${Math.abs(hash >>> 0).toString(36)}`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function uniqueStrings(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function sourceIdFromText(text: string, fallback: string): string {
  if (!text.includes(":")) return fallback;
  const prefix = text.split(":")[0]?.trim();
  if (prefix && prefix.length <= 120) return prefix;
  return fallback;
}

function evidenceKindForStructuredFact(fact: StructuredFact): EvidenceItemKind {
  if (fact.kind === "table_cell" || fact.kind === "table_row") return "table_fact";
  if (fact.kind === "numeric_value") return "numeric_fact";
  return "text_fact";
}

function evidenceKindForTaskType(taskType: BuildEvidenceBundleInput["taskType"]): TextEvidenceItemKind {
  switch (taskType) {
    case "definition":
      return "definition";
    case "list_items":
      return "list_item";
    case "compare_concepts":
      return "comparison_point";
    case "procedure":
      return "procedure_step";
    case "code_explanation":
      return "code_fact";
    default:
      return "text_fact";
  }
}

function resolveTextEvidenceKind(input: BuildEvidenceBundleInput): TextEvidenceItemKind | undefined {
  if (input.evidenceType) return input.evidenceType;
  const taskKind = evidenceKindForTaskType(input.taskType);
  return taskKind === "text_fact" ? undefined : taskKind;
}

function diagnosticsForItems(items: EvidenceItem[]): EvidenceBundleDiagnostics {
  const kindCounts = Object.fromEntries(EVIDENCE_ITEM_KINDS.map((kind) => [kind, 0])) as Record<EvidenceItemKind, number>;
  for (const item of items) {
    kindCounts[item.kind] += 1;
  }

  return {
    stringFactCount: items.filter((item) => item.kind === "text_fact").length,
    structuredFactCount: items.filter((item) => item.structuredFactId).length,
    tableFactCount: items.filter((item) => item.kind === "table_fact").length,
    contradictionCount: items.filter((item) => item.kind === "contradiction").length,
    sourceLimitCount: items.filter((item) => item.kind === "source_limit").length,
    kindCounts,
  };
}

export function createEvidenceItem(input: Omit<EvidenceItem, "id"> & { id?: string }): EvidenceItem {
  const quote = normalizeText(input.quote);
  const id = input.id ?? stableId("ev", [
    input.kind,
    input.sourceId,
    quote,
    input.structuredFactId ?? "",
    input.tableFactId ?? "",
  ].join("|"));
  return {
    ...input,
    id,
    quote,
    normalizedClaim: input.normalizedClaim ? normalizeText(input.normalizedClaim) : undefined,
  };
}

export function evidenceItemFromTextFact(input: {
  fact: string;
  sourceId?: string;
  fallbackSourceId?: string;
  kind?: EvidenceItemKind;
  confidence?: EvidenceItemConfidence;
  extractor?: string;
}): EvidenceItem | null {
  const quote = normalizeText(input.fact);
  if (!quote) return null;
  const kind = input.kind ?? (CONTRADICTION_PATTERN.test(quote) ? "contradiction" : "text_fact");
  return createEvidenceItem({
    kind,
    sourceId: input.sourceId ?? sourceIdFromText(quote, input.fallbackSourceId ?? "unknown-source"),
    quote,
    normalizedClaim: quote,
    confidence: input.confidence ?? (kind === "contradiction" ? "medium" : "high"),
    provenance: {
      extractor: input.extractor ?? "deterministic-evidence-v1",
    },
  });
}

export function evidenceItemFromStructuredFact(fact: StructuredFact): EvidenceItem {
  return createEvidenceItem({
    kind: evidenceKindForStructuredFact(fact),
    sourceId: fact.sourceId,
    chunkId: fact.chunkId,
    quote: fact.provenance.quote,
    normalizedClaim: [fact.subject, fact.field, fact.value, fact.unit, fact.period].filter(Boolean).join(" "),
    structuredFactId: fact.id,
    confidence: fact.confidence,
    provenance: {
      extractor: fact.provenance.extractor,
    },
  });
}

export function buildEvidenceBundle(input: BuildEvidenceBundleInput): EvidenceBundle {
  const fallbackSourceId = input.sourceIds?.[0] ?? "unknown-source";
  const textEvidenceKind = resolveTextEvidenceKind(input);
  const textItems = uniqueStrings(input.textFacts).map((fact) =>
    evidenceItemFromTextFact({
      fact,
      fallbackSourceId,
      kind: textEvidenceKind,
      extractor: input.extractor,
    }),
  );
  const riskItems = uniqueStrings(input.riskFacts).map((fact) =>
    evidenceItemFromTextFact({
      fact,
      fallbackSourceId,
      confidence: "medium",
      extractor: input.extractor,
    }),
  );
  const notSupportedItems = uniqueStrings(input.notSupported).map((fact) =>
    evidenceItemFromTextFact({
      fact,
      fallbackSourceId,
      kind: CONTRADICTION_PATTERN.test(fact) ? "contradiction" : "source_limit",
      confidence: "medium",
      extractor: input.extractor,
    }),
  );
  const structuredItems = (input.structuredFacts ?? []).map(evidenceItemFromStructuredFact);
  const items = [...textItems, ...riskItems, ...notSupportedItems, ...structuredItems]
    .filter((item): item is EvidenceItem => Boolean(item));

  return {
    userQuery: input.userQuery.trim(),
    items,
    sourceIds: uniqueStrings([
      ...(input.sourceIds ?? []),
      ...items.map((item) => item.sourceId),
    ]),
    requestedFieldIds: uniqueStrings(input.requestedFieldIds),
    diagnostics: diagnosticsForItems(items),
  };
}

export function hasUsableEvidenceItem(item: EvidenceItem): boolean {
  return item.kind === "text_fact" ||
    item.kind === "definition" ||
    item.kind === "list_item" ||
    item.kind === "comparison_point" ||
    item.kind === "code_fact" ||
    item.kind === "table_fact" ||
    item.kind === "numeric_fact" ||
    item.kind === "procedure_step";
}

export function countUsableEvidenceItems(bundle: EvidenceBundle | null | undefined): number {
  return bundle?.items.filter(hasUsableEvidenceItem).length ?? 0;
}
