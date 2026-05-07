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

  if (!isNearDuplicate(opts.caution, opts.assessment) && !isNearDuplicate(opts.caution, opts.action)) {
    lines.push(`Dikkat edilmesi gereken nokta: ${cautionSentence}`);
  }

  if (!isNearDuplicate(opts.summary, opts.assessment) && !isNearDuplicate(opts.summary, opts.action)) {
    lines.push(`Kısaca: ${summarySentence}`);
  }

  return lines.join("\n");
}

export function composeAnswerSpec(spec: AnswerSpec): string {
  const policy = getDomainPolicy(spec.answerDomain);
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
    uniqueSentences([action, assessment, caution], 3).forEach((item, index) => {
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
      `${policy.answerLabels.caution}: ${sentence(caution)}`,
    );
    if (relevantFact) lines.push(`Ek kontrol: ${sentence(relevantFact)}`);
    return lines.join("\n");
  }

  if (spec.answerIntent === "compare") {
    lines.push(
      `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
      `Karşılaştırırken kullanılabilecek dayanak: ${sentence(summary)}`,
      `${policy.answerLabels.caution}: ${sentence(caution)}`,
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
      `Dikkat: ${sentence(caution)}`,
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
    `${policy.answerLabels.caution}: ${sentence(caution)}`,
    `${policy.answerLabels.summary}: ${sentence(summary)}`,
  );
  return lines.join("\n");
}

export function composeDomainEvidenceAnswer(answer: GroundedMedicalAnswer): string {
  return composeAnswerSpec(buildAnswerSpecFromGroundedAnswer(answer));
}
