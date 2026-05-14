import type { AlignmentConfig } from "./alignmentConfig.js";
import type { RouterWeights, AdaptiveRouterConfig } from "./routerConfig.js";

export const DECISION_CONFIG_VERSION = "decision-config-v1";

export interface RetrievalBudgetConfig {
  fastSourceLimit: number;
  normalSourceLimit: number;
  deepSourceLimit: number;
  deepQueryTerms: string[];
}

export interface HybridRetrievalConfig {
  lexicalWeight: number;
  embeddingWeight: number;
}

export interface RerankerDecisionConfig {
  mode: "model" | "deterministic";
  timeoutMs: number;
  modelWeight: number;
  candidateLimit: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  requireRealProvider: boolean;
}

export interface EvidenceScoringConfig {
  coreOverlapWeight: number;
  sourceTitleBonus: number;
  languageEvidenceBonus: number;
  tableValueBonus: number;
  tableRowBonus: number;
  exactNetPeriodBonus: number;
  exactPeriodProfitBonus: number;
  plainPeriodProfitBonus: number;
  shortRelevantBonus: number;
  spkScopeBonus: number;
  spkEnglishScopeBonus: number;
  stopajScopeBonus: number;
  stopajGroupRateBonus: number;
  otherSourcesScopeBonus: number;
  shareGroupScopeBonus: number;
  shareGroupDenseTableBonus: number;
  answerSourceTitleBonus: number;
  answerShareGroupTableBonus: number;
  answerShareGroupDenseTableBonus: number;
  answerWithholdingGroupRateBonus: number;
  rejectedExtraordinaryReservePenalty: number;
  unrequestedNetDistributablePenalty: number;
  headerPenalty: number;
  answerFactOverlapWeight: number;
  factDirectActionBonus: number;
  factCompleteSentenceBonus: number;
  factLengthBonus: number;
  factShortLengthPenalty: number;
  factIncompleteLongPenalty: number;
  factScaffoldPenalty: number;
  factTruncationPenalty: number;
  factGenericPenalty: number;
  fragmentActionBonus: number;
  fragmentCompleteSentenceBonus: number;
  fragmentLengthBonus: number;
  fragmentShortLengthPenalty: number;
  fragmentIncompleteLongPenalty: number;
  fragmentScaffoldPenalty: number;
  fragmentTruncationPenalty: number;
  fragmentMinScore: number;
  answerFactMinScore: number;
  answerFirstUsefulFactMinScore: number;
}

export interface EvidenceLexiconConfig {
  shareGroupTerms: string[];
  cashRateTerms: string[];
  withholdingTerms: string[];
  spkTerms: string[];
  otherSourcesTerms: string[];
  netPeriodTerms: string[];
  periodProfitTerms: string[];
  distributableTerms: string[];
}

export type EvidencePlannerExpectedType = "symptom_card" | "guideline" | "user_record" | "unknown";

export interface EvidencePlannerHintConfig {
  id: string;
  expectedEvidenceType: EvidencePlannerExpectedType;
  matchTerms: string[];
  searchQueries: string[];
  mustIncludeTerms: string[];
}

export interface IngestionQualityConfig {
  tableMediumScore: number;
  tableHighScore: number;
  tableMultiSignalScore: number;
  tableSingleSignalScore: number;
  tableDenseNumericScore: number;
  tableDenseNumericThreshold: number;
  ocrMediumScore: number;
  ocrHighScore: number;
  thinParseScore: number;
}

export interface EvidenceBudgetConfig {
  directFactLimit: number;
  supportingFactLimit: number;
  riskFactLimit: number;
  notSupportedLimit: number;
  usableFactLimit: number;
  sourceIdLimit: number;
}

export interface EvidenceCompilerConfig {
  minUsableFactsForMedium: number;
  minUsableFactsForHigh: number;
  requireSourceForMedium: boolean;
  requireSourceForHigh: boolean;
  contradictionDowngradesToLow: boolean;
}

export interface FeedbackRuntimeConfig {
  mode: "shadow" | "active";
  promotionMaxAbsDelta: number;
  candidateLimit: number;
}

export interface FeedbackProposalConfig {
  minSignals: number;
  baseScoreDelta: number;
  perSignalScoreDelta: number;
  minConfidenceFactor: number;
  mediumRiskAbsDelta: number;
  applyMinAbsDelta: number;
  applyMaxAbsDelta: number;
  expectedBoostMaxAbsDelta: number;
  expectedBoostMultiplier: number;
}

