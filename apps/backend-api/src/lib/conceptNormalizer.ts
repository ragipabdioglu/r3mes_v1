export interface CanonicalConceptRule {
  id: string;
  patterns: RegExp[];
  terms: string[];
}

const TURKISH_FOLD: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  İ: "i",
  ö: "o",
  ş: "s",
  ü: "u",
};

export function normalizeConceptText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[çğıİöşü]/g, (char) => TURKISH_FOLD[char] ?? char)
    .toLocaleLowerCase("tr-TR")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LIGHT_TURKISH_SUFFIXES = [
  "larimizdan",
  "lerimizden",
  "larimiz",
  "lerimiz",
  "lariniz",
  "leriniz",
  "larindan",
  "lerinden",
  "larina",
  "lerine",
  "lardan",
  "lerden",
  "larin",
  "lerin",
  "lari",
  "leri",
  "imiz",
  "iniz",
  "indan",
  "inden",
  "undan",
  "unden",
  "lar",
  "ler",
  "nin",
  "nun",
  "im",
  "in",
  "um",
  "un",
  "si",
  "su",
  "dan",
  "den",
  "da",
  "de",
  "ya",
  "ye",
  "a",
  "e",
  "i",
  "u",
];

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map(normalizeConceptText).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function softenFinalConsonant(value: string): string[] {
  if (value.length < 4) return [value];
  const last = value.at(-1);
  if (last === "g") return [value, `${value.slice(0, -1)}k`];
  if (last === "b") return [value, `${value.slice(0, -1)}p`];
  if (last === "d") return [value, `${value.slice(0, -1)}t`];
  return [value];
}

function lightTokenVariants(value: string): string[] {
  const normalized = normalizeConceptText(value);
  const variants = new Set<string>(softenFinalConsonant(normalized));
  for (const suffix of LIGHT_TURKISH_SUFFIXES) {
    if (!normalized.endsWith(suffix)) continue;
    const stem = normalized.slice(0, -suffix.length);
    if (stem.length < 3) continue;
    for (const variant of softenFinalConsonant(stem)) variants.add(variant);
  }
  return [...variants];
}

export function expandSurfaceConceptTerms(values: string | string[], limit = 64): string[] {
  const inputs = Array.isArray(values) ? values : [values];
  const terms: string[] = [];
  for (const input of inputs) {
    const normalized = normalizeConceptText(input);
    if (!normalized) continue;
    terms.push(normalized, ...expandConceptTerms(normalized, 16));
    const tokens = normalized.split(/\s+/).filter((token) => token.length >= 3);
    terms.push(...tokens);
    for (const token of tokens) terms.push(...lightTokenVariants(token));
  }
  return unique(terms, limit);
}

export function expandSurfaceTokenVariants(values: string | string[], limit = 64): string[] {
  const inputs = Array.isArray(values) ? values : [values];
  const terms: string[] = [];
  for (const input of inputs) {
    const normalized = normalizeConceptText(input);
    if (!normalized) continue;
    const tokens = normalized.split(/\s+/).filter((token) => token.length >= 3);
    for (const token of tokens) {
      terms.push(token);
      terms.push(...lightTokenVariants(token).filter((variant) => variant === token || variant.length >= 4));
    }
  }
  return unique(terms, limit);
}

