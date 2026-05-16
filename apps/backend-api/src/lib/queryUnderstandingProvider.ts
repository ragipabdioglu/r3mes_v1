import type { DomainLexiconPackSummary } from "./domainLexiconPack.js";
import type { QueryUnderstanding } from "./queryUnderstanding.js";

export interface QueryUnderstandingSourceProfile {
  collectionId?: string;
  documentId?: string;
  profileLevel?: "collection" | "document" | "section" | "table" | "chunk";
  answerableConcepts?: string[];
  topicPhrases?: string[];
  entities?: string[];
  sampleQueries?: string[];
  tableConcepts?: string[];
}

export interface QueryUnderstandingTenantProfile {
  tenantId?: string;
  locale?: string;
  domains?: string[];
  preferredDomainPackIds?: string[];
}

export interface QueryUnderstandingProviderInput {
  query: string;
  sourceProfiles?: QueryUnderstandingSourceProfile[];
  tenantProfile?: QueryUnderstandingTenantProfile;
  domainPacks?: DomainLexiconPackSummary[];
}

export interface QueryUnderstandingProviderTrace {
  providerId: string;
  matchedDomainPackIds: string[];
  warnings: string[];
}

export interface QueryUnderstandingProviderResult {
  understanding: QueryUnderstanding;
  trace: QueryUnderstandingProviderTrace;
}

export interface QueryUnderstandingProvider {
  id: string;
  analyze(input: QueryUnderstandingProviderInput): Promise<QueryUnderstandingProviderResult>;
}

export type QueryUnderstandingProviderCapability =
  | "turkish_normalization"
  | "concept_rules"
  | "route_rules"
  | "requested_field_aliases"
  | "source_profile_expansion";

export interface QueryUnderstandingProviderDescriptor {
  id: string;
  label: string;
  locale: string;
  implementation: "heuristic" | "adapter" | "model";
  status: "boundary_only" | "available" | "disabled";
  defaultDomainPackIds: string[];
  capabilities: QueryUnderstandingProviderCapability[];
  notes: string[];
}

export const HEURISTIC_TR_V1_QUERY_UNDERSTANDING_PROVIDER_ID = "heuristic-tr-v1";

export const HEURISTIC_TR_V1_QUERY_UNDERSTANDING_PROVIDER_DESCRIPTOR: QueryUnderstandingProviderDescriptor = {
  id: HEURISTIC_TR_V1_QUERY_UNDERSTANDING_PROVIDER_ID,
  label: "Current deterministic Turkish query understanding",
  locale: "tr",
  implementation: "heuristic",
  status: "boundary_only",
  defaultDomainPackIds: [],
  capabilities: [
    "turkish_normalization",
    "concept_rules",
    "route_rules",
    "requested_field_aliases",
    "source_profile_expansion",
  ],
  notes: [
    "Descriptor for the existing buildQueryUnderstanding behavior.",
    "This boundary intentionally does not call the current implementation yet.",
  ],
};

export function getHeuristicQueryUnderstandingProviderDescriptor(): QueryUnderstandingProviderDescriptor {
  return HEURISTIC_TR_V1_QUERY_UNDERSTANDING_PROVIDER_DESCRIPTOR;
}

export function summarizeQueryUnderstandingProviderDescriptor(
  descriptor: QueryUnderstandingProviderDescriptor,
): Record<string, unknown> {
  return {
    id: descriptor.id,
    locale: descriptor.locale,
    implementation: descriptor.implementation,
    status: descriptor.status,
    defaultDomainPackIds: descriptor.defaultDomainPackIds,
    capabilities: descriptor.capabilities,
  };
}
