import { routeQuery, type DomainRoutePlan } from "./queryRouter.js";
import type { AnswerIntent } from "./answerSchema.js";
import { expandConceptTerms, normalizeConceptText } from "./conceptNormalizer.js";
import { getDecisionConfig } from "./decisionConfig.js";
import { getEvidenceLexicon, normalizedIncludesAny } from "./evidenceLexicon.js";

export type SkillName =
  | "intent-router"
  | "query-planner"
  | "evidence-extractor"
  | "response-composer"
  | "style-persona";

export type SkillRuntime = "deterministic" | "lora";

export interface SkillRunEnvelope<TInput, TOutput> {
  skill: SkillName;
  runtime: SkillRuntime;
  input: TInput;
  output: TOutput;
}

export interface IntentRouterOutput {
  intent:
    | "medical_question"
    | "legal_question"
    | "document_summary"
    | "general_chat"
    | "unknown";
  riskLevel: "low" | "medium" | "high";
  needsRetrieval: boolean;
  needsClarification: boolean;
  language: "tr" | "en" | "unknown";
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
    | "symptom_card"
    | "guideline"
    | "user_record"
    | "faq"
    | "unknown";
  retrievalQuery: string;
}

export interface EvidenceExtractorOutput {
  answerIntent: AnswerIntent;
  intentResolution: AnswerIntentResolution;
  directAnswerFacts: string[];
  supportingContext: string[];
  riskFacts: string[];
  notSupported: string[];
  usableFacts: string[];
  uncertainOrUnusable: string[];
  redFlags: string[];
  sourceIds: string[];
  missingInfo: string[];
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

export interface ResponseComposerOutput {
  answer: string;
  sourcesUsed: string[];
  confidence: "low" | "medium" | "high";
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function getEvidenceExtractorBudget(): EvidenceExtractorBudget {
  return getDecisionConfig().evidenceBudget;
}

function hasAny(text: string, terms: string[]): boolean {
  const normalized = text.toLocaleLowerCase("tr-TR");
  return terms.some((term) => normalized.includes(term.toLocaleLowerCase("tr-TR")));
}

function inferAnswerIntent(query: string): AnswerIntent {
  if (hasAny(query, ["panik", "kork", "endişe", "endise", "normal mi", "kötü mü", "kotu mu"])) return "reassure";
  if (
    hasAny(query, [
      "ne yap",
      "nasıl",
      "nasil",
      "takip",
      "adım",
      "adim",
      "öner",
      "oner",
      "hazırla",
      "hazirla",
      "hazırlamalı",
      "hazirlamali",
      "hangi belge",
      "hangi belg",
      "hangi kayıt",
      "hangi kayit",
      "hangi kontrol",
      "neye dikkat",
      "ilk ne",
      "ilk hangi",
      "ne sormalı",
      "ne sormali",
      "konuşulmalı",
      "konusulmali",
      "saklamalı",
      "saklamali",
      "toplamam",
      "kontrolleri",
      "kontrol listesi",
    ])
  ) return "steps";
  if (hasAny(query, ["acil", "beklemeli", "ne zaman", "şiddetli", "siddetli", "ateş", "ates", "riskli mi"])) return "triage";
  if (hasAny(query, ["fark", "karşılaştır", "karsilastir", "hangisi"])) return "compare";
  if (hasAny(query, ["nedir", "ne anlama", "yorum", "açıkla", "acikla", "neden"])) return "explain";
  if (hasAny(query, ["risk"])) return "triage";
  return "unknown";
}

function addIntentScore(
  scores: Partial<Record<AnswerIntentSignal, number>>,
  intent: AnswerIntentSignal,
  amount: number,
): void {
  scores[intent] = (scores[intent] ?? 0) + amount;
}

function mapIntentSignalToAnswerIntent(signal: AnswerIntentSignal): AnswerIntent {
  if (signal === "checklist") return "steps";
  if (signal === "summarize") return "explain";
  if (signal === "clarify" || signal === "no_source") return "unknown";
  return signal;
}

export function resolveAnswerIntent(opts: {
  userQuery: string;
  weakIntent?: AnswerIntent;
  directFactCount?: number;
  supportingFactCount?: number;
  riskFactCount?: number;
  missingInfoCount?: number;
  sourceCount?: number;
}): AnswerIntentResolution {
  const query = opts.userQuery;
  const scores: Partial<Record<AnswerIntentSignal, number>> = {};
  const reasons: string[] = [];
  const weakIntent = opts.weakIntent ?? inferAnswerIntent(query);
  const directFactCount = opts.directFactCount ?? 0;
  const supportingFactCount = opts.supportingFactCount ?? 0;
  const riskFactCount = opts.riskFactCount ?? 0;
  const missingInfoCount = opts.missingInfoCount ?? 0;
  const sourceCount = opts.sourceCount ?? 0;

  if (weakIntent !== "unknown") {
    addIntentScore(scores, weakIntent, 30);
    reasons.push(`weak query intent: ${weakIntent}`);
  }
  if (hasAny(query, ["kontrol listesi", "checklist", "liste", "maddeli", "madde madde"])) {
    addIntentScore(scores, "checklist", 85);
    reasons.push("query asks for checklist/list output");
  }
  if (hasAny(query, ["ne yap", "nasıl", "nasil", "hangi adım", "hangi adim", "hazırla", "hazirla", "saklamalı", "saklamali", "toplamam", "kontrol"])) {
    addIntentScore(scores, "steps", 35);
    reasons.push("query asks for action/steps");
  }
  if (hasAny(query, ["acil", "ne zaman", "riskli", "tehlikeli", "şiddetli", "siddetli", "ateş", "ates"])) {
    addIntentScore(scores, "triage", 35);
    reasons.push("query contains risk/triage language");
  }
  if (riskFactCount > 0) {
    addIntentScore(scores, "triage", Math.min(25, 10 + riskFactCount * 5));
    reasons.push("retrieved evidence contains risk facts");
  }
  if (hasAny(query, ["nedir", "neden", "ne anlama", "açıkla", "acikla", "yorumla"])) {
    addIntentScore(scores, "explain", 35);
    reasons.push("query asks for explanation");
  }
  if (hasAny(query, ["özetle", "ozetle", "kısa özet", "kisa ozet", "özet", "ozet"])) {
    addIntentScore(scores, "summarize", 40);
    reasons.push("query asks for summary");
  }
  if (hasAny(query, ["fark", "karşılaştır", "karsilastir", "hangisi", "versus", "vs"])) {
    addIntentScore(scores, "compare", 45);
    reasons.push("query asks for comparison");
  }
  if (hasAny(query, ["panik", "kork", "endişe", "endise", "normal mi", "sakin"])) {
    addIntentScore(scores, "reassure", 35);
    reasons.push("query asks for reassurance/calm tone");
  }
  if (missingInfoCount > 0 && directFactCount === 0 && supportingFactCount === 0) {
    addIntentScore(scores, "no_source", 90);
    reasons.push("no directly usable evidence was found");
  }
  if (sourceCount === 0) {
    addIntentScore(scores, "clarify", 25);
    reasons.push("no source ids are available");
  }

  const ranked = (Object.entries(scores) as Array<[AnswerIntentSignal, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [primarySignal = weakIntent, primaryScore = 0] = ranked[0] ?? [weakIntent, 0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const mappedIntent = mapIntentSignalToAnswerIntent(primarySignal);
  const intent = mappedIntent === "unknown" && weakIntent !== "unknown" && primarySignal !== "no_source"
    ? weakIntent
    : mappedIntent;
  const confidence =
    primaryScore >= 55 && primaryScore - secondScore >= 15
      ? "high"
      : primaryScore >= 35
        ? "medium"
        : "low";

  return {
    intent,
    primarySignal,
    confidence,
    scores,
    weakIntent,
    reasons: reasons.slice(0, 6),
  };
}

function normalizeTableLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return trimmed;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length === 0 || cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return "";
  return cells.join(" - ");
}

function normalizeDocumentScaffoldFragment(value: string): string {
  const cleaned = value
    .replace(/\bPDF\s+COPY\s*>{2,}\s*/giu, "")
    .replace(/\bOCR\s+HATASI\s*:?\s*/giu, "")
    .replace(/\bTABLO\s*[-:]\s*/giu, "")
    .replace(/\s*-\s*bulgu\s*-\s*yorum\s*/giu, "; ")
    .replace(/^#+\s*Page\s+\d+\s*/giu, "")
    .replace(/^#+\s*XML Text Fallback\s*/giu, "")
    .replace(/^#+\s*word\/[^\s]+\s*/giu, "")
    .replace(/^\s*(?:[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9()[\]\s_-]{8,})\s+\d+\s*[•\-–:]\s*/u, "")
    .replace(/^\s*(?:[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9()[\]\s_-]{8,})\s+\d+\s+/u, "")
    .replace(/^\s*(?:[A-ZÇĞİÖŞÜ0-9()[\]\s_-]{24,}?)\s+(?=(Bu|Bu\s+ilaç|Eğer|Eller|Okul|Öğrenci|Hasta|Veli|Kaynak|Amaç)\b)/u, "")
    .trim();
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  const uppercaseLetters = cleaned.match(/\p{Lu}/gu) ?? [];
  if (letters.length >= 6 && uppercaseLetters.length / letters.length > 0.85 && cleaned.length <= 140) return "";
  return cleaned;
}

function fragmentQualityScore(value: string): number {
  const scoring = getDecisionConfig().evidenceScoring;
  const normalized = value.trim();
  if (!normalized) return -100;
  const tokenCount = normalizeConceptText(normalized).split(/\s+/).filter((token) => token.length >= 3).length;
  const actionBonus = /(göndermeyiniz|göndermeyin|bilgilendir|başvur|kontrol|hazır|sakla|denenmel|planlan|yapılmal|edilmel|olmalıdır|olmalidir)/iu.test(normalized)
    ? scoring.fragmentActionBonus
    : 0;
  const completeBonus = /[.!?]$/u.test(normalized) ? scoring.fragmentCompleteSentenceBonus : 0;
  const incompleteLongPenalty = !/[.!?]$/u.test(normalized) && normalized.length >= 60 ? scoring.fragmentIncompleteLongPenalty : 0;
  const lengthBonus = normalized.length >= 35 && normalized.length <= 260
    ? scoring.fragmentLengthBonus
    : normalized.length < 20
      ? -scoring.fragmentShortLengthPenalty
      : 0;
  const scaffoldPenalty = /(page\s+\d+|rehberi\s+\d+|önemseyiniz|para ile satılamaz)/iu.test(normalized) ? scoring.fragmentScaffoldPenalty : 0;
  const truncationPenalty = /[…]|\.{3}$/u.test(normalized) ? scoring.fragmentTruncationPenalty : 0;
  return tokenCount + actionBonus + completeBonus + lengthBonus - scaffoldPenalty - truncationPenalty - incompleteLongPenalty;
}

function sentenceFragments(text: string, limit = 2): string[] {
  const normalized = text
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+[•]\s+/g, "\n")
    .split(/\n+/)
    .map(normalizeTableLine)
    .map(normalizeDocumentScaffoldFragment)
    .filter(Boolean)
    .join("\n");
  const fragments = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .map(normalizeDocumentScaffoldFragment)
    .filter(Boolean);
  return fragments
    .map((fragment, index) => ({ fragment, index, score: fragmentQualityScore(fragment) }))
    .filter(({ score }) => score > getDecisionConfig().evidenceScoring.fragmentMinScore)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ fragment }) => fragment);
}

function splitNumberedTableRows(text: string): string[] {
  return text
    .replace(/\s+(\d{1,2})\.\s*(?=[\p{L}A-ZÇĞİÖŞÜ])/gu, "\n$1. ")
    .replace(/\s+(\d{1,2})\.\s+(?=[A-ZÇĞİÖŞÜ][\p{L}\s]{2,})/gu, "\n$1. ")
    .split(/\n+/)
    .map(normalizeTableLine)
    .map(normalizeDocumentScaffoldFragment)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasFinancialTableValue(value: string): boolean {
  return /(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+\s*%|%\s*\d+|\(\s*\d)/u.test(value);
}

function isLikelyFinancialTableRow(value: string): boolean {
  const lexicon = getEvidenceLexicon();
  const normalized = normalizeConceptText(value);
  if (!hasFinancialTableValue(value)) return false;
  const hasShareGroupTableRows =
    /(?:^|\s)a\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalized) &&
    /(?:^|\s)b\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalized) &&
    normalizedIncludesAny(normalized, lexicon.cashRateTerms);
  if (hasShareGroupTableRows) return true;
  const hasLineItemLabel =
    /^\s*\d{1,2}\.\s*\p{L}/u.test(value) ||
    normalizedIncludesAny(normalized, [
      ...lexicon.netPeriodTerms,
      ...lexicon.periodProfitTerms,
      ...lexicon.distributableTerms,
      ...lexicon.withholdingTerms,
      "profit",
      "dividend",
    ]);
  if (!hasLineItemLabel) return false;
  return [
    ...lexicon.periodProfitTerms,
    ...lexicon.netPeriodTerms,
    ...lexicon.distributableTerms,
    ...lexicon.spkTerms,
    "yasal kayit",
    "tax",
    "profit",
    "net profit",
    "dividend",
    ...lexicon.withholdingTerms,
    "sermaye",
    "capital",
  ].some((term) => normalized.includes(normalizeConceptText(term)));
}

function financialTableScope(text: string): string {
  const normalized = normalizeConceptText(text);
  const parts: string[] = [];
  if (normalized.includes("spkya gore") || normalized.includes("spk ya gore")) parts.push("SPK'ya Göre");
  if (normalized.includes("yasal kayitlara gore") || normalized.includes("yasal kayitlara yk gore")) {
    parts.push("Yasal Kayıtlara Göre");
  }
  return parts.join(" / ");
}

function numericTableFragments(text: string, query: string, limit = 4): string[] {
  const queryTokens = new Set(tokenizeForOverlap(query).filter((token) => !GENERIC_OVERLAP_TOKENS.has(token)));
  const normalizedQuery = normalizeConceptText(query);
  const scope = financialTableScope(text);
  const rows = splitNumberedTableRows(text);
  return rows
    .map((row, index) => {
      const normalized = normalizeConceptText(row);
      const overlap = queryCoreOverlapScore(queryTokens, row);
      const exactPhraseBonus =
        normalized.includes("net donem") && normalizedQuery.includes("net donem")
          ? 6
          : normalized.includes("donem kari") && normalizedQuery.includes("donem kari")
            ? 6
            : 0;
      const requestedPlainPeriodProfit =
        normalizedQuery.includes("donem kari") && !normalizedQuery.includes("sadece net donem");
      const plainPeriodProfitBonus =
        requestedPlainPeriodProfit && /^\s*\d{1,2}\.\s*dönem\s+k[âa]rı/iu.test(row)
          ? 5
          : 0;
      const unrequestedNetDistributablePenalty =
        normalized.includes("dagitilabilir") && !normalizedQuery.includes("dagitilabilir")
          ? 50
          : 0;
      const score =
        overlap * 3 +
        exactPhraseBonus +
        plainPeriodProfitBonus +
        (isLikelyFinancialTableRow(row) ? 5 : 0) +
        (hasFinancialTableValue(row) ? 2 : 0) -
        (row.length > 420 ? 2 : 0) -
        unrequestedNetDistributablePenalty;
      const scopedRow = scope && isLikelyFinancialTableRow(row) && !normalizeConceptText(row).includes("spkya gore")
        ? `${scope}: ${row}`
        : row;
      return { row: scopedRow, index, score };
    })
    .filter(({ row, score }) => score >= 7 && hasFinancialTableValue(row))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ row }) => row);
}

