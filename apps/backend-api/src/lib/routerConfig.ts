import { getDecisionConfig } from "./decisionConfig.js";

export interface RouterWeights {
  profileEmbedding: number;
  lexicalKeyword: number;
  sampleQuestion: number;
  domainHint: number;
  sourceQuality: number;
}

export interface RouterScoreBreakdown {
  signals: Partial<Record<keyof RouterWeights, number>>;
  weights: RouterWeights;
  contributions: Partial<Record<keyof RouterWeights, number>>;
  missingSignals: Array<keyof RouterWeights>;
  finalScore: number;
}

export interface AdaptiveRouterConfig {
  queryMatchBonusPerTerm: number;
  structuredSourceBonus: number;
  inferredSourceBonus: number;
  routeOverrideMargin: number;
  thinRoutePenalty: number;
}

export const DEFAULT_ROUTER_WEIGHTS: RouterWeights = {
  profileEmbedding: 0.45,
  lexicalKeyword: 0.25,
  sampleQuestion: 0.15,
  domainHint: 0.1,
  sourceQuality: 0.05,
};

export const DEFAULT_ADAPTIVE_ROUTER_CONFIG: AdaptiveRouterConfig = {
  queryMatchBonusPerTerm: 7,
  structuredSourceBonus: 12,
  inferredSourceBonus: 6,
  routeOverrideMargin: 18,
  thinRoutePenalty: 10,
};

export function getRouterWeights(env: NodeJS.ProcessEnv = process.env): RouterWeights {
  return getDecisionConfig(env).router.weights;
}

export function getAdaptiveRouterConfig(env: NodeJS.ProcessEnv = process.env): AdaptiveRouterConfig {
  return getDecisionConfig(env).router.adaptive;
}

export function weightedRouterScore(
  signals: Partial<Record<keyof RouterWeights, number | null | undefined>>,
  weights: RouterWeights = getRouterWeights(),
): number {
  return explainWeightedRouterScore(signals, weights).finalScore;
}

export function explainWeightedRouterScore(
  signals: Partial<Record<keyof RouterWeights, number | null | undefined>>,
  weights: RouterWeights = getRouterWeights(),
): RouterScoreBreakdown {
  let totalWeight = 0;
  let totalScore = 0;
  const normalizedSignals: Partial<Record<keyof RouterWeights, number>> = {};
  const contributions: Partial<Record<keyof RouterWeights, number>> = {};
  const missingSignals: Array<keyof RouterWeights> = [];
  for (const key of Object.keys(weights) as Array<keyof RouterWeights>) {
    const value = signals[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      missingSignals.push(key);
      continue;
    }
    const clamped = Math.max(0, Math.min(100, value));
    normalizedSignals[key] = Number(clamped.toFixed(3));
    contributions[key] = Number((clamped * weights[key]).toFixed(3));
    totalWeight += weights[key];
    totalScore += clamped * weights[key];
  }
  const finalScore = totalWeight <= 0 ? 0 : Number((totalScore / totalWeight).toFixed(3));
  return {
    signals: normalizedSignals,
    weights,
    contributions,
    missingSignals,
    finalScore,
  };
}
