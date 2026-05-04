import type { AnswerDomain } from "./answerSchema.js";
import { normalizeConceptText } from "./conceptNormalizer.js";

export type RouteRiskLevel = "low" | "medium" | "high";
export type RouteConfidence = "low" | "medium" | "high";

export interface DomainRoutePlan {
  domain: AnswerDomain;
  subtopics: string[];
  riskLevel: RouteRiskLevel;
  retrievalHints: string[];
  mustIncludeTerms: string[];
  mustExcludeTerms: string[];
  confidence: RouteConfidence;
}

export interface QuerySignals {
  normalizedQuery: string;
  language: "tr" | "en" | "unknown";
  intent: "steps" | "triage" | "explain" | "compare" | "reassure" | "unknown";
  riskLevel: RouteRiskLevel;
  lexicalTerms: string[];
  significantTerms: string[];
  phraseHints: string[];
  namedEntities: string[];
  possibleDomains: AnswerDomain[];
  routeHints: {
    domain: AnswerDomain;
    subtopics: string[];
    confidence: RouteConfidence;
    authority: "weak";
    retrievalHints: string[];
    mustIncludeTerms: string[];
  };
}

interface RouteRule {
  domain: AnswerDomain;
  subtopic: string;
  terms: string[];
  hints: string[];
  include: string[];
  riskTerms?: string[];
}

function normalize(text: string): string {
  return normalizeConceptText(text);
}