export interface DecisionConfig {
  version: string;
  router: {
    weights: RouterWeights;
    adaptive: AdaptiveRouterConfig;
    routeHintScoreWeight: number;
    strictProfileScoreThreshold: number;
    queryProfileStrictThreshold: number;
    suggestionScoreThresholdWithProfile: number;
    suggestionScoreThresholdWithoutProfile: number;
    routeSuggestionScoreThreshold: number;
    metadataCandidateMinScore: number;
  };
  alignment: AlignmentConfig;
  retrievalBudget: RetrievalBudgetConfig;
  hybridRetrieval: HybridRetrievalConfig;
  reranker: RerankerDecisionConfig;
  evidenceBudget: EvidenceBudgetConfig;
  evidenceCompiler: EvidenceCompilerConfig;
  evidenceScoring: EvidenceScoringConfig;
  evidenceLexicon: EvidenceLexiconConfig;
  evidencePlannerHints: EvidencePlannerHintConfig[];
  ingestionQuality: IngestionQualityConfig;
  feedbackRuntime: FeedbackRuntimeConfig;
  feedbackProposal: FeedbackProposalConfig;
}

const DEFAULT_ROUTER_WEIGHTS: RouterWeights = {
  profileEmbedding: 0.45,
  lexicalKeyword: 0.25,
  sampleQuestion: 0.15,
  domainHint: 0.1,
  sourceQuality: 0.05,
};

const DEFAULT_ADAPTIVE_ROUTER_CONFIG: AdaptiveRouterConfig = {
  queryMatchBonusPerTerm: 7,
  structuredSourceBonus: 12,
  inferredSourceBonus: 6,
  routeOverrideMargin: 18,
  thinRoutePenalty: 10,
};

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

const DEFAULT_HYBRID_RETRIEVAL: HybridRetrievalConfig = {
  lexicalWeight: 0.75,
  embeddingWeight: 0.25,
};

const DEFAULT_EVIDENCE_SCORING: EvidenceScoringConfig = {
  coreOverlapWeight: 4,
  sourceTitleBonus: 30,
  languageEvidenceBonus: 12,
  tableValueBonus: 3,
  tableRowBonus: 5,
  exactNetPeriodBonus: 10,
  exactPeriodProfitBonus: 8,
  plainPeriodProfitBonus: 9,
  shortRelevantBonus: 2,
  spkScopeBonus: 24,
  spkEnglishScopeBonus: 18,
  stopajScopeBonus: 22,
  stopajGroupRateBonus: 34,
  otherSourcesScopeBonus: 22,
  shareGroupScopeBonus: 26,
  shareGroupDenseTableBonus: 38,
  answerSourceTitleBonus: 35,
  answerShareGroupTableBonus: 36,
  answerShareGroupDenseTableBonus: 42,
  answerWithholdingGroupRateBonus: 32,
  rejectedExtraordinaryReservePenalty: 60,
  unrequestedNetDistributablePenalty: 50,
  headerPenalty: 6,
  answerFactOverlapWeight: 6,
  factDirectActionBonus: 4,
  factCompleteSentenceBonus: 1,
  factLengthBonus: 2,
  factShortLengthPenalty: 4,
  factIncompleteLongPenalty: 10,
  factScaffoldPenalty: 6,
  factTruncationPenalty: 5,
  factGenericPenalty: 3,
  fragmentActionBonus: 5,
  fragmentCompleteSentenceBonus: 3,
  fragmentLengthBonus: 2,
  fragmentShortLengthPenalty: 4,
  fragmentIncompleteLongPenalty: 10,
  fragmentScaffoldPenalty: 8,
  fragmentTruncationPenalty: 6,
  fragmentMinScore: -8,
  answerFactMinScore: -20,
  answerFirstUsefulFactMinScore: 1,
};

const DEFAULT_EVIDENCE_LEXICON: EvidenceLexiconConfig = {
  shareGroupTerms: ["grubu", "grub", "group", "pay grubu"],
  cashRateTerms: ["nakit", "cash", "oran", "rate", "bonus", "bedelsiz"],
  withholdingTerms: ["stopaj", "withholding"],
  spkTerms: ["spk", "capital markets board"],
  otherSourcesTerms: ["dagitilmasi ongorulen diger kaynak", "other sources", "olaganustu yedek", "extraordinary reserves"],
  netPeriodTerms: ["net donem"],
  periodProfitTerms: ["donem kari", "donem kâri"],
  distributableTerms: ["dagitilabilir"],
};

