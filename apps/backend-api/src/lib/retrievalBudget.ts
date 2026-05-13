import type { DomainRoutePlan } from "./queryRouter.js";
import type { QueryUnderstanding } from "./queryUnderstanding.js";
import { getDecisionConfig } from "./decisionConfig.js";

export type RetrievalBudgetMode = "fast_grounded" | "normal_rag" | "deep_rag";

export interface RetrievalBudgetDecision {
  mode: RetrievalBudgetMode;
  sourceLimit: number;
  reasons: string[];
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
  queryUnderstanding?: QueryUnderstanding | null;
}): RetrievalBudgetDecision {
  const budgetConfig = getDecisionConfig().retrievalBudget;
  const fastLimit = budgetConfig.fastSourceLimit;
  const normalLimit = budgetConfig.normalSourceLimit;
  const deepLimit = budgetConfig.deepSourceLimit;
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
  if (opts.queryUnderstanding?.quality.shape === "short") deepReasons.push("short query needs broader evidence search");
  if (opts.queryUnderstanding?.quality.shape === "noisy") deepReasons.push("noisy or partial query needs broader evidence search");
  if (typeof opts.queryUnderstanding?.quality.clarityScore === "number" && opts.queryUnderstanding.quality.clarityScore < 45) {
    deepReasons.push("low query clarity");
  }
  if (requestedCount === 0 && opts.includePublic !== false) {
    deepReasons.push("auto/public search without explicit selected collection");
  }
  const deepTerms = budgetConfig.deepQueryTerms.map(normalizeText);
  const matchedDeepTerm = deepTerms.find((term) => term && query.includes(term));
  if (matchedDeepTerm) deepReasons.push(`deep-query term matched: ${matchedDeepTerm}`);

  if (deepReasons.length > 0) {
    reasons.push(...deepReasons, "use deeper retrieval budget");
    return { mode: "deep_rag", sourceLimit: deepLimit, reasons };
  }

  reasons.push("standard routed RAG budget");
  return { mode: "normal_rag", sourceLimit: normalLimit, reasons };
}