function firstMatch(value: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return match[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

function firstTableSegment(value: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return match[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

function queryRejectsConcept(normalizedQuery: string, concept: string): boolean {
  const escaped = concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:${escaped}.{0,48}(?:sanma|karistirma|karıştırma|degil|değil|not)|(?:sanma|karistirma|karıştırma|degil|değil|not).{0,48}${escaped})`, "u")
    .test(normalizedQuery);
}

function financeTargetedFragments(text: string, query: string): string[] {
  const normalizedQuery = normalizeConceptText(query);
  const fragments: string[] = [];

  if (
    (normalizedQuery.includes("grup") || normalizedQuery.includes("grub") || normalizedQuery.includes("group")) &&
    (
      normalizedQuery.includes("nakit") ||
      normalizedQuery.includes("cash") ||
      normalizedQuery.includes("bedelsiz") ||
      normalizedQuery.includes("bonus") ||
      normalizedQuery.includes("oran") ||
      normalizedQuery.includes("rate")
    )
  ) {
    const shareGroupRows = firstTableSegment(text, [
      /(?:GRUBU|PAY\s+GRUBU|SHARE\s+GROUP|GROUP)[\s\S]{0,260}(?:NAK\s*[İI]\s*T|NAK[İI]T|CASH)[\s\S]{0,760}(?:TOPLAM|TOTAL)[\s\S]{0,160}/iu,
      /(?:CASH|NAK\s*[İI]\s*T|NAK[İI]T)\s*\(TL\)[\s\S]{0,760}(?:TOPLAM|TOTAL)[\s\S]{0,160}/iu,
      /(?:TOTAL\s+DIVIDEND\s+AMOUNT|TOPLAM\s+DA[ĞG]ITILAN)[\s\S]{0,260}(?:A\s*(?:Grubu)?|A\s+[\d.,]+)[\s\S]{0,520}(?:B\s*(?:Grubu)?|B\s+[\d.,]+)[\s\S]{0,260}(?:TOPLAM|TOTAL)?[\s\S]{0,160}/iu,
    ]);
    if (shareGroupRows) fragments.push(`Pay grubu nakit/oran satırları: ${shareGroupRows}`);
  }

  if (normalizedQuery.includes("net donem") && normalizedQuery.includes("spk")) {
    const value = firstMatch(text, [
      /SPK[\s\S]{0,24}?Göre[\s\S]{0,260}?(?:^|[^\d])5\.\s+[\d.]+(?:,\d+)?/ium,
      /According\s+to\s+CMB[\s\S]{0,260}?(?:^|[^\d])5\.\s+[\d.]+(?:,\d+)?/ium,
      /Capital\s+Markets\s+Board[\s\S]{0,260}?(?:^|[^\d])5\.\s+[\d.]+(?:,\d+)?/ium,
    ]);
    if (value) fragments.push(`SPK'ya Göre: 5. Net Dönem Kârı = ${value.match(/(?:^|[^\d])5\.\s+([\d.]+(?:,\d+)?)/u)?.[1] ?? value}`);
  }

  if (normalizedQuery.includes("stopaj") || normalizedQuery.includes("withholding")) {
    const withholding = firstMatch(text, [
      /(?:stopaj|withholding\s+tax)[\s\S]{0,340}?(?:0\s*%|%\s*0|%0|0,00)[\s\S]{0,340}?(?:5\s*%|%\s*5|%5|5,00)/iu,
      /(?:%|percent|oranı|orani|rate)[\s\S]{0,100}?(?:0|5)[\s\S]{0,260}?(?:%|percent|oranı|orani|rate)[\s\S]{0,100}?(?:0|5)/iu,
      /(?:0\s*%|%\s*0|%0|0,00)[\s\S]{0,320}?(?:5\s*%|%\s*5|%5|5,00)/iu,
      /withholding\s+tax\s+rate[\s\S]{0,260}?(?:0|5)/iu,
      /stopaj\s+oran[ıi][\s\S]{0,260}?(?:0|5)/iu,
    ]);
    if (withholding) fragments.push(`Stopaj oranı: ${withholding}`);
  }

  if (
    normalizedQuery.includes("dagitilmasi ongorulen diger kaynak") ||
    normalizedQuery.includes("other sources") ||
    (
      (normalizedQuery.includes("olaganustu yedek") || normalizedQuery.includes("extraordinary reserves")) &&
      !queryRejectsConcept(normalizedQuery, "olaganustu yedek") &&
      !queryRejectsConcept(normalizedQuery, "extraordinary reserves")
    )
  ) {
    const wantsOnlyOtherSources =
      (normalizedQuery.includes("dagitilmasi ongorulen diger kaynak") || normalizedQuery.includes("other sources")) &&
      (
        queryRejectsConcept(normalizedQuery, "olaganustu yedek") ||
        queryRejectsConcept(normalizedQuery, "extraordinary reserves")
      );
    const otherSources = firstMatch(text, [
      ...(wantsOnlyOtherSources
        ? [
            /Da[ğg]ıtılması\s+Öngörülen\s+Di[ğg]er\s+Kaynaklar\s+[\d.,-]+\s+[\d.,-]+/iu,
            /20\.\s*Other\s+Sources[^\d]{0,80}[\d.,-]+\s+[\d.,-]+/iu,
            /Other\s+sources\s+planned\s+for\s+distribution\s+[\d.,-]+\s+[\d.,-]+/iu,
          ]
        : []),
      /20\.\s*Da[ğg]ıtılması\s+Öngörülen\s+Di[ğg]er\s+Kaynaklar[\s\S]{0,360}?Ola[ğg]an[üu]st[üu]\s+Yedekler[\s\S]{0,160}?[\d.]+(?:,\d+)?/iu,
      /20\.\s*Da[ğg]ıtılması\s+Öngörülen\s+Di[ğg]er\s+Kaynaklar[\s\S]{0,260}?[\d.]+(?:,\d+)?[\s\S]{0,100}?[\d.]+(?:,\d+)?/iu,
      /20\.\s*Other\s+Sources[\s\S]{0,360}?Extraordinary\s+Reserves[\s\S]{0,160}?[\d.]+(?:,\d+)?/iu,
      /20\.\s*Other\s+Sources[\s\S]{0,260}?[\d.]+(?:,\d+)?[\s\S]{0,100}?[\d.]+(?:,\d+)?/iu,
    ]);
    if (otherSources) fragments.push(otherSources);
  }

  return unique(fragments).slice(0, 4);
}

function evidenceRelevanceScore(query: string, fact: string): number {
  const scoring = getDecisionConfig().evidenceScoring;
  const lexicon = getEvidenceLexicon();
  const normalizedQuery = normalizeConceptText(query);
  const normalizedFact = normalizeConceptText(fact);
  const queryTokens = new Set(tokenizeForOverlap(query).filter((token) => !GENERIC_OVERLAP_TOKENS.has(token)));
  const coreOverlap = queryCoreOverlapScore(queryTokens, fact);
  const titleEvidenceBonus =
    asksForSourceTitleEvidence(query) && normalizedFact.includes("kaynak basligi")
      ? scoring.sourceTitleBonus
      : 0;
  const languageEvidenceBonus =
    asksForSourceTitleEvidence(query) &&
    ((normalizedQuery.includes("turkce") && normalizedFact.includes("turkce")) ||
      (normalizedQuery.includes("ingilizce") && normalizedFact.includes("ingilizce")))
      ? scoring.languageEvidenceBonus
      : 0;
  const tableValueBonus = hasFinancialTableValue(fact) ? scoring.tableValueBonus : 0;
  const tableRowBonus = isLikelyFinancialTableRow(fact) ? scoring.tableRowBonus : 0;
  const exactPhraseBonus =
    normalizedIncludesAny(normalizedQuery, lexicon.netPeriodTerms) && normalizedIncludesAny(normalizedFact, lexicon.netPeriodTerms)
      ? scoring.exactNetPeriodBonus
      : normalizedIncludesAny(normalizedQuery, lexicon.periodProfitTerms) && normalizedIncludesAny(normalizedFact, lexicon.periodProfitTerms)
        ? scoring.exactPeriodProfitBonus
        : 0;
  const requestedPlainPeriodProfit =
    normalizedIncludesAny(normalizedQuery, lexicon.periodProfitTerms) &&
    !normalizedQuery.includes(`sadece ${lexicon.netPeriodTerms[0] ?? "net donem"}`);
  const plainPeriodProfitBonus =
    requestedPlainPeriodProfit && /(?:^|:\s*)\d{1,2}\.\s*dönem\s+k[âa]rı/iu.test(fact)
      ? scoring.plainPeriodProfitBonus
      : 0;
  const shortRelevantBonus = fact.length <= 360 ? scoring.shortRelevantBonus : 0;
  const spkScopeBonus =
    normalizedIncludesAny(normalizedQuery, lexicon.spkTerms) && normalizedFact.includes("spk")
      ? scoring.spkScopeBonus
      : normalizedIncludesAny(normalizedQuery, lexicon.spkTerms) && normalizedFact.includes("capital markets board")
        ? scoring.spkEnglishScopeBonus
        : 0;
  const stopajScopeBonus =
    normalizedIncludesAny(normalizedQuery, lexicon.withholdingTerms) &&
    normalizedIncludesAny(normalizedFact, lexicon.withholdingTerms)
      ? scoring.stopajScopeBonus
      : 0;
  const stopajGroupRateBonus =
    normalizedIncludesAny(normalizedQuery, lexicon.withholdingTerms) &&
    (normalizedQuery.includes("b") || normalizedQuery.includes("c") || normalizedIncludesAny(normalizedQuery, lexicon.shareGroupTerms)) &&
    normalizedIncludesAny(normalizedFact, lexicon.withholdingTerms) &&
    (normalizedFact.includes("b") || normalizedFact.includes("group b") || normalizedFact.includes("b grubu")) &&
    (normalizedFact.includes("c") || normalizedFact.includes("group c") || normalizedFact.includes("c grubu")) &&
    /(?:%?\s*0|0\s*%|0,00)/u.test(normalizedFact) &&
    /(?:%?\s*5|5\s*%|5,00)/u.test(normalizedFact)
      ? scoring.stopajGroupRateBonus
      : 0;
  const otherSourcesScopeBonus =
    normalizedIncludesAny(normalizedQuery, lexicon.otherSourcesTerms) &&
    normalizedIncludesAny(normalizedFact, lexicon.otherSourcesTerms)
      ? scoring.otherSourcesScopeBonus
      : 0;
  const shareGroupScopeBonus =
    normalizedIncludesAny(normalizedQuery, lexicon.shareGroupTerms) &&
    normalizedIncludesAny(normalizedFact, lexicon.shareGroupTerms) &&
    normalizedIncludesAny(normalizedFact, lexicon.cashRateTerms)
      ? scoring.shareGroupScopeBonus
      : 0;
  const shareGroupDenseTableBonus =
    normalizedIncludesAny(normalizedQuery, lexicon.shareGroupTerms) &&
    normalizedIncludesAny(normalizedQuery, lexicon.cashRateTerms) &&
    /(?:^|\s)a\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalizedFact) &&
    /(?:^|\s)b\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalizedFact)
      ? scoring.shareGroupDenseTableBonus
      : 0;
  const rejectedExtraordinaryReservePenalty =
    (queryRejectsConcept(normalizedQuery, "olaganustu yedek") || queryRejectsConcept(normalizedQuery, "extraordinary reserves")) &&
    (normalizedFact.includes("olaganustu yedek") || normalizedFact.includes("extraordinary reserves"))
      ? scoring.rejectedExtraordinaryReservePenalty
      : 0;
  const unrequestedNetDistributablePenalty =
    normalizedIncludesAny(normalizedFact, lexicon.distributableTerms) &&
    !normalizedIncludesAny(normalizedQuery, lexicon.distributableTerms) &&
    shareGroupScopeBonus === 0 &&
    stopajGroupRateBonus === 0 &&
    otherSourcesScopeBonus === 0 &&
    shareGroupDenseTableBonus === 0
      ? scoring.unrequestedNetDistributablePenalty
      : 0;
  const headerPenalty =
    /spk'?ya\s+gore\s+yasal\s+kayitlara\s+gore/u.test(normalizedFact) && !/^\s*[^:]+:\s*\d{1,2}\./u.test(fact)
      ? scoring.headerPenalty
      : 0;
  return coreOverlap * scoring.coreOverlapWeight +
    tableValueBonus +
    tableRowBonus +
    exactPhraseBonus +
    plainPeriodProfitBonus +
    titleEvidenceBonus +
    languageEvidenceBonus +
    spkScopeBonus +
    stopajScopeBonus +
    stopajGroupRateBonus +
    otherSourcesScopeBonus +
    shareGroupScopeBonus +
    shareGroupDenseTableBonus +
    shortRelevantBonus -
    headerPenalty -
    rejectedExtraordinaryReservePenalty -
    unrequestedNetDistributablePenalty;
}

