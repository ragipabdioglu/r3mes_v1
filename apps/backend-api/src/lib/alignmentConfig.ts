import { getDecisionConfig } from "./decisionConfig.js";

export interface AlignmentConfig {
  enabled: boolean;
  fastFailEnabled: boolean;
  minScore: number;
  weakScore: number;
  genericPenalty: number;
  maxRerankWords: number;
  semanticKeepScore: number;
}

export function getAlignmentConfig(): AlignmentConfig {
  return getDecisionConfig().alignment;
}
