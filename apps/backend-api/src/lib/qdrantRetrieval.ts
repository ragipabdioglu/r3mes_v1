import type { ChatSourceCitation } from "@r3mes/shared-types";

import type { GroundingConfidence } from "./answerSchema.js";
import { buildEvidenceGroundedBrief, buildGroundedBrief } from "./groundedBrief.js";
import type { HybridCandidate } from "./hybridRetrieval.js";
import { parseKnowledgeCard } from "./knowledgeCard.js";
import { rerankKnowledgeCardsWithFallback } from "./modelRerank.js";
import { embedTextForQdrant } from "./qdrantEmbedding.js";
import { searchQdrantKnowledge, type QdrantKnowledgePayload } from "./qdrantStore.js";
import type { DomainRoutePlan } from "./queryRouter.js";
import { runEvidenceExtractorSkill, type EvidenceExtractorOutput } from "./skillPipeline.js";

export interface QdrantRetrievedKnowledgeContext {
  contextText: string;
  sources: ChatSourceCitation[];
  lowGroundingConfidence: boolean;
  groundingConfidence: GroundingConfidence;
  evidence: EvidenceExtractorOutput | null;
}

function deriveGroundingConfidence(scores: number[]): GroundingConfidence {
  if (scores.length === 0) return "low";
  const top = scores[0] ?? 0;
  const third = scores[Math.min(2, scores.length - 1)] ?? top;
  if (top >= 2.4 && third >= 1.4) return "high";
  if (top >= 1.2 && third >= 0.6) return "medium";
  return "low";
}

function bulletSection(title: string, items: string[]): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return [title, ...clean.map((item) => `- ${item}`)].join("\n");
}

