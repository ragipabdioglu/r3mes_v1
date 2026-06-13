import type { EvidenceExtractorCardInput } from "../skillPipeline.js";
import { normalizeConceptText } from "../conceptNormalizer.js";
import { createEvidenceItem, type EvidenceItem, type EvidenceItemConfidence, type EvidenceItemKind } from "../evidenceBundle.js";

export interface ArtifactExtractionInput {
  query: string;
  normalizedQuery: string;
  queryTokens: Set<string>;
  card: EvidenceExtractorCardInput;
  sourceLabel: string;
}

const STOP_TOKENS = new Set([
  "nedir",
  "nelerdir",
  "neler",
  "hangi",
  "kaynak",
  "kaynağa",
  "gore",
  "göre",
  "kisa",
  "kısa",
  "acikla",
  "açıkla",
  "madde",
  "yaz",
  "sadece",
  "fark",
  "arasindaki",
  "arasındaki",
]);

export function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function queryTokens(query: string): Set<string> {
  return new Set(
    normalizeConceptText(query)
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_TOKENS.has(token)),
  );
}

export function cardText(card: EvidenceExtractorCardInput): string {
  return [
    card.topic ?? "",
    card.patientSummary ?? "",
    card.clinicalTakeaway ?? "",
    card.safeGuidance ?? "",
    card.redFlags ?? "",
    card.doNotInfer ?? "",
    card.rawContent ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function splitSentences(text: string, limit = 32): string[] {
  const normalized = text
    .replace(/\r/gu, "\n")
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?。])\s+/u))
    .map(normalizeEvidenceText)
    .filter((line) => line.length >= 8 && line.length <= 1200);
  return normalized.slice(0, limit);
}

export function splitListItems(text: string, limit = 40): string[] {
  const lines = text.replace(/\r/gu, "\n").split(/\n+/u);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = normalizeEvidenceText(line);
    if (!trimmed) continue;
    const bullet = trimmed.match(/^(?:[-*•]|\d+[.)]|[a-zA-Z][.)])\s+(.{2,})$/u)?.[1];
    if (bullet) out.push(bullet);
    if (/[;•]/u.test(trimmed) && /[:：]/u.test(trimmed)) {
      const afterColon = trimmed.split(/[:：]/u).slice(1).join(":");
      for (const part of afterColon.split(/[;•]/u)) {
        const item = normalizeEvidenceText(part.replace(/^[-*•]\s*/u, ""));
        if (item.length >= 2) out.push(item);
      }
    }
  }
  return uniqueTexts(out).slice(0, limit);
}

export function splitCodeBlocks(text: string, limit = 12): string[] {
  const fenced = Array.from(text.matchAll(/```[\s\S]*?```/gu)).map((match) => match[0]);
  const functionLike = Array.from(
    text.matchAll(/(?:public|private|protected|function|const|let|var|async|void|def)\s+[\w$<>[\],\s]+\s*\([^)]*\)\s*\{?[\s\S]{0,700}?/giu),
  ).map((match) => match[0]);
  const identifierBlocks = Array.from(text.matchAll(/\b[\w$]{3,}\s*\([^)]*\)\s*(?:=>|\{)[\s\S]{0,520}/gu)).map((match) => match[0]);
  return uniqueTexts([...fenced, ...functionLike, ...identifierBlocks].map(normalizeEvidenceText)).slice(0, limit);
}

export function overlapsQuery(input: { text: string; queryTokens: Set<string>; min?: number }): boolean {
  if (input.queryTokens.size === 0) return true;
  const normalized = normalizeConceptText(input.text);
  let matches = 0;
  for (const token of input.queryTokens) {
    if (normalized.includes(token)) matches += 1;
  }
  return matches >= (input.min ?? 1);
}

export function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = normalizeEvidenceText(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function sourceEvidenceItem(input: {
  kind: EvidenceItemKind;
  extractor: string;
  extraction: ArtifactExtractionInput;
  quote: string;
  confidence?: EvidenceItemConfidence;
  subject?: string;
  field?: string;
  value?: string;
  unit?: string;
}): EvidenceItem {
  return createEvidenceItem({
    kind: input.kind,
    sourceId: input.extraction.card.sourceId,
    quote: `${input.extraction.sourceLabel}: ${normalizeEvidenceText(input.quote)}`,
    normalizedClaim: input.quote,
    subject: input.subject,
    field: input.field,
    value: input.value,
    unit: input.unit,
    confidence: input.confidence ?? "medium",
    provenance: {
      extractor: input.extractor,
    },
  });
}
