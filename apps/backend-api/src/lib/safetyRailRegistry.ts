export type SafetySeverity = "pass" | "warn" | "rewrite" | "block";
export type SafetyRailCategory = "retrieval" | "evidence" | "privacy" | "output";
export type SafetyRailStatus = "pass" | "warn" | "rewrite" | "block";
export type SafetyFallbackMode = "low_grounding" | "domain_safe" | "source_suggestion" | "privacy_safe";

export interface SafetyRailDefinition {
  id: string;
  category: SafetyRailCategory;
  defaultStatus: SafetyRailStatus;
  defaultFallbackMode?: SafetyFallbackMode;
  publicReason: string;
}

const SAFETY_RAIL_DEFINITIONS = [
  {
    id: "EMPTY_ANSWER",
    category: "output",
    defaultStatus: "rewrite",
    defaultFallbackMode: "domain_safe",
    publicReason: "Yanıt boş veya kullanıcıya gösterilemeyecek kadar eksik.",
  },
  {
    id: "MISSING_SOURCES",
    category: "retrieval",
    defaultStatus: "rewrite",
    defaultFallbackMode: "low_grounding",
    publicReason: "RAG kullanıldı ama kaynak metadatası güvenli şekilde bağlanamadı.",
  },
  {
    id: "SUGGEST_MODE_NO_GROUNDED_SOURCES",
    category: "retrieval",
    defaultStatus: "warn",
    defaultFallbackMode: "source_suggestion",
    publicReason: "Seçili kaynak cevap üretmedi; daha uygun kaynak öneriliyor.",
  },
  {
    id: "NO_SOURCE_MODE_WITH_SOURCES",
    category: "retrieval",
    defaultStatus: "rewrite",
    defaultFallbackMode: "domain_safe",
    publicReason: "No-source kararıyla kaynak listesi arasında tutarsızlık var.",
  },
  {
    id: "TOO_MANY_CONTEXT_CHUNKS_FOR_3B",
    category: "retrieval",
    defaultStatus: "warn",
    publicReason: "3B model için fazla geniş context riski var.",
  },
  {
    id: "QUERY_SOURCE_MISMATCH",
    category: "retrieval",
    defaultStatus: "rewrite",
    defaultFallbackMode: "source_suggestion",
    publicReason: "Soru ile getirilen kaynak konusu yeterince örtüşmedi.",
  },
  {
    id: "NO_USABLE_FACTS",
    category: "evidence",
    defaultStatus: "rewrite",
    defaultFallbackMode: "low_grounding",
    publicReason: "Kaynaklardan kullanıcı sorusunu cevaplayan kullanılabilir kanıt çıkarılamadı.",
  },
  {
    id: "RISKY_CERTAINTY_OR_TREATMENT",
    category: "output",
    defaultStatus: "rewrite",
    defaultFallbackMode: "domain_safe",
    publicReason: "Yanıt kaynakların desteklemediği kesin veya riskli yönlendirme içeriyor.",
  },
  {
    id: "LOW_LANGUAGE_QUALITY",
    category: "output",
    defaultStatus: "rewrite",
    defaultFallbackMode: "domain_safe",
    publicReason: "Yanıt dili kullanıcıya gösterilemeyecek kadar bozuk.",
  },
  {
    id: "LOW_GROUNDING_OVERCONFIDENCE",
    category: "output",
    defaultStatus: "rewrite",
    defaultFallbackMode: "low_grounding",
    publicReason: "Düşük kaynak güvenine rağmen yanıt fazla kesin konuşuyor.",
  },
  {
    id: "SOURCE_METADATA_MISMATCH",
    category: "privacy",
    defaultStatus: "rewrite",
    defaultFallbackMode: "privacy_safe",
    publicReason: "Yanıtın referans verdiği kaynak metadatası mevcut kaynaklarla uyuşmuyor.",
  },
  {
    id: "PRIVATE_SOURCE_SCOPE_MISMATCH",
    category: "privacy",
    defaultStatus: "block",
    defaultFallbackMode: "privacy_safe",
    publicReason: "Yanıt erişilebilir kaynak kapsamı dışında private veri kullanmaya çalışıyor.",
  },
  {
    id: "RED_FLAG_WITHOUT_URGENT_GUIDANCE",
    category: "evidence",
    defaultStatus: "rewrite",
    defaultFallbackMode: "domain_safe",
    publicReason: "Risk sinyali var ama yanıt gerekli güvenli yönlendirmeyi içermiyor.",
  },
  {
    id: "ANSWER_TOO_THIN",
    category: "output",
    defaultStatus: "rewrite",
    defaultFallbackMode: "domain_safe",
    publicReason: "Kaynaklı yanıt yeterli açıklama içermiyor.",
  },
] as const satisfies readonly SafetyRailDefinition[];

export type SafetyRailId = typeof SAFETY_RAIL_DEFINITIONS[number]["id"];

const SAFETY_RAIL_REGISTRY = new Map<string, SafetyRailDefinition>(
  SAFETY_RAIL_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getSafetyRailDefinition(id: SafetyRailId): SafetyRailDefinition {
  const definition = SAFETY_RAIL_REGISTRY.get(id);
  if (!definition) {
    throw new Error(`Unknown safety rail: ${id}`);
  }
  return definition;
}

export function listSafetyRailDefinitions(): SafetyRailDefinition[] {
  return SAFETY_RAIL_DEFINITIONS.map((definition) => ({ ...definition }));
}
