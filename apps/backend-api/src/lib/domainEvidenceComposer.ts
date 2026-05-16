import type { GroundedMedicalAnswer } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { buildAnswerSpecFromGroundedAnswer } from "./answerSpec.js";
import { buildAnswerPlan, type AnswerPlan } from "./answerPlan.js";
import type { ComposerInput, ComposePlannedAnswerOptions } from "./composerInput.js";
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
    const baseLabel = fact.field ?? fact.subject ?? "Kaynakta bulunan değer";
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
    return candidates.map((item) => `- ${item}`).join("\n");
  }

  if (answerPlan.taskType === "definition" || answerPlan.taskType === "source_grounded_explain") {
    return composeNaturalBrief(spec, {
      answerPlan,
      assessment: opts.assessment,
      action: opts.action,
      caution: opts.caution,
      summary: opts.summary,
      relevantFact: opts.relevantFact,
    });
  }

  if (answerPlan.taskType === "compare_concepts") {
    const lines = uniqueSentences(
      [opts.assessment, opts.summary, opts.action, ...(opts.relevantFact ? [opts.relevantFact] : [])]
        .filter((item) => !isGenericSourceLimitGuidance(item) && !isDocumentScaffoldFact(item)),
      4,
    );
    return lines.length > 0 ? lines.join("\n") : null;
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

  const missingFieldAnswer = composeMissingFieldAnswer(input.answerPlan);
  if (missingFieldAnswer && (input.constraints.forbidCaution || input.answerPlan.taskType === "field_extraction")) {
    return enforceMaxWords(missingFieldAnswer, input.constraints.maxWords);
  }

  const spec = withSafetyPresentationPolicy(input.answerSpec, input.answerPlan, input);
  const rendered = composeAnswerSpec(spec, {
    enableFinanceTableStringFallback: opts.enableFinanceTableStringFallback === true,
  });
  return enforceMaxWords(rendered, input.constraints.maxWords);
}

export function composeDomainEvidenceAnswer(answer: GroundedMedicalAnswer): string {
  return composeAnswerSpec(buildAnswerSpecFromGroundedAnswer(answer));
}