const DEFAULT_EVIDENCE_PLANNER_HINTS: EvidencePlannerHintConfig[] = [
  {
    id: "medical_abdominal_pain",
    expectedEvidenceType: "symptom_card",
    matchTerms: ["karn", "karın", "karin", "mide", "göbek", "gobek"],
    searchQueries: [
      "karın ağrısı genel triyaj",
      "karın ağrısı ateş kusma kanama acil belirtiler",
      "kasık ağrısı alt karın ağrısı kadın doğum",
    ],
    mustIncludeTerms: ["karın", "ağrı", "ateş", "kusma", "kanama", "acil"],
  },
  {
    id: "medical_pelvic_pain",
    expectedEvidenceType: "symptom_card",
    matchTerms: ["kasık", "kasik", "pelvik", "alt karın", "alt karin"],
    searchQueries: [
      "kasık ağrısı genel triyaj",
      "pelvik ağrı kadın doğum acil belirtiler",
      "kasık ağrısı ateş kanama akıntı gebelik şüphesi",
    ],
    mustIncludeTerms: ["kasık", "pelvik", "ağrı", "kanama", "akıntı", "gebelik"],
  },
  {
    id: "medical_abnormal_bleeding",
    expectedEvidenceType: "symptom_card",
    matchTerms: ["kanama", "lekelenme", "adet dışı", "adet disi", "menopoz"],
    searchQueries: [
      "anormal vajinal kanama triyaj",
      "adet dışı kanama lekelenme kadın doğum",
      "menopoz sonrası kanama değerlendirme",
    ],
    mustIncludeTerms: ["kanama", "lekelenme", "adet", "menopoz"],
  },
  {
    id: "medical_discharge",
    expectedEvidenceType: "symptom_card",
    matchTerms: ["akıntı", "akinti", "koku", "kaşıntı", "kasinti", "yanma"],
    searchQueries: [
      "vajinal akıntı triyaj",
      "akıntı kötü koku kaşıntı kasık ağrısı",
      "vajinal akıntı ateş kanama acil belirtiler",
    ],
    mustIncludeTerms: ["akıntı", "koku", "kaşıntı", "yanma", "ağrı"],
  },
  {
    id: "legal_general",
    expectedEvidenceType: "guideline",
    matchTerms: ["hukuk", "dava", "avukat", "sözleşme", "sozlesme", "kira", "tüketici", "tuketici", "ayıplı", "ayipli", "bozuk ürün", "bozuk urun", "fatura", "satıcı", "satici", "iade", "trafik cezası", "itiraz"],
    searchQueries: ["{query} hukuki bilgi", "{query} süre belge başvuru", "{query} avukat yetkili kurum"],
    mustIncludeTerms: ["hukuk", "süre", "belge", "başvuru", "avukat", "sözleşme", "fatura", "iade"],
  },
  {
    id: "finance_general",
    expectedEvidenceType: "guideline",
    matchTerms: ["yatırım", "yatirim", "hisse", "borsa", "kripto", "faiz", "kredi", "portföy", "portfoy", "finans"],
    searchQueries: ["{query} risk vade maliyet", "{query} yatırım danışmanı çeşitlendirme", "{query} getiri garantisi risk"],
    mustIncludeTerms: ["yatırım", "risk", "vade", "maliyet", "danışman", "garanti"],
  },
  {
    id: "technical_migration",
    expectedEvidenceType: "guideline",
    matchTerms: ["migration", "veritabanı", "veritabani", "deploy", "rollback", "staging", "sunucu", "log", "yedek"],
    searchQueries: ["{query} yedek rollback staging", "{query} log kontrol riskli işlem", "{query} üretim ortamı güvenli migration"],
    mustIncludeTerms: ["migration", "yedek", "rollback", "staging", "log", "üretim"],
  },
  {
    id: "medical_user_record",
    expectedEvidenceType: "user_record",
    matchTerms: ["smear", "hpv", "biyopsi", "patoloji", "kist", "yumurtalık", "yumurtalik"],
    searchQueries: ["{query} kadın hastalıkları takip", "{query} güvenli değerlendirme"],
    mustIncludeTerms: [],
  },
  {
    id: "medical_biopsy_followup",
    expectedEvidenceType: "user_record",
    matchTerms: ["biyopsi", "parça", "parca"],
    searchQueries: ["biyopsi temiz sonuç takip", "rahimden parça alındı temiz çıktı kanama", "biyopsi sonrası lekelenme kontrol"],
    mustIncludeTerms: ["biyopsi", "parça", "temiz", "kanama", "lekelenme", "kontrol"],
  },
  {
    id: "medical_ascus_followup",
    expectedEvidenceType: "user_record",
    matchTerms: ["asc-us", "ascus", "asc us"],
    searchQueries: ["ASC-US smear sonucu takip", "ASC-US kanser anlamına gelir mi", "ASC-US HPV kontrol değerlendirme"],
    mustIncludeTerms: ["ASC-US", "smear", "takip", "kontrol", "kanser"],
  },
];