function renderEvidenceBrief(
  evidence: EvidenceExtractorOutput,
  opts: { groundingConfidence: GroundingConfidence; lowGroundingConfidence: boolean },
): string {
  return [
    `GROUNDING DURUMU: ${opts.groundingConfidence}${opts.lowGroundingConfidence ? " (düşük güven; kesin konuşma)" : ""}`,
    `CEVAP NIYETI: ${evidence.answerIntent}`,
    bulletSection("DOGRUDAN CEVAP KANITLARI:", evidence.directAnswerFacts.slice(0, 4)),
    bulletSection("DESTEKLEYICI BAGLAM:", evidence.supportingContext.slice(0, 3)),
    bulletSection("BELIRSIZ / KULLANILAMAYAN:", [
      ...evidence.notSupported.slice(0, 4),
    ]),
    bulletSection("RED FLAGS:", evidence.riskFacts.slice(0, 3)),
    bulletSection("KAYNAK KIMLIKLARI:", evidence.sourceIds.slice(0, 4)),
    [
      "YANIT KURALLARI:",
      "- Sadece kullanılabilir gerçeklere dayan.",
      "- Kaynakta olmayan özel terim, işlem, karar veya ayrıntı ekleme.",
      "- Kaynak zayıfsa bunu açık söyle ve ilgili uzmana veya yetkili kuruma yönlendir.",
      "- Cevabı kısa, sakin ve kullanıcı-dostu yaz.",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

function getRagContextMode(): "compact" | "detailed" {
  const raw = (process.env.R3MES_RAG_CONTEXT_MODE ?? "compact").trim().toLowerCase();
  return raw === "detailed" ? "detailed" : "compact";
}

type QdrantChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  document: {
    title: string;
    collectionId: string;
  };
};

function payloadToChunk(payload: QdrantKnowledgePayload): QdrantChunk {
  return {
    id: payload.chunkId,
    documentId: payload.documentId,
    chunkIndex: payload.chunkIndex,
    content: payload.content,
    document: {
      title: payload.title,
      collectionId: payload.collectionId,
    },
  };
}

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

function payloadMatchesRoute(payload: QdrantKnowledgePayload, routePlan: DomainRoutePlan | null): boolean {
  if (!routePlan || routePlan.confidence === "low") return true;
  const domains = (payload.domains?.length ? payload.domains : [payload.domain]).map(normalize);
  const tags = [...(payload.tags ?? []), ...(payload.keywords ?? []), ...(payload.entities ?? [])].map(normalize);
  const subtopics = [...(payload.profileSubtopics ?? []), ...(payload.subtopics ?? [])].map(normalize);
  const domainMatches = domains.includes(routePlan.domain) || tags.includes(routePlan.domain);
  if (!domainMatches) return false;
  if (routePlan.subtopics.length === 0) return true;

  const routeSubtopics = routePlan.subtopics.map(normalize);
  if (routeSubtopics.some((subtopic) => subtopics.includes(subtopic))) return true;

  const haystack = normalize([
    ...domains,
    ...tags,
    ...subtopics,
    payload.documentType,
    payload.audience,
    payload.profileSummary,
    payload.title,
  ].join(" "));
  const terms = [
    ...routePlan.subtopics,
    ...routePlan.mustIncludeTerms,
    ...routePlan.retrievalHints,
  ].map((term) => normalize(term).replace(/_/g, " "));
  return terms.some((term) => haystack.includes(term));
}

export async function retrieveKnowledgeContextQdrant(opts: {
  query: string;
  evidenceQuery?: string;
  accessibleCollectionIds: string[];
  limit?: number;
  routePlan?: DomainRoutePlan | null;
}): Promise<QdrantRetrievedKnowledgeContext> {
  const { query, evidenceQuery = query, accessibleCollectionIds, limit = 3, routePlan = null } = opts;
  if (accessibleCollectionIds.length === 0) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
    };
  }

  const vector = await embedTextForQdrant(query);
  const rawPoints = await searchQdrantKnowledge({
    vector,
    accessibleCollectionIds,
    limit: 50,
  });
  const scopedPoints =
    routePlan && routePlan.confidence !== "low"
      ? rawPoints.filter((point) => payloadMatchesRoute(point.payload, routePlan))
      : rawPoints;
  const strictRouteScope = Boolean(routePlan && routePlan.confidence !== "low" && routePlan.subtopics.length > 0);
  const points = (scopedPoints.length > 0 || strictRouteScope ? scopedPoints : rawPoints).slice(0, 20);
  if (strictRouteScope && points.length === 0) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
    };
  }

  const candidates: Array<HybridCandidate<QdrantChunk> & { card: ReturnType<typeof parseKnowledgeCard> }> = points.map((point) => {
    const chunk = payloadToChunk(point.payload);
    return {
      chunk,
      lexicalScore: point.score,
      embeddingScore: point.score,
      fusedScore: point.score,
      card: parseKnowledgeCard(chunk.content),
    };
  });

  const reranked = await rerankKnowledgeCardsWithFallback(query, candidates, Math.max(limit, 3));
  const finalCandidates = reranked.slice(0, limit);
  const groundingConfidence = deriveGroundingConfidence(finalCandidates.map((candidate) => candidate.rerankScore));
  const lowGroundingConfidence = groundingConfidence === "low";

  const sources: ChatSourceCitation[] = finalCandidates.map(({ chunk }) => ({
    collectionId: chunk.document.collectionId,
    documentId: chunk.documentId,
    title: chunk.document.title,
    chunkIndex: chunk.chunkIndex,
    excerpt: chunk.content.slice(0, 220),
  }));

  const evidenceRun = await runEvidenceExtractorSkill({
    userQuery: evidenceQuery,
    cards: finalCandidates.map(({ chunk, card }) => ({
      sourceId: chunk.documentId,
      title: chunk.document.title,
      topic: card.topic,
      rawContent: chunk.content,
      patientSummary: card.patientSummary,
      clinicalTakeaway: card.clinicalTakeaway,
      safeGuidance: card.safeGuidance,
      redFlags: card.redFlags,
      doNotInfer: card.doNotInfer,
    })),
  });

  const brief =
    getRagContextMode() === "detailed"
      ? renderEvidenceBrief(evidenceRun.output, { groundingConfidence, lowGroundingConfidence })
      : evidenceRun.output.usableFacts.length > 0 || evidenceRun.output.notSupported.length > 0
        ? buildEvidenceGroundedBrief(evidenceRun.output, {
            groundingConfidence,
            lowGroundingConfidence,
            answerIntent: evidenceRun.output.answerIntent,
            sourceRefs: finalCandidates.map(({ chunk }) => ({
              id: chunk.documentId,
              title: chunk.document.title,
            })),
          })
        : buildGroundedBrief(
            finalCandidates.map(({ card }) => card),
            {
              groundingConfidence,
              lowGroundingConfidence,
              answerIntent: evidenceRun.output.answerIntent,
              sourceRefs: finalCandidates.map(({ chunk }) => ({
                id: chunk.documentId,
                title: chunk.document.title,
              })),
            },
          );
  const sourceHints = finalCandidates.map(({ chunk, card }, index) =>
    `[Kaynak ${index + 1}: ${chunk.document.title}]\n${card.topic ? `Konu: ${card.topic}\n` : ""}${(card.clinicalTakeaway || card.safeGuidance || chunk.content).slice(0, 220).trim()}`,
  ).join("\n\n");

  return {
    contextText: [brief, sourceHints].filter(Boolean).join("\n\n"),
    sources,
    lowGroundingConfidence,
    groundingConfidence,
    evidence: evidenceRun.output,
  };
}
