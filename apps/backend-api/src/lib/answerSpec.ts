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

function stripDocumentScaffold(value: string): string {
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
  if (letters.length >= 6 && uppercaseLetters.length / letters.length > 0.85 && cleaned.length <= 140) {
    return "";
  }
  return cleaned;
}

function cleanValues(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of (values ?? [])
    .map(stripSourcePrefix)
    .map(stripDocumentScaffold)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const key = value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").slice(0, 220);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeForFactMatch(value: string): string {
  return value
    .normalize("NFKC")
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
    .replace(/\s+/g, " ")
    .trim();
}

const FACT_STOPWORDS = new Set([
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
  "ile",
  "kisa",
  "mi",
  "midir",
  "ne",
  "nasil",
  "olur",
  "sonra",
  "ve",
  "veya",
]);

const MEDICAL_QUERY_CONTEXT_STOPWORDS = new Set([
  ...FACT_STOPWORDS,
  "acil",
  "artık",
  "artik",
  "bana",
  "bende",
  "bunun",
  "çıktı",
  "cikti",
  "daha",
  "devam",
  "ediyor",
  "etmeli",
  "etmeliyim",
  "gerekiyor",
  "halen",
  "hala",
  "hemen",
  "kötü",
  "kotu",
  "miyim",
  "mıyım",
  "olmalı",
  "olmali",
  "sonuc",
  "sonuç",
  "sonucu",
  "tekrar",
  "temkinli",
]);

function medicalQueryContextTerms(query: string, existingText: string): string[] {
  const existing = normalizeForFactMatch(existingText);
  const normalizedQuery = normalizeForFactMatch(query);
  const tokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !MEDICAL_QUERY_CONTEXT_STOPWORDS.has(token));
  const prioritized = tokens
    .map((token, index) => {
      const canonicalToken =
        token.startsWith("temiz") ? "temiz"
        : token.startsWith("takip") ? "takip"
        : token.startsWith("kasik") || token.startsWith("kasig") ? "kasik"
        : token.startsWith("kist") ? "kist"
        : token.startsWith("boyut") ? "boyut"
        : token.startsWith("smear") ? "smear"
        : token.startsWith("biyops") ? "biyopsi"
        : token.startsWith("patoloj") ? "patoloji"
        : token;
      let score = 0;
      if (/^(hpv|asc|ascus|asc-us|smear|biyopsi|patoloji|kist|boyut|takip|kasik|kanama|lekelenme|gebelik|hamile|temiz|muayene)$/u.test(canonicalToken)) score += 20;
      if (/^(agri|agrisi|agriyor)$/u.test(canonicalToken)) score += 5;
      if (!existing.includes(canonicalToken)) score += 6;
      return { token: canonicalToken, index, score };
    })
    .filter(({ score }) => score >= 10)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ token }) => token);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of prioritized) {
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= 4) break;
  }
  return terms;
}

function medicalQueryContextFact(query: string, existingText: string): string | null {
  const terms = medicalQueryContextTerms(query, existingText);
  if (terms.length === 0) return null;
  const joined = terms.join(", ");
  return `Soruda belirtilen ${joined} bilgisi kaynak yanıtını yorumlarken korunmalı; bu başlıklar kesin tanı yerine uygun muayene/kontrol bağlamında değerlendirilmelidir.`;
}

function factTokens(value: string): string[] {
  return normalizeForFactMatch(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !FACT_STOPWORDS.has(token));
}

function factQualityScore(value: string, userQuery: string): number {
  const tokens = factTokens(value);
  if (tokens.length === 0) return -100;
  const queryTokens = new Set(factTokens(userQuery));
  const overlap = tokens.filter((token) => queryTokens.has(token)).length;
  const directActionBonus = /(göndermeyiniz|göndermeyin|bilgilendir|başvur|kontrol|hazırla|sakla|denenmel|planlan|yapılmal|edilmel)/iu.test(value)
    ? 4
    : 0;
  const sentenceBonus = /[.!?]$/u.test(value.trim()) ? 1 : 0;
  const incompleteLongPenalty = !/[.!?]$/u.test(value.trim()) && value.trim().length >= 60 ? 10 : 0;
  const lengthBonus = value.length >= 45 && value.length <= 260 ? 2 : value.length < 24 ? -4 : 0;
  const truncationPenalty = /[…]|\.{3}$/u.test(value) ? 5 : 0;
  const scaffoldPenalty = /(page\s+\d+|rehberi\s+\d+|önemseyiniz|para ile satılamaz)/iu.test(value) ? 6 : 0;
  const genericPenalty = /(doğru ve güvenilir kaynaklardan bilgi edin|kaynakta özel alarm|kaynakta açık dayanak yoksa)/iu.test(value)
    ? 3
    : 0;
  return overlap * 6 + directActionBonus + sentenceBonus + lengthBonus - truncationPenalty - scaffoldPenalty - genericPenalty - incompleteLongPenalty;
}

function prioritizeFacts(values: string[], userQuery: string): string[] {
  return values
    .map((value, index) => ({ value, index, score: factQualityScore(value, userQuery) }))
    .filter(({ score }) => score > -20)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ value }) => value);
}

function firstUsefulFact(values: string[], userQuery: string, exclude: string[] = []): string | undefined {
  const excluded = new Set(exclude.map((value) => normalizeForFactMatch(value)));
  return values.find((value) => !excluded.has(normalizeForFactMatch(value)) && factQualityScore(value, userQuery) >= 1);
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
  const directFacts = prioritizeFacts(cleanValues(opts.evidence?.directAnswerFacts), opts.userQuery);
  const supportingFacts = prioritizeFacts(cleanValues(opts.evidence?.supportingContext), opts.userQuery);
  const usableFacts = prioritizeFacts(cleanValues(opts.evidence?.usableFacts), opts.userQuery);
  const riskFacts = prioritizeFacts(cleanValues(opts.evidence?.redFlags), opts.userQuery);
  const unknowns = cleanValues([
    ...(opts.evidence?.uncertainOrUnusable ?? []),
    ...(opts.evidence?.missingInfo ?? []),
  ]);
  const facts = cleanValues([...directFacts, ...supportingFacts, ...usableFacts]);
  const contradictionUnknowns = unknowns.filter((item) => /çeliş|celis/u.test(item.toLocaleLowerCase("tr-TR")));
  const queryContextFact =
    opts.answerDomain === "medical"
      ? medicalQueryContextFact(opts.userQuery, [...facts, ...riskFacts, ...unknowns].join(" "))
      : null;
  const assessment = directFacts[0] ?? usableFacts[0] ?? "Kaynaklarda bu soruya doğrudan sınırlı bilgi bulundu.";
  const action =
    queryContextFact ??
    firstUsefulFact(supportingFacts, opts.userQuery, [assessment]) ??
    firstUsefulFact(directFacts, opts.userQuery, [assessment]) ??
    firstUsefulFact(usableFacts, opts.userQuery, [assessment]) ??
    firstUsefulFact(directFacts, opts.userQuery) ??
    firstUsefulFact(usableFacts, opts.userQuery) ??
    fallbackAction(opts.answerDomain);
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
    facts: cleanValues([queryContextFact ?? "", ...facts]).slice(0, 6),
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
