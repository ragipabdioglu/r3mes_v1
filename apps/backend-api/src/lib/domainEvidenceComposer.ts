import type { GroundedMedicalAnswer } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { buildAnswerSpecFromGroundedAnswer } from "./answerSpec.js";
import { buildAnswerPlan, type AnswerPlan } from "./answerPlan.js";
import type { ComposerInput, ComposePlannedAnswerOptions } from "./composerInput.js";
import { requestedFieldMatchesFact } from "./fieldCoverageResolver.js";
import { polishAnswerText } from "./answerQuality.js";
import { getDomainPolicy } from "./domainPolicy.js";
import { buildSafetyPresentationPolicy, shouldSuppressGenericCaution } from "./safetyPresentationPolicy.js";
import { buildExpandedQueryTokens } from "./turkishQueryNormalizer.js";

function clean(value: string, fallback: string): string {
  const polished = polishAnswerText(value);
  return polished || fallback;
}

function joinItems(values: string[], fallback: string): string {
  const cleanValues = values.map((item) => polishAnswerText(item)).filter(Boolean);
  return cleanValues.length > 0 ? cleanValues.slice(0, 2).join("; ") : fallback;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function uniqueSentences(values: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map((item) => sentence(clean(item, ""))).filter(Boolean)) {
    const key = normalizeForMatch(value).slice(0, 180);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function firstSentence(value: string): string {
  const cleaned = clean(value, "");
  const match = cleaned.match(/^(.{12,260}?[.!?])(?:\s|$)/u);
  return (match?.[1] ?? cleaned).trim();
}

function conciseListItem(value: string): string {
  const sentenceText = firstSentence(value)
    .replace(/^\s*[-*•]\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  const words = sentenceText.split(/\s+/u).filter(Boolean);
  if (words.length <= 24) return sentence(sentenceText);
  return `${words.slice(0, 24).join(" ").replace(/[.,;:!?]*$/u, "")}.`;
}

function conciseDefinition(value: string): string {
  const sentenceText = firstSentence(value)
    .replace(/^\s*[-*•]\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return enforceMaxWords(sentence(sentenceText), 36);
}

function conciseProcedureStep(value: string): string {
  const sentenceText = firstSentence(value)
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  const words = sentenceText.split(/\s+/u).filter(Boolean);
  if (words.length <= 28) return sentence(sentenceText);
  return `${words.slice(0, 28).join(" ").replace(/[.,;:!?]*$/u, "")}.`;
}

function conciseCodeExplanation(value: string): string {
  const sentenceText = firstSentence(value)
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  const words = sentenceText.split(/\s+/u).filter(Boolean);
  if (words.length <= 32) return sentence(sentenceText);
  return `${words.slice(0, 32).join(" ").replace(/[.,;:!?]*$/u, "")}.`;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ");
}

function compactForCompare(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, " ").trim();
}

function isNearDuplicate(left: string, right: string): boolean {
  const a = compactForCompare(left);
  const b = compactForCompare(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 40) return false;
  return a.includes(b.slice(0, 80)) || b.includes(a.slice(0, 80));
}

function asksForStructuredList(query: string): boolean {
  const normalized = compactForCompare(query);
  return /\b(madde|maddeli|liste|adim|adım|checklist|sirala|sırala)\b/u.test(normalized);
}

function asksForBriefNaturalAnswer(query: string): boolean {
  const normalized = compactForCompare(query);
  return /\b(kisa|kısa|sakin|basit|dogal|doğal|acikla|açıkla)\b/u.test(normalized) && !asksForStructuredList(query);
}

function asksToAvoidExtraCaution(query: string): boolean {
  const normalized = compactForCompare(query);
  return (
    /\b(risk|alarm|yorum|uyari|uyarı|tavsiye)\s+(ekleme|katma|yazma|verme)\b/u.test(normalized) ||
    /\bsadece\s+(sorulan|rakam|rakamlari|rakamları|sayi|sayı|sayilari|sayıları|deger|değer)\b/u.test(normalized)
  );
}

function asksForNumericTableAnswer(query: string): boolean {
  const normalized = compactForCompare(query);
  return (
    /\b(tablo|rakam|rakamlari|rakamları|sayi|sayı|sayilari|sayıları|tutar|oran|net donem|net dönem|kar|kâr)\b/u
      .test(normalized)
  );
}

function asksForDefinitionAnswer(query: string): boolean {
  const normalized = compactForCompare(query);
  return /\b(nedir|ne demek|tanim|tanım)\b/u.test(normalized);
}

function cleanComparisonSubject(value: string): string {
  return value
    .replace(/\b(kaynaga gore|kaynağa göre|kaynaklara gore|kaynaklara göre)\b/giu, "")
    .replace(/\b(nedir|ne demek|farki|farkı)\b/giu, "")
    .replace(/[?.!,;:]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitComparisonSubjects(value: string): string[] {
  return value
    .split(/\s*(?:,|;|\s+ile\s+|\s+ve\s+)\s*/iu)
    .map(cleanComparisonSubject)
    .filter((part) => part.length >= 2 && part.split(/\s+/u).length <= 5)
    .slice(0, 4);
}

function extractComparisonSubjectLabel(query: string): string | null {
  const normalized = query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const multiSubjectMatch = normalized.match(/^(.{2,160}?)\s+aras[ıi]ndaki\s+(?:temel\s+)?fark/iu);
  const multiSubjects = splitComparisonSubjects(multiSubjectMatch?.[1] ?? "");
  if (multiSubjects.length >= 2) return multiSubjects.join(", ");

  const patterns = [
    /^(.{2,80}?)\s+(?:ile|ve)\s+(.{2,80}?)\s+aras[ıi]ndaki\s+fark/iu,
    /^(.{2,80}?)\s+(?:ile|ve)\s+(.{2,80}?)\s+fark[ıi]/iu,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const left = cleanComparisonSubject(match?.[1] ?? "");
    const right = cleanComparisonSubject(match?.[2] ?? "");
    if (left.split(/\s+/u).length > 5 || right.split(/\s+/u).length > 5) continue;
    if (left.length >= 2 && right.length >= 2) return `${left} ile ${right}`;
  }
  return null;
}

function ensureComparisonSubjectsVisible(query: string, answer: string): string {
  const label = extractComparisonSubjectLabel(query);
  if (!label) return answer;
  const subjects = splitComparisonSubjects(label);
  const normalizedAnswer = compactForCompare(answer);
  if (subjects.length >= 2 && subjects.every((subject) => normalizedAnswer.includes(compactForCompare(subject)))) {
    return answer;
  }
  return `${label}: ${answer}`;
}

function isGenericSourceLimitGuidance(value: string): boolean {
  return /\bkaynak\s+s[ıi]n[ıi]rl[ıi]ysa\b|\bilgili\s+uzman\s+veya\s+yetkili\s+kurum\b/iu.test(value);
}

function stripSourcePrefix(value: string): string {
  return value.replace(/^\s*[\p{L}\p{N}_./() -]{3,180}:\s*/u, "").trim();
}

function isDocumentScaffoldFact(value: string): boolean {
  const normalized = compactForCompare(stripSourcePrefix(value));
  return (
    !normalized ||
    /\bpage\s+\d+\b/u.test(normalized) ||
    (/^hafta\s+\d+\s*-?\s*\d*\b/u.test(normalized) && normalized.length < 120) ||
    (/^\d+\s*hafta\b/u.test(normalized) && normalized.length < 120) ||
    (/^bilişim teknolojilerine giriş\b/u.test(normalized) && normalized.length < 120) ||
    (/\bmart\s+20\d{2}\b/u.test(normalized) && normalized.length < 140)
  );
}

function shouldOmitOptionalCaution(spec: AnswerSpec): boolean {
  if (lowGroundingLead(spec)) return false;
  return spec.answerDomain === "finance" && asksForNumericTableAnswer(spec.userQuery) && asksToAvoidExtraCaution(spec.userQuery);
}

function shouldIncludeOptionalCaution(spec: AnswerSpec, answerPlan?: AnswerPlan): boolean {
  if (answerPlan?.constraints.forbidCaution || answerPlan?.forbiddenAdditions.includes("optional_caution")) return false;
  if (shouldOmitOptionalCaution(spec)) return false;
  if (lowGroundingLead(spec)) return true;
  if (
    answerPlan &&
    ["definition", "list_items", "compare_concepts", "summarize_opinions", "source_grounded_explain"].includes(answerPlan.taskType) &&
    spec.answerIntent !== "triage"
  ) return false;
  if (asksForDefinitionAnswer(spec.userQuery)) return false;
  if (spec.answerDomain === "medical" || spec.answerDomain === "finance") return true;
  if (spec.answerIntent === "triage") return true;
  if (answerPlan?.outputFormat === "bullets" || asksForBriefNaturalAnswer(spec.userQuery)) return false;
  return true;
}

function matchTokens(value: string): string[] {
  const stopwords = new Set([
    "acaba",
    "ama",
    "bana",
    "ben",
    "bir",
    "bu",
    "da",
    "de",
    "diye",
    "gibi",
    "hangi",
    "icin",
    "için",
    "ile",
    "kisa",
    "kısa",
    "mi",
    "ne",
    "nasil",
    "nasıl",
    "nereye",
    "once",
    "önce",
    "sonra",
    "ve",
    "veya",
  ]);
  const baseTokens = normalizeForMatch(value)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !stopwords.has(part));
  const expandedTokens = buildExpandedQueryTokens(value, null, 96).filter((part) => part.length >= 3 && !stopwords.has(part));
  return Array.from(new Set([...baseTokens, ...expandedTokens]));
}

const TABLE_QUERY_STOPWORDS = new Set([
  "acikla",
  "cevapla",
  "geciyor",
  "geçiyor",
  "hangi",
  "karistirma",
  "karıştırma",
  "kaynak",
  "kisa",
  "kısa",
  "maddelerle",
  "rakam",
  "rakamlari",
  "rakamları",
  "risk",
  "sadece",
  "satiri",
  "satırı",
  "soyle",
  "söyle",
  "tablosunda",
  "turkce",
  "türkçe",
  "yorum",
  "yaz",
]);

const TABLE_LABEL_SIGNAL_TOKENS = new Set([
  "bagis",
  "bağış",
  "dagitilabilir",
  "dağıtılabilir",
  "dagitilmasi",
  "dağıtılması",
  "diger",
  "diğer",
  "donem",
  "dönem",
  "grubu",
  "kar",
  "kâr",
  "kaynaklar",
  "nakit",
  "net",
  "olaganustu",
  "olağanüstü",
  "oran",
  "stopaj",
  "tutar",
  "yedek",
  "yedekler",
]);

function compactTableLabel(value: string): string {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !TABLE_QUERY_STOPWORDS.has(token))
    .join(" ")
    .trim();
}

function isNegatedTableCandidate(normalizedQuery: string, candidate: string): boolean {
  const index = normalizedQuery.indexOf(candidate);
  if (index < 0) return false;
  const window = normalizedQuery.slice(index, index + candidate.length + 24);
  return /\b(karistirma|karıştırma|kullanma|cevap\s+sanma)\b/u.test(window);
}

function tableLabelCandidates(query: string): string[] {
  const normalized = compactForCompare(query);
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const candidates: Array<{ label: string; score: number }> = [];
  for (let size = 2; size <= 6; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const raw = tokens.slice(index, index + size).join(" ");
      const label = compactTableLabel(raw);
      if (!label || label.split(/\s+/).length < 2) continue;
      if (isNegatedTableCandidate(normalized, label)) continue;
      const labelTokens = label.split(/\s+/);
      const signalCount = labelTokens.filter((token) => TABLE_LABEL_SIGNAL_TOKENS.has(token)).length;
      if (signalCount === 0) continue;
      const score = signalCount * 10 + labelTokens.length;
      candidates.push({ label, score });
    }
  }

  const selected: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.sort((a, b) => b.score - a.score || b.label.length - a.label.length)) {
    if (seen.has(candidate.label)) continue;
    seen.add(candidate.label);
    selected.push(candidate.label);
    if (selected.length >= 64) break;
  }
  return selected;
}

function extractNumbers(value: string): string[] {
  return Array.from(value.matchAll(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+/gu))
    .map((match) => match[0])
    .filter((number) => number.length > 1);
}

function titleCaseTurkishLabel(label: string): string {
  return label
    .split(/\s+/)
    .map((token) => token.charAt(0).toLocaleUpperCase("tr-TR") + token.slice(1))
    .join(" ");
}

function labelFromProvenanceQuote(value: string): string | null {
  const cleaned = value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return null;
  const firstNumber = cleaned.search(/\d/u);
  if (firstNumber <= 2) return null;
  const label = cleaned.slice(0, firstNumber).replace(/[-:;,.()\s]+$/gu, "").trim();
  if (label.length < 3 || label.length > 140) return null;
  return label;
}

function normalizeLabelForRecovery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıİöşü]/g, (char) => ({
      ç: "c",
      ğ: "g",
      ı: "i",
      İ: "i",
      ö: "o",
      ş: "s",
      ü: "u",
    })[char] ?? char)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripTrailingLabelNoise(value: string): string {
  return value
    .replace(/^[\s:;,.|/-]+/gu, "")
    .replace(/[\s:;,.|/-]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

type LabelToken = {
  normalized: string;
  start: number;
  end: number;
};

function labelTokens(value: string): LabelToken[] {
  const tokens: LabelToken[] = [];
  for (const match of value.matchAll(/[\p{L}\p{N}-]+/gu)) {
    const raw = match[0];
    const normalized = normalizeLabelForRecovery(raw);
    if (!normalized) continue;
    const start = match.index ?? 0;
    tokens.push({
      normalized,
      start,
      end: start + raw.length,
    });
  }
  return tokens;
}

function recoverLabelSpanFromSource(sourceText: string, normalizedRowLabel: string): string | null {
  const rowTokens = normalizedRowLabel.split(/\s+/u).filter(Boolean);
  if (rowTokens.length === 0) return null;
  const sourceTokens = labelTokens(sourceText);
  if (sourceTokens.length < rowTokens.length) return null;

  for (let index = 0; index <= sourceTokens.length - rowTokens.length; index += 1) {
    const window = sourceTokens.slice(index, index + rowTokens.length);
    if (window.some((token, offset) => token.normalized !== rowTokens[offset])) continue;
    const recovered = stripTrailingLabelNoise(sourceText.slice(window[0].start, window[window.length - 1].end));
    if (recovered.length >= 3 && recovered.length <= 140) return recovered;
  }
  return null;
}

function recoverReadableRowLabel(
  rowLabel: string,
  fact: AnswerPlan["selectedFacts"][number],
): string | null {
  const normalizedRowLabel = normalizeLabelForRecovery(rowLabel);
  if (!normalizedRowLabel || normalizedRowLabel.length < 3) return null;
  const sourceCandidates = [fact.table?.rawRow, fact.provenance.quote].filter((value): value is string => Boolean(value?.trim()));
  for (const sourceCandidate of sourceCandidates) {
    const sourceText = stripSourcePrefix(sourceCandidate.normalize("NFKC").replace(/\s+/gu, " ").trim());
    const recovered = recoverLabelSpanFromSource(sourceText, normalizedRowLabel);
    if (recovered) return recovered;
  }
  return null;
}

function displayLabelForStructuredFact(plan: AnswerPlan, fact: AnswerPlan["selectedFacts"][number]): string {
  const tableRowLabel = fact.table?.rowLabel?.trim();
  if (tableRowLabel && tableRowLabel.length >= 3) {
    return recoverReadableRowLabel(tableRowLabel, fact) ?? tableRowLabel;
  }
  const quoteLabel = labelFromProvenanceQuote(fact.provenance.quote);
  if (quoteLabel) return quoteLabel;
  const requestedField = plan.requestedFields.find((field) => requestedFieldMatchesFact(field, fact));
  const requestedLabel = requestedField?.label?.trim();
  if (requestedLabel && requestedLabel.length >= 3) return requestedLabel;
  return fact.field ?? fact.subject ?? "Kaynakta bulunan değer";
}

function composeFinanceTableFacts(spec: AnswerSpec): string | null {
  if (!shouldOmitOptionalCaution(spec)) return null;
  const labels = tableLabelCandidates(spec.userQuery);
  if (labels.length === 0) return null;
  const facts = spec.facts.map((fact) => ({
    original: fact,
    normalized: compactForCompare(fact),
    searchable: fact
      .normalize("NFKC")
      .toLocaleLowerCase("tr-TR")
      .replace(/[^\p{L}\p{N}.,\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
  const lines: string[] = [];
  const usedLabels: string[] = [];
  for (const label of labels) {
    if (usedLabels.some((used) => used.includes(label) || label.includes(used))) continue;
    const matches = facts
      .filter((item) => item.normalized.includes(label) || item.searchable.includes(label))
      .map((fact) => {
        const start = Math.max(0, fact.searchable.indexOf(label));
        const snippet = fact.searchable.slice(start, start + 320);
        const numbers = extractNumbers(snippet)
          .filter((number) => !/^20$|^21$|^2025$|^1578858$/u.test(number))
          .slice(0, 3);
        return { numbers, sourceLength: fact.searchable.length };
      })
      .sort((a, b) => b.numbers.length - a.numbers.length || b.sourceLength - a.sourceLength);
    const numbers = matches[0]?.numbers ?? [];
    if (numbers.length === 0) continue;
    lines.push(`- ${titleCaseTurkishLabel(label)}: ${numbers.join(" / ")}`);
    usedLabels.push(label);
    if (lines.length >= 4) break;
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function composeStructuredFieldAnswer(plan: AnswerPlan): string | null {
  if (plan.taskType !== "field_extraction" || plan.coverage === "none" || plan.selectedFacts.length === 0) return null;
  const lines = plan.selectedFacts.map((fact) => {
    const baseLabel = displayLabelForStructuredFact(plan, fact);
    const label = fact.table?.columnLabel ? `${baseLabel} (${fact.table.columnLabel})` : baseLabel;
    const value = fact.value ?? fact.provenance.quote;
    return plan.outputFormat === "bullets" ? `- ${label}: ${value}.` : `${label}: ${value}.`;
  });
  if (plan.coverage === "partial" && plan.diagnostics.missingFieldIds.length > 0) {
    lines.push(
      plan.outputFormat === "bullets"
        ? `- Bulunamayan alanlar: ${plan.diagnostics.missingFieldIds.join(", ")}`
        : `Bulunamayan alanlar: ${plan.diagnostics.missingFieldIds.join(", ")}`,
    );
  }
  if (plan.outputFormat === "short" && lines.length > 0) return lines.join("; ");
  return lines.join("\n");
}

function missingFieldLabels(plan: AnswerPlan): string[] {
  const byId = new Map(plan.requestedFields.map((field) => [field.id, field.label || field.id]));
  return plan.diagnostics.missingFieldIds.map((id) => byId.get(id) ?? id).filter(Boolean);
}

function looksLikeRawTableDump(value: string): boolean {
  const normalized = value.normalize("NFKC");
  const numbers = extractNumbers(normalized);
  const separatorCount = (normalized.match(/[|;\t]/gu) ?? []).length;
  const compactedLength = normalized.replace(/\s+/gu, " ").trim().length;
  if (/^\s*\|.*\|\s*$/u.test(normalized)) return true;
  if (numbers.length >= 4 && compactedLength > 80) return true;
  return separatorCount >= 5 && compactedLength > 100;
}

function textFactsForPartialFieldExtraction(
  spec: AnswerSpec,
  plan: AnswerPlan,
  input: ComposerInput,
  opts: ComposePlannedAnswerOptions,
): string[] {
  if (plan.taskType !== "field_extraction" || !["partial", "none"].includes(plan.coverage)) return [];
  const textFacts = uniqueSentences(
    spec.facts
      .filter((fact) => !isGenericSourceLimitGuidance(fact) && !isDocumentScaffoldFact(fact))
      .filter((fact) => !(input.constraints.noRawTableDump && looksLikeRawTableDump(fact)))
      .filter((fact) => spec.answerDomain !== "finance" || opts.enableFinanceTableStringFallback === true || extractNumbers(fact).length === 0),
    plan.outputFormat === "bullets" ? 4 : 2,
  );
  return textFacts;
}

function composePartialTextFieldAnswer(
  spec: AnswerSpec,
  plan: AnswerPlan,
  input: ComposerInput,
  opts: ComposePlannedAnswerOptions,
): string | null {
  const facts = textFactsForPartialFieldExtraction(spec, plan, input, opts);
  if (facts.length === 0) return null;
  const missing = missingFieldLabels(plan);
  const missingText = missing.length > 0 ? `Bulunamayan alanlar: ${missing.join(", ")}.` : "";

  if (plan.outputFormat === "bullets") {
    const lines = facts.map((fact) => `- ${fact}`);
    if (missingText) lines.push(`- ${missingText}`);
    return lines.join("\n");
  }

  const factText = facts.join("; ");
  return missingText ? `${factText} ${missingText}` : factText;
}

function composeMissingFieldAnswer(plan: AnswerPlan): string | null {
  if (plan.taskType !== "field_extraction") return null;
  const missingFieldIds = plan.diagnostics.missingFieldIds;
  if (missingFieldIds.length > 0) {
    return `Kaynakta sorulan alanlar için tam değer bulunamadı: ${missingFieldIds.join(", ")}.`;
  }
  return "Kaynakta sorulan alan için doğrulanmış değer bulunamadı.";
}

function withSafetyPresentationPolicy(spec: AnswerSpec, answerPlan: AnswerPlan, input: ComposerInput): AnswerSpec {
  const policy = buildSafetyPresentationPolicy({
    answerPlan,
    constraints: input.constraints,
  });
  if (!shouldSuppressGenericCaution(policy)) return spec;
  return {
    ...spec,
    caution: [],
    sections: spec.sections.filter((section) => section !== "caution"),
  };
}

function enforceMaxWords(value: string, maxWords: number | undefined): string {
  if (!Number.isFinite(maxWords) || Number(maxWords) <= 0) return value;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= Number(maxWords)) return value;
  return `${words.slice(0, Number(maxWords)).join(" ").replace(/[.,;:!?]*$/u, "")}.`;
}

function queryRelevantFact(spec: AnswerSpec, usedText: string): string | null {
  const queryTokens = new Set(matchTokens(spec.userQuery));
  if (queryTokens.size === 0) return null;
  const used = normalizeForMatch(usedText);
  let best: { fact: string; score: number } | null = null;
  for (const fact of spec.facts) {
    const cleaned = clean(fact, "");
    const normalizedFact = normalizeForMatch(cleaned);
    if (!cleaned || used.includes(normalizedFact.slice(0, 80))) continue;
    const factTokens = matchTokens(cleaned);
    const overlap = factTokens.filter((token) => queryTokens.has(token)).length;
    const evidenceBonus = factTokens.some((token) =>
      ["belge", "fatura", "dekont", "tutanak", "kayıt", "kayit"].includes(token),
    )
      ? 0.5
      : 0;
    const score = overlap + evidenceBonus;
    if (score >= 2 && (!best || score > best.score)) {
      best = { fact: cleaned, score };
    }
  }
  return best?.fact ?? null;
}

function lowGroundingLead(spec: AnswerSpec): string | null {
  if (spec.groundingConfidence !== "low") return null;
  const contradictionText = [...spec.caution, ...spec.unknowns].join(" ").toLocaleLowerCase("tr-TR");
  if (/çeliş|celis|contradict|conflict/u.test(contradictionText)) {
    return "Bu kaynaklarda çelişki sinyali var; bu yüzden net ve kesin bir cevap vermek doğru olmaz, aşağıdaki yanıt yalnızca eldeki sınırlı dayanağa göre okunmalı.";
  }
  return "Bu kaynaklarla net ve kesin bir cevap vermek doğru olmaz; aşağıdaki yanıt yalnızca eldeki sınırlı dayanağa göre okunmalı.";
}

function composeNaturalBrief(spec: AnswerSpec, opts: {
  answerPlan?: AnswerPlan;
  assessment: string;
  action: string;
  caution: string;
  summary: string;
  relevantFact: string | null;
}): string {
  const lines: string[] = [];
  const lead = lowGroundingLead(spec);
  if (lead) lines.push(lead);

  const firstSentence = sentence(opts.assessment);
  const actionSentence = sentence(opts.action);
  const cautionSentence = sentence(opts.caution);
  const summarySentence = sentence(opts.summary);

  const body: string[] = [firstSentence];
  if (
    !isGenericSourceLimitGuidance(opts.action) &&
    !isDocumentScaffoldFact(opts.action) &&
    !isNearDuplicate(opts.action, opts.assessment)
  ) body.push(actionSentence);
  if (
    opts.relevantFact &&
    !isGenericSourceLimitGuidance(opts.relevantFact) &&
    !isDocumentScaffoldFact(opts.relevantFact) &&
    ![opts.assessment, opts.action, opts.caution].some((value) => isNearDuplicate(value, opts.relevantFact ?? ""))
  ) {
    body.push(sentence(opts.relevantFact));
  }
  lines.push(body.join(" "));

  if (
    shouldIncludeOptionalCaution(spec, opts.answerPlan) &&
    !isNearDuplicate(opts.caution, opts.assessment) &&
    !isNearDuplicate(opts.caution, opts.action)
  ) {
    lines.push(`Dikkat edilmesi gereken nokta: ${cautionSentence}`);
  }

  if (
    !asksForDefinitionAnswer(spec.userQuery) &&
    !isGenericSourceLimitGuidance(opts.summary) &&
    !isDocumentScaffoldFact(opts.summary) &&
    !isNearDuplicate(opts.summary, opts.assessment) &&
    !isNearDuplicate(opts.summary, opts.action)
  ) {
    lines.push(`Kısaca: ${summarySentence}`);
  }

  return lines.join("\n");
}

function composeBulletAnswer(spec: AnswerSpec, answerPlan: AnswerPlan, opts: {
  assessment: string;
  action: string;
  caution: string;
  summary: string;
  relevantFact: string | null;
}): string {
  const candidates = [
    opts.action,
    opts.assessment,
    ...(opts.relevantFact ? [opts.relevantFact] : []),
    ...(shouldIncludeOptionalCaution(spec, answerPlan) ? [opts.caution] : []),
    opts.summary,
  ];
  return uniqueSentences(candidates, 4)
    .map((item) => `- ${item}`)
    .join("\n");
}

function composePlannedKnowledgeAnswer(spec: AnswerSpec, answerPlan: AnswerPlan, opts: {
  assessment: string;
  action: string;
  caution: string;
  summary: string;
  relevantFact: string | null;
  enableProcedureRenderer?: boolean;
}): string | null {
  if (lowGroundingLead(spec)) return null;
  if (answerPlan.taskType === "list_items") {
    const candidates = uniqueSentences(
      [
        ...spec.facts,
        opts.assessment,
        opts.action,
        opts.summary,
        ...(opts.relevantFact ? [opts.relevantFact] : []),
      ].filter((item) => !isGenericSourceLimitGuidance(item) && !isDocumentScaffoldFact(item)),
      6,
    );
    if (candidates.length === 0) return null;
    return candidates.map((item) => `- ${conciseListItem(item)}`).join("\n");
  }

  if (answerPlan.taskType === "definition") {
    const candidates = uniqueSentences(
      [opts.assessment, ...spec.facts, opts.summary, opts.action]
        .filter((item) => !isGenericSourceLimitGuidance(item) && !isDocumentScaffoldFact(item)),
      3,
    );
    return candidates.length > 0 ? conciseDefinition(candidates[0]) : null;
  }

  if (answerPlan.taskType === "source_grounded_explain") {
    return composeNaturalBrief(spec, {
      answerPlan,
      assessment: opts.assessment,
      action: opts.action,
      caution: opts.caution,
      summary: opts.summary,
      relevantFact: opts.relevantFact,
    });
  }

  if (answerPlan.taskType === "procedure" && opts.enableProcedureRenderer === true) {
    const candidates = uniqueSentences(
      [
        ...spec.facts,
        opts.action,
        opts.assessment,
        opts.summary,
        ...(opts.relevantFact ? [opts.relevantFact] : []),
      ].filter((item) => !isGenericSourceLimitGuidance(item) && !isDocumentScaffoldFact(item)),
      5,
    );
    if (candidates.length === 0) return null;
    return candidates
      .map((item, index) => `${index + 1}. ${conciseProcedureStep(item)}`)
      .join("\n");
  }

  if (answerPlan.taskType === "code_explanation") {
    const candidates = uniqueSentences(
      [
        ...spec.facts,
        opts.assessment,
        opts.action,
        opts.summary,
        ...(opts.relevantFact ? [opts.relevantFact] : []),
      ].filter((item) => !isGenericSourceLimitGuidance(item) && !isDocumentScaffoldFact(item)),
      4,
    );
    if (candidates.length === 0) return null;
    return candidates.map((item) => conciseCodeExplanation(item)).join("\n");
  }

  if (answerPlan.taskType === "compare_concepts") {
    const lines = uniqueSentences(
      [opts.assessment, opts.summary, opts.action, ...(opts.relevantFact ? [opts.relevantFact] : [])]
        .filter((item) => !isGenericSourceLimitGuidance(item) && !isDocumentScaffoldFact(item)),
      4,
    );
    return lines.length > 0 ? ensureComparisonSubjectsVisible(spec.userQuery, lines.join("\n")) : null;
  }

  if (answerPlan.taskType === "summarize_opinions") {
    const lines = uniqueSentences(
      [opts.assessment, opts.action, opts.summary, ...(opts.relevantFact ? [opts.relevantFact] : [])]
        .filter((item) => !isGenericSourceLimitGuidance(item) && !isDocumentScaffoldFact(item)),
      4,
    );
    return lines.length > 0 ? lines.join("\n") : null;
  }

  return null;
}

export function composeAnswerSpec(spec: AnswerSpec, opts: ComposePlannedAnswerOptions = {
  enableFinanceTableStringFallback: true,
}): string {
  const policy = getDomainPolicy(spec.answerDomain);
  const answerPlan = buildAnswerPlan(spec);
  const structuredFieldAnswer = composeStructuredFieldAnswer(answerPlan);
  if (structuredFieldAnswer) return structuredFieldAnswer;
  if (opts.enableFinanceTableStringFallback === true) {
    const financeTableAnswer = composeFinanceTableFacts(spec);
    if (financeTableAnswer) return financeTableAnswer;
  }
  const sourceNote =
    spec.groundingConfidence === "low"
      ? "Eldeki kaynak dayanağı sınırlı."
      : "Kaynaklarda bu soruya doğrudan dayanak var.";
  const assessment = clean(spec.assessment, sourceNote);
  const action = clean(spec.action, "Kaynak yetersizse karar vermeden önce ilgili uzman veya yetkili kurumdan destek alın.");
  const caution = joinItems(spec.caution, "Kaynakta açık dayanak yoksa kesin sonuç veya garanti ifade edilmemelidir.");
  const summary = clean(spec.summary || assessment, "Kaynaklara bağlı kalarak temkinli ilerlemek gerekir.");
  const relevantFact = queryRelevantFact(spec, [assessment, action, caution, summary].join(" "));
  const plannedAnswer = composePlannedKnowledgeAnswer(spec, answerPlan, { assessment, action, caution, summary, relevantFact });
  if (plannedAnswer) return plannedAnswer;

  const lead = lowGroundingLead(spec);
  const lines: string[] = [];
  if (lead) lines.push(lead);

  if (answerPlan.outputFormat === "bullets") {
    const bullets = composeBulletAnswer(spec, answerPlan, { assessment, action, caution, summary, relevantFact });
    return lead ? `${lead}\n${bullets}` : bullets;
  }

  if (spec.answerIntent === "triage") {
    lines.push(
      ...(shouldIncludeOptionalCaution(spec, answerPlan) ? [`${policy.answerLabels.caution}: ${sentence(caution)}`] : []),
      `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
      `Özet: ${sentence(summary)}`,
    );
    return lines.join("\n");
  }

  if (spec.answerIntent === "steps") {
    if (asksForBriefNaturalAnswer(spec.userQuery)) {
      return composeNaturalBrief(spec, { answerPlan, assessment, action, caution, summary, relevantFact });
    }
    lines.push(`Kısa plan:`);
    uniqueSentences([action, assessment, ...(shouldIncludeOptionalCaution(spec, answerPlan) ? [caution] : [])], 3).forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    if (relevantFact) lines.push(`Ek kontrol: ${sentence(relevantFact)}`);
    lines.push(`Özet: ${sentence(summary)}`);
    return lines.join("\n");
  }

  if (spec.answerIntent === "reassure") {
    if (asksForBriefNaturalAnswer(spec.userQuery)) {
      return composeNaturalBrief(spec, { answerPlan, assessment, action, caution, summary, relevantFact });
    }
    lines.push(
      `Kısa cevap: ${sentence(assessment)}`,
      `Bu, tek başına kesin veya panik gerektiren bir sonuç gibi sunulmamalı; kaynakların desteklediği sınır burada kalıyor.`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
      ...(shouldIncludeOptionalCaution(spec, answerPlan) ? [`${policy.answerLabels.caution}: ${sentence(caution)}`] : []),
    );
    if (relevantFact) lines.push(`Ek kontrol: ${sentence(relevantFact)}`);
    return lines.join("\n");
  }

  if (spec.answerIntent === "compare") {
    lines.push(
      `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
      `Karşılaştırırken kullanılabilecek dayanak: ${sentence(summary)}`,
      ...(shouldIncludeOptionalCaution(spec, answerPlan) ? [`${policy.answerLabels.caution}: ${sentence(caution)}`] : []),
      `${policy.answerLabels.action}: ${sentence(action)}`,
    );
    return lines.join("\n");
  }

  if (spec.answerIntent === "explain") {
    if (asksForBriefNaturalAnswer(spec.userQuery)) {
      return composeNaturalBrief(spec, { answerPlan, assessment, action, caution, summary, relevantFact });
    }
    lines.push(
      `${sentence(assessment)}`,
      `Pratik anlamı: ${sentence(action)}`,
      ...(shouldIncludeOptionalCaution(spec, answerPlan) ? [`Dikkat: ${sentence(caution)}`] : []),
      `Kısa özet: ${sentence(summary)}`,
    );
    return lines.join("\n");
  }

  if (asksForBriefNaturalAnswer(spec.userQuery)) {
    return composeNaturalBrief(spec, { answerPlan, assessment, action, caution, summary, relevantFact });
  }

  lines.push(
    `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
    `${policy.answerLabels.action}: ${sentence(action)}`,
    ...(shouldIncludeOptionalCaution(spec, answerPlan) ? [`${policy.answerLabels.caution}: ${sentence(caution)}`] : []),
    `${policy.answerLabels.summary}: ${sentence(summary)}`,
  );
  return lines.join("\n");
}

export function composePlannedAnswer(input: ComposerInput, opts: ComposePlannedAnswerOptions = {}): string {
  const plannedStructuredAnswer = composeStructuredFieldAnswer(input.answerPlan);
  if (plannedStructuredAnswer) {
    return enforceMaxWords(plannedStructuredAnswer, input.constraints.maxWords);
  }

  const spec = withSafetyPresentationPolicy(input.answerSpec, input.answerPlan, input);
  const partialTextAnswer = composePartialTextFieldAnswer(spec, input.answerPlan, input, opts);
  if (partialTextAnswer) {
    return enforceMaxWords(partialTextAnswer, input.constraints.maxWords);
  }

  const missingFieldAnswer = composeMissingFieldAnswer(input.answerPlan);
  if (missingFieldAnswer && (input.constraints.forbidCaution || input.answerPlan.taskType === "field_extraction")) {
    return enforceMaxWords(missingFieldAnswer, input.constraints.maxWords);
  }

  const sourceNote =
    spec.groundingConfidence === "low"
      ? "Eldeki kaynak dayanağı sınırlı."
      : "Kaynaklarda bu soruya doğrudan dayanak var.";
  const assessment = clean(spec.assessment, sourceNote);
  const action = clean(spec.action, "Kaynak yetersizse karar vermeden önce ilgili uzman veya yetkili kurumdan destek alın.");
  const caution = joinItems(spec.caution, "Kaynakta açık dayanak yoksa kesin sonuç veya garanti ifade edilmemelidir.");
  const summary = clean(spec.summary || assessment, "Kaynaklara bağlı kalarak temkinli ilerlemek gerekir.");
  const relevantFact = queryRelevantFact(spec, [assessment, action, caution, summary].join(" "));
  const plannedKnowledgeAnswer = composePlannedKnowledgeAnswer(spec, input.answerPlan, {
    assessment,
    action,
    caution,
    summary,
    relevantFact,
    enableProcedureRenderer: true,
  });
  if (plannedKnowledgeAnswer) {
    return enforceMaxWords(plannedKnowledgeAnswer, input.constraints.maxWords);
  }

  const rendered = composeAnswerSpec(spec, {
    enableFinanceTableStringFallback: opts.enableFinanceTableStringFallback === true,
  });
  return enforceMaxWords(rendered, input.constraints.maxWords);
}

export function composeDomainEvidenceAnswer(answer: GroundedMedicalAnswer): string {
  return composeAnswerSpec(buildAnswerSpecFromGroundedAnswer(answer));
}
