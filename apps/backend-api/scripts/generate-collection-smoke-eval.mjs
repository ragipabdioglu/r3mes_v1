import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const outFile = resolve(
  process.cwd(),
  "..",
  "..",
  argValue("--out", "artifacts/evals/generated-collection-smoke/golden.jsonl"),
);
const wallet = process.env.R3MES_DEV_WALLET || "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
const maxCollections = Number(argValue("--max-collections", "12"));
const includeThin = process.argv.includes("--include-thin");
const maxNormalizationCases = Number(argValue("--max-normalization-cases", "8"));

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function readProfile(autoMetadata) {
  if (!autoMetadata || typeof autoMetadata !== "object") return null;
  const profile = autoMetadata.profile && typeof autoMetadata.profile === "object" ? autoMetadata.profile : null;
  const source = profile ?? autoMetadata;
  const domains = asStringArray(source.domains);
  const domain = domains[0] || (typeof source.domain === "string" ? source.domain : "general");
  return {
    domain,
    domains: domains.length > 0 ? domains : [domain],
    subtopics: asStringArray(source.subtopics),
    keywords: asStringArray(source.keywords),
    entities: asStringArray(source.entities),
    topicPhrases: asStringArray(source.topicPhrases),
    answerableConcepts: asStringArray(source.answerableConcepts),
    sampleQuestions: asStringArray(source.sampleQuestions ?? source.questionsAnswered),
    sourceQuality:
      source.sourceQuality === "structured" || source.sourceQuality === "inferred" || source.sourceQuality === "thin"
        ? source.sourceQuality
        : "thin",
    confidence:
      source.confidence === "high" || source.confidence === "medium" || source.confidence === "low"
        ? source.confidence
        : "low",
  };
}

