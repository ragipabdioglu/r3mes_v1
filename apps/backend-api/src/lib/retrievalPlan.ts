import type { QueryContract } from "@r3mes/shared-types";

import type { ChatRequestContext } from "./chatRequestContext.js";
import type { RetrievalRuntimeHealth } from "./retrievalRuntimeHealth.js";

export type SourceResolutionMode =
  | "explicit"
  | "auto_single_private"
  | "auto_private_ranked"
  | "include_public"
  | "needs_user_scope"
  | "source_discovery"
  | "none";

export interface SourceResolutionPlanCandidate {
  collectionId: string;
  score: number;
  reasons: string[];
  matchedProfileLevel?: "collection" | "document" | "section" | "chunk" | "none" | string;
}

export interface SourceResolutionPlanRejected {
  collectionId: string;
  reason: string;
  score?: number;
}

export interface SourceResolutionPlanLike {
  mode: SourceResolutionMode | string;
  selectedCollectionIds: string[];
  candidates?: SourceResolutionPlanCandidate[];
  rejected?: SourceResolutionPlanRejected[];
  confidence?: number;
  warnings?: string[];
  [key: string]: unknown;
}

export type ExpectedEvidenceKind = "paragraph" | "table" | "numeric" | "procedure" | "definition" | "code" | "visual_layout";

export interface RetrievalPlanEvidenceDemandBasis {
  operation: QueryContract["operation"];
  requiredEvidenceType: QueryContract["requiredEvidenceType"];
  derivationMode: "query_contract";
}

export interface RetrievalPlan {
  query: string;
  normalizedQuery: string;
  sourcePlan: SourceResolutionPlanLike;
  runtime: RetrievalRuntimeHealth;
  expectedEvidenceKinds: ExpectedEvidenceKind[];
  requestedFields: string[];
  outputConstraints: string[];
  evidenceDemandBasis?: RetrievalPlanEvidenceDemandBasis;
  requestContext?: ChatRequestContext;
  warnings: string[];
}

export interface BuildRetrievalPlanInput {
  query: string;
  normalizedQuery?: string;
  sourcePlan: SourceResolutionPlanLike;
  runtime: RetrievalRuntimeHealth;
  expectedEvidenceKinds?: ExpectedEvidenceKind[];
  requestedFields?: string[];
  outputConstraints?: string[];
  evidenceDemandBasis?: RetrievalPlanEvidenceDemandBasis;
  requestContext?: ChatRequestContext;
  warnings?: string[];
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))];
}

function inferEvidenceKinds(input: BuildRetrievalPlanInput): ExpectedEvidenceKind[] {
  if (input.expectedEvidenceKinds && input.expectedEvidenceKinds.length > 0) {
    return [...new Set(input.expectedEvidenceKinds)];
  }
  const joined = [
    input.query,
    input.normalizedQuery,
    ...(input.requestedFields ?? []),
    ...(input.outputConstraints ?? []),
  ].join(" ").toLocaleLowerCase("tr-TR");
  const kinds: ExpectedEvidenceKind[] = ["paragraph"];
  if (/\btablo|table|satır|sütun|sutun\b/u.test(joined)) kinds.push("table");
  if (/\b\d+|oran|yüzde|yuzde|tutar|adet|miktar|numeric|sayısal|sayisal\b/u.test(joined)) kinds.push("numeric");
  if (/\bprosedür|prosedur|süreç|surec|adım|adim|procedure\b/u.test(joined)) kinds.push("procedure");
  if (/\bkod|code|metot|method|fonksiyon|function|event|olay|handler|click\b/u.test(joined)) kinds.push("code");
  if (/\b(?:arayuz|arayüz|ekran|form|panel|layout|tasarim|tasarım|gorsel|görsel|kontrol|kontroller)\b/u.test(joined)) kinds.push("visual_layout");
  if (/\bnedir|tanım|tanim|definition|ne demek\b/u.test(joined)) kinds.push("definition");
  return [...new Set(kinds)];
}

