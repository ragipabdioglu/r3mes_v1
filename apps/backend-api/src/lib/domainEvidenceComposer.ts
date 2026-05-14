import type { GroundedMedicalAnswer } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { buildAnswerSpecFromGroundedAnswer } from "./answerSpec.js";
import { polishAnswerText } from "./answerQuality.js";
import { getDomainPolicy } from "./domainPolicy.js";
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

function shouldOmitOptionalCaution(spec: AnswerSpec): boolean {
  if (lowGroundingLead(spec)) return false;
  return spec.answerDomain === "finance" && asksForNumericTableAnswer(spec.userQuery) && asksToAvoidExtraCaution(spec.userQuery);
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
  if (!isNearDuplicate(opts.action, opts.assessment)) body.push(actionSentence);
  if (opts.relevantFact && ![opts.assessment, opts.action, opts.caution].some((value) => isNearDuplicate(value, opts.relevantFact ?? ""))) {
    body.push(sentence(opts.relevantFact));
  }
  lines.push(body.join(" "));

  if (!shouldOmitOptionalCaution(spec) && !isNearDuplicate(opts.caution, opts.assessment) && !isNearDuplicate(opts.caution, opts.action)) {
    lines.push(`Dikkat edilmesi gereken nokta: ${cautionSentence}`);
  }

  if (!isNearDuplicate(opts.summary, opts.assessment) && !isNearDuplicate(opts.summary, opts.action)) {
    lines.push(`Kısaca: ${summarySentence}`);
  }

  return lines.join("\n");
}

export function composeAnswerSpec(spec: AnswerSpec): string {
  const policy = getDomainPolicy(spec.answerDomain);
  const financeTableAnswer = composeFinanceTableFacts(spec);
  if (financeTableAnswer) return financeTableAnswer;
  const sourceNote =
    spec.groundingConfidence === "low"
      ? "Eldeki kaynak dayanağı sınırlı."
      : "Kaynaklarda bu soruya doğrudan dayanak var.";
  const assessment = clean(spec.assessment, sourceNote);
  const action = clean(spec.action, "Kaynak yetersizse karar vermeden önce ilgili uzman veya yetkili kurumdan destek alın.");
  const caution = joinItems(spec.caution, "Kaynakta açık dayanak yoksa kesin sonuç veya garanti ifade edilmemelidir.");
  const summary = clean(spec.summary || assessment, "Kaynaklara bağlı kalarak temkinli ilerlemek gerekir.");
  const relevantFact = queryRelevantFact(spec, [assessment, action, caution, summary].join(" "));

  const lead = lowGroundingLead(spec);
  const lines: string[] = [];
  if (lead) lines.push(lead);

  if (spec.answerIntent === "triage") {
    lines.push(
      `${policy.answerLabels.caution}: ${sentence(caution)}`,
      `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
      `Özet: ${sentence(summary)}`,
    );
    return lines.join("\n");
  }

  if (spec.answerIntent === "steps") {
    if (asksForBriefNaturalAnswer(spec.userQuery)) {
      return composeNaturalBrief(spec, { assessment, action, caution, summary, relevantFact });
    }
    lines.push(`Kısa plan:`);
    uniqueSentences([action, assessment, ...(shouldOmitOptionalCaution(spec) ? [] : [caution])], 3).forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    if (relevantFact) lines.push(`Ek kontrol: ${sentence(relevantFact)}`);
    lines.push(`Özet: ${sentence(summary)}`);
    return lines.join("\n");
  }

  if (spec.answerIntent === "reassure") {
    if (asksForBriefNaturalAnswer(spec.userQuery)) {
      return composeNaturalBrief(spec, { assessment, action, caution, summary, relevantFact });
    }
    lines.push(
      `Kısa cevap: ${sentence(assessment)}`,
      `Bu, tek başına kesin veya panik gerektiren bir sonuç gibi sunulmamalı; kaynakların desteklediği sınır burada kalıyor.`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
      ...(shouldOmitOptionalCaution(spec) ? [] : [`${policy.answerLabels.caution}: ${sentence(caution)}`]),
    );
    if (relevantFact) lines.push(`Ek kontrol: ${sentence(relevantFact)}`);
    return lines.join("\n");
  }

  if (spec.answerIntent === "compare") {
    lines.push(
      `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
      `Karşılaştırırken kullanılabilecek dayanak: ${sentence(summary)}`,
      ...(shouldOmitOptionalCaution(spec) ? [] : [`${policy.answerLabels.caution}: ${sentence(caution)}`]),
      `${policy.answerLabels.action}: ${sentence(action)}`,
    );
    return lines.join("\n");
  }

  if (spec.answerIntent === "explain") {
    if (asksForBriefNaturalAnswer(spec.userQuery)) {
      return composeNaturalBrief(spec, { assessment, action, caution, summary, relevantFact });
    }
    lines.push(
      `${sentence(assessment)}`,
      `Pratik anlamı: ${sentence(action)}`,
      ...(shouldOmitOptionalCaution(spec) ? [] : [`Dikkat: ${sentence(caution)}`]),
      `Kısa özet: ${sentence(summary)}`,
    );
    return lines.join("\n");
  }

  if (asksForBriefNaturalAnswer(spec.userQuery)) {
    return composeNaturalBrief(spec, { assessment, action, caution, summary, relevantFact });
  }

  lines.push(
    `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
    `${policy.answerLabels.action}: ${sentence(action)}`,
    ...(shouldOmitOptionalCaution(spec) ? [] : [`${policy.answerLabels.caution}: ${sentence(caution)}`]),
    `${policy.answerLabels.summary}: ${sentence(summary)}`,
  );
  return lines.join("\n");
}

export function composeDomainEvidenceAnswer(answer: GroundedMedicalAnswer): string {
  return composeAnswerSpec(buildAnswerSpecFromGroundedAnswer(answer));
}
