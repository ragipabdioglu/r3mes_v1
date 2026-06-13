import type { AnswerDomain, AnswerIntent, GroundedMedicalAnswer, GroundingConfidence } from "./answerSchema.js";
import type { CompiledEvidence } from "./compiledEvidence.js";
import { hasUsableEvidenceItem, type EvidenceBundle, type EvidenceItem } from "./evidenceBundle.js";
import { detectAnswerTask } from "./answerTaskDetector.js";
import {
  evidenceOutputLimitText,
  evidenceOutputStructuredFacts,
  evidenceOutputUsableTextFacts,
  type EvidenceExtractorOutput,
} from "./skillPipeline.js";
import type { StructuredFact } from "./structuredFact.js";

export interface AnswerSpec {
  answerDomain: AnswerDomain;
  answerIntent: AnswerIntent;
  groundingConfidence: GroundingConfidence;
  userQuery: string;
  tone: "calm" | "direct" | "cautious";
  sections: Array<"assessment" | "action" | "caution" | "summary">;
  assessment: string;
  action: string;
  caution: string[];
  summary: string;
  unknowns: string[];
  sourceIds: string[];
  facts: string[];
  structuredFacts?: StructuredFact[];
}

function stripSourcePrefix(value: string): string {
  const match = value.match(/^\s*([^:]{1,120}):\s*(.+)$/u);
  if (!match) return value.trim();
  const prefix = match[1]?.trim() ?? "";
  const rest = match[2]?.trim() ?? "";
  if (!prefix || !rest) return value.trim();
  if (/^[a-z0-9_.-]{2,120}$/iu.test(prefix) || /(?:\.pdf|\.docx|\.pptx|\.md|\.txt)\b/iu.test(prefix)) {
    return rest;
  }
  return value.trim();
}

