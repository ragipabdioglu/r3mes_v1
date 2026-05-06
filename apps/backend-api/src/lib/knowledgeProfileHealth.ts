export type KnowledgeProfileHealthLevel = "healthy" | "usable" | "weak";

export interface KnowledgeProfileHealth {
  score: number;
  level: KnowledgeProfileHealthLevel;
  warnings: string[];
  signals: {
    hasProfile: boolean;
    sourceQuality: "structured" | "inferred" | "thin" | null;
    confidence: "low" | "medium" | "high" | null;
    profileVersion: number | null;
    domainCount: number;
    subtopicCount: number;
    keywordCount: number;
    entityCount: number;
    topicPhraseCount: number;
    answerableConceptCount: number;
    negativeHintCount: number;
    sampleQuestionCount: number;
    embeddingFieldCount: number;
    hasProfileText: boolean;
    hasSummary: boolean;
    hasLastProfiledAt: boolean;
    parseQualityScore: number | null;
    parseQualityLevel: "clean" | "usable" | "noisy" | null;
    parseQualityWarningCount: number;
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function readProfile(autoMetadata: unknown): Record<string, unknown> | null {
  if (!autoMetadata || typeof autoMetadata !== "object") return null;
  const record = autoMetadata as Record<string, unknown>;
  if (!record.profile || typeof record.profile !== "object") return null;
  return record.profile as Record<string, unknown>;
}

function readSourceQuality(value: unknown): KnowledgeProfileHealth["signals"]["sourceQuality"] {
  return value === "structured" || value === "inferred" || value === "thin" ? value : null;
}

function readConfidence(value: unknown): KnowledgeProfileHealth["signals"]["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function readParseQuality(value: unknown): {
  score: number | null;
  level: "clean" | "usable" | "noisy" | null;
  warningCount: number;
} {
  if (!value || typeof value !== "object") {
    return { score: null, level: null, warningCount: 0 };
  }
  const record = value as Record<string, unknown>;
  const level = record.level === "clean" || record.level === "usable" || record.level === "noisy" ? record.level : null;
  const score = typeof record.score === "number" && Number.isFinite(record.score)
    ? Math.max(0, Math.min(100, Math.round(record.score)))
    : null;
  return {
    score,
    level,
    warningCount: stringArray(record.warnings).length,
  };
}

function scoreCount(count: number, fullAt: number, points: number): number {
  if (count <= 0) return 0;
  return Math.min(points, (count / fullAt) * points);
}

function levelForScore(score: number): KnowledgeProfileHealthLevel {
  if (score >= 78) return "healthy";
  if (score >= 48) return "usable";
  return "weak";
}

export function scoreKnowledgeProfileHealth(autoMetadata: unknown): KnowledgeProfileHealth {
  const profile = readProfile(autoMetadata);
  const metadata = autoMetadata && typeof autoMetadata === "object" ? autoMetadata as Record<string, unknown> : {};
  const sourceQuality = readSourceQuality(profile?.sourceQuality ?? metadata.sourceQuality);
  const confidence = readConfidence(profile?.confidence);
  const parseQuality = readParseQuality(metadata.parseQuality);
  const embeddingFields = [
    "profileEmbedding",
    "summaryEmbedding",
    "sampleQuestionsEmbedding",
    "keywordsEmbedding",
    "entityEmbedding",
  ];
  const embeddingFieldCount = profile
    ? embeddingFields.filter((field) => numberArray(profile[field]).length > 0).length
    : 0;
  const profileVersion =
    typeof profile?.profileVersion === "number"
      ? profile.profileVersion
      : typeof profile?.version === "number"
        ? profile.version
        : null;
  const signals: KnowledgeProfileHealth["signals"] = {
    hasProfile: Boolean(profile),
    sourceQuality,
    confidence,
    profileVersion,
    domainCount: stringArray(profile?.domains).length,
    subtopicCount: stringArray(profile?.subtopics).length,
    keywordCount: stringArray(profile?.keywords).length,
    entityCount: stringArray(profile?.entities).length,
    topicPhraseCount: stringArray(profile?.topicPhrases).length,
    answerableConceptCount: stringArray(profile?.answerableConcepts).length,
    negativeHintCount: stringArray(profile?.negativeHints).length,
    sampleQuestionCount: stringArray(profile?.sampleQuestions).length,
    embeddingFieldCount,
    hasProfileText: typeof profile?.profileText === "string" && profile.profileText.trim().length > 0,
    hasSummary: typeof profile?.summary === "string" && profile.summary.trim().length > 0,
    hasLastProfiledAt: typeof profile?.lastProfiledAt === "string" && profile.lastProfiledAt.trim().length > 0,
    parseQualityScore: parseQuality.score,
    parseQualityLevel: parseQuality.level,
    parseQualityWarningCount: parseQuality.warningCount,
  };
  const qualityScore = sourceQuality === "structured" ? 18 : sourceQuality === "inferred" ? 11 : sourceQuality === "thin" ? 4 : 0;
  const confidenceScore = confidence === "high" ? 10 : confidence === "medium" ? 6 : confidence === "low" ? 2 : 0;
  const parseQualityScore =
    parseQuality.level === "clean"
      ? 6
      : parseQuality.level === "usable"
        ? 3
        : parseQuality.level === "noisy"
          ? -26
          : 0;
  const rawScore = Math.round(Math.max(0, Math.min(100,
    (signals.hasProfile ? 8 : 0) +
    qualityScore +
    confidenceScore +
    scoreCount(signals.domainCount, 1, 7) +
    scoreCount(signals.subtopicCount, 3, 9) +
    scoreCount(signals.keywordCount, 10, 8) +
    scoreCount(signals.entityCount, 5, 6) +
    scoreCount(signals.topicPhraseCount, 8, 10) +
    scoreCount(signals.answerableConceptCount, 10, 12) +
    scoreCount(signals.sampleQuestionCount, 4, 8) +
    scoreCount(signals.embeddingFieldCount, 5, 10) +
    (signals.hasProfileText ? 5 : 0) +
    (signals.hasSummary ? 4 : 0) +
    (signals.hasLastProfiledAt ? 3 : 0) +
    parseQualityScore
  )));
  const score = parseQuality.level === "noisy" ? Math.min(rawScore, 77) : rawScore;
  const warnings: string[] = [];
  if (!signals.hasProfile) warnings.push("missing_profile");
  if (sourceQuality === "thin") warnings.push("thin_source_quality");
  if (sourceQuality === "inferred") warnings.push("inferred_source_quality");
  if (!signals.hasLastProfiledAt) warnings.push("missing_last_profiled_at");
  if (signals.embeddingFieldCount < 3) warnings.push("low_embedding_field_coverage");
  if (signals.answerableConceptCount < 4) warnings.push("low_answerable_concept_coverage");
  if (signals.topicPhraseCount < 4) warnings.push("low_topic_phrase_coverage");
  if (signals.sampleQuestionCount === 0) warnings.push("missing_sample_questions");
  if (!signals.hasSummary) warnings.push("missing_summary");
  if (parseQuality.level === "noisy") warnings.push("noisy_parse_quality");
  if (parseQuality.level === "usable" && parseQuality.warningCount > 0) warnings.push("usable_parse_quality_with_warnings");

  return {
    score,
    level: levelForScore(score),
    warnings,
    signals,
  };
}
