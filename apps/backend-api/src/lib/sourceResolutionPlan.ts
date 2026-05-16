import type { KnowledgeCollectionAccessItem } from "./knowledgeAccess.js";
import type { QueryUnderstanding } from "./queryUnderstanding.js";

export type SourceResolutionMode =
  | "explicit"
  | "auto_single_private"
  | "auto_private_ranked"
  | "include_public"
  | "needs_user_scope"
  | "source_discovery"
  | "none";

export type SourceResolutionMatchedProfileLevel =
  | "collection"
  | "document"
  | "section"
  | "chunk"
  | "none";

export interface SourceResolutionCandidate {
  collectionId: string;
  score: number;
  reasons: string[];
  matchedProfileLevel: SourceResolutionMatchedProfileLevel;
}

export interface SourceResolutionRejectedCollection {
  collectionId: string;
  reason: string;
  score?: number;
}

export interface SourceResolutionPlan {
  mode: SourceResolutionMode;
  selectedCollectionIds: string[];
  candidates: SourceResolutionCandidate[];
  rejected: SourceResolutionRejectedCollection[];
  confidence: number;
  warnings: string[];
  suggestions?: SourceResolutionSuggestion[];
}

export interface SourceResolutionSuggestion {
  collectionId: string;
  reason: string;
  score?: number;
}

export interface SourceResolutionRankedCandidate {
  collectionId: string;
  score: number;
  reasons?: string[];
  matchedProfileLevel?: SourceResolutionMatchedProfileLevel;
}

export interface BuildSourceResolutionPlanInput {
  accessibleCollections: KnowledgeCollectionAccessItem[];
  requestedCollectionIds?: string[];
  includePublic?: boolean;
  retrievalQuery?: string;
  queryUnderstanding?: QueryUnderstanding | null;
  rankedCandidates?: SourceResolutionRankedCandidate[];
  suggestions?: SourceResolutionSuggestion[];
  enforceLowConfidenceGuard?: boolean;
  maxAutoSelectedCollections?: number;
  sourceDiscoveryIntent?: boolean;
}

export interface SourceResolutionPlanSummary {
  mode: SourceResolutionMode;
  selectedCollectionIds: string[];
  candidateCount: number;
  rejectedCount: number;
  confidence: number;
  warnings: string[];
  suggestions: SourceResolutionSuggestion[];
  topCandidates: SourceResolutionCandidate[];
}

const HIGH_CONFIDENCE = 0.72;
const LOW_CONFIDENCE = 0.5;

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(opts: {
  retrievalQuery?: string;
  queryUnderstanding?: QueryUnderstanding | null;
}): string[] {
  return unique([
    opts.retrievalQuery ?? "",
    opts.queryUnderstanding?.normalized.normalized ?? "",
    ...(opts.queryUnderstanding?.normalized.tokens ?? []),
    ...(opts.queryUnderstanding?.normalized.expandedTokens ?? []),
    ...(opts.queryUnderstanding?.concepts ?? []),
    ...(opts.queryUnderstanding?.profileConcepts ?? []),
  ]
    .flatMap((part) => normalizeText(part).split(" "))
    .filter((token) => token.length >= 3))
    .slice(0, 96);
}

function stringifyMetadata(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyMetadata).join(" ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.entries(record)
      .flatMap(([key, item]) => [key, stringifyMetadata(item)])
      .join(" ");
  }
  return "";
}

function collectionSearchText(collection: KnowledgeCollectionAccessItem): string {
  return normalizeText([
    collection.name,
    stringifyMetadata(collection.autoMetadata),
    ...(collection.documents ?? []).slice(0, 5).flatMap((document) => [
      document.title,
      stringifyMetadata(document.autoMetadata),
      document.chunks[0]?.content ?? "",
    ]),
  ].join(" "));
}

function scoreAccessibleCollection(
  collection: KnowledgeCollectionAccessItem,
  tokens: string[],
): SourceResolutionCandidate {
  if (tokens.length === 0) {
    return {
      collectionId: collection.id,
      score: collection.visibility === "PRIVATE" ? 0.16 : 0.08,
      reasons: ["no_query_terms"],
      matchedProfileLevel: "none",
    };
  }

  const text = collectionSearchText(collection);
  const matched = tokens.filter((token) => text.includes(token));
  const name = normalizeText(collection.name);
  const nameMatches = tokens.filter((token) => name.includes(token));
  const score = clampConfidence(
    0.14 +
      Math.min(0.48, matched.length / Math.max(4, tokens.length)) +
      Math.min(0.22, nameMatches.length * 0.11) +
      (collection.visibility === "PRIVATE" ? 0.04 : 0),
  );
  return {
    collectionId: collection.id,
    score,
    reasons: matched.length > 0
      ? [`matched_terms:${matched.slice(0, 6).join(",")}`]
      : ["no_profile_match"],
    matchedProfileLevel: matched.length > 0 ? "collection" : "none",
  };
}