function normalizeText(value: string): string {
  return stripSourcePrefix(value)
    .replace(/\bPDF\s+COPY\s*>{2,}\s*/giu, "")
    .replace(/\bOCR\s+HATASI\s*:?\s*/giu, "")
    .replace(/^#+\s*Page\s+\d+\s*/giu, "")
    .replace(/^#+\s*XML Text Fallback\s*/giu, "")
    .replace(/^#+\s*word\/[^\s]+\s*/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function uniqueClean(values: Array<string | null | undefined>, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = normalizeText(value ?? "");
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

function uniqueIds(values: Array<string | null | undefined>, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const id = value?.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

function itemText(item: EvidenceItem): string {
  return item.quote || item.normalizedClaim || [item.subject, item.field, item.value, item.unit].filter(Boolean).join(" ");
}

function evidenceItems(bundle: EvidenceBundle | null | undefined): EvidenceItem[] {
  return (bundle?.items ?? []).filter(hasUsableEvidenceItem);
}

function factsFromCompiled(compiledEvidence: CompiledEvidence | null | undefined): string[] {
  if (!compiledEvidence) return [];
  const typed = evidenceItems(compiledEvidence.evidenceBundle)
    .map(itemText);
  const structured = (compiledEvidence.structuredFacts ?? [])
    .map((fact) => [fact.subject, fact.field, fact.value, fact.unit, fact.provenance.quote].filter(Boolean).join(" "));
  if (typed.length > 0 || structured.length > 0) return uniqueClean([...typed, ...structured], 8);
  return uniqueClean([...typed, ...structured, ...compiledEvidence.facts], 8);
}

function factsFromEvidence(evidence: EvidenceExtractorOutput | null | undefined): string[] {
  if (!evidence) return [];
  const typed = evidenceItems(evidence.evidenceBundle).map(itemText);
  if (typed.length > 0) return uniqueClean(typed, 8);
  return uniqueClean([...typed, ...evidenceOutputUsableTextFacts(evidence)], 8);
}

function unknownsFromEvidence(
  evidence: EvidenceExtractorOutput | null | undefined,
  compiledEvidence: CompiledEvidence | null | undefined,
): string[] {
  return uniqueClean([
    ...(compiledEvidence?.unknowns ?? []),
    ...(compiledEvidence?.contradictions ?? []),
    ...(compiledEvidence?.answerReadiness?.missingFields ?? []).map((field) => `Eksik alan: ${field}`),
    ...evidenceOutputLimitText(evidence),
    ...(evidence?.missingInfo ?? []),
  ], 6);
}

function sourceIdsFromEvidence(
  evidence: EvidenceExtractorOutput | null | undefined,
  compiledEvidence: CompiledEvidence | null | undefined,
): string[] {
  const primaryIds = uniqueIds([
    ...(compiledEvidence?.sourceIds ?? []),
    ...(evidence?.sourceIds ?? []),
  ], 12);
  if (primaryIds.length > 0) return primaryIds;
  return uniqueIds([
    ...(compiledEvidence?.evidenceBundle?.sourceIds ?? []),
    ...(evidence?.evidenceBundle?.sourceIds ?? []),
  ], 12);
}

function sectionsForIntent(intent: AnswerIntent): AnswerSpec["sections"] {
  if (intent === "triage") return ["caution", "assessment", "action", "summary"];
  if (intent === "steps") return ["action", "assessment", "caution", "summary"];
  if (intent === "compare") return ["assessment", "summary", "caution", "action"];
  return ["assessment", "action", "caution", "summary"];
}

function inferIntent(userQuery: string, evidence: EvidenceExtractorOutput | null | undefined): AnswerIntent {
  if (evidence?.answerIntent && evidence.answerIntent !== "unknown") return evidence.answerIntent;
  const detected = detectAnswerTask(userQuery).answerIntent;
  if (detected !== "unknown") return detected;
  return "unknown";
}

function confidenceFromCompiled(
  fallback: GroundingConfidence,
  compiledEvidence: CompiledEvidence | null | undefined,
): GroundingConfidence {
  return compiledEvidence?.confidence ?? fallback;
}

function toneFor(confidence: GroundingConfidence, intent: AnswerIntent): AnswerSpec["tone"] {
  if (confidence === "low" || intent === "unknown") return "cautious";
  if (intent === "reassure") return "calm";
  return "direct";
}

function noSourceAssessment(compiledEvidence: CompiledEvidence | null | undefined): string {
  const mode = compiledEvidence?.answerReadiness?.mode;
  if (mode === "contradiction") return "Kaynaklarda bu cevap için çelişkili kanıt bulundu.";
  if (mode === "partial_answer") return "Kaynaklarda bu sorunun yalnız bir kısmını destekleyen kanıt bulundu.";
  return "Kaynaklarda bu soruya doğrudan yeterli kanıt bulunamadı.";
}

function actionFromReadiness(compiledEvidence: CompiledEvidence | null | undefined): string {
  const readiness = compiledEvidence?.answerReadiness;
  if (!readiness) return "";
  if (readiness.mode === "no_source") return "Kaynak dışı bilgi eklenmemeli; kullanıcıya kaynak bulunamadığı söylenmelidir.";
  if (readiness.mode === "contradiction") return "Çelişki açıkça belirtilmeli ve kesin hüküm kurulmadan cevap verilmelidir.";
  if (readiness.mode === "partial_answer") return "Yalnız desteklenen alanlar cevaplanmalı; eksik alanlar açıkça belirtilmelidir.";
  return "";
}

export function buildAnswerSpec(opts: {
  answerDomain: AnswerDomain;
  groundingConfidence: GroundingConfidence;
  userQuery: string;
  evidence: EvidenceExtractorOutput | null;
  compiledEvidence?: CompiledEvidence | null;
}): AnswerSpec {
  const compiledEvidence = opts.compiledEvidence ?? null;
  const evidence = opts.evidence ?? null;
  const groundingConfidence = confidenceFromCompiled(opts.groundingConfidence, compiledEvidence);
  const answerIntent = inferIntent(opts.userQuery, evidence);
  const facts = uniqueClean([
    ...factsFromCompiled(compiledEvidence),
    ...factsFromEvidence(evidence),
  ], 8);
  const unknowns = unknownsFromEvidence(evidence, compiledEvidence);
  const sourceIds = sourceIdsFromEvidence(evidence, compiledEvidence);
  const structuredFacts = compiledEvidence?.structuredFacts ?? evidenceOutputStructuredFacts(evidence);
  const hasUsableEvidence =
    facts.length > 0 ||
    structuredFacts.length > 0 ||
    (compiledEvidence?.answerReadiness?.usableForAnswer ?? false);
  const assessment = hasUsableEvidence
    ? facts[0] ?? structuredFacts[0]?.provenance.quote ?? "Kaynaklarda kullanılabilir kanıt bulundu."
    : noSourceAssessment(compiledEvidence);
  const action = facts[1] ?? actionFromReadiness(compiledEvidence);
  const caution = uniqueClean([
    ...(compiledEvidence?.answerReadiness?.mode === "contradiction" ? ["Kaynaklar arasında çelişki var; kesin konuşulmamalıdır."] : []),
    ...unknowns,
  ], 3);
  const summary = assessment;

  return {
    answerDomain: opts.answerDomain,
    answerIntent,
    groundingConfidence,
    userQuery: opts.userQuery,
    tone: toneFor(groundingConfidence, answerIntent),
    sections: sectionsForIntent(answerIntent),
    assessment,
    action,
    caution,
    summary,
    unknowns: unknowns.slice(0, 4),
    sourceIds,
    facts,
    structuredFacts,
  };
}

export function buildAnswerSpecFromGroundedAnswer(answer: GroundedMedicalAnswer): AnswerSpec {
  const facts = uniqueClean([
    answer.answer,
    answer.condition_context,
    answer.safe_action,
    answer.general_assessment,
    answer.recommended_action,
    answer.one_sentence_summary,
    answer.short_summary,
  ], 8);
  const assessment = facts[0] ?? "Kaynaklarda bu soruya doğrudan yeterli kanıt bulunamadı.";
  const action = facts[1] ?? "";
  const caution = uniqueClean([...answer.red_flags, ...answer.visit_triggers, ...answer.doctor_visit_when], 3);

  return {
    answerDomain: answer.answer_domain,
    answerIntent: answer.answer_intent,
    groundingConfidence: answer.grounding_confidence,
    userQuery: answer.user_query,
    tone: toneFor(answer.grounding_confidence, answer.answer_intent),
    sections: sectionsForIntent(answer.answer_intent),
    assessment,
    action,
    caution,
    summary: answer.short_summary || answer.one_sentence_summary || assessment,
    unknowns: uniqueClean(answer.avoid_inference, 4),
    sourceIds: answer.used_source_ids,
    facts,
  };
}
