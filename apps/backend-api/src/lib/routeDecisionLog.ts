import { createHash } from "node:crypto";

import type {
  KnowledgeMetadataRouteCandidate,
  KnowledgeRouteDecision,
} from "./knowledgeAccess.js";
import type { DomainRoutePlan } from "./queryRouter.js";

export interface RouteDecisionLogSourceSelection {
  selectionMode: "none" | "selected" | "public" | "selected_plus_public" | "auto_private";
  requestedCollectionIds: string[];
  accessibleCollectionIds: string[];
  searchedCollectionIds?: string[];
  usedCollectionIds: string[];
  groundedCollectionIds?: string[];
  unusedSelectedCollectionIds: string[];
  suggestedCollections: Array<{ id: string; name: string; reason: string }>;
  metadataRouteCandidates: KnowledgeMetadataRouteCandidate[];
  thinProfileCollectionIds?: string[];
  includePublic: boolean;
  hasSources: boolean;
  warning: string | null;
  routeDecision: KnowledgeRouteDecision;
}

export interface RouteDecisionLogEvent {
  event: "knowledge_route_decision";
  decisionConfigVersion?: string;
  queryHash: string;
  queryLength: number;
  route: {
    domain: DomainRoutePlan["domain"] | null;
    confidence: DomainRoutePlan["confidence"] | null;
    subtopics: string[];
    weakHints: {
      mustIncludeTerms: string[];
      retrievalHints: string[];
    };
  };
  decision: KnowledgeRouteDecision;
  sourceSelection: {
    selectionMode: RouteDecisionLogSourceSelection["selectionMode"];
    includePublic: boolean;
    requestedCollectionIds: string[];
    accessibleCollectionIds: string[];
    searchedCollectionIds?: string[];
    usedCollectionIds: string[];
    groundedCollectionIds?: string[];
    unusedSelectedCollectionIds: string[];
    suggestedCollectionIds: string[];
    metadataRouteCandidates: Array<{
      id: string;
      score: number;
      domain: string | null;
      sourceQuality: KnowledgeMetadataRouteCandidate["sourceQuality"];
      matchedTerms: string[];
      scoreBreakdown?: {
        scoringMode?: string;
        finalScore: number;
        signals: Record<string, number>;
        contributions: Record<string, number>;
        missingSignals: string[];
        adaptiveBonus?: number;
      };
    }>;
    thinProfileCollectionIds?: string[];
    hasSources: boolean;
    warning: string | null;
  };
  retrievalDiagnostics?: Record<string, unknown>;
  quality?: {
    sourceCount: number;
    directFactCount: number;
    riskFactCount: number;
    hasUsableGrounding: boolean;
  };
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query.trim(), "utf8").digest("hex").slice(0, 16);
}

function roundedScore(score: number): number {
  return Math.round(score * 100) / 100;
}

export function buildRouteDecisionLogEvent(opts: {
  query: string;
  routePlan: DomainRoutePlan | null;
  sourceSelection: RouteDecisionLogSourceSelection;
  retrievalDiagnostics?: Record<string, unknown>;
  quality?: RouteDecisionLogEvent["quality"];
  decisionConfigVersion?: string;
}): RouteDecisionLogEvent {
  return {
    event: "knowledge_route_decision",
    decisionConfigVersion: opts.decisionConfigVersion,
    queryHash: hashQuery(opts.query),
    queryLength: opts.query.trim().length,
    route: {
      domain: opts.routePlan?.domain ?? null,
      confidence: opts.routePlan?.confidence ?? null,
      subtopics: opts.routePlan?.subtopics ?? [],
      weakHints: {
        mustIncludeTerms: opts.routePlan?.mustIncludeTerms ?? [],
        retrievalHints: opts.routePlan?.retrievalHints ?? [],
      },
    },
    decision: opts.sourceSelection.routeDecision,
    sourceSelection: {
      selectionMode: opts.sourceSelection.selectionMode,
      includePublic: opts.sourceSelection.includePublic,
      requestedCollectionIds: opts.sourceSelection.requestedCollectionIds,
      accessibleCollectionIds: opts.sourceSelection.accessibleCollectionIds,
      searchedCollectionIds: opts.sourceSelection.searchedCollectionIds,
      usedCollectionIds: opts.sourceSelection.usedCollectionIds,
      groundedCollectionIds: opts.sourceSelection.groundedCollectionIds,
      unusedSelectedCollectionIds: opts.sourceSelection.unusedSelectedCollectionIds,
      suggestedCollectionIds: opts.sourceSelection.suggestedCollections.map((collection) => collection.id),
      metadataRouteCandidates: opts.sourceSelection.metadataRouteCandidates.map((candidate) => ({
        id: candidate.id,
        score: roundedScore(candidate.score),
        domain: candidate.domain,
        sourceQuality: candidate.sourceQuality,
        matchedTerms: candidate.matchedTerms,
        ...(candidate.scoreBreakdown
          ? {
              scoreBreakdown: {
                scoringMode: candidate.scoreBreakdown.scoringMode,
                finalScore: roundedScore(candidate.scoreBreakdown.finalScore),
                signals: Object.fromEntries(
                  Object.entries(candidate.scoreBreakdown.signals).map(([key, value]) => [key, roundedScore(value)]),
                ),
                contributions: Object.fromEntries(
                  Object.entries(candidate.scoreBreakdown.contributions).map(([key, value]) => [
                    key,
                    roundedScore(value),
                  ]),
                ),
                missingSignals: candidate.scoreBreakdown.missingSignals,
                ...(typeof candidate.scoreBreakdown.adaptiveBonus === "number"
                  ? { adaptiveBonus: roundedScore(candidate.scoreBreakdown.adaptiveBonus) }
                  : {}),
              },
            }
          : {}),
      })),
      thinProfileCollectionIds: opts.sourceSelection.thinProfileCollectionIds,
      hasSources: opts.sourceSelection.hasSources,
      warning: opts.sourceSelection.warning,
    },
    retrievalDiagnostics: opts.retrievalDiagnostics,
    quality: opts.quality,
  };
}
