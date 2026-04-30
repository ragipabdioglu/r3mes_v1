import { routeQuery, type DomainRoutePlan } from "./queryRouter.js";
import type { AnswerIntent } from "./answerSchema.js";

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

function sentenceFragments(text: string, limit = 2): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function tokenizeForOverlap(text: string): string[] {
  return text
    .toLocaleLowerCase("tr-TR")
    .split(/[^\p{L}\p{N}-]+/u)
    .map((part) => part.trim())
    .map((part) => {
      const canonical: Record<string, string> = {
        "ağrım": "ağrı",
        agrim: "agri",
        "ağrısı": "ağrı",
        agrisi: "agri",
        "karnım": "karın",
        karnim: "karin",
        kasigim: "kasik",
        "kasığım": "kasık",
        okulda: "okul",
        "desteği": "destek",
        destegi: "destek",
        "adımları": "adım",
        adimlari: "adim",
        "konuşmalıyım": "konuş",
        konusmaliyim: "konus",
      };
      const direct = canonical[part] ?? part;
      if (direct.startsWith("depozito")) return "depozito";
      if (direct.startsWith("protokol")) return "protokol";
      if (direct.startsWith("belge")) return "belge";
      if (direct.startsWith("dekont")) return "belge";
      if (direct.startsWith("sözleşme") || direct.startsWith("sozlesme")) return "sözleşme";
      if (direct.startsWith("boşanma") || direct.startsWith("bosanma")) return "boşanma";
      if (direct.startsWith("anlaşma") || direct.startsWith("anlasma")) return "anlaşma";
      if (direct.startsWith("başlık") || direct.startsWith("baslik")) return "başlık";
      if (direct.startsWith("netleştir") || direct.startsWith("netlestir")) return "netleştir";
      if (direct.startsWith("velayet")) return "velayet";
      if (direct.startsWith("nafaka")) return "nafaka";
      if (direct.startsWith("kayıt") || direct.startsWith("kayit")) return "kayıt";
      if (direct.startsWith("başvuru") || direct.startsWith("basvuru")) return "başvuru";
      return direct;
    })
    .filter((part) => part.length >= 3);
}

function queryOverlapScore(queryTokens: Set<string>, text: string): number {
  return tokenizeForOverlap(text).filter((token) => queryTokens.has(token)).length;
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
  const answerIntent = inferAnswerIntent(input.userQuery);

  const addUsableIfRelevant = (sourceLabel: string, fragment: string, opts: { allowGenericGuidance?: boolean; kind?: "direct" | "supporting" } = {}) => {
    const sanitized = removeOffQuerySymptomPhrases(input.userQuery, fragment);
    if (!sanitized.trim()) return;
    const overlap = queryOverlapScore(queryTokens, sanitized);
    const strongOverlap = hasStrongQueryOverlap(queryTokens, sanitized);
    const offQuerySymptom = hasOffQuerySymptom(input.userQuery, sanitized);
    if (offQuerySymptom && !opts.allowGenericGuidance) return;
    const acceptDirect = opts.kind !== "supporting" && (strongOverlap || (answerIntent === "explain" && overlap > 0));
    const acceptSupporting =
      opts.kind === "supporting" &&
      (strongOverlap || (opts.allowGenericGuidance && overlap > 0));
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

    for (const fragment of sentenceFragments(card.patientSummary ?? "", 2)) {
      addUsableIfRelevant(sourceLabel, fragment, { allowGenericGuidance: !hasOffQuerySymptom(input.userQuery, fragment) });
    }

    for (const fragment of sentenceFragments(card.clinicalTakeaway ?? "", 2)) {
      addUsableIfRelevant(sourceLabel, fragment, { allowGenericGuidance: !hasOffQuerySymptom(input.userQuery, fragment) });
    }

    for (const fragment of sentenceFragments(card.safeGuidance ?? "", 2)) {
      addUsableIfRelevant(sourceLabel, fragment, {
        allowGenericGuidance: !hasOffQuerySymptom(input.userQuery, fragment),
        kind: "supporting",
      });
    }

    for (const fragment of sentenceFragments(card.redFlags ?? "", 2)) {
      const sanitized = removeOffQuerySymptomPhrases(input.userQuery, fragment);
      const overlap = queryOverlapScore(queryTokens, sanitized);
      if (sanitized && (overlap > 0 || !hasOffQuerySymptom(input.userQuery, sanitized))) {
        redFlags.push(compactEvidenceLine(evidenceLine(sourceLabel, sanitized)));
      }
    }

    for (const fragment of sentenceFragments(card.doNotInfer ?? "", 2)) {
      uncertainOrUnusable.push(compactEvidenceLine(evidenceLine(sourceLabel, fragment)));
    }
  }

  const missingInfo =
    usableFacts.length === 0
      ? ["Soruya doğrudan dayanak sağlayan yeterli kaynak cümlesi bulunamadı."]
      : [];

  return {
    answerIntent,
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