const DEFAULT_INGESTION_QUALITY: IngestionQualityConfig = {
  tableMediumScore: 35,
  tableHighScore: 65,
  tableMultiSignalScore: 70,
  tableSingleSignalScore: 38,
  tableDenseNumericScore: 52,
  tableDenseNumericThreshold: 0.18,
  ocrMediumScore: 12,
  ocrHighScore: 35,
  thinParseScore: 48,
};

const ROUTER_WEIGHT_ENV_KEYS: Record<keyof RouterWeights, string> = {
  profileEmbedding: "R3MES_ROUTER_WEIGHT_PROFILE_EMBEDDING",
  lexicalKeyword: "R3MES_ROUTER_WEIGHT_LEXICAL_KEYWORD",
  sampleQuestion: "R3MES_ROUTER_WEIGHT_SAMPLE_QUESTION",
  domainHint: "R3MES_ROUTER_WEIGHT_DOMAIN_HINT",
  sourceQuality: "R3MES_ROUTER_WEIGHT_SOURCE_QUALITY",
};

const ADAPTIVE_ENV_KEYS: Record<keyof AdaptiveRouterConfig, string> = {
  queryMatchBonusPerTerm: "R3MES_ROUTER_QUERY_MATCH_BONUS_PER_TERM",
  structuredSourceBonus: "R3MES_ROUTER_STRUCTURED_SOURCE_BONUS",
  inferredSourceBonus: "R3MES_ROUTER_INFERRED_SOURCE_BONUS",
  routeOverrideMargin: "R3MES_ROUTER_ROUTE_OVERRIDE_MARGIN",
  thinRoutePenalty: "R3MES_ROUTER_THIN_ROUTE_PENALTY",
};

const EVIDENCE_ENV_KEYS: Record<keyof EvidenceScoringConfig, string> = {
  coreOverlapWeight: "R3MES_EVIDENCE_SCORE_CORE_OVERLAP_WEIGHT",
  sourceTitleBonus: "R3MES_EVIDENCE_SCORE_SOURCE_TITLE_BONUS",
  languageEvidenceBonus: "R3MES_EVIDENCE_SCORE_LANGUAGE_BONUS",
  tableValueBonus: "R3MES_EVIDENCE_SCORE_TABLE_VALUE_BONUS",
  tableRowBonus: "R3MES_EVIDENCE_SCORE_TABLE_ROW_BONUS",
  exactNetPeriodBonus: "R3MES_EVIDENCE_SCORE_EXACT_NET_PERIOD_BONUS",
  exactPeriodProfitBonus: "R3MES_EVIDENCE_SCORE_EXACT_PERIOD_PROFIT_BONUS",
  plainPeriodProfitBonus: "R3MES_EVIDENCE_SCORE_PLAIN_PERIOD_PROFIT_BONUS",
  shortRelevantBonus: "R3MES_EVIDENCE_SCORE_SHORT_RELEVANT_BONUS",
  spkScopeBonus: "R3MES_EVIDENCE_SCORE_SPK_SCOPE_BONUS",
  spkEnglishScopeBonus: "R3MES_EVIDENCE_SCORE_SPK_ENGLISH_SCOPE_BONUS",
  stopajScopeBonus: "R3MES_EVIDENCE_SCORE_STOPAJ_SCOPE_BONUS",
  stopajGroupRateBonus: "R3MES_EVIDENCE_SCORE_STOPAJ_GROUP_RATE_BONUS",
  otherSourcesScopeBonus: "R3MES_EVIDENCE_SCORE_OTHER_SOURCES_SCOPE_BONUS",
  shareGroupScopeBonus: "R3MES_EVIDENCE_SCORE_SHARE_GROUP_SCOPE_BONUS",
  shareGroupDenseTableBonus: "R3MES_EVIDENCE_SCORE_SHARE_GROUP_DENSE_TABLE_BONUS",
  answerSourceTitleBonus: "R3MES_EVIDENCE_SCORE_ANSWER_SOURCE_TITLE_BONUS",
  answerShareGroupTableBonus: "R3MES_EVIDENCE_SCORE_ANSWER_SHARE_GROUP_TABLE_BONUS",
  answerShareGroupDenseTableBonus: "R3MES_EVIDENCE_SCORE_ANSWER_SHARE_GROUP_DENSE_TABLE_BONUS",
  answerWithholdingGroupRateBonus: "R3MES_EVIDENCE_SCORE_ANSWER_WITHHOLDING_GROUP_RATE_BONUS",
  rejectedExtraordinaryReservePenalty: "R3MES_EVIDENCE_SCORE_REJECTED_EXTRAORDINARY_RESERVE_PENALTY",
  unrequestedNetDistributablePenalty: "R3MES_EVIDENCE_SCORE_UNREQUESTED_NET_DISTRIBUTABLE_PENALTY",
  headerPenalty: "R3MES_EVIDENCE_SCORE_HEADER_PENALTY",
  answerFactOverlapWeight: "R3MES_EVIDENCE_SCORE_ANSWER_FACT_OVERLAP_WEIGHT",
  factDirectActionBonus: "R3MES_EVIDENCE_SCORE_FACT_DIRECT_ACTION_BONUS",
  factCompleteSentenceBonus: "R3MES_EVIDENCE_SCORE_FACT_COMPLETE_SENTENCE_BONUS",
  factLengthBonus: "R3MES_EVIDENCE_SCORE_FACT_LENGTH_BONUS",
  factShortLengthPenalty: "R3MES_EVIDENCE_SCORE_FACT_SHORT_LENGTH_PENALTY",
  factIncompleteLongPenalty: "R3MES_EVIDENCE_SCORE_FACT_INCOMPLETE_LONG_PENALTY",
  factScaffoldPenalty: "R3MES_EVIDENCE_SCORE_FACT_SCAFFOLD_PENALTY",
  factTruncationPenalty: "R3MES_EVIDENCE_SCORE_FACT_TRUNCATION_PENALTY",
  factGenericPenalty: "R3MES_EVIDENCE_SCORE_FACT_GENERIC_PENALTY",
  fragmentActionBonus: "R3MES_EVIDENCE_SCORE_FRAGMENT_ACTION_BONUS",
  fragmentCompleteSentenceBonus: "R3MES_EVIDENCE_SCORE_FRAGMENT_COMPLETE_SENTENCE_BONUS",
  fragmentLengthBonus: "R3MES_EVIDENCE_SCORE_FRAGMENT_LENGTH_BONUS",
  fragmentShortLengthPenalty: "R3MES_EVIDENCE_SCORE_FRAGMENT_SHORT_LENGTH_PENALTY",
  fragmentIncompleteLongPenalty: "R3MES_EVIDENCE_SCORE_FRAGMENT_INCOMPLETE_LONG_PENALTY",
  fragmentScaffoldPenalty: "R3MES_EVIDENCE_SCORE_FRAGMENT_SCAFFOLD_PENALTY",
  fragmentTruncationPenalty: "R3MES_EVIDENCE_SCORE_FRAGMENT_TRUNCATION_PENALTY",
  fragmentMinScore: "R3MES_EVIDENCE_SCORE_FRAGMENT_MIN_SCORE",
  answerFactMinScore: "R3MES_EVIDENCE_SCORE_ANSWER_FACT_MIN_SCORE",
  answerFirstUsefulFactMinScore: "R3MES_EVIDENCE_SCORE_ANSWER_FIRST_USEFUL_FACT_MIN_SCORE",
};

