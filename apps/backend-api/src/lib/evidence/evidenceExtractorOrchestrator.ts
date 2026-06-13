import { detectAnswerTask, type AnswerTaskDetection, type AnswerTaskType } from "../answerTaskDetector.js";
import { findEvidenceDomainPacksForText } from "../../domain-packs/evidenceDomainPacks.js";
import {
  buildEvidenceBundleFromItems,
  evidenceItemFromStructuredFact,
  hasUsableEvidenceItem,
  type EvidenceBundle,
  type EvidenceItem,
  type EvidenceItemCoverage,
  type EvidenceItemKind,
} from "../evidenceBundle.js";
import { extractTableNumericFacts } from "../tableNumericFactExtractor.js";
import type { StructuredFact } from "../structuredFact.js";
import type { EvidenceExtractorCardInput } from "../skillPipeline.js";
import { extractCodeEvidence } from "./codeEvidenceExtractor.js";
import { extractComparisonEvidence } from "./comparisonEvidenceExtractor.js";
import { extractDefinitionEvidence } from "./definitionEvidenceExtractor.js";
import { extractListEvidence } from "./listEvidenceExtractor.js";
import { extractProcedureEvidence } from "./procedureEvidenceExtractor.js";
import { extractSourceLimitEvidence } from "./sourceLimitEvidenceExtractor.js";
import { extractTextClaimEvidence } from "./textClaimEvidenceExtractor.js";
import { extractVisualLayoutEvidence } from "./visualLayoutEvidenceExtractor.js";
import { cardText, normalizeEvidenceText, queryTokens, sourceEvidenceItem, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";

export interface LegacyEvidenceSeeds {
  directAnswerFacts?: string[];
  supportingContext?: string[];
  usableFacts?: string[];
  riskFacts?: string[];
  notSupported?: string[];
}

export interface EvidenceExtractorInputV2 {
  query: string;
  cards: EvidenceExtractorCardInput[];
  taskDetection?: AnswerTaskDetection;
  legacySeeds?: LegacyEvidenceSeeds;
  sourceIds?: string[];
  structuredFacts?: StructuredFact[];
}

export interface EvidenceExtractionDiagnostics {
  extractorVersion: "v2";
  contextItemCount: number;
  evidenceItemCount: number;
  structuredFactCount: number;
  coverage: EvidenceItemCoverage;
  extractorBreakdown: Record<string, number>;
  domainPackIds: string[];
}

export interface EvidenceExtractorOutputV2 {
  items: EvidenceItem[];
  structuredFacts: StructuredFact[];
  coverage: EvidenceItemCoverage;
  sourceIds: string[];
  evidenceBundle: EvidenceBundle;
  diagnostics: EvidenceExtractionDiagnostics;
}

const TASK_TO_REQUIRED_EVIDENCE: Partial<Record<AnswerTaskType, EvidenceItemKind[]>> = {
  definition: ["definition"],
  list_items: ["list_item"],
  compare_concepts: ["comparison_point"],
  procedure: ["procedure_step"],
  code_explanation: ["code_fact"],
  visual_layout: ["visual_layout"],
  field_extraction: ["table_fact", "numeric_fact"],
};

function uniqueItems(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.kind}|${item.sourceId}|${item.quote}`.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function itemFromLegacyFact(input: {
  query: string;
  fact: string;
  sourceIds: string[];
  kind: EvidenceItemKind;
  extractor: string;
}): EvidenceItem | null {
  const quote = normalizeEvidenceText(input.fact);
  if (!quote) return null;
  const sourceId = input.sourceIds.find((id) => quote.toLocaleLowerCase("tr-TR").includes(id.toLocaleLowerCase("tr-TR"))) ??
    input.sourceIds[0] ??
    quote.split(":")[0]?.trim() ??
    "unknown-source";
  return sourceEvidenceItem({
    kind: input.kind,
    extractor: input.extractor,
    extraction: {
      query: input.query,
      normalizedQuery: input.query,
      queryTokens: queryTokens(input.query),
      card: { sourceId, title: sourceId },
      sourceLabel: sourceId,
    },
    quote,
    confidence: input.kind === "source_limit" ? "medium" : "high",
  });
}

function legacySeedItems(input: {
  query: string;
  seeds?: LegacyEvidenceSeeds;
  sourceIds: string[];
  taskType: AnswerTaskType;
}): EvidenceItem[] {
  const requiredKinds = TASK_TO_REQUIRED_EVIDENCE[input.taskType] ?? ["text_fact"];
  const primaryKind = requiredKinds[0] ?? "text_fact";
  const values: Array<{ facts?: string[]; kind: EvidenceItemKind; extractor: string }> = [
    { facts: input.seeds?.directAnswerFacts, kind: primaryKind, extractor: "legacy-direct-fact-adapter-v2" },
    { facts: input.seeds?.usableFacts, kind: primaryKind, extractor: "legacy-usable-fact-adapter-v2" },
    { facts: input.seeds?.supportingContext, kind: primaryKind, extractor: "legacy-supporting-fact-adapter-v2" },
    { facts: input.seeds?.riskFacts, kind: "text_fact", extractor: "legacy-risk-fact-adapter-v2" },
    { facts: input.seeds?.notSupported, kind: "source_limit", extractor: "legacy-source-limit-adapter-v2" },
  ];
  return values.flatMap((entry) =>
    (entry.facts ?? [])
      .map((fact) => itemFromLegacyFact({
        query: input.query,
        fact,
        sourceIds: input.sourceIds,
        kind: entry.kind,
        extractor: entry.extractor,
      }))
      .filter((item): item is EvidenceItem => Boolean(item)),
  );
}

function coverageFor(input: {
  taskDetection: AnswerTaskDetection;
  items: EvidenceItem[];
  structuredFacts: StructuredFact[];
}): EvidenceItemCoverage {
  const requiredKinds = TASK_TO_REQUIRED_EVIDENCE[input.taskDetection.taskType] ?? [];
  const requestedFields = input.taskDetection.requestedFields.map((field) => field.id);
  const coveredFields = requestedFields.filter((fieldId) =>
    input.structuredFacts.some((fact) =>
      [fact.field, fact.subject, fact.value, fact.table?.rowLabel, fact.table?.columnLabel]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(fieldId.replace(/_/gu, " ").toLocaleLowerCase("tr-TR")),
    ),
  );
  const missingFields = requestedFields.filter((field) => !coveredFields.includes(field));
  const missingEvidenceKinds = requiredKinds.filter((kind) => !input.items.some((item) => item.kind === kind));
  const usableCount = input.items.filter(hasUsableEvidenceItem).length + input.structuredFacts.length;
  const requestedItemCount = Math.max(requestedFields.length, requiredKinds.length, input.taskDetection.taskType === "unknown" ? 0 : 1);
  const coveredItemCount = requestedFields.length > 0 ? coveredFields.length : Math.max(0, requestedItemCount - missingEvidenceKinds.length);
  const status =
    usableCount === 0 || (requestedItemCount > 0 && coveredItemCount === 0)
      ? "none"
      : missingFields.length > 0 || missingEvidenceKinds.length > 0
        ? "partial"
        : "complete";
  const reason =
    status === "complete"
      ? "evidence_requirements_met"
      : missingFields.length > 0
        ? "requested_fields_missing"
        : missingEvidenceKinds.length > 0
          ? "required_evidence_kind_missing"
          : "no_usable_evidence";
  return {
    status,
    requestedItemCount,
    coveredItemCount,
    missingFields,
    missingEvidenceKinds,
    reason,
  };
}

function extractorBreakdown(items: EvidenceItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const extractor = item.provenance.extractor || "unknown";
    out[extractor] = (out[extractor] ?? 0) + 1;
  }
  return out;
}

export function extractEvidenceV2(input: EvidenceExtractorInputV2): EvidenceExtractorOutputV2 {
  const taskDetection = input.taskDetection ?? detectAnswerTask(input.query);
  const tokens = queryTokens(input.query);
  const normalizedQuery = taskDetection.diagnostics.normalizedQuery;
  const sourceIds = [...new Set([...(input.sourceIds ?? []), ...input.cards.map((card) => card.sourceId)])];
  const domainPackIds = [
    ...new Set(
      findEvidenceDomainPacksForText([
        input.query,
        ...input.cards.map(cardText),
      ].join("\n")).map((pack) => pack.id),
    ),
  ];
  const items: EvidenceItem[] = [];

  for (const card of input.cards) {
    const extraction: ArtifactExtractionInput = {
      query: input.query,
      normalizedQuery,
      queryTokens: tokens,
      card,
      sourceLabel: card.title || card.sourceId,
    };
    items.push(...extractSourceLimitEvidence(extraction));
    switch (taskDetection.taskType) {
      case "definition":
        items.push(...extractDefinitionEvidence(extraction));
        break;
      case "list_items":
        items.push(...extractListEvidence(extraction));
        break;
      case "compare_concepts":
        items.push(...extractComparisonEvidence(extraction));
        break;
      case "procedure":
        items.push(...extractProcedureEvidence(extraction));
        break;
      case "code_explanation":
        items.push(...extractCodeEvidence(extraction));
        break;
      case "visual_layout":
        items.push(...extractVisualLayoutEvidence(extraction));
        break;
      default:
        items.push(...extractTextClaimEvidence(extraction));
        break;
    }
  }

  const tableStructuredFacts = extractTableNumericFacts({
    query: input.query,
    facts: [
      ...input.cards.map((card) => `${card.title || card.sourceId}: ${cardText(card)}`),
      ...(input.legacySeeds?.directAnswerFacts ?? []),
      ...(input.legacySeeds?.usableFacts ?? []),
      ...(input.legacySeeds?.supportingContext ?? []),
      ...items.map((item) => item.quote),
    ],
    sourceIds,
  });
  const structuredFacts = [...(input.structuredFacts ?? []), ...tableStructuredFacts];
  items.push(...structuredFacts.map(evidenceItemFromStructuredFact));
  items.push(...legacySeedItems({
    query: input.query,
    seeds: input.legacySeeds,
    sourceIds,
    taskType: taskDetection.taskType,
  }));

  const unique = uniqueItems(items);
  const coverage = coverageFor({ taskDetection, items: unique, structuredFacts });
  const evidenceBundle = buildEvidenceBundleFromItems({
    userQuery: input.query,
    items: unique,
    requestedFieldIds: taskDetection.requestedFields.map((field) => field.id),
    coverage,
  });

  return {
    items: unique,
    structuredFacts,
    coverage,
    sourceIds: evidenceBundle.sourceIds,
    evidenceBundle,
    diagnostics: {
      extractorVersion: "v2",
      contextItemCount: input.cards.length,
      evidenceItemCount: unique.length,
      structuredFactCount: structuredFacts.length,
      coverage,
      extractorBreakdown: extractorBreakdown(unique),
      domainPackIds,
    },
  };
}
