import type { DomainRoutePlan } from "./queryRouter.js";

export type RetrievalBudgetMode = "fast_grounded" | "normal_rag" | "deep_rag";

export interface RetrievalBudgetDecision {
  mode: RetrievalBudgetMode;
  sourceLimit: number;
  reasons: string[];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  const query = opts.query ?? "";
  const reasons: string[] = [];

  if (requestedCount > 0 && routePlan?.confidence === "high") {
    reasons.push("selected collection plus high-confidence route; narrow context is enough");
    return { mode: "fast_grounded", sourceLimit: fastLimit, reasons };
  }

  if (
    !routePlan ||
    routePlan.confidence === "low" ||
    routePlan.domain === "general" ||
    requestedCount === 0 && opts.includePublic !== false ||
    /\b(karşılaştır|karsilastir|fark|detay|ayrıntı|ayrinti|kaynakları|kaynaklari)\b/iu.test(query)
  ) {
    reasons.push("broad or uncertain route; use deeper retrieval budget");
    return { mode: "deep_rag", sourceLimit: deepLimit, reasons };
  }

  reasons.push("standard routed RAG budget");
  return { mode: "normal_rag", sourceLimit: normalLimit, reasons };
}