const EVIDENCE_LEXICON_ENV_KEYS: Record<keyof EvidenceLexiconConfig, string> = {
  shareGroupTerms: "R3MES_EVIDENCE_LEXICON_SHARE_GROUP_TERMS",
  cashRateTerms: "R3MES_EVIDENCE_LEXICON_CASH_RATE_TERMS",
  withholdingTerms: "R3MES_EVIDENCE_LEXICON_WITHHOLDING_TERMS",
  spkTerms: "R3MES_EVIDENCE_LEXICON_SPK_TERMS",
  otherSourcesTerms: "R3MES_EVIDENCE_LEXICON_OTHER_SOURCES_TERMS",
  netPeriodTerms: "R3MES_EVIDENCE_LEXICON_NET_PERIOD_TERMS",
  periodProfitTerms: "R3MES_EVIDENCE_LEXICON_PERIOD_PROFIT_TERMS",
  distributableTerms: "R3MES_EVIDENCE_LEXICON_DISTRIBUTABLE_TERMS",
};

const INGESTION_QUALITY_ENV_KEYS: Record<keyof IngestionQualityConfig, string> = {
  tableMediumScore: "R3MES_INGESTION_TABLE_MEDIUM_SCORE",
  tableHighScore: "R3MES_INGESTION_TABLE_HIGH_SCORE",
  tableMultiSignalScore: "R3MES_INGESTION_TABLE_MULTI_SIGNAL_SCORE",
  tableSingleSignalScore: "R3MES_INGESTION_TABLE_SINGLE_SIGNAL_SCORE",
  tableDenseNumericScore: "R3MES_INGESTION_TABLE_DENSE_NUMERIC_SCORE",
  tableDenseNumericThreshold: "R3MES_INGESTION_TABLE_DENSE_NUMERIC_THRESHOLD",
  ocrMediumScore: "R3MES_INGESTION_OCR_MEDIUM_SCORE",
  ocrHighScore: "R3MES_INGESTION_OCR_HIGH_SCORE",
  thinParseScore: "R3MES_INGESTION_THIN_PARSE_SCORE",
};

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

