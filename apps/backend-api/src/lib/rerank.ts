import { normalizeKnowledgeText, tokenizeKnowledgeText } from "./knowledgeEmbedding.js";
import type { KnowledgeCard } from "./knowledgeCard.js";
import type { HybridCandidate } from "./hybridRetrieval.js";

const OFF_TOPIC_MARKERS = [
  "ca125",
  "ca 125",
  "bhcg",
  "beta hcg",
  "menopoz",
  "biyopsi",
  "patoloji",
];

export interface RerankCandidate<TChunk> extends HybridCandidate<TChunk> {
  card: KnowledgeCard;
  rerankScore: number;
  matchedIntentCount: number;
  strictEligible: boolean;
}

interface QueryIntentRule {
  id: string;
  markers: string[];
  required?: boolean;
}

const QUERY_INTENT_RULES: QueryIntentRule[] = [
  { id: "asc_us", markers: ["asc-us", "ascus", "asc us"], required: true },
  { id: "smear", markers: ["smear", "servikal", "rahim agzi", "rahimde yara"], required: true },
  { id: "hpv", markers: ["hpv"], required: true },
  { id: "kasik_agri", markers: ["kasik", "kasık", "agri", "ağrı", "agrisi", "ağrısı"], required: true },
  { id: "kanama", markers: ["kanama", "lekelenme", "lekelen"], required: true },
  { id: "kist", markers: ["kist", "over"], required: true },
  { id: "biyopsi", markers: ["biyopsi", "parca", "parça"], required: true },
  { id: "patoloji", markers: ["patoloji"], required: true },
  { id: "hukuk", markers: ["hukuk", "dava", "avukat", "sozlesme", "sözleşme", "tuketici", "tüketici", "itiraz", "ceza"], required: true },
  { id: "sozlesme", markers: ["sozlesme", "sözleşme", "protokol", "madde"], required: true },
  { id: "cezai_sart", markers: ["cezai", "sart", "şart"], required: true },
  { id: "trafik_cezasi", markers: ["trafik", "cezasi", "cezası"], required: true },
  { id: "tuketici", markers: ["tuketici", "tüketici", "ayipli", "ayıplı", "iade"], required: true },
  { id: "fazla_mesai", markers: ["fazla mesai", "mesai", "bordro"], required: true },
  { id: "adet", markers: ["adet", "regl"], required: true },
  { id: "gebelik", markers: ["gebe", "gebelik", "hamile", "infertil"], required: true },
  { id: "menopoz", markers: ["menopoz"], required: true },
];

function inferQueryIntents(normalizedQuery: string): QueryIntentRule[] {
  return QUERY_INTENT_RULES.filter((rule) =>
    rule.markers.some((marker) => normalizedQuery.includes(marker)),
  );
}

function scoreIntentCoverage(normalizedText: string, intents: QueryIntentRule[]): number {
  if (intents.length === 0) return 0;
  let score = 0;
  for (const intent of intents) {
    const hasIntent = intent.markers.some((marker) => normalizedText.includes(marker));
    if (hasIntent) {
      score += 1.2;
    } else if (intent.required) {
      score -= 2;
    }
  }
  return score;
}

function countMatchedIntents(normalizedText: string, intents: QueryIntentRule[]): number {
  return intents.filter((intent) => intent.markers.some((marker) => normalizedText.includes(marker))).length;
}

function hasTopicConflict(normalizedQuery: string, normalizedCardText: string, intents: QueryIntentRule[]): boolean {
  if (intents.length === 0) return false;
  const queryHasKist = normalizedQuery.includes("kist");
  const queryHasKanama = normalizedQuery.includes("kanama");
  const queryHasSmear = normalizedQuery.includes("smear");

  if (queryHasSmear && !queryHasKist && normalizedCardText.includes("kist")) return true;
  if (queryHasSmear && !queryHasKanama && normalizedCardText.includes("anormal kanama")) return true;

  const matchedIntentCount = intents.filter((intent) =>
    intent.markers.some((marker) => normalizedCardText.includes(marker)),
  ).length;
  return matchedIntentCount === 0;
}

export function rerankKnowledgeCards<TChunk>(
  query: string,
  candidates: Array<HybridCandidate<TChunk> & { card: KnowledgeCard }>,
  limit = 4,
): RerankCandidate<TChunk>[] {
  const normalizedQuery = normalizeKnowledgeText(query);
  const queryTokens = new Set(tokenizeKnowledgeText(query));
  const queryIntents = inferQueryIntents(normalizedQuery);

  const ranked = candidates
    .map((candidate) => {
      const cardText = normalizeKnowledgeText(
        [
          candidate.card.topic,
          candidate.card.tags.join(" "),
          candidate.card.patientSummary,
          candidate.card.clinicalTakeaway,
          candidate.card.safeGuidance,
          candidate.card.redFlags,
        ].join(" "),
      );
      const overlap = tokenizeKnowledgeText(cardText).filter((token) => queryTokens.has(token)).length;
      const tagHits = candidate.card.tags.reduce(
        (sum, tag) => sum + (normalizedQuery.includes(tag) ? 1 : 0),
        0,
      );
      const intentScore = scoreIntentCoverage(cardText, queryIntents);
      const matchedIntentCount = countMatchedIntents(cardText, queryIntents);
      const offTopicPenalty = OFF_TOPIC_MARKERS.reduce(
        (sum, marker) =>
          sum +
          (cardText.includes(marker) && !normalizedQuery.includes(marker) ? 0.8 : 0),
        0,
      );
      const topicConflictPenalty = hasTopicConflict(normalizedQuery, cardText, queryIntents) ? 2.5 : 0;
      const strictEligible =
        queryIntents.length === 0 ||
        (matchedIntentCount >= Math.max(1, Math.ceil(queryIntents.length * 0.6)) &&
          topicConflictPenalty === 0);

      return {
        ...candidate,
        matchedIntentCount,
        strictEligible,
        topicConflictPenalty,
        rerankScore:
          candidate.fusedScore +
          overlap * 0.35 +
          tagHits * 0.5 +
          intentScore -
          offTopicPenalty -
          topicConflictPenalty,
      };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .filter((candidate) => candidate.rerankScore > 0 || (candidate.matchedIntentCount > 0 && candidate.topicConflictPenalty === 0));

  const matchedIntentIds = new Set<string>();
  const complementaryStrict: typeof ranked = [];
  for (const candidate of ranked) {
    const cardText = normalizeKnowledgeText(
      [
        candidate.card.topic,
        candidate.card.tags.join(" "),
        candidate.card.patientSummary,
        candidate.card.clinicalTakeaway,
        candidate.card.safeGuidance,
        candidate.card.redFlags,
      ].join(" "),
    );
    const matchedIds = queryIntents
      .filter((intent) => intent.markers.some((marker) => cardText.includes(marker)))
      .map((intent) => intent.id);
    const addsNewIntent = matchedIds.some((id) => !matchedIntentIds.has(id));
    if (candidate.strictEligible || (addsNewIntent && candidate.matchedIntentCount > 0)) {
      complementaryStrict.push(candidate);
      for (const id of matchedIds) matchedIntentIds.add(id);
    }
    if (complementaryStrict.length >= limit) break;
  }
  const strict = complementaryStrict.length > 0 ? complementaryStrict : ranked.filter((candidate) => candidate.strictEligible);
  const finalPool = strict.length > 0 ? strict : ranked;
  return finalPool.slice(0, limit);
}
