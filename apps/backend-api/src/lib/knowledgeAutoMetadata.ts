import { createHash } from "node:crypto";

import { parseKnowledgeCard } from "./knowledgeCard.js";
import { embedKnowledgeText } from "./knowledgeEmbedding.js";
import type { KnowledgeChunkDraft } from "./knowledgeText.js";
import { routeQuery } from "./queryRouter.js";
import { expandSurfaceConceptTerms, normalizeConceptText } from "./conceptNormalizer.js";
import type { KnowledgeParseQuality } from "./knowledgeParseQuality.js";

export type KnowledgeRiskLevel = "low" | "medium" | "high";

export interface KnowledgeAutoMetadata {
  domain: string;
  subtopics: string[];
  keywords: string[];
  entities: string[];
  documentType: string;
  audience: string;
  riskLevel: KnowledgeRiskLevel;
  summary: string;
  questionsAnswered: string[];
  sourceQuality: "structured" | "inferred" | "thin";
  parseQuality?: KnowledgeParseQuality;
  parseAdapter?: {
    id: string;
    version: number;
    diagnostics?: {
      originalBytes: number;
      normalizedChars: number;
      warnings: string[];
    };
  };
  profile?: KnowledgeCollectionProfile;
}

export interface KnowledgeCollectionProfile {
  version: 2;
  profileVersion: number;
  domains: string[];
  subtopics: string[];
  keywords: string[];
  entities: string[];
  topicPhrases: string[];
  answerableConcepts: string[];
  negativeHints: string[];
  documentTypes: string[];
  audiences: string[];
  sampleQuestions: string[];
  summary: string;
  riskLevel: KnowledgeRiskLevel;
  sourceQuality: "structured" | "inferred" | "thin";
  confidence: "low" | "medium" | "high";
  profileText: string;
  profileTextHash: string;
  profileEmbedding: number[];
  summaryEmbedding: number[];
  sampleQuestionsEmbedding: number[];
  keywordsEmbedding: number[];
  entityEmbedding: number[];
  lastProfiledAt: string;
  updatedAt: string;
}

function hasStructuredKnowledgeMetadata(content: string): boolean {
  const card = parseKnowledgeCard(content);
  return Boolean(card.topic.trim() && card.tags.length > 0);
}

function compactSummary(content: string, maxChars = 360): string {
  return content
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars)
    .trim();
}

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function weightedUnique(values: string[], limit: number): string[] {
  const counts = new Map<string, { value: string; count: number; firstSeen: number }>();
  let index = 0;
  for (const raw of values.map((item) => item.trim()).filter(Boolean)) {
    const key = raw.toLocaleLowerCase("tr-TR");
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { value: raw, count: 1, firstSeen: index });
      index += 1;
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen)
    .map((item) => item.value)
    .slice(0, limit);
}

function sourceQualityRank(value: KnowledgeAutoMetadata["sourceQuality"]): number {
  if (value === "structured") return 3;
  if (value === "inferred") return 2;
  return 1;
}

function hasMeaningfulProfileSignal(item: KnowledgeAutoMetadata): boolean {
  return item.domain !== "general" || item.subtopics.length > 0 || item.keywords.length >= 3 || item.entities.length > 0;
}

function collectionSourceQualityForItems(items: KnowledgeAutoMetadata[]): KnowledgeAutoMetadata["sourceQuality"] {
  if (items.some((item) => item.sourceQuality === "structured")) return "structured";
  const meaningfulCount = items.filter(hasMeaningfulProfileSignal).length;
  if (meaningfulCount >= 1 && items.some((item) => item.sourceQuality === "inferred")) return "inferred";
  return "thin";
}

