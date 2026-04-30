export interface AlignmentConfig {
  enabled: boolean;
  fastFailEnabled: boolean;
  minScore: number;
  weakScore: number;
  genericPenalty: number;
  maxRerankWords: number;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Math.floor(readNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

export function getAlignmentConfig(): AlignmentConfig {
  return {
    enabled: readBoolean(process.env.R3MES_ALIGNMENT_ENABLED, true),
    fastFailEnabled: readBoolean(process.env.R3MES_ALIGNMENT_FAST_FAIL_ENABLED, true),
    minScore: readNumber(process.env.R3MES_ALIGNMENT_MIN_SCORE, 0.34),
    weakScore: readNumber(process.env.R3MES_ALIGNMENT_WEAK_SCORE, 0.5),
    genericPenalty: readNumber(process.env.R3MES_ALIGNMENT_GENERIC_PENALTY, 0.18),
    maxRerankWords: readPositiveInt(process.env.R3MES_ALIGNMENT_MAX_RERANK_WORDS, 300),
  };
}