const CONCEPT_RULES: CanonicalConceptRule[] = [
  {
    id: "concept:pelvic_pain",
    terms: ["kasik", "kasik agrisi", "pelvik", "pelvik agri", "alt karin"],
    patterns: [
      /\bkasik\w*\b/,
      /\bkasig\w*\b/,
      /\bpelvik\b/,
      /\balt\s+karin\b/,
    ],
  },
  {
    id: "concept:abdominal_pain",
    terms: ["karin", "karin agrisi", "mide", "gobek"],
    patterns: [
      /\bkarin\w*\b/,
      /\bkarn\w*\b/,
      /\bmide\w*\b/,
      /\bgobek\w*\b/,
    ],
  },
  {
    id: "concept:headache",
    terms: ["bas agrisi", "basim", "migren"],
    patterns: [
      /\bbas\w*\s+agri\w*\b/,
      /\bbasim\b/,
      /\bbasimin\b/,
      /\bmigren\b/,
    ],
  },
  {
    id: "concept:vaginal_bleeding",
    terms: ["kanama", "lekelenme", "vajinal kanama"],
    patterns: [/\bkanama\w*\b/, /\blekelen\w*\b/, /\bvajinal\s+kanama\w*\b/],
  },
  {
    id: "concept:discharge",
    terms: ["akinti", "koku", "kasinti"],
    patterns: [/\bakinti\w*\b/, /\bkoku\w*\b/, /\bkasinti\w*\b/],
  },
  {
    id: "concept:pregnancy",
    terms: ["gebelik", "hamile"],
    patterns: [/\bgebel\w*\b/, /\bhamile\w*\b/],
  },
  {
    id: "concept:ovarian_cyst",
    terms: ["kist", "yumurtalik", "over"],
    patterns: [/\bkist\w*\b/, /\byumurtalik\w*\b/, /\bover\w*\b/],
  },
  {
    id: "concept:smear",
    terms: ["smear", "servikal", "rahim agzi"],
    patterns: [/\bsmear\b/, /\bservikal\b/, /\brahim\s+agzi\b/],
  },
  {
    id: "concept:hpv",
    terms: ["hpv", "human papilloma virus", "servikal tarama"],
    patterns: [/\bhpv\b/, /\bhuman\s+papilloma\b/],
  },
  {
    id: "concept:asc_us",
    terms: ["asc-us", "ascus", "servikal sitoloji"],
    patterns: [/\basc\s*us\b/, /\bascus\b/],
  },
  {
    id: "concept:divorce",
    terms: ["bosanma", "anlasmali bosanma", "velayet", "nafaka"],
    patterns: [/\bbosan\w*\b/, /\bvelayet\b/, /\bnafaka\b/],
  },
  {
    id: "concept:traffic_fine",
    terms: ["trafik cezasi", "itiraz", "teblig"],
    patterns: [/\btrafik\s+ceza\w*\b/, /\bteblig\w*\b/],
  },
  {
    id: "concept:consumer_defect",
    terms: ["ayipli urun", "bozuk urun", "iade", "fatura", "fotograf", "tuketici"],
    patterns: [
      /\bayipli\s+urun\w*\b/,
      /\bbozuk\s+urun\w*\b/,
      /\biade\w*\b/,
      /\bfatura\w*\b/,
      /\bfotograf\w*\b/,
      /\btuketici\w*\b/,
    ],
  },
  {
    id: "concept:rent_deposit",
    terms: ["depozito", "kira depozitosu", "teslim tutanagi", "dekont", "hasar"],
    patterns: [
      /\bdepozito\w*\b/,
      /\bkira\s+depozito\w*\b/,
      /\bteslim\s+tutanag\w*\b/,
      /\bdekont\w*\b/,
      /\bhasar\w*\b/,
    ],
  },
  {
    id: "concept:db_migration",
    terms: ["migration", "yedek", "rollback", "staging"],
    patterns: [/\bmigration\b/, /\byedek\w*\b/, /\brollback\b/, /\bstaging\b/],
  },
  {
    id: "concept:special_education",
    terms: ["bep", "ram", "ozel egitim", "rehberlik"],
    patterns: [/\bbep\b/, /\bram\b/, /\bozel\s+egitim\b/, /\brehberlik\b/],
  },
  {
    id: "concept:exam_objection",
    terms: ["sinav itiraz", "basvuru", "resmi kaynak"],
    patterns: [/\bsinav\w*\s+itiraz\w*\b/, /\bresmi\s+kaynak\b/],
  },
  {
    id: "concept:travel_documents",
    terms: ["pasaport", "rezervasyon", "seyahat"],
    patterns: [/\bpasaport\w*\b/, /\brezervasyon\w*\b/, /\bseyahat\w*\b/],
  },
  {
    id: "concept:finance_risk",
    terms: ["yatirim", "getiri", "kayip", "risk"],
    patterns: [/\byatirim\w*\b/, /\bgetiri\w*\b/, /\bkayip\w*\b/],
  },
  {
    id: "concept:contract",
    terms: ["sozlesme", "fesih", "odeme gecikmesi"],
    patterns: [/\bsozlesme\w*\b/, /\bfesih\w*\b/, /\bodeme\s+gecik\w*\b/],
  },
];

export function inferCanonicalConcepts(value: string, limit = 12): string[] {
  const normalized = normalizeConceptText(value);
  const concepts: string[] = [];
  for (const rule of CONCEPT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      concepts.push(rule.id);
    }
    if (concepts.length >= limit) break;
  }
  return concepts;
}

export function expandConceptTerms(value: string, limit = 32): string[] {
  const normalized = normalizeConceptText(value);
  const terms: string[] = [];
  for (const rule of CONCEPT_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(normalized))) continue;
    terms.push(rule.id, ...rule.terms);
    if (terms.length >= limit) break;
  }
  return [...new Set(terms)].slice(0, limit);
}