function addQueryLanguageAlias(query: string, fragment: string): string {
  const normalizedQuery = normalizeConceptText(query);
  const normalizedFragment = normalizeConceptText(fragment);
  if (
    normalizedQuery.includes("stopaj") &&
    normalizedFragment.includes("withholding") &&
    !normalizedFragment.includes("stopaj")
  ) {
    return `Stopaj oranı / withholding tax rate: ${fragment}`;
  }
  if (
    normalizedQuery.includes("spk") &&
    normalizedFragment.includes("capital markets board") &&
    !normalizedFragment.includes("spk")
  ) {
    return `SPK / Capital Markets Board: ${fragment}`;
  }
  return fragment;
}

function rankEvidenceFacts(query: string, facts: string[]): string[] {
  return unique(facts)
    .map((fact, index) => ({ fact, index, score: evidenceRelevanceScore(query, fact) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ fact }) => fact);
}

function promoteCriticalDirectFacts(query: string, directFacts: string[], usableFacts: string[]): string[] {
  const normalizedQuery = normalizeConceptText(query);
  const promoted: string[] = [];
  if (normalizedQuery.includes("stopaj") || normalizedQuery.includes("withholding")) {
    promoted.push(
      ...usableFacts.filter((fact) => {
        const normalizedFact = normalizeConceptText(fact);
        return (
          (normalizedFact.includes("stopaj") || normalizedFact.includes("withholding")) &&
          (
            /(?:^|\s)0(?:\s|$)|0,00|%0/u.test(normalizedFact) ||
            normalizedFact.includes("group b") ||
            normalizedFact.includes("b grubu")
          )
        );
      }),
    );
  }
  if (
    (normalizedQuery.includes("grubu") || normalizedQuery.includes("group")) &&
    (normalizedQuery.includes("nakit") ||
      normalizedQuery.includes("cash") ||
      normalizedQuery.includes("bedelsiz") ||
      normalizedQuery.includes("bonus") ||
      normalizedQuery.includes("oran") ||
      normalizedQuery.includes("rate"))
  ) {
    promoted.push(
      ...usableFacts.filter((fact) => {
        const normalizedFact = normalizeConceptText(fact);
        return (
          /(?:^|\s)a\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalizedFact) &&
          /(?:^|\s)b\s+[\d.,-]+\s+[-\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+/u.test(normalizedFact) &&
          (normalizedFact.includes("cash") ||
            normalizedFact.includes("nakit") ||
            normalizedFact.includes("bonus") ||
            normalizedFact.includes("bedelsiz") ||
            normalizedFact.includes("rate") ||
            normalizedFact.includes("oran"))
        );
      }),
    );
  }
  return unique([...promoted, ...directFacts]);
}

