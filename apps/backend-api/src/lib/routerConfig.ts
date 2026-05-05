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

export const DEFAULT_ROUTER_WEIGHTS: RouterWeights = {
  profileEmbedding: 0.45,
  lexicalKeyword: 0.25,
  sampleQuestion: 0.15,
  domainHint: 0.1,
  sourceQuality: 0.05,
};

const ENV_KEYS: Record<keyof RouterWeights, string> = {
  profileEmbedding: "R3MES_ROUTER_WEIGHT_PROFILE_EMBEDDING",
  lexicalKeyword: "R3MES_ROUTER_WEIGHT_LEXICAL_KEYWORD",
  sampleQuestion: "R3MES_ROUTER_WEIGHT_SAMPLE_QUESTION",
  domainHint: "R3MES_ROUTER_WEIGHT_DOMAIN_HINT",
  sourceQuality: "R3MES_ROUTER_WEIGHT_SOURCE_QUALITY",
};

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeWeights(weights: RouterWeights): RouterWeights {
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  if (sum <= 0) return DEFAULT_ROUTER_WEIGHTS;
  return {
    profileEmbedding: weights.profileEmbedding / sum,
    lexicalKeyword: weights.lexicalKeyword / sum,
    sampleQuestion: weights.sampleQuestion / sum,
    domainHint: weights.domainHint / sum,
    sourceQuality: weights.sourceQuality / sum,
  };
}

function readJsonWeights(env: NodeJS.ProcessEnv): Partial<RouterWeights> {
  const raw = env.R3MES_ROUTER_WEIGHTS_JSON;
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof RouterWeights, unknown>>;
    const out: Partial<RouterWeights> = {};
    for (const key of Object.keys(DEFAULT_ROUTER_WEIGHTS) as Array<keyof RouterWeights>) {
      const value = finiteNonNegative(parsed[key]);
      if (value !== null) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function getRouterWeights(env: NodeJS.ProcessEnv = process.env): RouterWeights {
  const jsonWeights = readJsonWeights(env);
  const merged: RouterWeights = { ...DEFAULT_ROUTER_WEIGHTS, ...jsonWeights };
  for (const key of Object.keys(DEFAULT_ROUTER_WEIGHTS) as Array<keyof RouterWeights>) {
    const value = finiteNonNegative(env[ENV_KEYS[key]]);
    if (value !== null) merged[key] = value;
  }
  return normalizeWeights(merged);
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