function aggregateParseQuality(items: KnowledgeAutoMetadata[]): KnowledgeParseQuality | undefined {
  const qualities = items.map((item) => item.parseQuality).filter((item): item is KnowledgeParseQuality => Boolean(item));
  if (qualities.length === 0) return undefined;
  const averageScore = Math.round(qualities.reduce((sum, item) => sum + item.score, 0) / qualities.length);
  const noisyCount = qualities.filter((item) => item.level === "noisy").length;
  const usableCount = qualities.filter((item) => item.level === "usable").length;
  const level: KnowledgeParseQuality["level"] =
    noisyCount > 0 && noisyCount / qualities.length >= 0.34
      ? "noisy"
      : usableCount + noisyCount > 0
        ? "usable"
        : "clean";
  const warnings = unique(qualities.flatMap((item) => item.warnings), 16);
  return {
    score: averageScore,
    level,
    warnings,
    signals: {
      textLength: Math.round(qualities.reduce((sum, item) => sum + item.signals.textLength, 0) / qualities.length),
      chunkCount: qualities.reduce((sum, item) => sum + item.signals.chunkCount, 0),
      averageChunkChars: Math.round(qualities.reduce((sum, item) => sum + item.signals.averageChunkChars, 0) / qualities.length),
      replacementCharRatio: Number((qualities.reduce((sum, item) => sum + item.signals.replacementCharRatio, 0) / qualities.length).toFixed(5)),
      mojibakeMarkerCount: qualities.reduce((sum, item) => sum + item.signals.mojibakeMarkerCount, 0),
      controlCharRatio: Number((qualities.reduce((sum, item) => sum + item.signals.controlCharRatio, 0) / qualities.length).toFixed(5)),
      symbolRatio: Number((qualities.reduce((sum, item) => sum + item.signals.symbolRatio, 0) / qualities.length).toFixed(5)),
      shortLineRatio: Number((qualities.reduce((sum, item) => sum + item.signals.shortLineRatio, 0) / qualities.length).toFixed(5)),
      structureSignalCount: Math.round(qualities.reduce((sum, item) => sum + item.signals.structureSignalCount, 0) / qualities.length),
    },
  };
}

function confidenceForProfile(items: KnowledgeAutoMetadata[], sourceQuality: KnowledgeAutoMetadata["sourceQuality"]): KnowledgeCollectionProfile["confidence"] {
  const meaningfulItems = items.filter(hasMeaningfulProfileSignal);
  if (sourceQuality === "structured" && meaningfulItems.length >= 1) return "high";
  if (meaningfulItems.length >= 2) return "high";
  if (meaningfulItems.length === 1) return "medium";
  return "low";
}

function profileLine(label: string, values: string[] | string): string {
  const value = Array.isArray(values) ? values.filter(Boolean).join(", ") : values.trim();
  return value ? `${label}: ${value}` : "";
}

function buildProfileText(
  profile: Omit<
    KnowledgeCollectionProfile,
    | "version"
    | "profileVersion"
    | "profileText"
    | "profileTextHash"
    | "profileEmbedding"
    | "summaryEmbedding"
    | "sampleQuestionsEmbedding"
    | "keywordsEmbedding"
    | "entityEmbedding"
    | "lastProfiledAt"
    | "updatedAt"
  >,
): string {
  return [
    profileLine("Domains", profile.domains),
    profileLine("Subtopics", profile.subtopics),
    profileLine("Keywords", profile.keywords),
    profileLine("Entities", profile.entities),
    profileLine("Topic phrases", profile.topicPhrases),
    profileLine("Answerable concepts", profile.answerableConcepts),
    profileLine("Negative hints", profile.negativeHints),
    profileLine("Document types", profile.documentTypes),
    profileLine("Audiences", profile.audiences),
    profileLine("Sample questions", profile.sampleQuestions),
    profileLine("Summary", profile.summary),
    profileLine("Risk level", profile.riskLevel),
    profileLine("Source quality", profile.sourceQuality),
    profileLine("Confidence", profile.confidence),
  ].filter(Boolean).join("\n");
}

function hashProfileText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function nextProfileVersion(previousProfile: KnowledgeCollectionProfile | null | undefined, profileTextHash: string): number {
  const previousVersion = previousProfile?.profileVersion ?? previousProfile?.version ?? 0;
  if (previousProfile?.profileTextHash === profileTextHash && previousVersion > 0) {
    return previousVersion;
  }
  return previousVersion + 1;
}

function phraseFromSubtopic(subtopic: string): string {
  return subtopic.replace(/_/g, " ");
}