function asksForSourceTitleEvidence(query: string): boolean {
  const normalized = normalizeConceptText(query);
  const asksForTableDetails =
    normalized.includes("grubu") ||
    normalized.includes("group") ||
    normalized.includes("nakit") ||
    normalized.includes("cash") ||
    normalized.includes("bonus") ||
    normalized.includes("bedelsiz") ||
    normalized.includes("oran") ||
    normalized.includes("rate");
  return (
    (normalized.includes("kaynak") && normalized.includes("baslik")) ||
    normalized.includes("bildirim indeksi") ||
    normalized.includes("ayni bildirim") ||
    (normalized.includes("turkce") && normalized.includes("ingilizce") && !asksForTableDetails)
  );
}

function sourceTitleLanguageLabel(title: string): "Türkçe" | "İngilizce" | "Belirsiz" {
  const normalized = normalizeConceptText(title);
  if (/(profit distribution|dividend distribution|withholding|board|table)/u.test(normalized)) return "İngilizce";
  if (/(kar payi|kâr payi|dagitim|dağıtım|islemlerine|işlemlerine|bildirim)/u.test(normalized)) return "Türkçe";
  return "Belirsiz";
}

function buildSourceTitleEvidence(title: string): string | null {
  const clean = title.trim();
  if (!clean) return null;
  const language = sourceTitleLanguageLabel(clean);
  return `${language} kaynak başlığı: ${clean}`;
}

