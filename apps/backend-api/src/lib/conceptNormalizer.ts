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