function normalizeRankedCandidate(
  candidate: SourceResolutionRankedCandidate,
): SourceResolutionCandidate {
  const score = candidate.score > 1 ? candidate.score / 100 : candidate.score;
  return {
    collectionId: candidate.collectionId,
    score: clampConfidence(score),
    reasons: candidate.reasons?.length ? candidate.reasons : ["ranked_candidate"],
    matchedProfileLevel: candidate.matchedProfileLevel ?? "collection",
  };
}

function sortCandidates(candidates: SourceResolutionCandidate[]): SourceResolutionCandidate[] {
  return [...candidates].sort((left, right) =>
    right.score - left.score || left.collectionId.localeCompare(right.collectionId, "tr-TR"));
}

function queryConfidence(queryUnderstanding: QueryUnderstanding | null | undefined): number {
  if (!queryUnderstanding) return 0.45;
  if (queryUnderstanding.retrievalIntent === "conversation") return 0.1;
  if (queryUnderstanding.retrievalIntent === "source_selection") return 0.35;
  if (queryUnderstanding.confidence === "high") return 0.82;
  if (queryUnderstanding.confidence === "medium") return 0.58;
  return 0.28;
}

function planConfidence(opts: {
  queryUnderstanding?: QueryUnderstanding | null;
  candidates: SourceResolutionCandidate[];
}): number {
  const best = opts.candidates[0]?.score ?? 0;
  return clampConfidence((queryConfidence(opts.queryUnderstanding) * 0.45) + (best * 0.55));
}

function rankedAccessibleCandidates(opts: BuildSourceResolutionPlanInput): SourceResolutionCandidate[] {
  const accessibleIds = new Set(opts.accessibleCollections.map((collection) => collection.id));
  const provided = opts.rankedCandidates
    ?.filter((candidate) => accessibleIds.has(candidate.collectionId))
    .map(normalizeRankedCandidate);
  if (provided?.length) return sortCandidates(provided);
  const tokens = queryTokens({
    retrievalQuery: opts.retrievalQuery,
    queryUnderstanding: opts.queryUnderstanding,
  });
  return sortCandidates(opts.accessibleCollections.map((collection) => scoreAccessibleCollection(collection, tokens)));
}

function rejectedMissingRequestedIds(
  requestedCollectionIds: string[],
  accessibleIds: Set<string>,
): SourceResolutionRejectedCollection[] {
  return requestedCollectionIds
    .filter((id) => !accessibleIds.has(id))
    .map((collectionId) => ({
      collectionId,
      reason: "requested_collection_not_accessible",
    }));
}

function rejectedUnselectedCandidates(
  candidates: SourceResolutionCandidate[],
  selectedCollectionIds: string[],
  reason: string,
): SourceResolutionRejectedCollection[] {
  const selected = new Set(selectedCollectionIds);
  return candidates
    .filter((candidate) => !selected.has(candidate.collectionId))
    .map((candidate) => ({
      collectionId: candidate.collectionId,
      reason,
      score: candidate.score,
    }));
}