function tokenizeForOverlap(text: string): string[] {
  const normalized = normalizeConceptText(text);
  return [
    ...expandConceptTerms(normalized),
    ...normalized
    .split(/[^\p{L}\p{N}-]+/u)
    .map((part) => part.trim())
    .map((part) => {
      const canonical: Record<string, string> = {
        agrim: "agri",
        agrisi: "agri",
        karnim: "karin",
        kasigim: "kasik",
        okulda: "okul",
        destegi: "destek",
        adimlari: "adim",
        konusmaliyim: "konus",
      };
      const direct = canonical[part] ?? part;
      if (direct.startsWith("depozito")) return "depozito";
      if (direct.startsWith("protokol")) return "protokol";
      if (direct.startsWith("belge")) return "belge";
      if (direct.startsWith("dekont")) return "belge";
      if (direct.startsWith("sozlesme")) return "sozlesme";
      if (direct.startsWith("bosanma")) return "bosanma";
      if (direct.startsWith("anlasma")) return "anlasma";
      if (direct.startsWith("baslik")) return "baslik";
      if (direct.startsWith("netlestir")) return "netlestir";
      if (direct.startsWith("velayet")) return "velayet";
      if (direct.startsWith("nafaka")) return "nafaka";
      if (direct.startsWith("kayit")) return "kayit";
      if (direct.startsWith("basvuru")) return "basvuru";
      if (direct.startsWith("migration")) return "migration";
      if (direct.startsWith("rollback")) return "rollback";
      return direct;
    })
    .filter((part) => part.length >= 3),
  ];
}

function queryOverlapScore(queryTokens: Set<string>, text: string): number {
  return tokenizeForOverlap(text).filter((token) => queryTokens.has(token)).length;
}

const GENERIC_OVERLAP_TOKENS = new Set([
  "agri",
  "agriyor",
  "belirti",
  "durum",
  "genel",
  "kontrol",
  "sikayet",
  "sorun",
  "takip",
  "uzman",
]);

function queryCoreOverlapScore(queryTokens: Set<string>, text: string): number {
  return tokenizeForOverlap(text).filter((token) => queryTokens.has(token) && !GENERIC_OVERLAP_TOKENS.has(token)).length;
}

function hasStrongQueryOverlap(queryTokens: Set<string>, text: string): boolean {
  return queryOverlapScore(queryTokens, text) >= 2;
}

function hasOffQuerySymptom(query: string, text: string): boolean {
  const symptomGroups = [
    ["kanama", "lekelenme"],
    ["akıntı", "akinti", "koku", "kaşıntı", "kasinti"],
    ["gebelik", "hamile"],
    ["kist", "yumurtalık", "yumurtalik"],
    ["ateş", "ates", "kusma", "bayılma", "bayilma"],
  ];
  const normalizedQuery = query.toLocaleLowerCase("tr-TR");
  const normalizedText = text.toLocaleLowerCase("tr-TR");
  return symptomGroups.some((group) => {
    const textHasGroup = group.some((term) => normalizedText.includes(term));
    if (!textHasGroup) return false;
    return !group.some((term) => normalizedQuery.includes(term));
  });
}

function removeOffQuerySymptomPhrases(query: string, text: string): string {
  const normalizedQuery = query.toLocaleLowerCase("tr-TR");
  let next = text;
  if (!["kanama", "lekelenme"].some((term) => normalizedQuery.includes(term))) {
    next = next
      .replace(/\s+veya\s+kanama(?:\s+nedenini|\s+nedeni|\s+yakınması)?/giu, "")
      .replace(/\s+ya da\s+kanama(?:\s+nedenini|\s+nedeni|\s+yakınması)?/giu, "")
      .replace(/,\s*kanama\/lekelenme eşlik edebiliyor\.?/giu, ".")
      .replace(/\s*kanama\/lekelenme eşlik edebiliyor\.?/giu, "")
      .replace(/\s+veya\s+lekelenme/giu, "");
  }
  if (!["akıntı", "akinti", "koku", "kaşıntı", "kasinti"].some((term) => normalizedQuery.includes(term))) {
    next = next
      .replace(/,\s*akıntı tarif ediyor\.?/giu, ".")
      .replace(/\s*akıntı tarif ediyor\.?/giu, "");
  }
  return next.replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
}

function evidenceLine(prefix: string, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? `${prefix}: ${trimmed}` : "";
}

function compactEvidenceLine(line: string, maxChars = 320): string {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const clipped = normalized.slice(0, maxChars).trim();
  const lastPunctuation = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!"),
    clipped.lastIndexOf("?"),
  );
  if (lastPunctuation >= 80) return clipped.slice(0, lastPunctuation + 1).trim();
  const lastSeparator = Math.max(clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
  if (lastSeparator >= 80) return clipped.slice(0, lastSeparator).trim();
  return clipped.replace(/\s+\S*$/, "").trim();
}

