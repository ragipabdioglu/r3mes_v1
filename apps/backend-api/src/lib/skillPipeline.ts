import { routeQuery, type DomainRoutePlan } from "./queryRouter.js";
import type { AnswerIntent } from "./answerSchema.js";
import { detectAnswerTask } from "./answerTaskDetector.js";
import { getDecisionConfig } from "./decisionConfig.js";
import type { EvidenceBundle, EvidenceItem } from "./evidenceBundle.js";
import { buildEvidenceBundleFromItems, hasUsableEvidenceItem } from "./evidenceBundle.js";
import { extractEvidenceV2 } from "./evidence/evidenceExtractorOrchestrator.js";
import type { StructuredFact } from "./structuredFact.js";

export type SkillName =
  | "query-planner"
  | "evidence-extractor";

export type SkillRuntime = "deterministic" | "lora";

export interface SkillRunEnvelope<TInput, TOutput> {
  skill: SkillName;
  runtime: SkillRuntime;
  input: TInput;
  output: TOutput;
}

export interface QueryPlannerInput {
  userQuery: string;
  language?: "tr" | "en" | "unknown";
}

export interface QueryPlannerOutput {
  routePlan: DomainRoutePlan;
  searchQueries: string[];
  mustIncludeTerms: string[];
  mustExcludeTerms: string[];
  expectedEvidenceType:
    | "definition"
    | "list"
    | "comparison"
    | "procedure"
    | "code"
    | "table"
    | "visual_layout"
    | "text"
    | "unknown";
  retrievalQuery: string;
}

export interface EvidenceExtractorOutput {
  answerIntent: AnswerIntent;
  intentResolution: AnswerIntentResolution;
  sourceIds: string[];
  missingInfo: string[];
  structuredFacts: StructuredFact[];
  evidenceBundle: EvidenceBundle;
}

export interface EvidenceExtractorBudget {
  directFactLimit: number;
  supportingFactLimit: number;
  riskFactLimit: number;
  notSupportedLimit: number;
  usableFactLimit: number;
  sourceIdLimit: number;
}

export interface EvidenceExtractorCardInput {
  sourceId: string;
  title: string;
  topic?: string;
  rawContent?: string;
  patientSummary?: string;
  clinicalTakeaway?: string;
  safeGuidance?: string;
  redFlags?: string;
  doNotInfer?: string;
}

export interface EvidenceExtractorInput {
  userQuery: string;
  cards: EvidenceExtractorCardInput[];
}

export type AnswerIntentSignal =
  | AnswerIntent
  | "checklist"
  | "summarize"
  | "clarify"
  | "no_source";

export interface AnswerIntentResolution {
  intent: AnswerIntent;
  primarySignal: AnswerIntentSignal;
  confidence: "low" | "medium" | "high";
  scores: Partial<Record<AnswerIntentSignal, number>>;
  weakIntent: AnswerIntent;
  reasons: string[];
}

