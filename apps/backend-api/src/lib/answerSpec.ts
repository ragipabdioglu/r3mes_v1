import type { AnswerDomain, AnswerIntent, GroundedMedicalAnswer, GroundingConfidence } from "./answerSchema.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

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
}

function stripSourcePrefix(value: string): string {
  return value.replace(/^[^:]{1,120}:\s*/, "").trim();
}

function cleanValues(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of (values ?? []).map(stripSourcePrefix).map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function fallbackAction(domain: AnswerDomain): string {
  if (domain === "technical") return "Önce kontrollü ortamda deneyip yedek, log ve geri dönüş planını netleştirin.";
  if (domain === "legal") return "Belgeleri saklayıp süre ve başvuru yolu için yetkili kurum veya avukattan destek alın.";
  if (domain === "finance") return "Kişisel karar vermeden önce risk, vade, maliyet ve danışmanlık ihtiyacını değerlendirin.";
  if (domain === "education") return "Okul, rehberlik birimi veya ilgili resmi kaynakla doğrulanabilir adımları netleştirin.";
  if (domain === "medical") return "Şikayet sürerse veya artarsa ilgili sağlık uzmanıyla değerlendirme planlayın.";
  return "Karar vermeden önce güncel ve yetkili kaynakla doğrulama yapın.";
}

function fallbackCaution(domain: AnswerDomain): string {
  if (domain === "technical") return "Yedeksiz işlem, belirsiz rollback veya veri silen komutlar yüksek risklidir.";
  if (domain === "legal") return "Kaynakta açık dayanak yoksa kesin sonuç, garanti veya dava sonucu söylenmemelidir.";
  if (domain === "finance") return "Kesin getiri, al/sat/tut veya kişiye özel yatırım tavsiyesi çıkarılmamalıdır.";
  if (domain === "education") return "Kaynakta açık dayanak yoksa kesin tanı, kesin başarı veya tek tip uygulama çıkarılmamalıdır.";
  if (domain === "medical") return "Kaynakta açık dayanak yoksa tanı, ilaç, test veya kesin neden çıkarılmamalıdır.";
  return "Kaynakta açık dayanak yoksa kesin hüküm kurulmamalıdır.";
}

function sectionsForIntent(intent: AnswerIntent): AnswerSpec["sections"] {
  if (intent === "triage") return ["caution", "assessment", "action", "summary"];
  if (intent === "steps") return ["action", "assessment", "caution", "summary"];
  if (intent === "reassure") return ["assessment", "action", "caution"];
  if (intent === "compare") return ["assessment", "summary", "caution", "action"];
  return ["assessment", "action", "caution", "summary"];
}

export function buildAnswerSpec(opts: {
  answerDomain: AnswerDomain;
  groundingConfidence: GroundingConfidence;
  userQuery: string;
  evidence: EvidenceExtractorOutput | null;
}): AnswerSpec {
  const directFacts = cleanValues(opts.evidence?.directAnswerFacts);
  const supportingFacts = cleanValues(opts.evidence?.supportingContext);
  const usableFacts = cleanValues(opts.evidence?.usableFacts);
  const riskFacts = cleanValues(opts.evidence?.redFlags);
  const unknowns = cleanValues([
    ...(opts.evidence?.uncertainOrUnusable ?? []),
    ...(opts.evidence?.missingInfo ?? []),
  ]);
  const facts = cleanValues([...directFacts, ...supportingFacts, ...usableFacts]);
  const contradictionUnknowns = unknowns.filter((item) => /çeliş|celis/u.test(item.toLocaleLowerCase("tr-TR")));
  const assessment = directFacts[0] ?? usableFacts[0] ?? "Kaynaklarda bu soruya doğrudan sınırlı bilgi bulundu.";
  const action = supportingFacts[0] ?? directFacts[1] ?? usableFacts[1] ?? fallbackAction(opts.answerDomain);
  const caution = cleanValues([
    ...contradictionUnknowns,
    ...(riskFacts.length > 0 ? riskFacts : [fallbackCaution(opts.answerDomain)]),
  ]).slice(0, 3);
  const summary = directFacts[0] ?? usableFacts[0] ?? assessment;
  const answerIntent = opts.evidence?.answerIntent ?? "unknown";
  const tone = opts.groundingConfidence === "low" ? "cautious" : answerIntent === "reassure" ? "calm" : "direct";

  return {
    answerDomain: opts.answerDomain,
    answerIntent,
    groundingConfidence: opts.groundingConfidence,
    userQuery: opts.userQuery,
    tone,
    sections: sectionsForIntent(answerIntent),
    assessment,
    action,
    caution,
    summary,
    unknowns: unknowns.slice(0, 4),
    sourceIds: opts.evidence?.sourceIds ?? [],
    facts: facts.slice(0, 6),
  };
}

export function buildAnswerSpecFromGroundedAnswer(answer: GroundedMedicalAnswer): AnswerSpec {
  const assessment =
    answer.condition_context ||
    answer.general_assessment ||
    answer.one_sentence_summary ||
    answer.answer ||
    "Kaynaklarda bu soruya doğrudan sınırlı bilgi bulundu.";
  const action = answer.safe_action || answer.recommended_action || fallbackAction(answer.answer_domain);
  const caution = cleanValues([
    ...(answer.red_flags.length > 0 ? answer.red_flags : answer.visit_triggers),
    ...answer.doctor_visit_when,
  ]);
  const unknowns = cleanValues(answer.avoid_inference);
  const facts = cleanValues([
    answer.answer,
    answer.condition_context,
    answer.safe_action,
    answer.general_assessment,
    answer.recommended_action,
    answer.one_sentence_summary,
    answer.short_summary,
  ]);
  const tone =
    answer.grounding_confidence === "low" ? "cautious" : answer.answer_intent === "reassure" ? "calm" : "direct";

  return {
    answerDomain: answer.answer_domain,
    answerIntent: answer.answer_intent,
    groundingConfidence: answer.grounding_confidence,
    userQuery: answer.user_query,
    tone,
    sections: sectionsForIntent(answer.answer_intent),
    assessment,
    action,
    caution: (caution.length > 0 ? caution : [fallbackCaution(answer.answer_domain)]).slice(0, 3),
    summary: answer.short_summary || answer.one_sentence_summary || assessment,
    unknowns: unknowns.slice(0, 4),
    sourceIds: answer.used_source_ids,
    facts: facts.slice(0, 6),
  };
}