function questionToTopicPhrase(question: string): string {
  return question
    .replace(/\bhakkında ne bilinmeli\??$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_PROFILE_TERMS = new Set([
  "acikla",
  "açıkla",
  "agri",
  "ağrı",
  "belge",
  "bilgi",
  "degerlendirme",
  "değerlendirme",
  "durum",
  "genel",
  "hakkinda",
  "hakkında",
  "kaynak",
  "kontrol",
  "muayene",
  "nedir",
  "risk",
  "sure",
  "süre",
  "takip",
]);

function normalizeTerm(text: string): string {
  return normalizeConceptText(text);
}

function isGenericProfileTerm(term: string): boolean {
  const normalized = normalizeTerm(term);
  return normalized.length < 3 || GENERIC_PROFILE_TERMS.has(normalized);
}

const PROFILE_STOPWORDS = new Set([
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
  "gibi",
  "olan",
  "icin",
  "için",
  "gereken",
  "gerekir",
  "yapilmali",
  "yapılmalı",
  "hazirlanmali",
  "hazırlanmalı",
]);

function profileTokens(text: string): string[] {
  return normalizeTerm(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !PROFILE_STOPWORDS.has(token))
    .filter((token) => !isGenericProfileTerm(token));
}

function ngrams(tokens: string[], minSize: number, maxSize: number): string[] {
  const out: string[] = [];
  for (let size = minSize; size <= maxSize; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      out.push(tokens.slice(index, index + size).join(" "));
    }
  }
  return out;
}

function extractGenericProfilePhrases(opts: { title: string; content: string; limit?: number }): string[] {
  const titleTokens = profileTokens(opts.title);
  const contentTokens = profileTokens(compactSummary(opts.content, 1200));
  return weightedUnique(
    [
      ...ngrams(titleTokens, 2, 4),
      ...titleTokens,
      ...ngrams(contentTokens.slice(0, 80), 2, 3),
      ...contentTokens,
    ],
    opts.limit ?? 18,
  );
}

function expandProfileTerms(values: string[], limit: number): string[] {
  return unique(
    expandSurfaceConceptTerms(values, limit * 3)
      .filter((term) => !isGenericProfileTerm(term))
      .filter((term) => !term.startsWith("concept ")),
    limit,
  );
}

function buildTopicPhrases(items: KnowledgeAutoMetadata[]): string[] {
  const baseTerms = items.flatMap((item) => [
    ...item.subtopics.map(phraseFromSubtopic),
    ...item.keywords.filter((keyword) => !isGenericProfileTerm(keyword)),
    ...item.entities.filter((entity) => !isGenericProfileTerm(entity)),
    ...item.questionsAnswered.map(questionToTopicPhrase).filter((phrase) => !isGenericProfileTerm(phrase)),
  ]);
  return weightedUnique(
    [
      ...baseTerms,
      ...expandProfileTerms(baseTerms, 36),
    ],
    28,
  );
}

function buildAnswerableConcepts(opts: {
  topicPhrases: string[];
  subtopics: string[];
  keywords: string[];
  entities: string[];
}): string[] {
  return weightedUnique(
    [
      ...opts.topicPhrases,
      ...expandProfileTerms(opts.topicPhrases, 48),
      ...opts.subtopics.map(phraseFromSubtopic),
      ...opts.entities,
      ...opts.keywords.filter((keyword) => !isGenericProfileTerm(keyword)),
      ...expandProfileTerms([...opts.subtopics.map(phraseFromSubtopic), ...opts.entities, ...opts.keywords], 48),
    ],
    36,
  );
}

function buildNegativeHints(opts: {
  keywords: string[];
  topicPhrases: string[];
  answerableConcepts: string[];
}): string[] {
  const answerableText = normalizeTerm([...opts.topicPhrases, ...opts.answerableConcepts].join(" "));
  return unique(
    opts.keywords
      .filter(isGenericProfileTerm)
      .filter((term) => !answerableText.includes(normalizeTerm(term)))
      .map((term) => `${term} tek başına yeterli eşleşme değildir`),
    12,
  );
}

export function buildKnowledgeCollectionProfile(
  items: KnowledgeAutoMetadata[],
  opts: { now?: Date; previousProfile?: KnowledgeCollectionProfile | null } = {},
): KnowledgeCollectionProfile | null {
  const cleanItems = items.filter(Boolean);
  if (cleanItems.length === 0) return null;
  const riskOrder: KnowledgeRiskLevel[] = ["low", "medium", "high"];
  const riskLevel = cleanItems
    .map((item) => item.riskLevel)
    .sort((a, b) => riskOrder.indexOf(b) - riskOrder.indexOf(a))[0] ?? "low";
  const sourceQuality = collectionSourceQualityForItems(cleanItems);
  const domains = weightedUnique(cleanItems.map((item) => item.domain), 4);
  const subtopics = weightedUnique(cleanItems.flatMap((item) => item.subtopics), 16);
  const keywords = weightedUnique(cleanItems.flatMap((item) => item.keywords), 32);
  const entities = weightedUnique(cleanItems.flatMap((item) => item.entities), 20);
  const documentTypes = weightedUnique(cleanItems.map((item) => item.documentType), 8);
  const audiences = weightedUnique(cleanItems.map((item) => item.audience), 8);
  const sampleQuestions = unique(cleanItems.flatMap((item) => item.questionsAnswered), 12);
  const topicPhrases = buildTopicPhrases(cleanItems);
  const answerableConcepts = buildAnswerableConcepts({ topicPhrases, subtopics, keywords, entities });
  const negativeHints = buildNegativeHints({ keywords, topicPhrases, answerableConcepts });
  const baseProfile = {
    domains,
    subtopics,
    keywords,
    entities,
    topicPhrases,
    answerableConcepts,
    negativeHints,
    documentTypes,
    audiences,
    sampleQuestions,
    summary: compactSummary(cleanItems.map((item) => item.summary).filter(Boolean).join(" "), 700),
    riskLevel,
    sourceQuality,
    confidence: confidenceForProfile(cleanItems, sourceQuality),
  };
  const profileText = buildProfileText(baseProfile);
  const profileTextHash = hashProfileText(profileText);
  const timestamp = (opts.now ?? new Date()).toISOString();
  return {
    version: 2,
    profileVersion: nextProfileVersion(opts.previousProfile, profileTextHash),
    ...baseProfile,
    profileText,
    profileTextHash,
    profileEmbedding: embedKnowledgeText(profileText),
    summaryEmbedding: embedKnowledgeText(baseProfile.summary),
    sampleQuestionsEmbedding: embedKnowledgeText(baseProfile.sampleQuestions.join(" ")),
    keywordsEmbedding: embedKnowledgeText(baseProfile.keywords.join(" ")),
    entityEmbedding: embedKnowledgeText(baseProfile.entities.join(" ")),
    lastProfiledAt: timestamp,
    updatedAt: timestamp,
  };
}

function inferDocumentType(title: string, content: string): string {
  const text = `${title}\n${content}`.toLocaleLowerCase("tr-TR");
  if (text.includes("soru:") || text.includes("cevap:")) return "qa";
  if (text.includes("rapor") || text.includes("sonuç") || text.includes("sonuc")) return "report";
  if (text.includes("runbook") || text.includes("checklist") || text.includes("kontrol")) return "runbook";
  if (text.includes("madde") || text.includes("sözleşme") || text.includes("sozlesme")) return "document";
  return "knowledge_note";
}

function inferAudience(domain: string, content: string): string {
  const text = content.toLocaleLowerCase("tr-TR");
  if (text.includes("hasta") || domain === "medical") return "patient";
  if (text.includes("müvekkil") || text.includes("muvekkil") || domain === "legal") return "client";
  if (text.includes("öğrenci") || text.includes("ogrenci") || domain === "education") return "student_or_parent";
  if (domain === "technical") return "operator";
  return "general_user";
}

export function inferKnowledgeAutoMetadata(opts: {
  title: string;
  content: string;
}): KnowledgeAutoMetadata {
  const card = parseKnowledgeCard(opts.content);
  const routePlan = routeQuery(`${opts.title}\n${card.topic}\n${card.tags.join(" ")}\n${opts.content.slice(0, 1600)}`);
  const structured = Boolean(card.topic.trim() && card.tags.length > 0);
  const genericPhrases = extractGenericProfilePhrases({
    title: opts.title,
    content: card.patientSummary || card.clinicalTakeaway || opts.content,
  });
  const normalizedProfileTerms = expandProfileTerms(
    [
      opts.title,
      card.topic,
      ...card.tags,
      ...routePlan.subtopics.map((subtopic) => subtopic.replace(/_/g, " ")),
      ...routePlan.mustIncludeTerms,
      ...routePlan.retrievalHints,
      ...genericPhrases,
    ],
    28,
  );
  const keywords = unique(
    [
      ...card.tags,
      structured ? card.topic : "",
      ...routePlan.subtopics.map((subtopic) => subtopic.replace(/_/g, " ")),
      ...genericPhrases,
      ...normalizedProfileTerms,
      ...routePlan.mustIncludeTerms,
      ...routePlan.retrievalHints,
    ],
    20,
  );
  const summary = compactSummary(card.patientSummary || card.clinicalTakeaway || opts.content, 420);
  const questionsAnswered = unique(
    [
      ...routePlan.retrievalHints.map((hint) => `${hint} hakkında ne bilinmeli?`),
      structured && card.topic ? `${card.topic} hakkında ne bilinmeli?` : "",
      ...genericPhrases.slice(0, 4).map((phrase) => `${phrase} hakkında ne bilinmeli?`),
    ],
    6,
  );
  const hasGenericProfileSignal = genericPhrases.length >= 3;

  return {
    domain: routePlan.domain,
    subtopics: routePlan.subtopics,
    keywords,
    entities: unique(
      [
        structured ? card.topic : "",
        ...card.tags.filter((tag) => tag.length > 3),
        ...genericPhrases.slice(0, 6),
        ...normalizedProfileTerms.slice(0, 8),
      ],
      12,
    ),
    documentType: inferDocumentType(opts.title, opts.content),
    audience: inferAudience(routePlan.domain, opts.content),
    riskLevel: routePlan.riskLevel,
    summary,
    questionsAnswered,
    sourceQuality: structured ? "structured" : routePlan.confidence === "low" && !hasGenericProfileSignal ? "thin" : "inferred",
  };
}

export function mergeKnowledgeAutoMetadata(
  items: KnowledgeAutoMetadata[],
  opts: { now?: Date } = {},
): KnowledgeAutoMetadata | null {
  if (items.length === 0) return null;
  const previousProfile = items.find((item) => item.profile)?.profile ?? null;
  const count = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  };
  const domains = count(items.map((item) => item.domain));
  const riskOrder: KnowledgeRiskLevel[] = ["low", "medium", "high"];
  const riskLevel = items
    .map((item) => item.riskLevel)
    .sort((a, b) => riskOrder.indexOf(b) - riskOrder.indexOf(a))[0] ?? "low";

  const mergedBase: KnowledgeAutoMetadata = {
    domain: domains[0] ?? "general",
    subtopics: unique(items.flatMap((item) => item.subtopics), 12),
    keywords: unique(items.flatMap((item) => item.keywords), 24),
    entities: unique(items.flatMap((item) => item.entities), 16),
    documentType: count(items.map((item) => item.documentType))[0] ?? "knowledge_note",
    audience: count(items.map((item) => item.audience))[0] ?? "general_user",
    riskLevel,
    summary: compactSummary(items.map((item) => item.summary).filter(Boolean).join(" "), 520),
    questionsAnswered: unique(items.flatMap((item) => item.questionsAnswered), 10),
    sourceQuality: collectionSourceQualityForItems(items),
    parseQuality: aggregateParseQuality(items),
  };
  return {
    ...mergedBase,
    profile: buildKnowledgeCollectionProfile(items, { now: opts.now, previousProfile }) ?? undefined,
  };
}

export function enrichKnowledgeChunkWithAutoMetadata(
  chunk: KnowledgeChunkDraft,
  opts: { title: string },
): KnowledgeChunkDraft {
  if (hasStructuredKnowledgeMetadata(chunk.content)) {
    return chunk;
  }

  const routePlan = routeQuery(`${opts.title}\n${chunk.content.slice(0, 1200)}`);
  if (routePlan.confidence === "low" && routePlan.subtopics.length === 0) {
    return chunk;
  }

  const tags = [
    routePlan.domain,
    ...routePlan.subtopics,
    ...routePlan.mustIncludeTerms.slice(0, 6),
  ];
  const metadata = [
    `Topic: ${routePlan.subtopics[0] ?? routePlan.domain}`,
    `Tags: ${[...new Set(tags)].join(", ")}`,
    `Source Summary: ${compactSummary(chunk.content)}`,
    "",
  ].join("\n");

  const content = `${metadata}${chunk.content}`.trim();
  return {
    ...chunk,
    content,
    tokenCount: Math.max(chunk.tokenCount, Math.ceil(content.length / 4)),
  };
}