function tokenize(text: string): string[] {
  return unique(
    normalize(text)
      .split(/[^\p{L}\p{N}-]+/u)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function containsTerm(query: string, tokens: string[], term: string): boolean {
  const normalizedTerm = normalize(term);
  if (normalizedTerm.includes(" ")) return query.includes(normalizedTerm);
  if (tokens.includes(normalizedTerm)) return true;
  if (normalizedTerm.endsWith("k")) {
    const softened = `${normalizedTerm.slice(0, -1)}g`;
    if (tokens.some((token) => token.startsWith(softened))) return true;
  }
  if (normalizedTerm.length < 4) return false;
  return tokens.some((token) => token.startsWith(normalizedTerm));
}

function countMatches(query: string, tokens: string[], terms: string[]): number {
  return terms.filter((term) => containsTerm(query, tokens, term)).length;
}

function inferLanguage(text: string): QuerySignals["language"] {
  if (!text.trim()) return "unknown";
  if (/[ğüşöçıİĞÜŞÖÇ]/u.test(text)) return "tr";
  const normalized = normalize(text);
  if (/\b(the|what|how|why|when|should|before|after)\b/u.test(normalized)) return "en";
  if (/\b(ne|nasıl|nasil|neden|hangi|önce|once|sonra|mıyım|miyim)\b/u.test(normalized)) return "tr";
  return "unknown";
}

function inferIntent(query: string): QuerySignals["intent"] {
  if (containsTerm(query, tokenize(query), "panik") || containsTerm(query, tokenize(query), "kork")) return "reassure";
  if (["acil", "beklemeli", "ne zaman", "şiddetli", "siddetli", "ateş", "ates", "riskli mi"].some((term) => containsTerm(query, tokenize(query), term))) return "triage";
  if (["ne yap", "nasıl", "nasil", "hangi", "neye dikkat", "ilk ne", "hazırla", "hazirla", "kontrol"].some((term) => containsTerm(query, tokenize(query), term))) return "steps";
  if (["fark", "karşılaştır", "karsilastir", "hangisi"].some((term) => containsTerm(query, tokenize(query), term))) return "compare";
  if (["nedir", "ne anlama", "yorum", "açıkla", "acikla", "neden"].some((term) => containsTerm(query, tokenize(query), term))) return "explain";
  return "unknown";
}

function extractNamedEntities(text: string): string[] {
  return unique(
    text
      .match(/\b[A-ZÇĞİÖŞÜ][\p{L}\p{N}-]*(?:\s+[A-ZÇĞİÖŞÜ][\p{L}\p{N}-]*){0,3}\b/gu) ?? [],
  ).slice(0, 8);
}

const SIGNAL_STOPWORDS = new Set([
  "acaba",
  "ama",
  "bana",
  "beni",
  "benim",
  "bir",
  "bunu",
  "icin",
  "için",
  "ile",
  "kisa",
  "kısa",
  "mi",
  "mı",
  "mu",
  "mü",
  "ne",
  "neden",
  "nasil",
  "nasıl",
  "olarak",
  "once",
  "önce",
  "sonra",
  "ve",
  "veya",
  "hangi",
  "hazırlamalıyım",
  "hazirlamaliyim",
  "yapmalıyım",
  "yapmaliyim",
]);

function significantTerms(tokens: string[]): string[] {
  return unique(
    tokens
      .filter((token) => token.length >= 3)
      .filter((token) => !SIGNAL_STOPWORDS.has(token)),
  ).slice(0, 16);
}

function phraseHintsFromTerms(terms: string[]): string[] {
  const phrases: string[] = [];
  for (let index = 0; index < terms.length - 1; index += 1) {
    const left = terms[index];
    const right = terms[index + 1];
    if (!left || !right) continue;
    phrases.push(`${left} ${right}`);
  }
  return unique(phrases).slice(0, 10);
}

const ROUTE_RULES: RouteRule[] = [
  {
    domain: "medical",
    subtopic: "smear",
    terms: ["smear", "ascus", "asc-us", "servikal"],
    hints: ["smear sonucu", "servikal tarama", "kadın hastalıkları takip"],
    include: ["smear", "takip", "kontrol"],
  },
  {
    domain: "medical",
    subtopic: "hpv",
    terms: ["hpv", "aşı", "asi"],
    hints: ["HPV sonucu", "HPV takip", "HPV aşı uygunluğu"],
    include: ["hpv", "takip", "kontrol"],
  },
  {
    domain: "medical",
    subtopic: "kist",
    terms: ["kist", "yumurtalık", "yumurtalik", "kitle", "ultrason"],
    hints: ["yumurtalık kisti", "ultrason bulgusu", "takip veya değerlendirme"],
    include: ["kist", "ultrason", "takip", "değerlendirme"],
    riskTerms: ["şiddetli", "siddetli", "ani", "birden"],
  },
  {
    domain: "medical",
    subtopic: "kanama",
    terms: ["kanama", "lekelenme", "adet dışı", "adet disi", "menopoz"],
    hints: ["anormal vajinal kanama", "lekelenme değerlendirme", "menopoz sonrası kanama"],
    include: ["kanama", "lekelenme", "kontrol"],
    riskTerms: ["menopoz", "yoğun", "yogun", "şiddetli", "siddetli"],
  },
  {
    domain: "medical",
    subtopic: "kasik_agrisi",
    terms: ["kasık", "kasik", "pelvik", "alt karın", "alt karin"],
    hints: ["kasık ağrısı triyaj", "pelvik ağrı alarm bulguları"],
    include: ["kasık", "ağrı", "ateş", "kanama", "muayene"],
    riskTerms: ["ateş", "ates", "kusma", "bayılma", "bayilma", "şiddetli", "siddetli"],
  },
  {
    domain: "medical",
    subtopic: "karin_agrisi",
    terms: ["karın", "karin", "karnım", "karnim", "mide", "göbek", "gobek"],
    hints: ["karın ağrısı genel triyaj", "karın ağrısı alarm bulguları"],
    include: ["karın", "ağrı", "ateş", "kusma", "kanama", "muayene"],
    riskTerms: ["ateş", "ates", "kusma", "bayılma", "bayilma", "şiddetli", "siddetli"],
  },
  {
    domain: "medical",
    subtopic: "akinti",
    terms: ["akıntı", "akinti", "koku", "kaşıntı", "kasinti", "yanma"],
    hints: ["vajinal akıntı", "akıntı koku kaşıntı", "kadın hastalıkları kontrol"],
    include: ["akıntı", "koku", "kaşıntı", "kontrol"],
  },
  {
    domain: "medical",
    subtopic: "pediatri_terleme",
    terms: [
      "bebek",
      "bebeğim",
      "bebegim",
      "çocuk",
      "cocuk",
      "terliyor",
      "terleme",
      "ter",
      "ateş",
      "ates",
      "oda sıcaklığı",
      "oda sicakligi",
      "emzirme",
    ],
    hints: ["bebek terlemesi", "çocuk terlemesi", "ateş kontrolü", "oda sıcaklığı", "beslenme durumu"],
    include: ["bebek", "terleme", "ateş", "oda sıcaklığı", "beslenme", "çocuk doktoru"],
    riskTerms: ["ateş", "ates", "morarma", "nefes", "beslenememe", "halsizlik", "uyandırılamıyor", "uyandirulamiyor"],
  },
  {
    domain: "medical",
    subtopic: "biyopsi_patoloji",
    terms: ["biyopsi", "patoloji", "parça", "parca", "temiz"],
    hints: ["biyopsi sonucu", "patoloji sonucu", "takip planı"],
    include: ["biyopsi", "patoloji", "temiz", "takip", "kontrol"],
  },
  {
    domain: "legal",
    subtopic: "bosanma",
    terms: ["boşanma", "bosanma", "anlaşmalı boşanma", "anlasmali bosanma", "çekişmeli boşanma", "cekismeli bosanma"],
    hints: ["boşanma davası", "anlaşmalı boşanma", "çekişmeli boşanma"],
    include: ["boşanma", "dava", "belge", "süre", "avukat"],
  },
  {
    domain: "legal",
    subtopic: "velayet",
    terms: ["velayet", "çocuk teslimi", "cocuk teslimi", "kişisel ilişki", "kisisel iliski"],
    hints: ["velayet değerlendirme", "çocuğun üstün yararı", "kişisel ilişki düzenlemesi"],
    include: ["velayet", "çocuk", "belge", "mahkeme", "avukat"],
    riskTerms: ["şiddet", "siddet", "kaçırma", "kacirma"],
  },
  {
    domain: "legal",
    subtopic: "nafaka",
    terms: ["nafaka", "iştirak nafakası", "istirak nafakasi", "yoksulluk nafakası", "yoksulluk nafakasi"],
    hints: ["nafaka talebi", "gelir gider belgesi", "mahkeme değerlendirmesi"],
    include: ["nafaka", "gelir", "belge", "mahkeme", "avukat"],
  },
  {
    domain: "legal",
    subtopic: "miras",
    terms: ["miras", "veraset", "vasiyet", "mirasçı", "mirasci", "tereke"],
    hints: ["miras hukuku", "veraset belgesi", "tereke değerlendirmesi"],
    include: ["miras", "veraset", "belge", "süre", "avukat"],
  },
  {
    domain: "legal",
    subtopic: "icra",
    terms: ["icra", "haciz", "ödeme emri", "odeme emri", "itirazın iptali", "itirazin iptali"],
    hints: ["icra takibi", "ödeme emrine itiraz", "süre ve belge"],
    include: ["icra", "itiraz", "süre", "belge", "avukat"],
    riskTerms: ["haciz", "süre", "sure", "tebligat"],
  },
  {
    domain: "legal",
    subtopic: "kira",
    terms: ["kira", "kiracı", "kiraci", "ev sahibi", "depozito"],
    hints: ["kira hukuku", "depozito iadesi", "belge ve süre"],
    include: ["kira", "depozito", "belge", "süre", "avukat"],
  },
  {
    domain: "legal",
    subtopic: "is_hukuku",
    terms: ["işçi", "isci", "işveren", "isveren", "mesai", "fazla mesai", "kıdem", "kidem"],
    hints: ["iş hukuku", "fazla mesai delil", "hak arama süresi"],
    include: ["iş", "mesai", "delil", "süre", "avukat"],
  },
  {
    domain: "legal",
    subtopic: "tuketici",
    terms: ["tüketici", "tuketici", "ayıplı", "ayipli", "iade", "satıcı", "satici"],
    hints: ["tüketici başvurusu", "ayıplı ürün", "belge ve başvuru"],
    include: ["tüketici", "iade", "belge", "başvuru"],
  },
  {
    domain: "legal",
    subtopic: "trafik",
    terms: ["trafik", "trafik cezası", "trafik cezasi", "ceza"],
    hints: ["trafik cezası itiraz", "süre ve belge"],
    include: ["trafik", "ceza", "itiraz", "süre", "belge"],
  },
  {
    domain: "legal",
    subtopic: "sozlesme",
    terms: ["sözleşme", "sozlesme", "madde", "cezai şart", "cezai sart"],
    hints: ["sözleşme hükmü", "cezai şart", "hukuki değerlendirme"],
    include: ["sözleşme", "madde", "hukuki", "avukat"],
  },
  {
    domain: "finance",
    subtopic: "yatirim_riski",
    terms: ["yatırım", "yatirim", "hisse", "borsa", "kripto", "portföy", "portfoy", "garanti"],
    hints: ["yatırım riski", "vade ve risk profili", "yatırım danışmanı"],
    include: ["risk", "vade", "danışman", "garanti"],
  },
  {
    domain: "technical",
    subtopic: "migration",
    terms: ["migration", "veritabanı", "veritabani", "rollback", "staging", "yedek"],
    hints: ["veritabanı migration", "yedek rollback staging", "log kontrol"],
    include: ["migration", "yedek", "rollback", "staging", "log"],
    riskTerms: ["production", "prod", "üretim", "uretim", "sil", "drop"],
  },
  {
    domain: "technical",
    subtopic: "deploy",
    terms: ["deploy", "sunucu", "log", "hata", "bug", "api"],
    hints: ["deploy kontrol", "log inceleme", "rollback planı"],
    include: ["deploy", "log", "rollback", "test"],
  },
  {
    domain: "education",
    subtopic: "sinav",
    terms: ["sınav", "sinav", "lgs", "yks", "ösym", "osym", "sınav itiraz", "sinav itiraz"],
    hints: ["sınav başvurusu", "sınav itiraz süresi", "resmi kılavuz kontrolü"],
    include: ["sınav", "başvuru", "itiraz", "süre", "resmi"],
  },
  {
    domain: "education",
    subtopic: "mufredat",
    terms: ["müfredat", "mufredat", "kazanım", "kazanim", "ders programı", "ders programi"],
    hints: ["müfredat kazanımları", "ders programı", "resmi eğitim kaynağı"],
    include: ["müfredat", "ders", "kazanım", "program"],
  },
  {
    domain: "education",
    subtopic: "ogrenci_disiplini",
    terms: ["disiplin", "uzaklaştırma", "uzaklastirma", "kınama", "kinama", "okul cezası", "okul cezasi"],
    hints: ["öğrenci disiplin süreci", "okul disiplin kurulu", "veli bilgilendirme"],
    include: ["disiplin", "öğrenci", "veli", "okul", "belge"],
    riskTerms: ["uzaklaştırma", "uzaklastirma", "şiddet", "siddet"],
  },
  {
    domain: "education",
    subtopic: "okul_yonetimi",
    terms: ["okul yönetimi", "okul yonetimi", "nakil", "devamsızlık", "devamsizlik", "veli", "rehberlik"],
    hints: ["okul yönetimi başvurusu", "devamsızlık ve nakil", "rehberlik birimi"],
    include: ["okul", "veli", "başvuru", "rehberlik", "belge"],
  },
  {
    domain: "education",
    subtopic: "ozel_egitim",
    terms: ["özel eğitim", "ozel egitim", "bep", "ram", "kaynaştırma", "kaynastirma"],
    hints: ["özel eğitim desteği", "RAM değerlendirmesi", "BEP planı"],
    include: ["özel eğitim", "ram", "bep", "veli", "değerlendirme"],
  },
  {
    domain: "general",
    subtopic: "travel_document",
    terms: ["pasaport", "vize", "rezervasyon", "uçuş", "ucus", "seyahat"],
    hints: ["seyahat belgesi", "pasaport geçerliliği", "resmi kaynak kontrolü"],
    include: ["pasaport", "rezervasyon", "resmi", "güncel"],
  },
];

function fallbackDomainFromMatches(matches: RouteRule[]): AnswerDomain {
  const counts = new Map<AnswerDomain, number>();
  for (const match of matches) {
    counts.set(match.domain, (counts.get(match.domain) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "general";
}

export function routeQuery(userQuery: string): DomainRoutePlan {
  const normalized = normalize(userQuery);
  const tokens = tokenize(userQuery);
  const matched = ROUTE_RULES
    .map((rule) => ({ rule, score: countMatches(normalized, tokens, rule.terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const rules = matched.map((item) => item.rule);
  const domain = fallbackDomainFromMatches(rules);
  const domainRules = rules.filter((rule) => rule.domain === domain);
  const riskHits = domainRules.flatMap((rule) => rule.riskTerms ?? []).filter((term) => containsTerm(normalized, tokens, term));
  const confidence: RouteConfidence =
    domainRules.length === 0 ? "low" : domainRules.length >= 2 || matched[0]?.score > 1 ? "high" : "medium";

  return {
    domain,
    subtopics: unique(domainRules.map((rule) => rule.subtopic)).slice(0, 4),
    riskLevel: riskHits.length > 0 ? "high" : domain === "medical" || domain === "legal" || domain === "finance" ? "medium" : "low",
    retrievalHints: unique(domainRules.flatMap((rule) => rule.hints)).slice(0, 8),
    mustIncludeTerms: unique(domainRules.flatMap((rule) => rule.include)).slice(0, 12),
    mustExcludeTerms: ["kesin kanser", "mutlaka ameliyat", "ilaç başla", "garanti getiri", "kesin sonuç"],
    confidence,
  };
}

export function extractQuerySignals(userQuery: string): QuerySignals {
  const routeHints = routeQuery(userQuery);
  const tokens = unique(tokenize(userQuery)).slice(0, 24);
  const terms = significantTerms(tokens);
  const possibleDomains = routeHints.confidence === "low" ? [] : [routeHints.domain];

  return {
    normalizedQuery: normalize(userQuery).trim(),
    language: inferLanguage(userQuery),
    intent: inferIntent(normalize(userQuery)),
    riskLevel: routeHints.riskLevel,
    lexicalTerms: tokens,
    significantTerms: terms,
    phraseHints: phraseHintsFromTerms(terms),
    namedEntities: extractNamedEntities(userQuery),
    possibleDomains,
    routeHints: {
      domain: routeHints.domain,
      subtopics: routeHints.subtopics,
      confidence: routeHints.confidence,
      authority: "weak",
      retrievalHints: routeHints.retrievalHints,
      mustIncludeTerms: routeHints.mustIncludeTerms,
    },
  };
}