const NEGATION_PATTERNS = [
  /\bgerek(?:li|ir)\s+degildir\b/u,
  /\bgerek(?:li|ir)\s+değildir\b/u,
  /\bgerek(?:li|ir)\s+degil\b/u,
  /\bgerek(?:li|ir)\s+değil\b/u,
  /\bgerek\s+olmadigini\b/u,
  /\bgerek\s+olmadığını\b/u,
  /\bgerek\s+yok\b/u,
  /\byapilma(?:z|mali)\b/u,
  /\byapılma(?:z|malı)\b/u,
  /\bonerilme(?:z|meli)\b/u,
  /\bönerilme(?:z|meli)\b/u,
  /\bzorunlu\s+degil\b/u,
  /\bzorunlu\s+değil\b/u,
  /\bkontrendike\b/u,
  /\bkullanma\b/u,
  /\bkullanilmamali\b/u,
  /\bkullanılmamalı\b/u,
];

const AFFIRMATION_PATTERNS = [
  /\bgerek(?:li|ir)\b/u,
  /\byapilmali\b/u,
  /\byapılmalı\b/u,
  /\bonerilir\b/u,
  /\bönerilir\b/u,
  /\bzorunlu\b/u,
  /\bkullanilmali\b/u,
  /\bkullanılmalı\b/u,
  /\bkontrol\s+edilmeli\b/u,
];

function evidencePolarity(value: string): "negative" | "positive" | "neutral" {
  const text = normalizeConceptText(value);
  if (NEGATION_PATTERNS.some((pattern) => pattern.test(text))) return "negative";
  if (AFFIRMATION_PATTERNS.some((pattern) => pattern.test(text))) return "positive";
  return "neutral";
}

function evidenceSubjectKey(value: string): string {
  const withoutSourceLabel = value.includes(":") ? value.slice(value.indexOf(":") + 1) : value;
  const generic = new Set([
    "kaynak",
    "source",
    "gerekli",
    "gerekir",
    "degil",
    "değil",
    "yapilmali",
    "yapılmalı",
    "onerilir",
    "önerilir",
    "kontrol",
    "edilmeli",
    "kisa",
    "sakin",
  ]);
  const tokens = tokenizeForOverlap(withoutSourceLabel)
    .filter((token) => !GENERIC_OVERLAP_TOKENS.has(token))
    .filter((token) => !generic.has(token))
  const hasMigration = tokens.some((token) => token.startsWith("migration"));
  const technicalSafetyTerms = ["migration", "yedek", "backup", "rollback", "staging", "log"]
    .filter((term) => tokens.some((token) => token.startsWith(term)));
  if (hasMigration && technicalSafetyTerms.length > 0) {
    return unique(technicalSafetyTerms).slice(0, 5).join(" ");
  }
  return tokens.slice(0, 5).join(" ");
}

function hasContradictionMarker(value: string): boolean {
  const normalized = normalizeConceptText(value);
  return [
    "celisir",
    "celiski",
    "çelişir",
    "çelişki",
    "farkli yonlendirme",
    "farklı yönlendirme",
    "guvenilmez",
    "güvenilmez",
  ].some((term) => normalized.includes(normalizeConceptText(term)));
}

function hasSourceScopeExclusion(value: string): boolean {
  const normalized = normalizeConceptText(value);
  return [
    "kaynak degildir",
    "kaynak değildir",
    "dogrudan kaynak degildir",
    "doğrudan kaynak değildir",
    "icin kaynak degildir",
    "için kaynak değildir",
    "konular icin kaynak degildir",
    "konular için kaynak değildir",
    "hakkinda kesin yonlendirme yapma",
    "hakkında kesin yönlendirme yapma",
  ].some((term) => normalized.includes(normalizeConceptText(term)));
}

function findContradictoryEvidence(facts: string[]): { conflicts: string[]; conflictedFacts: Set<string> } {
  const bySubject = new Map<string, { positive: string[]; negative: string[] }>();
  const migrationSafety = { positive: [] as string[], negative: [] as string[] };
  for (const fact of facts) {
    const polarity = evidencePolarity(fact);
    if (polarity === "neutral") continue;
    const subject = evidenceSubjectKey(fact);
    if (!subject) continue;
    const bucket = bySubject.get(subject) ?? { positive: [], negative: [] };
    bucket[polarity].push(fact);
    bySubject.set(subject, bucket);
    if (subject.includes("migration") && (subject.includes("yedek") || subject.includes("backup") || subject.includes("rollback"))) {
      migrationSafety[polarity].push(fact);
    }
  }
  const conflicts: string[] = [];
  const conflictedFacts = new Set<string>();
  for (const [subject, bucket] of bySubject.entries()) {
    if (bucket.positive.length === 0 || bucket.negative.length === 0) continue;
    for (const fact of [...bucket.positive, ...bucket.negative]) conflictedFacts.add(fact);
    conflicts.push(`Çelişen kaynak bilgisi: ${subject} için kaynaklar farklı yönlendirme veriyor.`);
  }
  if (migrationSafety.positive.length > 0 && migrationSafety.negative.length > 0) {
    for (const fact of [...migrationSafety.positive, ...migrationSafety.negative]) conflictedFacts.add(fact);
    conflicts.push("Çelişen kaynak bilgisi: migration yedek/rollback güvenliği için kaynaklar farklı yönlendirme veriyor.");
  }
  return { conflicts: unique(conflicts).slice(0, 3), conflictedFacts };
}

type EvidenceSectionKind = "direct" | "supporting" | "risk" | "limit";

interface EvidenceSection {
  kind: EvidenceSectionKind;
  text: string;
}

const SECTION_LABELS: Record<EvidenceSectionKind, string[]> = {
  direct: [
    "Source Summary",
    "Key Takeaway",
    "Clinical Takeaway",
    "Patient Summary",
    "Temel Bilgi",
    "Özet",
    "Ozet",
    "Bulgular",
    "Finding",
    "Findings",
    "Claim",
    "Context",
    "Kullanılabilir Bilgiler",
    "Kullanilabilir Bilgiler",
    "Gerçekler",
    "Gercekler",
  ],
  supporting: [
    "Safe Guidance",
    "Guidance",
    "Recommendation",
    "Recommended Action",
    "Ne Yapmalı",
    "Ne Yapmali",
    "Öneri",
    "Oneri",
    "Steps",
    "Checklist",
    "Procedure",
    "Runbook",
  ],
  risk: [
    "Red Flags",
    "Risk",
    "Risks",
    "Warning",
    "Warnings",
    "Uyarı Bulguları",
    "Uyari Bulgulari",
    "Uyarılar",
    "Uyarilar",
    "Alarm",
    "Dikkat",
    "Dikkat Edilecekler",
  ],
  limit: [
    "Do Not Infer",
    "Limitations",
    "Limits",
    "Not Supported",
    "Belirsiz",
    "Kullanılamayan",
    "Kullanilamayan",
    "Çıkarım Yapma",
    "Cikarim Yapma",
    "Uydurma",
  ],
};

const ALL_SECTION_LABELS = Object.values(SECTION_LABELS).flat();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionKindForLabel(label: string): EvidenceSectionKind | null {
  const normalized = label.toLocaleLowerCase("tr-TR");
  for (const [kind, labels] of Object.entries(SECTION_LABELS) as Array<[EvidenceSectionKind, string[]]>) {
    if (labels.some((item) => item.toLocaleLowerCase("tr-TR") === normalized)) return kind;
  }
  return null;
}

function extractSectionBlock(content: string, label: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const labelPattern = escapeRegExp(label);
  const startMatch = normalized.match(new RegExp(`(^|\\n)\\s*(?:#{1,6}\\s*)?${labelPattern}\\s*:?[ \\t]*`, "i"));
  if (!startMatch || typeof startMatch.index !== "number") return "";
  const start = startMatch.index + startMatch[0].length;
  const afterStart = normalized.slice(start);
  let endIndex = afterStart.length;
  for (const otherLabel of ALL_SECTION_LABELS) {
    const otherPattern = escapeRegExp(otherLabel);
    const match = afterStart.match(new RegExp(`\\n\\s*(?:#{1,6}\\s*)?${otherPattern}\\s*:?[ \\t]*`, "i"));
    if (match && typeof match.index === "number") {
      endIndex = Math.min(endIndex, match.index);
    }
  }
  return afterStart.slice(0, endIndex).trim();
}

