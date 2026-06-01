import type {
  ChatSourceCitation,
  SourceDisplayModel,
  SuggestionDisplayModel,
  UserFacingStatus,
} from "@r3mes/shared-types";

export interface PublicSuggestionInput {
  id?: string;
  collectionId?: string;
  name?: string;
  title?: string;
  reason?: string | null;
}

export interface UserFacingStatusInput {
  sourceCount: number;
  suggestionCount?: number;
  noSource?: boolean;
  safetyLimited?: boolean;
  error?: boolean;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeUserFacingReason(value: string | null | undefined): string {
  const cleaned = compactWhitespace(value ?? "");
  if (!cleaned) return "Bu kaynak, soruyla ilişkili göründüğü için öneriliyor.";
  return compactWhitespace(
    cleaned
      .replace(/\((?:[^)]*\b(?:score|skor)\s*[:=]?\s*\d+(?:[.,]\d+)?[^)]*)\)/giu, "")
      .replace(/\b(?:score|skor)\s*[:=]?\s*\d+(?:[.,]\d+)?/giu, "")
      .replace(/\s+([,.;:])/g, "$1"),
  ) || "Bu kaynak, soruyla ilişkili göründüğü için öneriliyor.";
}

export function buildSourceDisplayModels(sources: ChatSourceCitation[]): SourceDisplayModel[] {
  return sources.map((source) => ({
    collectionId: source.collectionId,
    documentId: source.documentId,
    title: source.title,
    chunkIndex: source.chunkIndex,
    excerpt: source.excerpt ?? null,
    whyThisSource: source.excerpt
      ? "Cevapta kullanılan kanıt bu kaynaktan geldi."
      : "Bu kaynak cevap için kullanılan kanıtlar arasında yer aldı.",
  }));
}

export function buildSuggestionDisplayModels(
  suggestions: PublicSuggestionInput[] | null | undefined,
): SuggestionDisplayModel[] {
  const seen = new Set<string>();
  const result: SuggestionDisplayModel[] = [];
  for (const suggestion of suggestions ?? []) {
    const collectionId = (suggestion.collectionId ?? suggestion.id ?? "").trim();
    if (!collectionId || seen.has(collectionId)) continue;
    seen.add(collectionId);
    result.push({
      collectionId,
      title: compactWhitespace(suggestion.title ?? suggestion.name ?? collectionId),
      reason: sanitizeUserFacingReason(suggestion.reason),
      action: "select_collection",
    });
  }
  return result;
}

export function buildUserFacingStatus(input: UserFacingStatusInput): UserFacingStatus {
  if (input.error) {
    return {
      kind: "error",
      sourceBacked: false,
      message: "İstek işlenirken bir sorun oluştu.",
    };
  }
  if (input.safetyLimited) {
    return {
      kind: "safety_limited",
      sourceBacked: input.sourceCount > 0,
      message: "Cevap güvenlik ve kaynak uygunluğu nedeniyle sınırlandı.",
    };
  }
  if (input.noSource) {
    return {
      kind: input.suggestionCount && input.suggestionCount > 0 ? "suggestions" : "no_source",
      sourceBacked: false,
      message: input.suggestionCount && input.suggestionCount > 0
        ? "Bu soru için daha uygun kaynak önerileri var."
        : "Bu soru için yeterli kaynak bulunamadı.",
    };
  }
  return {
    kind: "answered",
    sourceBacked: input.sourceCount > 0,
    message: input.sourceCount > 0
      ? "Yanıt knowledge kaynaklarıyla desteklendi."
      : "Yanıt kaynak kullanmadan üretildi.",
  };
}
