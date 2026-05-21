import type { QueryContract } from "@r3mes/shared-types";

import type { AnswerDomain, AnswerIntent } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { detectAnswerTask, type AnswerTaskType } from "./answerTaskDetector.js";
import { normalizeConceptText } from "./conceptNormalizer.js";
import type { RequestedField } from "./requestedFieldDetector.js";
import type { StructuredFact } from "./structuredFact.js";

export type AnswerPlanCoverage = "complete" | "partial" | "none";
export type AnswerPlanFormat = "bullets" | "short" | "table" | "freeform";

export interface AnswerPlan {
  domain: AnswerDomain;
  intent: AnswerIntent;
  taskType: AnswerTaskType | "grounded_summary";
  outputFormat: AnswerPlanFormat;
  requestedFields: RequestedField[];
  selectedFacts: StructuredFact[];
  constraints: {
    maxWords?: number;
    maxSentencesPerBullet?: number;
    forbidCaution: boolean;
    noRawTableDump: boolean;
    sourceGroundedOnly: boolean;
    format: AnswerPlanFormat;
  };
  coverage: AnswerPlanCoverage;
  forbiddenAdditions: string[];
  requiresModelSynthesis: boolean;
  diagnostics: {
    requestedFieldCount: number;
    selectedFactCount: number;
    missingFieldIds: string[];
  };
}

export interface BuildAnswerPlanOptions {
  queryContract?: QueryContract;
}

function normalize(value: string | undefined): string {
  return normalizeConceptText(value ?? "");
}

function factMatchesField(fact: StructuredFact, field: RequestedField): boolean {
  const factText = normalize([fact.field, fact.subject, fact.table?.rowLabel, fact.provenance.quote].filter(Boolean).join(" "));
  const aliases = [field.label, ...field.aliases].map(normalize).filter(Boolean);
  return aliases.some((alias) => factText.includes(alias));
}

function selectFactsForFields(facts: StructuredFact[], fields: RequestedField[]): StructuredFact[] {
  const selected: StructuredFact[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.id === "nakit_tutar_oran") {
      const matches = facts
        .filter((fact) => !seen.has(fact.id) && factMatchesField(fact, field))
        .sort((left, right) => {
          const confidenceScore = { high: 3, medium: 2, low: 1 };
          return (
            confidenceScore[right.confidence] - confidenceScore[left.confidence] ||
            (left.field ?? "").localeCompare(right.field ?? "", "tr-TR")
          );
        })
        .slice(0, 6);
      for (const match of matches) {
        seen.add(match.id);
        selected.push(match);
      }
      continue;
    }
    const match = facts
      .filter((fact) => !seen.has(fact.id) && factMatchesField(fact, field))
      .sort((left, right) => {
        const confidenceScore = { high: 3, medium: 2, low: 1 };
        return confidenceScore[right.confidence] - confidenceScore[left.confidence];
      })[0];
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    selected.push(match);
  }
  return selected;
}

function coverageFor(fields: RequestedField[], selectedFacts: StructuredFact[]): AnswerPlanCoverage {
  if (fields.length === 0) return selectedFacts.length > 0 ? "partial" : "none";
  if (selectedFacts.length === 0) return "none";
  if (selectedFacts.length >= fields.length) return "complete";
  return "partial";
}

function requestedFieldsFromContract(queryContract: QueryContract): RequestedField[] {
  return queryContract.requestedFields.map((field) => ({
    ...field,
    aliases: [],
    matchedAliases: [],
  }));
}

function taskTypeFromContract(queryContract: QueryContract): AnswerTaskType | "grounded_summary" | null {
  switch (queryContract.operation) {
    case "conversation":
      return "conversation";
    case "define":
      return "definition";
    case "list":
      return "list_items";
    case "compare":
      return "compare_concepts";
    case "summarize":
      return "summarize_opinions";
    case "procedure":
      return "procedure";
    case "extract_fields":
      return "field_extraction";
    case "explain_with_sources":
      return "source_grounded_explain";
    case "unknown":
      return "grounded_summary";
    case "answer":
      return null;
    default:
      return null;
  }
}

export function buildAnswerPlan(spec: AnswerSpec, opts: BuildAnswerPlanOptions = {}): AnswerPlan {
  const taskDetection = detectAnswerTask(spec.userQuery);
  const detection = taskDetection.requestedFieldDetection;
  const requestedFields = opts.queryContract ? requestedFieldsFromContract(opts.queryContract) : detection.requestedFields;
  const outputConstraints = opts.queryContract?.outputConstraints ?? taskDetection.outputConstraints;
  const outputFormat = opts.queryContract?.outputFormat ?? outputConstraints.format;
  const contractTaskType = opts.queryContract ? taskTypeFromContract(opts.queryContract) : null;
  const selectedFacts = selectFactsForFields(spec.structuredFacts ?? [], requestedFields);
  const missingFieldIds = requestedFields
    .filter((field) => !selectedFacts.some((fact) => factMatchesField(fact, field)))
    .map((field) => field.id);
  const taskType =
    contractTaskType ?? (requestedFields.length > 0 ? "field_extraction" :
      taskDetection.taskType === "unknown" ? "grounded_summary" :
        taskDetection.taskType);
  const coverage = coverageFor(requestedFields, selectedFacts);

  return {
    domain: spec.answerDomain,
    intent: spec.answerIntent,
    taskType,
    outputFormat,
    requestedFields,
    selectedFacts,
    constraints: outputConstraints,
    coverage,
    forbiddenAdditions: [
      ...(opts.queryContract?.forbiddenAdditions ?? taskDetection.forbiddenAdditions),
    ],
    requiresModelSynthesis: taskType !== "field_extraction" || coverage !== "complete",
    diagnostics: {
      requestedFieldCount: requestedFields.length,
      selectedFactCount: selectedFacts.length,
      missingFieldIds,
    },
  };
}