function extractRawEvidenceSections(content: string | undefined): EvidenceSection[] {
  if (!content?.trim()) return [];
  const sections: EvidenceSection[] = [];
  for (const label of ALL_SECTION_LABELS) {
    const kind = sectionKindForLabel(label);
    if (!kind) continue;
    const text = extractSectionBlock(content, label);
    if (text) sections.push({ kind, text });
  }
  return sections;
}

function cardSections(card: EvidenceExtractorCardInput): EvidenceSection[] {
  const explicitSections: EvidenceSection[] = [
    { kind: "direct", text: card.patientSummary ?? "" },
    { kind: "direct", text: card.clinicalTakeaway ?? "" },
    { kind: "supporting", text: card.safeGuidance ?? "" },
    { kind: "risk", text: card.redFlags ?? "" },
    { kind: "limit", text: card.doNotInfer ?? "" },
  ];
  return [...explicitSections, ...extractRawEvidenceSections(card.rawContent)].filter((section) => section.text.trim());
}

function cardHasQueryScopedExclusion(card: EvidenceExtractorCardInput, queryTokens: Set<string>): boolean {
  return cardSections(card).some((section) =>
    sentenceFragments(section.text, section.text.includes("|") ? 6 : 3).some((fragment) => {
      if (!hasSourceScopeExclusion(fragment)) return false;
      return queryCoreOverlapScore(queryTokens, fragment) > 0 || queryOverlapScore(queryTokens, fragment) >= 2;
    }),
  );
}

