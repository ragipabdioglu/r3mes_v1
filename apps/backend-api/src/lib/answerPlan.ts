import type { QueryContract } from "@r3mes/shared-types";

import type { AnswerDomain, AnswerIntent } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { detectAnswerTask, type AnswerTaskType } from "./answerTaskDetector.js";
import { requestedFieldMatchesFact } from "./fieldCoverageResolver.js";
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

function factMatchesField(fact: StructuredFact, field: RequestedField): boolean {
  return requestedFieldMatchesFact(field, fact);
}

function isTableStructuredFact(fact: StructuredFact): boolean {
  return fact.kind === "table_row" || fact.kind === "table_cell" || fact.kind === "numeric_value" || Boolean(fact.table);
}

function selectFactsForFields(facts: StructuredFact[], fields: RequestedField[]): StructuredFact[] {
  const selected: StructuredFact[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.outputHint === "table") {
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
  if (selected.length === 0 && fields.some((field) => field.outputHint === "table")) {
    const confidenceScore = { high: 3, medium: 2, low: 1 };
    const tableMatches = facts
      .filter((fact) => !seen.has(fact.id) && isTableStructuredFact(fact))
      .sort((left, right) => confidenceScore[right.confidence] - confidenceScore[left.confidence])
      .slice(0, 6);
    for (const match of tableMatches) {
      seen.add(match.id);
      selected.push(match);
    }
  }
  return selected;
}

function fieldIsCovered(field: RequestedField, selectedFacts: StructuredFact[]): boolean {
  if (selectedFacts.some((fact) => factMatchesField(fact, field))) return true;
  return field.outputHint === "table" && selectedFacts.some(isTableStructuredFact);
}

function coverageFor(
  fields: RequestedField[],
  selectedFacts: StructuredFact[],
  missingFieldIds: string[],
): AnswerPlanCoverage {
  if (fields.length === 0) return selectedFacts.length > 0 ? "partial" : "none";
  if (selectedFacts.length === 0) return "none";
  if (missingFieldIds.length === 0) return "complete";
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
    case "code_explanation":
      return "code_explanation";
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

function outputFormatFromTask(taskType: AnswerPlan["taskType"], format: AnswerPlanFormat): AnswerPlanFormat {
  if (format !== "freeform") return format;
  if (taskType === "list_items") return "bullets";
  return format;
}

export function buildAnswerPlan(spec: AnswerSpec, opts: BuildAnswerPlanOptions = {}): AnswerPlan {
  const taskDetection = detectAnswerTask(spec.userQuery);
  const detection = taskDetection.requestedFieldDetection;
  const requestedFields = opts.queryContract ? requestedFieldsFromContract(opts.queryContract) : detection.requestedFields;
  const outputConstraints = opts.queryContract?.outputConstraints ?? taskDetection.outputConstraints;
  const contractTaskType = opts.queryContract ? taskTypeFromContract(opts.queryContract) : null;
  const selectedFacts = selectFactsForFields(spec.structuredFacts ?? [], requestedFields);
  const missingFieldIds = requestedFields
    .filter((field) => !fieldIsCovered(field, selectedFacts))
    .map((field) => field.id);
  const taskType =
    contractTaskType ?? (requestedFields.length > 0 ? "field_extraction" :
      taskDetection.taskType === "unknown" ? "grounded_summary" :
        taskDetection.taskType);
  const contractOutputFormat = opts.queryContract?.outputFormat;
  const outputFormat = outputFormatFromTask(taskType, contractOutputFormat ?? outputConstraints.format);
  const coverage = coverageFor(requestedFields, selectedFacts, missingFieldIds);

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
