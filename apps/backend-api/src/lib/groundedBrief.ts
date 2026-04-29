import type { KnowledgeCard } from "./knowledgeCard.js";
import type { GroundingConfidence } from "./answerSchema.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

interface GroundedBriefOptions {
  lowGroundingConfidence?: boolean;
  groundingConfidence?: GroundingConfidence;
  sourceRefs?: Array<{ id: string; title: string }>;
  answerIntent?: string;
}

function firstSentence(text: string): string {
  const match = text.trim().match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? text).trim();
}

function compactLine(text: string, maxChars = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trim()}…`;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const normalized = value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(compactLine(value));
  }
  return result;
}

function bulletSection(lines: string[], title: string, items: string[], limit: number): void {
  const clean = uniqueNonEmpty(items).slice(0, limit);
  if (clean.length === 0) return;
  lines.push(title);
  for (const item of clean) lines.push(`- ${item}`);
}

export function buildEvidenceGroundedBrief(
  evidence: EvidenceExtractorOutput,
  opts: GroundedBriefOptions = {},
): string {
  const groundingConfidence =
    opts.groundingConfidence ?? (opts.lowGroundingConfidence ? "low" : "high");
  const lines: string[] = [`GROUNDING DURUMU: ${groundingConfidence.toUpperCase()}`];
  lines.push(`CEVAP NIYETI: ${opts.answerIntent ?? evidence.answerIntent}`);

  bulletSection(lines, "KULLANILABILIR GERCEKLER:", evidence.directAnswerFacts, 3);
  bulletSection(lines, "DESTEKLEYICI BAGLAM:", evidence.supportingContext, 2);
  bulletSection(lines, "BELIRSIZ / KULLANILAMAYAN:", [...evidence.notSupported, ...evidence.missingInfo], 3);
  bulletSection(lines, "RED FLAGS:", evidence.riskFacts, 3);

  if (opts.sourceRefs && opts.sourceRefs.length > 0) {
    lines.push("KAYNAK KIMLIKLARI:");
    for (const ref of opts.sourceRefs.slice(0, 2)) {
      lines.push(`- ${ref.id}: ${ref.title}`);
    }
  } else if (evidence.sourceIds.length > 0) {
    lines.push("KAYNAK KIMLIKLARI:");
    for (const sourceId of evidence.sourceIds.slice(0, 2)) {
      lines.push(`- ${sourceId}`);
    }
  }

  lines.push("YANIT KURALLARI:");
  lines.push("- Yalnızca kullanılabilir gerçeklere dayan.");
  lines.push("- Destekleyici bağlamı ana cevap gibi sunma.");
  lines.push("- Belirsiz/kullanılamayan bilgiden tanı, karar veya neden üretme.");
  lines.push("- Emin değilsen bunu açıkça söyle.");
  lines.push("- Kısa, sade ve güvenli kal.");
  return lines.join("\n");
}

export function buildGroundedBrief(cards: KnowledgeCard[], opts: GroundedBriefOptions = {}): string {
  if (cards.length === 0) return "";
  const prunedCards = cards.slice(0, 2);
  const groundingConfidence =
    opts.groundingConfidence ?? (opts.lowGroundingConfidence ? "low" : "high");

  const topics = uniqueNonEmpty(prunedCards.map((card) => card.topic)).slice(0, 2);
  const takeaways = uniqueNonEmpty(prunedCards.map((card) => firstSentence(card.clinicalTakeaway))).slice(0, 2);
  const guidance = uniqueNonEmpty(prunedCards.map((card) => firstSentence(card.safeGuidance))).slice(0, 1);
  const redFlags = uniqueNonEmpty(prunedCards.map((card) => firstSentence(card.redFlags))).slice(0, 2);
  const doNotInfer = uniqueNonEmpty(prunedCards.map((card) => firstSentence(card.doNotInfer))).slice(0, 2);

  const lines: string[] = [];
  if (topics.length > 0) {
    lines.push(`KONU: ${topics.join(" | ")}`);
  }
  lines.push(`GROUNDING DURUMU: ${groundingConfidence.toUpperCase()}`);
  if (opts.answerIntent) {
    lines.push(`CEVAP NIYETI: ${opts.answerIntent}`);
  }
  if (takeaways.length > 0 || guidance.length > 0) {
    lines.push("KULLANILABILIR GERCEKLER:");
    for (const item of [...takeaways, ...guidance].slice(0, 3)) lines.push(`- ${item}`);
  }
  if (doNotInfer.length > 0) {
    lines.push("BELIRSIZ / KULLANILAMAYAN:");
    for (const item of doNotInfer) lines.push(`- ${item}`);
  }
  if (redFlags.length > 0) {
    lines.push("RED FLAGS:");
    for (const item of redFlags) lines.push(`- ${item}`);
  }
  if (opts.sourceRefs && opts.sourceRefs.length > 0) {
    lines.push("KAYNAK KIMLIKLARI:");
    for (const ref of opts.sourceRefs.slice(0, 2)) {
      lines.push(`- ${ref.id}: ${ref.title}`);
    }
  }
  lines.push("YANIT KURALLARI:");
  lines.push("- Yalnızca kullanılabilir bilgilere dayan.");
  lines.push("- Emin değilsen bunu açıkça söyle.");
  lines.push("- Alakasız test, değer veya hastalık ismi ekleme.");
  lines.push("- Kısa, sade ve güvenli kal.");
  return lines.join("\n");
}
