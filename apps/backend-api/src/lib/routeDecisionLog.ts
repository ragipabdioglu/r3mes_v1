import { createHash } from "node:crypto";

import type {
  KnowledgeMetadataRouteCandidate,
  KnowledgeRouteDecision,
} from "./knowledgeAccess.js";
import type { DomainRoutePlan } from "./queryRouter.js";

export interface RouteDecisionLogSourceSelection {
  selectionMode: "none" | "selected" | "public" | "selected_plus_public";
  requestedCollectionIds: string[];
  accessibleCollectionIds: string[];
  usedCollectionIds: string[];
  unusedSelectedCollectionIds: string[];
  suggestedCollections: Array<{ id: string; name: string; reason: string }>;
  metadataRouteCandidates: KnowledgeMetadataRouteCandidate[];
  includePublic: boolean;
  hasSources: boolean;
  warning: string | null;
  routeDecision: KnowledgeRouteDecision;
}

export interface RouteDecisionLogEvent {
  event: "knowledge_route_decision";
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
    usedCollectionIds: string[];
    unusedSelectedCollectionIds: string[];
    suggestedCollectionIds: string[];
    metadataRouteCandidates: Array<{
      id: string;
      score: number;
      domain: string | null;
      sourceQuality: KnowledgeMetadataRouteCandidate["sourceQuality"];
      matchedTerms: string[];
    }>;
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
}): RouteDecisionLogEvent {
  return {
    event: "knowledge_route_decision",
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
      usedCollectionIds: opts.sourceSelection.usedCollectionIds,
      unusedSelectedCollectionIds: opts.sourceSelection.unusedSelectedCollectionIds,
      suggestedCollectionIds: opts.sourceSelection.suggestedCollections.map((collection) => collection.id),
      metadataRouteCandidates: opts.sourceSelection.metadataRouteCandidates.map((candidate) => ({
        id: candidate.id,
        score: roundedScore(candidate.score),
        domain: candidate.domain,
        sourceQuality: candidate.sourceQuality,
        matchedTerms: candidate.matchedTerms,
      })),
      hasSources: opts.sourceSelection.hasSources,
      warning: opts.sourceSelection.warning,
    },
    retrievalDiagnostics: opts.retrievalDiagnostics,
    quality: opts.quality,
  };
}
