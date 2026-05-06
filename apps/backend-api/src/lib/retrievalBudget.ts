import type { DomainRoutePlan } from "./queryRouter.js";

export type RetrievalBudgetMode = "fast_grounded" | "normal_rag" | "deep_rag";

export interface RetrievalBudgetDecision {
  mode: RetrievalBudgetMode;
  sourceLimit: number;
  reasons: string[];
}

const DEFAULT_DEEP_QUERY_TERMS = [
  "karşılaştır",
  "karsilastir",
  "fark",
  "detay",
  "ayrıntı",
  "ayrinti",
  "kaynakları",
  "kaynaklari",
];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readCsv(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return raw && raw.length > 0 ? raw : fallback;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

export function resolveRetrievalBudget(opts: {
  routePlan?: DomainRoutePlan | null;
  requestedCollectionIds?: string[];
  includePublic?: boolean;
  query?: string;
}): RetrievalBudgetDecision {
  const fastLimit = parsePositiveInt(process.env.R3MES_RAG_FAST_SOURCE_LIMIT, 2);
  const normalLimit = parsePositiveInt(process.env.R3MES_RAG_NORMAL_SOURCE_LIMIT, 3);
  const deepLimit = parsePositiveInt(process.env.R3MES_RAG_DEEP_SOURCE_LIMIT, 4);
  const requestedCount = opts.requestedCollectionIds?.length ?? 0;
  const routePlan = opts.routePlan ?? null;
  const query = normalizeText(opts.query ?? "");
  const reasons: string[] = [];

  if (requestedCount > 0 && routePlan?.confidence === "high") {
    reasons.push("selected collection plus high-confidence route; narrow context is enough");
    return { mode: "fast_grounded", sourceLimit: fastLimit, reasons };
  }

  const deepReasons: string[] = [];
  if (!routePlan) deepReasons.push("missing route plan");
  if (routePlan?.confidence === "low") deepReasons.push("low-confidence route");
  if (routePlan?.domain === "general") deepReasons.push("general-domain route");
  if (requestedCount === 0 && opts.includePublic !== false) {
    deepReasons.push("auto/public search without explicit selected collection");
  }
  const deepTerms = readCsv(process.env.R3MES_RAG_DEEP_QUERY_TERMS, DEFAULT_DEEP_QUERY_TERMS)
    .map(normalizeText);
  const matchedDeepTerm = deepTerms.find((term) => term && query.includes(term));
  if (matchedDeepTerm) deepReasons.push(`deep-query term matched: ${matchedDeepTerm}`);

  if (deepReasons.length > 0) {
    reasons.push(...deepReasons, "use deeper retrieval budget");
    return { mode: "deep_rag", sourceLimit: deepLimit, reasons };
  }

  reasons.push("standard routed RAG budget");
  return { mode: "normal_rag", sourceLimit: normalLimit, reasons };
}