function readNonNegative(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Math.floor(readNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

function readPositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = readNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function readCsv(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return raw && raw.length > 0 ? raw : fallback;
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

function normalizeHybridRetrievalWeights(weights: HybridRetrievalConfig): HybridRetrievalConfig {
  const lexicalWeight = Math.max(0, weights.lexicalWeight);
  const embeddingWeight = Math.max(0, weights.embeddingWeight);
  const sum = lexicalWeight + embeddingWeight;
  if (sum <= 0) return DEFAULT_HYBRID_RETRIEVAL;
  return {
    lexicalWeight: lexicalWeight / sum,
    embeddingWeight: embeddingWeight / sum,
  };
}

function readJsonObject<T extends Record<string, unknown>>(raw: string | undefined): Partial<T> {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return {};
  }
}

function readRouterWeights(env: NodeJS.ProcessEnv): RouterWeights {
  const parsed = readJsonObject<Partial<Record<keyof RouterWeights, unknown>>>(env.R3MES_ROUTER_WEIGHTS_JSON);
  const merged: RouterWeights = { ...DEFAULT_ROUTER_WEIGHTS };
  for (const key of Object.keys(DEFAULT_ROUTER_WEIGHTS) as Array<keyof RouterWeights>) {
    const jsonValue = readNonNegative(parsed[key]);
    if (jsonValue !== null) merged[key] = jsonValue;
    const envValue = readNonNegative(env[ROUTER_WEIGHT_ENV_KEYS[key]]);
    if (envValue !== null) merged[key] = envValue;
  }
  return normalizeWeights(merged);
}

function readAdaptiveRouterConfig(env: NodeJS.ProcessEnv): AdaptiveRouterConfig {
  const parsed = readJsonObject<Partial<Record<keyof AdaptiveRouterConfig, unknown>>>(env.R3MES_ADAPTIVE_ROUTER_CONFIG_JSON);
  const merged: AdaptiveRouterConfig = { ...DEFAULT_ADAPTIVE_ROUTER_CONFIG };
  for (const key of Object.keys(DEFAULT_ADAPTIVE_ROUTER_CONFIG) as Array<keyof AdaptiveRouterConfig>) {
    const jsonValue = readNonNegative(parsed[key]);
    if (jsonValue !== null) merged[key] = jsonValue;
    const envValue = readNonNegative(env[ADAPTIVE_ENV_KEYS[key]]);
    if (envValue !== null) merged[key] = envValue;
  }
  return merged;
}

function readAlignmentConfig(env: NodeJS.ProcessEnv): AlignmentConfig {
  return {
    enabled: readBoolean(env.R3MES_ALIGNMENT_ENABLED, true),
    fastFailEnabled: readBoolean(env.R3MES_ALIGNMENT_FAST_FAIL_ENABLED, true),
    minScore: readNumber(env.R3MES_ALIGNMENT_MIN_SCORE, 0.34),
    weakScore: readNumber(env.R3MES_ALIGNMENT_WEAK_SCORE, 0.5),
    genericPenalty: readNumber(env.R3MES_ALIGNMENT_GENERIC_PENALTY, 0.18),
    maxRerankWords: readPositiveInt(env.R3MES_ALIGNMENT_MAX_RERANK_WORDS, 300),
    semanticKeepScore: readNumber(env.R3MES_ALIGNMENT_SEMANTIC_KEEP_SCORE, 0.62),
  };
}

function readEvidenceScoringConfig(env: NodeJS.ProcessEnv): EvidenceScoringConfig {
  const parsed = readJsonObject<Partial<Record<keyof EvidenceScoringConfig, unknown>>>(env.R3MES_EVIDENCE_SCORING_JSON);
  const merged: EvidenceScoringConfig = { ...DEFAULT_EVIDENCE_SCORING };
  for (const key of Object.keys(DEFAULT_EVIDENCE_SCORING) as Array<keyof EvidenceScoringConfig>) {
    const jsonValue = readNonNegative(parsed[key]);
    if (jsonValue !== null) merged[key] = jsonValue;
    const envValue = readNonNegative(env[EVIDENCE_ENV_KEYS[key]]);
    if (envValue !== null) merged[key] = envValue;
  }
  return merged;
}

function readEvidenceLexiconConfig(env: NodeJS.ProcessEnv): EvidenceLexiconConfig {
  const parsed = readJsonObject<Partial<Record<keyof EvidenceLexiconConfig, unknown>>>(env.R3MES_EVIDENCE_LEXICON_JSON);
  const merged: EvidenceLexiconConfig = { ...DEFAULT_EVIDENCE_LEXICON };
  for (const key of Object.keys(DEFAULT_EVIDENCE_LEXICON) as Array<keyof EvidenceLexiconConfig>) {
    const jsonValue = Array.isArray(parsed[key])
      ? (parsed[key] as unknown[]).map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (jsonValue.length > 0) merged[key] = jsonValue;
    merged[key] = readCsv(env[EVIDENCE_LEXICON_ENV_KEYS[key]], merged[key]);
  }
  return merged;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function readEvidencePlannerHints(env: NodeJS.ProcessEnv): EvidencePlannerHintConfig[] {
  const raw = env.R3MES_EVIDENCE_PLANNER_HINTS_JSON;
  if (!raw?.trim()) return DEFAULT_EVIDENCE_PLANNER_HINTS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_EVIDENCE_PLANNER_HINTS;
    const hints = parsed
      .map((item): EvidencePlannerHintConfig | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const id = String(record.id ?? "").trim();
        const expectedEvidenceType = String(record.expectedEvidenceType ?? "unknown") as EvidencePlannerExpectedType;
        if (!id || !["symptom_card", "guideline", "user_record", "unknown"].includes(expectedEvidenceType)) return null;
        const matchTerms = readStringArray(record.matchTerms);
        if (matchTerms.length === 0) return null;
        return {
          id,
          expectedEvidenceType,
          matchTerms,
          searchQueries: readStringArray(record.searchQueries),
          mustIncludeTerms: readStringArray(record.mustIncludeTerms),
        };
      })
      .filter((item): item is EvidencePlannerHintConfig => Boolean(item));
    return hints.length > 0 ? hints : DEFAULT_EVIDENCE_PLANNER_HINTS;
  } catch {
    return DEFAULT_EVIDENCE_PLANNER_HINTS;
  }
}

function readIngestionQualityConfig(env: NodeJS.ProcessEnv): IngestionQualityConfig {
  const parsed = readJsonObject<Partial<Record<keyof IngestionQualityConfig, unknown>>>(env.R3MES_INGESTION_QUALITY_JSON);
  const merged: IngestionQualityConfig = { ...DEFAULT_INGESTION_QUALITY };
  for (const key of Object.keys(DEFAULT_INGESTION_QUALITY) as Array<keyof IngestionQualityConfig>) {
    const jsonValue = readNonNegative(parsed[key]);
    if (jsonValue !== null) merged[key] = jsonValue;
    const envValue = readNonNegative(env[INGESTION_QUALITY_ENV_KEYS[key]]);
    if (envValue !== null) merged[key] = envValue;
  }
  return merged;
}

export function getDecisionConfig(env: NodeJS.ProcessEnv = process.env): DecisionConfig {
  return {
    version: env.R3MES_DECISION_CONFIG_VERSION?.trim() || DECISION_CONFIG_VERSION,
    router: {
      weights: readRouterWeights(env),
      adaptive: readAdaptiveRouterConfig(env),
      routeHintScoreWeight: readNumber(env.R3MES_ROUTE_HINT_SCORE_WEIGHT, 0.35),
      strictProfileScoreThreshold: readNumber(env.R3MES_ROUTER_STRICT_PROFILE_SCORE_THRESHOLD, 70),
      queryProfileStrictThreshold: readNumber(env.R3MES_ROUTER_QUERY_PROFILE_STRICT_THRESHOLD, 64),
      suggestionScoreThresholdWithProfile: readNumber(env.R3MES_ROUTER_SUGGESTION_SCORE_WITH_PROFILE, 24),
      suggestionScoreThresholdWithoutProfile: readNumber(env.R3MES_ROUTER_SUGGESTION_SCORE_WITHOUT_PROFILE, 14),
      routeSuggestionScoreThreshold: readNumber(env.R3MES_ROUTER_ROUTE_SUGGESTION_SCORE_THRESHOLD, 64),
      metadataCandidateMinScore: readNumber(env.R3MES_ROUTER_METADATA_CANDIDATE_MIN_SCORE, 20),
    },
    alignment: readAlignmentConfig(env),
    retrievalBudget: {
      fastSourceLimit: readPositiveInt(env.R3MES_RAG_FAST_SOURCE_LIMIT, 2),
      normalSourceLimit: readPositiveInt(env.R3MES_RAG_NORMAL_SOURCE_LIMIT, 3),
      deepSourceLimit: readPositiveInt(env.R3MES_RAG_DEEP_SOURCE_LIMIT, 4),
      deepQueryTerms: readCsv(env.R3MES_RAG_DEEP_QUERY_TERMS, DEFAULT_DEEP_QUERY_TERMS),
    },
    hybridRetrieval: normalizeHybridRetrievalWeights({
      lexicalWeight: readNumber(env.R3MES_HYBRID_LEXICAL_WEIGHT, DEFAULT_HYBRID_RETRIEVAL.lexicalWeight),
      embeddingWeight: readNumber(env.R3MES_HYBRID_EMBEDDING_WEIGHT, DEFAULT_HYBRID_RETRIEVAL.embeddingWeight),
    }),
    reranker: {
      mode: (env.R3MES_RERANKER_MODE ?? "model").trim().toLowerCase() === "deterministic" ? "deterministic" : "model",
      timeoutMs: readPositiveInt(env.R3MES_RERANKER_TIMEOUT_MS, 8_000),
      modelWeight: readPositiveFloat(env.R3MES_RERANKER_MODEL_WEIGHT, 1.75),
      candidateLimit: readPositiveInt(env.R3MES_RERANKER_CANDIDATE_LIMIT, 5),
      cacheTtlMs: readPositiveInt(env.R3MES_RERANKER_CACHE_TTL_MS, 10 * 60_000),
      cacheMaxEntries: readPositiveInt(env.R3MES_RERANKER_CACHE_MAX_ENTRIES, 256),
      requireRealProvider: env.R3MES_REQUIRE_REAL_RERANKER === "1" || env.NODE_ENV === "production",
    },
    evidenceBudget: {
      directFactLimit: readPositiveInt(env.R3MES_EVIDENCE_DIRECT_FACT_LIMIT, 3),
      supportingFactLimit: readPositiveInt(env.R3MES_EVIDENCE_SUPPORTING_FACT_LIMIT, 2),
      riskFactLimit: readPositiveInt(env.R3MES_EVIDENCE_RISK_FACT_LIMIT, 3),
      notSupportedLimit: readPositiveInt(env.R3MES_EVIDENCE_NOT_SUPPORTED_LIMIT, 4),
      usableFactLimit: readPositiveInt(env.R3MES_EVIDENCE_USABLE_FACT_LIMIT, 5),
      sourceIdLimit: readPositiveInt(env.R3MES_EVIDENCE_SOURCE_ID_LIMIT, 8),
    },
    evidenceCompiler: {
      minUsableFactsForMedium: readPositiveInt(env.R3MES_EVIDENCE_COMPILER_MIN_FACTS_MEDIUM, 1),
      minUsableFactsForHigh: readPositiveInt(env.R3MES_EVIDENCE_COMPILER_MIN_FACTS_HIGH, 1),
      requireSourceForMedium: readBoolean(env.R3MES_EVIDENCE_COMPILER_REQUIRE_SOURCE_MEDIUM, false),
      requireSourceForHigh: readBoolean(env.R3MES_EVIDENCE_COMPILER_REQUIRE_SOURCE_HIGH, false),
      contradictionDowngradesToLow: readBoolean(env.R3MES_EVIDENCE_COMPILER_CONTRADICTION_LOW, true),
    },
    evidenceScoring: readEvidenceScoringConfig(env),
    evidenceLexicon: readEvidenceLexiconConfig(env),
    evidencePlannerHints: readEvidencePlannerHints(env),
    ingestionQuality: readIngestionQualityConfig(env),
    feedbackRuntime: {
      mode: (env.R3MES_FEEDBACK_RUNTIME_MODE ?? "shadow").trim().toLowerCase() === "active" ? "active" : "shadow",
      promotionMaxAbsDelta: readPositiveFloat(env.R3MES_FEEDBACK_PROMOTION_MAX_ABS_DELTA, 0.35),
      candidateLimit: readPositiveInt(env.R3MES_FEEDBACK_RUNTIME_CANDIDATE_LIMIT, 25),
    },
    feedbackProposal: {
      minSignals: readPositiveInt(env.R3MES_FEEDBACK_PROPOSAL_MIN_SIGNALS, 2),
      baseScoreDelta: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_BASE_SCORE_DELTA, 0.08),
      perSignalScoreDelta: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_PER_SIGNAL_DELTA, 0.04),
      minConfidenceFactor: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_MIN_CONFIDENCE_FACTOR, 0.25),
      mediumRiskAbsDelta: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_MEDIUM_RISK_ABS_DELTA, 0.2),
      applyMinAbsDelta: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_APPLY_MIN_ABS_DELTA, 0.03),
      applyMaxAbsDelta: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_APPLY_MAX_ABS_DELTA, 0.25),
      expectedBoostMaxAbsDelta: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_EXPECTED_BOOST_MAX_ABS_DELTA, 0.18),
      expectedBoostMultiplier: readPositiveFloat(env.R3MES_FEEDBACK_PROPOSAL_EXPECTED_BOOST_MULTIPLIER, 0.75),
    },
  };
}

export function getDecisionConfigVersion(env: NodeJS.ProcessEnv = process.env): string {
  return getDecisionConfig(env).version;
}
