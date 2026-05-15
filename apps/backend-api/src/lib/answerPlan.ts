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

export function buildAnswerPlan(spec: AnswerSpec): AnswerPlan {
  const taskDetection = detectAnswerTask(spec.userQuery);
  const detection = taskDetection.requestedFieldDetection;
  const selectedFacts = selectFactsForFields(spec.structuredFacts ?? [], detection.requestedFields);
  const missingFieldIds = detection.requestedFields
    .filter((field) => !selectedFacts.some((fact) => factMatchesField(fact, field)))
    .map((field) => field.id);
  const taskType =
    detection.requestedFields.length > 0 ? "field_extraction" :
      taskDetection.taskType === "unknown" ? "grounded_summary" :
        taskDetection.taskType;
  const coverage = coverageFor(detection.requestedFields, selectedFacts);

  return {
    domain: spec.answerDomain,
    intent: spec.answerIntent,
    taskType,
    outputFormat: taskDetection.outputConstraints.format,
    requestedFields: detection.requestedFields,
    selectedFacts,
    constraints: taskDetection.outputConstraints,
    coverage,
    forbiddenAdditions: [
      ...taskDetection.forbiddenAdditions,
    ],
    requiresModelSynthesis: taskType !== "field_extraction" || coverage !== "complete",
    diagnostics: {
      requestedFieldCount: detection.requestedFields.length,
      selectedFactCount: selectedFacts.length,
      missingFieldIds,
    },
  };
}