export function buildSourceResolutionPlan(input: BuildSourceResolutionPlanInput): SourceResolutionPlan {
  const requestedCollectionIds = unique(input.requestedCollectionIds ?? []);
  const includePublic = input.includePublic === true;
  const accessibleIds = new Set(input.accessibleCollections.map((collection) => collection.id));
  const warnings: string[] = [];
  const missingRequested = rejectedMissingRequestedIds(requestedCollectionIds, accessibleIds);
  const hasRetrievalQuery = Boolean(input.retrievalQuery?.trim() || input.queryUnderstanding?.original.trim());

  if (!hasRetrievalQuery || input.queryUnderstanding?.retrievalIntent === "conversation") {
    return {
      mode: "none",
      selectedCollectionIds: [],
      candidates: [],
      rejected: missingRequested,
      confidence: 0,
      warnings: ["no_knowledge_retrieval_query"],
      suggestions: input.suggestions ?? [],
    };
  }

  if (input.sourceDiscoveryIntent === true || input.queryUnderstanding?.retrievalIntent === "source_selection") {
    const candidates = rankedAccessibleCandidates(input);
    return {
      mode: "source_discovery",
      selectedCollectionIds: [],
      candidates,
      rejected: missingRequested,
      confidence: planConfidence({ queryUnderstanding: input.queryUnderstanding, candidates }),
      warnings: ["source_discovery_intent"],
      suggestions: input.suggestions ?? candidates.slice(0, 5).map((candidate) => ({
        collectionId: candidate.collectionId,
        reason: candidate.reasons[0] ?? "source_candidate",
        score: candidate.score,
      })),
    };
  }

  if (requestedCollectionIds.length > 0) {
    const selectedCollectionIds = requestedCollectionIds.filter((id) => accessibleIds.has(id));
    const candidates = selectedCollectionIds.map((collectionId) => ({
      collectionId,
      score: 1,
      reasons: ["explicit_request"],
      matchedProfileLevel: "collection" as const,
    }));
    if (missingRequested.length > 0) warnings.push("some_requested_collections_not_accessible");
    return {
      mode: "explicit",
      selectedCollectionIds,
      candidates,
      rejected: missingRequested,
      confidence: selectedCollectionIds.length > 0 ? 1 : 0,
      warnings,
      suggestions: input.suggestions ?? [],
    };
  }

  if (includePublic) {
    const candidates = rankedAccessibleCandidates(input);
    const selectedCollectionIds = input.accessibleCollections.map((collection) => collection.id);
    return {
      mode: "include_public",
      selectedCollectionIds,
      candidates,
      rejected: rejectedUnselectedCandidates(candidates, selectedCollectionIds, "not_selected"),
      confidence: planConfidence({ queryUnderstanding: input.queryUnderstanding, candidates }),
      warnings: candidates.length === 0 ? ["include_public_without_accessible_sources"] : [],
      suggestions: input.suggestions ?? [],
    };
  }

  const privateCollections = input.accessibleCollections.filter((collection) => collection.visibility === "PRIVATE");
  if (privateCollections.length === 0) {
    return {
      mode: "needs_user_scope",
      selectedCollectionIds: [],
      candidates: [],
      rejected: [],
      confidence: 0,
      warnings: ["no_private_collections_available"],
      suggestions: input.suggestions ?? [],
    };
  }

  if (privateCollections.length === 1) {
    const collection = privateCollections[0];
    return {
      mode: "auto_single_private",
      selectedCollectionIds: [collection.id],
      candidates: [{
        collectionId: collection.id,
        score: 1,
        reasons: ["only_private_collection"],
        matchedProfileLevel: "collection",
      }],
      rejected: [],
      confidence: 1,
      warnings,
      suggestions: input.suggestions ?? [],
    };
  }

  const privateIds = new Set(privateCollections.map((collection) => collection.id));
  const candidates = rankedAccessibleCandidates({
    ...input,
    accessibleCollections: privateCollections,
  }).filter((candidate) => privateIds.has(candidate.collectionId));
  const confidence = planConfidence({ queryUnderstanding: input.queryUnderstanding, candidates });
  const topScore = candidates[0]?.score ?? 0;
  const secondScore = candidates[1]?.score ?? 0;
  const ambiguousTop = topScore - secondScore < 0.08;
  const lowConfidence = confidence < LOW_CONFIDENCE || topScore < LOW_CONFIDENCE || input.queryUnderstanding?.confidence === "low";

  if (lowConfidence && input.enforceLowConfidenceGuard === true) {
    return {
      mode: "needs_user_scope",
      selectedCollectionIds: [],
      candidates,
      rejected: rejectedUnselectedCandidates(candidates, [], "low_confidence_source_resolution"),
      confidence,
      warnings: ["low_confidence_source_resolution", "user_scope_required"],
      suggestions: input.suggestions ?? candidates.slice(0, 5).map((candidate) => ({
        collectionId: candidate.collectionId,
        reason: candidate.reasons[0] ?? "source_candidate",
        score: candidate.score,
      })),
    };
  }

  const maxAutoSelectedCollections = Math.max(1, input.maxAutoSelectedCollections ?? 3);
  const selectedCollectionIds =
    lowConfidence
      ? privateCollections.map((collection) => collection.id)
      : candidates
          .filter((candidate) => (
            candidate.score >= HIGH_CONFIDENCE ||
            candidate.score >= topScore - (ambiguousTop ? 0.03 : 0.12)
          ))
          .slice(0, maxAutoSelectedCollections)
          .map((candidate) => candidate.collectionId);
  if (lowConfidence) warnings.push("low_confidence_guard_not_enforced_legacy_selection");
  if (!lowConfidence && selectedCollectionIds.length === 0 && candidates[0]) {
    selectedCollectionIds.push(candidates[0].collectionId);
  }

  return {
    mode: "auto_private_ranked",
    selectedCollectionIds,
    candidates,
    rejected: rejectedUnselectedCandidates(candidates, selectedCollectionIds, "lower_ranked_source"),
    confidence,
    warnings,
    suggestions: input.suggestions ?? [],
  };
}

export function summarizeSourceResolutionPlan(plan: SourceResolutionPlan): SourceResolutionPlanSummary {
  return {
    mode: plan.mode,
    selectedCollectionIds: plan.selectedCollectionIds,
    candidateCount: plan.candidates.length,
    rejectedCount: plan.rejected.length,
    confidence: plan.confidence,
    warnings: plan.warnings,
    suggestions: plan.suggestions ?? [],
    topCandidates: plan.candidates.slice(0, 5),
  };
}