function normalize(value) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asciiFold(value) {
  return normalize(value)
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function slug(value) {
  return normalize(value)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
}

const GENERIC_TERMS = new Set([
  "belge",
  "bilgi",
  "durum",
  "adaptive",
  "adaptive router",
  "demo",
  "education",
  "genel",
  "hakkinda",
  "hukuk",
  "kaynak",
  "kontrol",
  "legal",
  "raw",
  "router",
  "smoke",
  "risk",
  "sure",
  "takip",
  "upload",
]);

function conceptTerms(profile, limit = 3) {
  const candidates = [
    ...profile.answerableConcepts,
    ...profile.topicPhrases,
    ...profile.entities,
    ...profile.keywords,
    ...profile.subtopics.map((item) => item.replace(/_/g, " ")),
  ];
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const text = candidate.trim();
    const key = normalize(text);
    if (!key || key.length < 3 || GENERIC_TERMS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function extractCardFields(content = "") {
  const field = (label) => {
    const match = content.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*(.+)`, "i"));
    return match?.[1]?.trim() ?? "";
  };
  const tags = field("Tags")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    topic: field("Topic"),
    tags,
    summary: field("Source Summary") || field("Clinical Takeaway") || field("Key Takeaway"),
  };
}

function primaryDocumentSignal(collection) {
  for (const document of collection.documents ?? []) {
    const chunk = document.chunks?.[0];
    const fields = extractCardFields(chunk?.content ?? "");
    const terms = [fields.topic, ...fields.tags, document.title]
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !GENERIC_TERMS.has(normalize(item)));
    if (fields.topic || terms.length > 0) {
      return {
        title: document.title,
        topic: fields.topic,
        terms,
      };
    }
  }
  return null;
}

function questionForCollection(collection, profile) {
  const docSignal = primaryDocumentSignal(collection);
  const subject = docSignal?.topic || docSignal?.terms.slice(0, 3).join(", ") || conceptTerms(profile, 3).join(", ");
  if (subject) {
    if (profile.domain === "medical") return `${subject} için kısa ve sakin ne yapmalıyım?`;
    if (profile.domain === "legal") return `${subject} için hangi belge ve süreleri kontrol etmeliyim?`;
    if (profile.domain === "education") return `${subject} için okul ve başvuru adımlarında neyi kontrol etmeliyim?`;
    if (profile.domain === "finance") return `${subject} için risk ve kayıp ihtimalini nasıl değerlendirmeliyim?`;
    if (profile.domain === "technical") return `${subject} için önce hangi güvenli adımları kontrol etmeliyim?`;
    return `${subject} için kısa ve maddeli neyi kontrol etmeliyim?`;
  }
  const specificSample = profile.sampleQuestions.find((item) => item.length >= 12 && !GENERIC_TERMS.has(normalize(item)));
  if (specificSample) return specificSample;
  return `${collection.name} kaynağına göre kısa ve güvenli bir özet verir misin?`;
}

function normalizedQuestionForCollection(collection, profile) {
  const terms = conceptTerms(profile, 3);
  const docSignal = primaryDocumentSignal(collection);
  const docSubject = docSignal?.topic || docSignal?.terms.find((term) => !GENERIC_TERMS.has(normalize(term)));
  const subject = docSubject || terms[0] || collection.name;
  const foldedSubject = asciiFold(subject);
  if (!foldedSubject || foldedSubject.length < 3) return null;
  if (profile.domain === "medical") return `${foldedSubject} icin kisa sakin ne yapmaliyim?`;
  if (profile.domain === "legal") return `${foldedSubject} icin hangi belge ve surelere bakmaliyim?`;
  if (profile.domain === "education") return `${foldedSubject} icin okul basvuru adimlarinda neyi kontrol etmeliyim?`;
  if (profile.domain === "finance") return `${foldedSubject} icin risk ve kayip ihtimalini nasil degerlendirmeliyim?`;
  if (profile.domain === "technical") return `${foldedSubject} icin once hangi guvenli adimlari kontrol etmeliyim?`;
  return `${foldedSubject} icin kisa maddeli neyi kontrol etmeliyim?`;
}

function forbiddenTermsFor(profile) {
  const terms = conceptTerms(profile, 4);
  return terms.length > 0 ? terms : [profile.domain].filter(Boolean);
}

function positiveCase(collection, profile) {
  const isThin = profile.sourceQuality === "thin";
  return {
    id: `generated-positive-${slug(collection.id || collection.name)}`,
    bucket: isThin ? "generated_thin_positive" : "generated_positive",
    query: questionForCollection(collection, profile),
    collectionIds: [collection.id],
    expectedRetrievalMode: "true_hybrid",
    expectedConfidence: ["medium", "high"],
    mustPassSafety: false,
    expectedSafetySeverity: isThin ? ["warn", "rewrite"] : ["pass", "warn", "rewrite"],
    ...(isThin
      ? {
          expectedRouteDecisionMode: "broad",
          expectedRouteReasonTerms: ["thin profile"],
          expectedRouteDecisionConfidence: "medium",
        }
      : {}),
    forbiddenSafetyRailIds: ["MISSING_SOURCES", "NO_USABLE_FACTS", "SOURCE_METADATA_MISMATCH", "LOW_LANGUAGE_QUALITY"],
    expectedUsedCollectionIds: [collection.id],
    mustHaveSources: true,
    minEvidenceFacts: 1,
    maxSources: 3,
    mustNotHaveLowLanguageQuality: true,
    maxLatencyMs: 30000,
  };
}

function normalizedPositiveCase(collection, profile) {
  const query = normalizedQuestionForCollection(collection, profile);
  if (!query) return null;
  const isThin = profile.sourceQuality === "thin";
  return {
    id: `generated-normalized-positive-${slug(collection.id || collection.name)}`,
    bucket: isThin ? "generated_thin_normalized_positive" : "generated_normalized_positive",
    query,
    collectionIds: [collection.id],
    expectedRetrievalMode: "true_hybrid",
    expectedConfidence: ["medium", "high"],
    mustPassSafety: false,
    expectedSafetySeverity: isThin ? ["warn", "rewrite"] : ["pass", "warn", "rewrite"],
    ...(isThin
      ? {
          expectedRouteDecisionMode: "broad",
          expectedRouteReasonTerms: ["thin profile"],
          expectedRouteDecisionConfidence: "medium",
        }
      : {}),
    forbiddenSafetyRailIds: ["MISSING_SOURCES", "NO_USABLE_FACTS", "SOURCE_METADATA_MISMATCH", "LOW_LANGUAGE_QUALITY"],
    expectedUsedCollectionIds: [collection.id],
    mustHaveSources: true,
    minEvidenceFacts: 1,
    maxSources: 3,
    mustNotHaveLowLanguageQuality: true,
    maxLatencyMs: 30000,
  };
}

function suggestionCase(source, sourceProfile, wrong) {
  return {
    id: `generated-suggest-${slug(source.id)}-from-${slug(wrong.id)}`,
    bucket: "generated_wrong_source_suggestion",
    query: questionForCollection(source, sourceProfile),
    collectionIds: [wrong.id],
    includePublic: false,
    expectedRetrievalMode: "true_hybrid",
    expectedConfidence: ["low", "medium"],
    mustPassSafety: false,
    expectedSafetySeverity: ["warn", "rewrite"],
    expectedSelectionMode: "selected",
    expectedRouteDecisionMode: "suggest",
    expectedSuggestedCollectionIds: [source.id],
    expectedMetadataCandidateIds: [source.id],
    expectedMetadataCandidateSourceQualities: [sourceProfile.sourceQuality],
    expectedRejectedCollectionIds: [wrong.id],
    maxSources: 0,
    mustHaveSources: false,
    minEvidenceFacts: 0,
    mustNotHaveLowLanguageQuality: true,
    forbiddenTerms: forbiddenTermsFor(readProfile(wrong.autoMetadata) ?? { domain: "general" }),
    maxLatencyMs: 30000,
  };
}

function sameDomainWrongTopicCase(source, sourceProfile, wrong) {
  return {
    id: `generated-same-domain-wrong-topic-${slug(source.id)}-from-${slug(wrong.id)}`,
    bucket: "generated_same_domain_wrong_topic",
    query: questionForCollection(source, sourceProfile),
    collectionIds: [wrong.id],
    includePublic: false,
    expectedRetrievalMode: "true_hybrid",
    expectedConfidence: ["low", "medium"],
    mustPassSafety: false,
    expectedSafetySeverity: ["warn", "rewrite"],
    expectedSelectionMode: "selected",
    expectedRouteDecisionMode: "suggest",
    expectedSuggestedCollectionIds: [source.id],
    expectedMetadataCandidateIds: [source.id],
    expectedMetadataCandidateSourceQualities: [sourceProfile.sourceQuality],
    expectedRejectedCollectionIds: [wrong.id],
    maxSources: 0,
    mustHaveSources: false,
    minEvidenceFacts: 0,
    mustNotHaveLowLanguageQuality: true,
    forbiddenTerms: forbiddenTermsFor(readProfile(wrong.autoMetadata) ?? { domain: "general" }),
    maxLatencyMs: 30000,
  };
}

function findWrongCollection(source, sourceProfile, candidates) {
  return candidates.find((candidate) => {
    if (candidate.id === source.id) return false;
    const profile = readProfile(candidate.autoMetadata);
    if (!profile) return false;
    return normalize(profile.domain) !== normalize(sourceProfile.domain);
  });
}

function findSameDomainWrongTopicCollection(source, sourceProfile, candidates) {
  return candidates.find((candidate) => {
    if (candidate.id === source.id) return false;
    const profile = readProfile(candidate.autoMetadata);
    if (!profile) return false;
    if (profile.sourceQuality === "thin") return false;
    if (normalize(profile.domain) !== normalize(sourceProfile.domain)) return false;
    return overlapScore(sourceProfile, profile) === 0;
  });
}

function overlapScore(left, right) {
  const leftTerms = new Set(conceptTerms(left, 8).map(normalize));
  const rightTerms = new Set(conceptTerms(right, 8).map(normalize));
  let overlap = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) overlap += 1;
  }
  return overlap;
}

function hasAmbiguousPeer(source, sourceProfile, candidates) {
  return candidates.some((candidate) => {
    if (candidate.id === source.id) return false;
    const profile = readProfile(candidate.autoMetadata);
    if (!profile) return false;
    if (normalize(profile.domain) !== normalize(sourceProfile.domain)) return false;
    return overlapScore(sourceProfile, profile) >= 2;
  });
}

async function main() {
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!user) {
    throw new Error(`No dev user found for wallet ${wallet}`);
  }
  const collections = await prisma.knowledgeCollection.findMany({
    where: { ownerId: user.id },
    include: {
      documents: {
        take: 5,
        orderBy: { createdAt: "asc" },
        include: { chunks: { take: 1, orderBy: { chunkIndex: "asc" } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const eligible = collections
    .map((collection) => ({ collection, profile: readProfile(collection.autoMetadata) }))
    .filter(({ profile }) => profile && (includeThin || profile.sourceQuality !== "thin"))
    .slice(0, maxCollections);

  const cases = [];
  for (const { collection, profile } of eligible) {
    cases.push(positiveCase(collection, profile));
  }
  let normalizationCases = 0;
  for (const { collection, profile } of eligible) {
    if (normalizationCases >= maxNormalizationCases) break;
    const testCase = normalizedPositiveCase(collection, profile);
    if (!testCase) continue;
    cases.push(testCase);
    normalizationCases += 1;
  }
  for (const { collection, profile } of eligible) {
    if (hasAmbiguousPeer(collection, profile, collections)) continue;
    const wrong = findWrongCollection(collection, profile, collections);
    if (wrong) cases.push(suggestionCase(collection, profile, wrong));
    const sameDomainWrong = findSameDomainWrongTopicCollection(collection, profile, collections);
    if (sameDomainWrong) cases.push(sameDomainWrongTopicCase(collection, profile, sameDomainWrong));
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${cases.map((testCase) => JSON.stringify(testCase)).join("\n")}\n`, "utf8");
  console.log(JSON.stringify({
    outFile,
    collections: collections.length,
    eligibleCollections: eligible.length,
    normalizationCases,
    cases: cases.length,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