export function buildRetrievalPlanInputsFromQueryContract(
  queryContract: QueryContract | null | undefined,
): Pick<BuildRetrievalPlanInput, "expectedEvidenceKinds" | "requestedFields" | "outputConstraints" | "evidenceDemandBasis"> {
  if (!queryContract) return {};

  const expectedEvidenceKinds: ExpectedEvidenceKind[] = ["paragraph"];
  if (queryContract.operation === "procedure") expectedEvidenceKinds.push("procedure");
  if (queryContract.operation === "code_explanation") expectedEvidenceKinds.push("code");
  if (queryContract.operation === "visual_layout" || queryContract.requiredEvidenceType === "visual_layout") {
    expectedEvidenceKinds.push("visual_layout");
  }
  if (queryContract.operation === "define") expectedEvidenceKinds.push("definition");
  if (
    queryContract.outputFormat === "table" ||
    queryContract.requestedFields.some((field) => field.outputHint === "table")
  ) {
    expectedEvidenceKinds.push("table");
  }
  if (queryContract.requestedFields.some((field) => field.outputHint === "number")) {
    expectedEvidenceKinds.push("numeric");
  }

  const outputConstraints = [
    `format:${queryContract.outputConstraints.format}`,
    ...(typeof queryContract.outputConstraints.maxWords === "number"
      ? [`max_words:${queryContract.outputConstraints.maxWords}`]
      : []),
    ...(typeof queryContract.outputConstraints.maxSentencesPerBullet === "number"
      ? [`max_sentences_per_bullet:${queryContract.outputConstraints.maxSentencesPerBullet}`]
      : []),
    ...(queryContract.outputConstraints.forbidCaution ? ["forbid_caution"] : []),
    ...(queryContract.outputConstraints.noRawTableDump ? ["no_raw_table_dump"] : []),
    ...(queryContract.outputConstraints.sourceGroundedOnly ? ["source_grounded_only"] : []),
  ];

  return {
    expectedEvidenceKinds: [...new Set(expectedEvidenceKinds)],
    requestedFields: queryContract.requestedFields.map((field) => field.id),
    outputConstraints,
    evidenceDemandBasis: {
      operation: queryContract.operation,
      requiredEvidenceType: queryContract.requiredEvidenceType,
      derivationMode: "query_contract",
    },
  };
}

export function buildRetrievalPlan(input: BuildRetrievalPlanInput): RetrievalPlan {
  const warnings = uniqueStrings([
    ...(input.warnings ?? []),
    ...(input.sourcePlan.warnings ?? []),
    ...input.runtime.warnings,
  ]);
  return {
    query: input.query.trim(),
    normalizedQuery: (input.normalizedQuery ?? input.query).trim(),
    sourcePlan: {
      ...input.sourcePlan,
      selectedCollectionIds: uniqueStrings(input.sourcePlan.selectedCollectionIds),
      candidates: input.sourcePlan.candidates ?? [],
      rejected: input.sourcePlan.rejected ?? [],
      warnings: input.sourcePlan.warnings ?? [],
    },
    runtime: input.runtime,
    expectedEvidenceKinds: inferEvidenceKinds(input),
    requestedFields: uniqueStrings(input.requestedFields),
    outputConstraints: uniqueStrings(input.outputConstraints),
    evidenceDemandBasis: input.evidenceDemandBasis,
    requestContext: input.requestContext,
    warnings,
  };
}

export function summarizeRetrievalPlan(plan: RetrievalPlan): Record<string, unknown> {
  return {
    hasQuery: plan.query.length > 0,
    normalizedQuery: plan.normalizedQuery,
    sourceMode: plan.sourcePlan.mode,
    selectedCollectionCount: plan.sourcePlan.selectedCollectionIds.length,
    candidateCount: plan.sourcePlan.candidates?.length ?? 0,
    rejectedCount: plan.sourcePlan.rejected?.length ?? 0,
    sourceConfidence: plan.sourcePlan.confidence,
    retrievalEngineActual: plan.runtime.retrievalEngineActual,
    embeddingProviderActual: plan.runtime.embeddingProviderActual,
    embeddingFallbackUsed: plan.runtime.embeddingFallbackUsed,
    rerankerModeActual: plan.runtime.rerankerModeActual,
    rerankerFallbackUsed: plan.runtime.rerankerFallbackUsed,
    expectedEvidenceKinds: plan.expectedEvidenceKinds,
    requestedFieldCount: plan.requestedFields.length,
    outputConstraintCount: plan.outputConstraints.length,
    evidenceDemandBasis: plan.evidenceDemandBasis,
    requestSourceMode: plan.requestContext?.sourceMode,
    warnings: plan.warnings,
  };
}
