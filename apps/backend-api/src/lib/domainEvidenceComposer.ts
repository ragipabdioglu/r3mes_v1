import type { GroundedMedicalAnswer } from "./answerSchema.js";
import type { AnswerSpec } from "./answerSpec.js";
import { buildAnswerSpecFromGroundedAnswer } from "./answerSpec.js";
import { polishAnswerText } from "./answerQuality.js";
import { getDomainPolicy } from "./domainPolicy.js";

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
  return normalizeForMatch(value)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !stopwords.has(part));
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
    lines.push(`Kısa plan:`);
    uniqueSentences([action, assessment, caution], 3).forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    if (relevantFact) lines.push(`Ek kontrol: ${sentence(relevantFact)}`);
    lines.push(`Özet: ${sentence(summary)}`);
    return lines.join("\n");
  }

  if (spec.answerIntent === "reassure") {
    lines.push(
      `Kısa cevap: ${sentence(assessment)}`,
      `Bu, tek başına kesin veya panik gerektiren bir sonuç gibi sunulmamalı; kaynakların desteklediği sınır burada kalıyor.`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
      `${policy.answerLabels.caution}: ${sentence(caution)}`,
    );
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
    lines.push(
      `${sentence(assessment)}`,
      `Pratik anlamı: ${sentence(action)}`,
      `Dikkat: ${sentence(caution)}`,
      `Kısa özet: ${sentence(summary)}`,
    );
    return lines.join("\n");
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
