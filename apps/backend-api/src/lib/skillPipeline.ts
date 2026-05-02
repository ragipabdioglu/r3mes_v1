import { routeQuery, type DomainRoutePlan } from "./queryRouter.js";
import type { AnswerIntent } from "./answerSchema.js";
import { expandConceptTerms, normalizeConceptText } from "./conceptNormalizer.js";

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

function sentenceFragments(text: string, limit = 2): string[] {
  return text
    .replace(/^\s*[-*]\s+/gm, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, limit);
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

function compactEvidenceLine(line: string, maxChars = 220): string {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trim()}…`;
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

  if (hasAny(userQuery, ["hukuk", "dava", "avukat", "sözleşme", "sozlesme", "kira", "tüketici", "tuketici", "ayıplı", "ayipli", "trafik cezası", "itiraz"])) {
    expectedEvidenceType = "guideline";
    searchQueries.push(
      `${userQuery} hukuki bilgi`,
      `${userQuery} süre belge başvuru`,
      `${userQuery} avukat yetkili kurum`,
    );
    mustIncludeTerms.push("hukuk", "süre", "belge", "başvuru", "avukat", "sözleşme");
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
  const usableFacts: string[] = [];
  const directAnswerFacts: string[] = [];
  const supportingContext: string[] = [];
  const uncertainOrUnusable: string[] = [];
  const redFlags: string[] = [];
  const sourceIds: string[] = [];
  const queryTokens = new Set(tokenizeForOverlap(input.userQuery));
  const weakIntent = inferAnswerIntent(input.userQuery);

  const addUsableIfRelevant = (sourceLabel: string, fragment: string, opts: { allowGenericGuidance?: boolean; kind?: "direct" | "supporting" } = {}) => {
    const sanitized = removeOffQuerySymptomPhrases(input.userQuery, fragment);
    if (!sanitized.trim()) return;
    const overlap = queryOverlapScore(queryTokens, sanitized);
    const coreOverlap = queryCoreOverlapScore(queryTokens, sanitized);
    const strongOverlap = hasStrongQueryOverlap(queryTokens, sanitized);
    const offQuerySymptom = hasOffQuerySymptom(input.userQuery, sanitized);
    if (offQuerySymptom && !opts.allowGenericGuidance) return;
    const acceptDirect = opts.kind !== "supporting" && (strongOverlap || coreOverlap > 0 || (weakIntent === "explain" && overlap > 0));
    const acceptSupporting =
      opts.kind === "supporting" &&
      (strongOverlap || coreOverlap > 0 || (opts.allowGenericGuidance && overlap > 0));
    if (acceptDirect || acceptSupporting) {
      const line = compactEvidenceLine(evidenceLine(sourceLabel, sanitized));
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
    sourceIds.push(card.sourceId);

    for (const section of cardSections(card)) {
      for (const fragment of sentenceFragments(section.text, 2)) {
        if (section.kind === "direct") {
          addUsableIfRelevant(sourceLabel, fragment, { allowGenericGuidance: !hasOffQuerySymptom(input.userQuery, fragment) });
        } else if (section.kind === "supporting") {
          addUsableIfRelevant(sourceLabel, fragment, {
            allowGenericGuidance: !hasOffQuerySymptom(input.userQuery, fragment),
            kind: "supporting",
          });
        } else if (section.kind === "risk") {
          const sanitized = removeOffQuerySymptomPhrases(input.userQuery, fragment);
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
  const intentResolution = resolveAnswerIntent({
    userQuery: input.userQuery,
    weakIntent,
    directFactCount: directAnswerFacts.length,
    supportingFactCount: supportingContext.length,
    riskFactCount: redFlags.length,
    missingInfoCount: missingInfo.length,
    sourceCount: sourceIds.length,
  });

  return {
    answerIntent: intentResolution.intent,
    intentResolution,
    directAnswerFacts: unique(directAnswerFacts).slice(0, 3),
    supportingContext: unique(supportingContext).slice(0, 2),
    riskFacts: unique(redFlags).slice(0, 3),
    notSupported: unique([...uncertainOrUnusable, ...missingInfo]).slice(0, 4),
    usableFacts: unique(usableFacts).slice(0, 5),
    uncertainOrUnusable: unique(uncertainOrUnusable).slice(0, 4),
    redFlags: unique(redFlags).slice(0, 4),
    sourceIds: unique(sourceIds).slice(0, 8),
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