export function buildDeterministicQueryPlan(input: QueryPlannerInput): QueryPlannerOutput {
  const userQuery = input.userQuery.trim();
  const routePlan = routeQuery(userQuery);
  const searchQueries = [userQuery];
  const mustIncludeTerms: string[] = [...routePlan.mustIncludeTerms];
  const mustExcludeTerms: string[] = [...routePlan.mustExcludeTerms];
  let expectedEvidenceType: QueryPlannerOutput["expectedEvidenceType"] = "unknown";

  if (hasAny(userQuery, ["karn", "karın", "karin", "mide", "göbek", "gobek"])) {
    expectedEvidenceType = "symptom_card";
    searchQueries.push(
      "karın ağrısı genel triyaj",
      "karın ağrısı ateş kusma kanama acil belirtiler",
      "kasık ağrısı alt karın ağrısı kadın doğum",
    );
    mustIncludeTerms.push("karın", "ağrı", "ateş", "kusma", "kanama", "acil");
  }

  if (hasAny(userQuery, ["kasık", "kasik", "pelvik", "alt karın", "alt karin"])) {
    expectedEvidenceType = "symptom_card";
    searchQueries.push(
      "kasık ağrısı genel triyaj",
      "pelvik ağrı kadın doğum acil belirtiler",
      "kasık ağrısı ateş kanama akıntı gebelik şüphesi",
    );
    mustIncludeTerms.push("kasık", "pelvik", "ağrı", "kanama", "akıntı", "gebelik");
  }

  if (hasAny(userQuery, ["kanama", "lekelenme", "adet dışı", "adet disi", "menopoz"])) {
    expectedEvidenceType = "symptom_card";
    searchQueries.push(
      "anormal vajinal kanama triyaj",
      "adet dışı kanama lekelenme kadın doğum",
      "menopoz sonrası kanama değerlendirme",
    );
    mustIncludeTerms.push("kanama", "lekelenme", "adet", "menopoz");
  }

  if (hasAny(userQuery, ["akıntı", "akinti", "koku", "kaşıntı", "kasinti", "yanma"])) {
    expectedEvidenceType = "symptom_card";
    searchQueries.push(
      "vajinal akıntı triyaj",
      "akıntı kötü koku kaşıntı kasık ağrısı",
      "vajinal akıntı ateş kanama acil belirtiler",
    );
    mustIncludeTerms.push("akıntı", "koku", "kaşıntı", "yanma", "ağrı");
  }

  if (hasAny(userQuery, ["hukuk", "dava", "avukat", "sözleşme", "sozlesme", "kira", "tüketici", "tuketici", "ayıplı", "ayipli", "bozuk ürün", "bozuk urun", "fatura", "satıcı", "satici", "iade", "trafik cezası", "itiraz"])) {
    expectedEvidenceType = "guideline";
    searchQueries.push(
      `${userQuery} hukuki bilgi`,
      `${userQuery} süre belge başvuru`,
      `${userQuery} avukat yetkili kurum`,
    );
    mustIncludeTerms.push("hukuk", "süre", "belge", "başvuru", "avukat", "sözleşme", "fatura", "iade");
  }

  if (hasAny(userQuery, ["yatırım", "yatirim", "hisse", "borsa", "kripto", "faiz", "kredi", "portföy", "portfoy", "finans"])) {
    expectedEvidenceType = "guideline";
    searchQueries.push(
      `${userQuery} risk vade maliyet`,
      `${userQuery} yatırım danışmanı çeşitlendirme`,
      `${userQuery} getiri garantisi risk`,
    );
    mustIncludeTerms.push("yatırım", "risk", "vade", "maliyet", "danışman", "garanti");
  }

  if (hasAny(userQuery, ["migration", "veritabanı", "veritabani", "deploy", "rollback", "staging", "sunucu", "log", "yedek"])) {
    expectedEvidenceType = "guideline";
    searchQueries.push(
      `${userQuery} yedek rollback staging`,
      `${userQuery} log kontrol riskli işlem`,
      `${userQuery} üretim ortamı güvenli migration`,
    );
    mustIncludeTerms.push("migration", "yedek", "rollback", "staging", "log", "üretim");
  }

  if (hasAny(userQuery, ["smear", "hpv", "biyopsi", "patoloji", "kist", "yumurtalık", "yumurtalik"])) {
    expectedEvidenceType = "user_record";
    searchQueries.push(`${userQuery} kadın hastalıkları takip`, `${userQuery} güvenli değerlendirme`);
  }

  if (hasAny(userQuery, ["biyopsi", "parça", "parca"])) {
    expectedEvidenceType = "user_record";
    searchQueries.push(
      "biyopsi temiz sonuç takip",
      "rahimden parça alındı temiz çıktı kanama",
      "biyopsi sonrası lekelenme kontrol",
    );
    mustIncludeTerms.push("biyopsi", "parça", "temiz", "kanama", "lekelenme", "kontrol");
  }

  if (hasAny(userQuery, ["asc-us", "ascus", "asc us"])) {
    expectedEvidenceType = "user_record";
    searchQueries.push(
      "ASC-US smear sonucu takip",
      "ASC-US kanser anlamına gelir mi",
      "ASC-US HPV kontrol değerlendirme",
    );
    mustIncludeTerms.push("ASC-US", "smear", "takip", "kontrol", "kanser");
  }

  searchQueries.push(...routePlan.retrievalHints);
  const plannedQueries = unique(searchQueries).slice(0, 7);
  const includeTerms = unique(mustIncludeTerms).slice(0, 10);

  return {
    routePlan,
    searchQueries: plannedQueries,
    mustIncludeTerms: includeTerms,
    mustExcludeTerms: unique(mustExcludeTerms),
    expectedEvidenceType,
    retrievalQuery: unique([...plannedQueries, ...includeTerms]).join("\n"),
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

export function buildDeterministicEvidenceExtraction(
  input: EvidenceExtractorInput,
): EvidenceExtractorOutput {
  const budget = getEvidenceExtractorBudget();
  const usableFacts: string[] = [];
  const directAnswerFacts: string[] = [];
  const supportingContext: string[] = [];
  const uncertainOrUnusable: string[] = [];
  const redFlags: string[] = [];
  const sourceIds: string[] = [];
  const queryTokens = new Set(tokenizeForOverlap(input.userQuery));
  const weakIntent = inferAnswerIntent(input.userQuery);

  const addUsableIfRelevant = (sourceLabel: string, fragment: string, opts: { allowGenericGuidance?: boolean; kind?: "direct" | "supporting"; force?: boolean } = {}) => {
    const sanitized = removeOffQuerySymptomPhrases(input.userQuery, addQueryLanguageAlias(input.userQuery, fragment));
    if (!sanitized.trim()) return;
    if (hasContradictionMarker(sanitized) || hasSourceScopeExclusion(sanitized)) {
      uncertainOrUnusable.push(compactEvidenceLine(evidenceLine(sourceLabel, sanitized)));
      return;
    }
    const overlap = queryOverlapScore(queryTokens, sanitized);
    const coreOverlap = queryCoreOverlapScore(queryTokens, sanitized);
    const strongOverlap = hasStrongQueryOverlap(queryTokens, sanitized);
    const offQuerySymptom = hasOffQuerySymptom(input.userQuery, sanitized);
    if (offQuerySymptom && !opts.allowGenericGuidance) return;
    const acceptDirect = opts.kind !== "supporting" && (opts.force || strongOverlap || coreOverlap > 0 || (weakIntent === "explain" && overlap > 0));
    const acceptSupporting =
      opts.kind === "supporting" &&
      (opts.force || strongOverlap || coreOverlap > 0 || (opts.allowGenericGuidance && overlap > 0));
    if (acceptDirect || acceptSupporting) {
      const line = compactEvidenceLine(evidenceLine(sourceLabel, sanitized), isLikelyFinancialTableRow(sanitized) ? 520 : 320);
      usableFacts.push(line);
      if (opts.kind === "supporting") {
        supportingContext.push(line);
      } else {
        directAnswerFacts.push(line);
      }
    }
  };

  for (const card of input.cards) {
    const sourceLabel = card.title || card.sourceId;
    if (cardHasQueryScopedExclusion(card, queryTokens)) {
      uncertainOrUnusable.push(
        compactEvidenceLine(evidenceLine(sourceLabel, "Kaynak kendi kapsamına göre bu soruya doğrudan dayanak olmadığını belirtiyor.")),
      );
      continue;
    }
    sourceIds.push(card.sourceId);
    if (asksForSourceTitleEvidence(input.userQuery)) {
      const titleEvidence = buildSourceTitleEvidence(sourceLabel);
      if (titleEvidence) {
        const line = compactEvidenceLine(evidenceLine(sourceLabel, titleEvidence), 520);
        usableFacts.push(line);
        directAnswerFacts.push(line);
      }
    }

    for (const section of cardSections(card)) {
      if (section.kind === "direct" || section.kind === "supporting") {
        for (const fragment of financeTargetedFragments(section.text, input.userQuery)) {
          addUsableIfRelevant(sourceLabel, fragment, {
            allowGenericGuidance: true,
            kind: section.kind === "supporting" ? "supporting" : "direct",
            force: true,
          });
        }
        for (const fragment of numericTableFragments(section.text, input.userQuery, 4)) {
          addUsableIfRelevant(sourceLabel, fragment, {
            allowGenericGuidance: true,
            kind: section.kind === "supporting" ? "supporting" : "direct",
          });
        }
      }
      const fragmentLimit = section.text.includes("|") ? 6 : 2;
      for (const fragment of sentenceFragments(section.text, fragmentLimit)) {
        if (section.kind === "direct") {
          addUsableIfRelevant(sourceLabel, fragment, { allowGenericGuidance: !hasOffQuerySymptom(input.userQuery, fragment) });
        } else if (section.kind === "supporting") {
          addUsableIfRelevant(sourceLabel, fragment, {
            allowGenericGuidance: !hasOffQuerySymptom(input.userQuery, fragment),
            kind: "supporting",
          });
        } else if (section.kind === "risk") {
          const sanitized = removeOffQuerySymptomPhrases(input.userQuery, fragment);
          if (hasSourceScopeExclusion(sanitized)) {
            uncertainOrUnusable.push(compactEvidenceLine(evidenceLine(sourceLabel, sanitized)));
            continue;
          }
          const overlap = queryOverlapScore(queryTokens, sanitized);
          if (sanitized && (overlap > 0 || !hasOffQuerySymptom(input.userQuery, sanitized))) {
            redFlags.push(compactEvidenceLine(evidenceLine(sourceLabel, sanitized)));
          }
        } else {
          uncertainOrUnusable.push(compactEvidenceLine(evidenceLine(sourceLabel, fragment)));
        }
      }
    }
  }

  const missingInfo =
    usableFacts.length === 0
      ? ["Soruya doğrudan dayanak sağlayan yeterli kaynak cümlesi bulunamadı."]
      : [];
  const contradiction = findContradictoryEvidence(unique([...directAnswerFacts, ...supportingContext]));
  if (contradiction.conflicts.length > 0) {
    for (let index = directAnswerFacts.length - 1; index >= 0; index -= 1) {
      if (contradiction.conflictedFacts.has(directAnswerFacts[index] ?? "")) directAnswerFacts.splice(index, 1);
    }
    for (let index = supportingContext.length - 1; index >= 0; index -= 1) {
      if (contradiction.conflictedFacts.has(supportingContext[index] ?? "")) supportingContext.splice(index, 1);
    }
    for (let index = usableFacts.length - 1; index >= 0; index -= 1) {
      if (contradiction.conflictedFacts.has(usableFacts[index] ?? "")) usableFacts.splice(index, 1);
    }
    uncertainOrUnusable.push(...contradiction.conflicts);
    if (usableFacts.length === 0) {
      missingInfo.push("Kaynaklar arasında çelişki olduğu için doğrudan öneri çıkarılmadı.");
    }
  }
  const intentResolution = resolveAnswerIntent({
    userQuery: input.userQuery,
    weakIntent,
    directFactCount: directAnswerFacts.length,
    supportingFactCount: supportingContext.length,
    riskFactCount: redFlags.length,
    missingInfoCount: missingInfo.length,
    sourceCount: sourceIds.length,
  });

  const rankedUsableFacts = rankEvidenceFacts(input.userQuery, usableFacts);
  const rankedDirectFacts = rankEvidenceFacts(input.userQuery, directAnswerFacts);

  return {
    answerIntent: intentResolution.intent,
    intentResolution,
    directAnswerFacts: promoteCriticalDirectFacts(input.userQuery, rankedDirectFacts, rankedUsableFacts).slice(0, budget.directFactLimit),
    supportingContext: rankEvidenceFacts(input.userQuery, supportingContext).slice(0, budget.supportingFactLimit),
    riskFacts: unique(redFlags).slice(0, budget.riskFactLimit),
    notSupported: unique([...uncertainOrUnusable, ...missingInfo]).slice(0, budget.notSupportedLimit),
    usableFacts: rankedUsableFacts.slice(0, budget.usableFactLimit),
    uncertainOrUnusable: unique(uncertainOrUnusable).slice(0, budget.notSupportedLimit),
    redFlags: unique(redFlags).slice(0, budget.riskFactLimit + 1),
    sourceIds: unique(sourceIds).slice(0, budget.sourceIdLimit),
    missingInfo,
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