export function getEvidenceExtractorBudget(): EvidenceExtractorBudget {
  const budget = getDecisionConfig().evidenceBudget;
  return {
    directFactLimit: budget.usableFactLimit,
    supportingFactLimit: 0,
    riskFactLimit: budget.riskFactLimit,
    notSupportedLimit: budget.notSupportedLimit,
    usableFactLimit: budget.usableFactLimit,
    sourceIdLimit: budget.sourceIdLimit,
  };
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value?.trim().replace(/\s+/gu, " ");
    if (!text) continue;
    const key = text.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function evidenceLine(item: EvidenceItem): string {
  const source = item.chunkId ? `${item.sourceId}/${item.chunkId}` : item.sourceId;
  return `${source}: ${item.quote}`;
}

export function isUsableEvidenceOutputItem(item: EvidenceItem): boolean {
  return item.kind !== "source_limit" && item.kind !== "contradiction";
}

export function evidenceOutputUsableItems(evidence: EvidenceExtractorOutput | null | undefined): EvidenceItem[] {
  return (evidence?.evidenceBundle?.items ?? []).filter((item) => isUsableEvidenceOutputItem(item) && hasUsableEvidenceItem(item));
}

export function evidenceOutputUsableTextFacts(evidence: EvidenceExtractorOutput | null | undefined): string[] {
  return evidenceOutputUsableItems(evidence).map(evidenceLine);
}

export function evidenceOutputLimitText(evidence: EvidenceExtractorOutput | null | undefined): string[] {
  const items = evidence?.evidenceBundle?.items ?? [];
  return [
    ...items.filter((item) => item.kind === "source_limit" || item.kind === "contradiction").map(evidenceLine),
    ...(evidence?.missingInfo ?? []),
  ];
}

export function evidenceOutputRiskText(_evidence: EvidenceExtractorOutput | null | undefined): string[] {
  return [];
}

export function evidenceOutputStructuredFacts(evidence: EvidenceExtractorOutput | null | undefined): StructuredFact[] {
  return evidence?.structuredFacts ?? [];
}

export function createEmptyEvidenceOutput(input: {
  userQuery: string;
  sourceIds?: string[];
  missingInfo?: string[];
  reason?: string;
}): EvidenceExtractorOutput {
  const sourceIds = unique(input.sourceIds ?? []);
  const missingInfo = unique(input.missingInfo ?? []);
  return {
    answerIntent: "unknown",
    intentResolution: {
      intent: "unknown",
      primarySignal: "no_source",
      confidence: "high",
      scores: { no_source: 1 },
      weakIntent: "unknown",
      reasons: [input.reason ?? "no usable typed evidence was found"],
    },
    sourceIds,
    missingInfo,
    structuredFacts: [],
    evidenceBundle: buildEvidenceBundleFromItems({
      userQuery: input.userQuery,
      items: [],
      requestedFieldIds: [],
      coverage: {
        status: "none",
        requestedItemCount: 0,
        coveredItemCount: 0,
        missingFields: [],
        missingEvidenceKinds: [],
        reason: input.reason ?? "no_usable_evidence",
      },
    }),
  };
}

function intentFromTask(taskType: ReturnType<typeof detectAnswerTask>["taskType"]): AnswerIntent {
  if (taskType === "compare_concepts") return "compare";
  if (taskType === "procedure" || taskType === "code_explanation" || taskType === "list_items") return "steps";
  if (taskType === "unknown") return "unknown";
  return "explain";
}

function expectedEvidenceType(taskType: ReturnType<typeof detectAnswerTask>["taskType"]): QueryPlannerOutput["expectedEvidenceType"] {
  if (taskType === "definition") return "definition";
  if (taskType === "list_items") return "list";
  if (taskType === "compare_concepts") return "comparison";
  if (taskType === "procedure") return "procedure";
  if (taskType === "code_explanation") return "code";
  if (taskType === "field_extraction") return "table";
  if (taskType === "visual_layout") return "visual_layout";
  if (taskType === "source_grounded_explain" || taskType === "summarize_opinions") return "text";
  return "unknown";
}

export function resolveAnswerIntent(input: {
  userQuery: string;
  weakIntent?: AnswerIntent;
  directFactCount?: number;
  supportingFactCount?: number;
  riskFactCount?: number;
  missingInfoCount?: number;
  sourceCount?: number;
}): AnswerIntentResolution {
  const task = detectAnswerTask(input.userQuery);
  const weakIntent = input.weakIntent ?? intentFromTask(task.taskType);
  const noSource = (input.directFactCount ?? 0) === 0 &&
    (input.supportingFactCount ?? 0) === 0 &&
    (input.sourceCount ?? 0) === 0 &&
    (input.missingInfoCount ?? 0) > 0;
  if (noSource) {
    return {
      intent: "unknown",
      primarySignal: "no_source",
      confidence: "high",
      scores: { no_source: 1 },
      weakIntent,
      reasons: ["no usable typed evidence was found"],
    };
  }
  const primarySignal: AnswerIntentSignal =
    task.taskType === "list_items" ? "checklist" : weakIntent;
  return {
    intent: weakIntent,
    primarySignal,
    confidence: (input.directFactCount ?? 0) > 0 || task.confidence === "high" ? "high" : "medium",
    scores: { [primarySignal]: 1 },
    weakIntent,
    reasons: [`task=${task.taskType}`, "intent derived from query contract and typed evidence"],
  };
}

export function buildDeterministicQueryPlan(input: QueryPlannerInput): QueryPlannerOutput {
  const routePlan = routeQuery(input.userQuery);
  const task = detectAnswerTask(input.userQuery);
  const taskTerms = unique([
    ...task.requestedFields.flatMap((field) => [field.label, ...field.aliases]),
    ...task.targetDocumentHints.map((hint) => hint.value),
  ]);
  const searchQueries = unique([
    input.userQuery,
    ...routePlan.retrievalHints,
    ...taskTerms,
  ]).slice(0, 8);
  return {
    routePlan,
    searchQueries,
    mustIncludeTerms: routePlan.mustIncludeTerms,
    mustExcludeTerms: routePlan.mustExcludeTerms,
    expectedEvidenceType: expectedEvidenceType(task.taskType),
    retrievalQuery: unique([input.userQuery, ...searchQueries]).join(" | "),
  };
}

export async function runQueryPlannerSkill(
  input: QueryPlannerInput,
): Promise<SkillRunEnvelope<QueryPlannerInput, QueryPlannerOutput>> {
  return {
    skill: "query-planner",
    runtime: "deterministic",
    input,
    output: buildDeterministicQueryPlan(input),
  };
}

export function buildDeterministicEvidenceExtraction(input: EvidenceExtractorInput): EvidenceExtractorOutput {
  const budget = getEvidenceExtractorBudget();
  const taskDetection = detectAnswerTask(input.userQuery);
  const evidenceV2 = extractEvidenceV2({
    query: input.userQuery,
    cards: input.cards,
    taskDetection,
  });
  const usableItems = evidenceV2.items.filter(isUsableEvidenceOutputItem);
  const sourceIds = unique(evidenceV2.sourceIds).slice(0, budget.sourceIdLimit);
  const missingInfo = usableItems.length === 0
    ? ["No usable typed evidence item was found for this query."]
    : [];
  const answerIntent = intentFromTask(taskDetection.taskType);
  const intentResolution = resolveAnswerIntent({
    userQuery: input.userQuery,
    weakIntent: answerIntent,
    directFactCount: usableItems.length,
    missingInfoCount: missingInfo.length,
    sourceCount: sourceIds.length,
  });

  return {
    answerIntent,
    intentResolution,
    sourceIds,
    missingInfo,
    structuredFacts: evidenceV2.structuredFacts,
    evidenceBundle: evidenceV2.evidenceBundle,
  };
}

export async function runEvidenceExtractorSkill(
  input: EvidenceExtractorInput,
): Promise<SkillRunEnvelope<EvidenceExtractorInput, EvidenceExtractorOutput>> {
  return {
    skill: "evidence-extractor",
    runtime: "deterministic",
    input,
    output: buildDeterministicEvidenceExtraction(input),
  };
}
