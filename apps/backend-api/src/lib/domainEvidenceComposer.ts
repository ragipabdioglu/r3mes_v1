import type { GroundedMedicalAnswer } from "./answerSchema.js";
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

function lowGroundingLead(answer: GroundedMedicalAnswer): string | null {
  if (answer.grounding_confidence !== "low") return null;
  return "Bu kaynaklarla net ve kesin bir cevap vermek doğru olmaz; aşağıdaki yanıt yalnızca eldeki sınırlı dayanağa göre okunmalı.";
}

export function composeDomainEvidenceAnswer(answer: GroundedMedicalAnswer): string {
  const policy = getDomainPolicy(answer.answer_domain);
  const sourceNote =
    answer.grounding_confidence === "low"
      ? "Eldeki kaynak dayanağı sınırlı."
      : "Kaynaklarda bu soruya doğrudan dayanak var.";
  const assessment = clean(
    answer.condition_context || answer.general_assessment || answer.one_sentence_summary,
    sourceNote,
  );
  const action = clean(
    answer.safe_action || answer.recommended_action,
    answer.answer_domain === "technical"
      ? "Değişikliği önce kontrollü ortamda deneyip yedek ve geri dönüş planını netleştirin."
      : "Kaynak yetersizse karar vermeden önce ilgili uzman veya yetkili kurumdan destek alın.",
  );
  const caution = joinItems(
    answer.red_flags.length > 0 ? answer.red_flags : answer.visit_triggers,
    answer.answer_domain === "technical"
      ? "Yedeksiz işlem, belirsiz rollback, uzun kilit süresi veya veri silen komutlar yüksek risklidir."
      : "Kaynakta açık dayanak yoksa kesin sonuç veya garanti ifade edilmemelidir.",
  );
  const summary = clean(
    answer.short_summary || answer.one_sentence_summary || assessment,
    "Kaynaklara bağlı kalarak temkinli ilerlemek gerekir.",
  );

  const lead = lowGroundingLead(answer);
  const lines: string[] = [];
  if (lead) lines.push(lead);

  if (answer.answer_intent === "triage") {
    lines.push(
      `${policy.answerLabels.caution}: ${sentence(caution)}`,
      `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
      `Özet: ${sentence(summary)}`,
    );
    return lines.join("\n");
  }

  if (answer.answer_intent === "steps") {
    lines.push(
      `Kısa plan:`,
      `1. ${sentence(action)}`,
      `2. ${sentence(assessment)}`,
      `3. ${sentence(caution)}`,
      `Özet: ${sentence(summary)}`,
    );
    return lines.join("\n");
  }

  if (answer.answer_intent === "reassure") {
    lines.push(
      `Kısa cevap: ${sentence(assessment)}`,
      `Bu, tek başına kesin veya panik gerektiren bir sonuç gibi sunulmamalı; kaynakların desteklediği sınır burada kalıyor.`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
      `${policy.answerLabels.caution}: ${sentence(caution)}`,
    );
    return lines.join("\n");
  }

  if (answer.answer_intent === "compare") {
    lines.push(
      `${policy.answerLabels.assessment}: ${sentence(assessment)}`,
      `Karşılaştırırken kullanılabilecek dayanak: ${sentence(summary)}`,
      `${policy.answerLabels.caution}: ${sentence(caution)}`,
      `${policy.answerLabels.action}: ${sentence(action)}`,
    );
    return lines.join("\n");
  }

  if (answer.answer_intent === "explain") {
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
