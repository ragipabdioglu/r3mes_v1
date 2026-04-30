import type { ChatSourceCitation } from "@r3mes/shared-types";
import type { GroundingConfidence } from "./answerSchema.js";
import { buildGroundedBrief } from "./groundedBrief.js";
import { rankHybridCandidates } from "./hybridRetrieval.js";
import { tokenizeKnowledgeText } from "./knowledgeEmbedding.js";
import { parseKnowledgeCard } from "./knowledgeCard.js";
import { rerankKnowledgeCardsWithFallback } from "./modelRerank.js";
import { prisma } from "./prisma.js";
import type { DomainRoutePlan } from "./queryRouter.js";
import { runEvidenceExtractorSkill, type EvidenceExtractorOutput } from "./skillPipeline.js";

export interface RetrievedKnowledgeContext {
  contextText: string;
  sources: ChatSourceCitation[];
  lowGroundingConfidence: boolean;
  groundingConfidence: GroundingConfidence;
  evidence: EvidenceExtractorOutput | null;
}

export { buildLexicalCorpusStats, scoreLexicalMatch, type LexicalCorpusStats } from "./lexicalRetrieval.js";

function fallbackContext(content: string): string {
  return content.slice(0, 360).trim();
}

function deriveGroundingConfidence(scores: number[]): GroundingConfidence {
  if (scores.length === 0) return "low";
  const top = scores[0] ?? 0;
  const third = scores[Math.min(2, scores.length - 1)] ?? top;
  if (top >= 2.6 && third >= 1.5) return "high";
  if (top >= 1.5 && third >= 0.8) return "medium";
  return "low";
}

function buildQueryTokens(query: string, routePlan?: DomainRoutePlan | null): string[] {
  const tokens = tokenizeKnowledgeText(query);
  const expanded = [
    ...tokens,
    ...(routePlan?.mustIncludeTerms ?? []),
    ...(routePlan?.retrievalHints ?? []),
    ...(routePlan?.subtopics ?? []),
  ];
  const normalized = query.toLocaleLowerCase("tr-TR");
  if (normalized.includes("karn") || normalized.includes("karın") || normalized.includes("karin")) {
    expanded.push("karın", "karin", "karnım", "karın ağrısı", "kasık", "kasık ağrısı", "ağrı");
  }
  if (normalized.includes("kasık") || normalized.includes("kasik")) {
    expanded.push("kasık", "kasik", "kasık ağrısı", "karın", "karin", "ağrı");
  }
  if (normalized.includes("ağrı") || normalized.includes("agri")) {
    expanded.push("ağrı", "agri", "şiddetli", "ateş", "kusma", "kanama");
  }
  return [...new Set(expanded)]
    .filter((token) => token.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
}

function routeScopeScore(content: string, tags: string[], routePlan?: DomainRoutePlan | null): number {
  if (!routePlan || routePlan.confidence === "low") return 0;
  const haystack = tokenizeKnowledgeText([content, ...tags].join(" ")).join(" ");
  const terms = [
    routePlan.domain,
    ...routePlan.subtopics,
    ...routePlan.mustIncludeTerms,
    ...routePlan.retrievalHints,
  ].map((term) => term.toLocaleLowerCase("tr-TR"));
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function bulletSection(title: string, items: string[]): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return [title, ...clean.map((item) => `- ${item}`)].join("\n");
}

function primaryDomainTag(tags: string[]): string | null {
  const domains = new Set(["medical", "legal", "finance", "technical", "education", "general"]);
  return tags.find((tag) => domains.has(tag.toLocaleLowerCase("tr-TR"))) ?? null;
}

function renderEvidenceBrief(
  evidence: EvidenceExtractorOutput,
  opts: { groundingConfidence: GroundingConfidence; lowGroundingConfidence: boolean },
): string {
  const sections = [
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
  ];

  return sections.filter(Boolean).join("\n\n");
}

function getRagContextMode(): "compact" | "detailed" {
  const raw = (process.env.R3MES_RAG_CONTEXT_MODE ?? "compact").trim().toLowerCase();
  return raw === "detailed" ? "detailed" : "compact";
}

export async function retrieveKnowledgeContext(opts: {
  query: string;
  evidenceQuery?: string;
  accessibleCollectionIds: string[];
  limit?: number;
  routePlan?: DomainRoutePlan | null;
}): Promise<RetrievedKnowledgeContext> {
  const { query, evidenceQuery = query, accessibleCollectionIds, limit = 4, routePlan = null } = opts;
  if (accessibleCollectionIds.length === 0) {
    return {
      contextText: "",
      sources: [],
      lowGroundingConfidence: true,
      groundingConfidence: "low",
      evidence: null,
    };
  }

  const queryTokens = buildQueryTokens(query, routePlan);
  const baseWhere = {
    document: {
      collectionId: { in: accessibleCollectionIds },
      parseStatus: "READY" as const,
    },
  };
  const include = {
    document: {
      include: {
        collection: {
          include: {
            owner: { select: { walletAddress: true } },
          },
        },
      },
    },
    embedding: true,
  };

  let chunks = await prisma.knowledgeChunk.findMany({
    where:
      queryTokens.length > 0
        ? {
            ...baseWhere,
            OR: queryTokens.map((token) => ({
              content: { contains: token, mode: "insensitive" as const },
            })),
          }
        : baseWhere,
    include,
    orderBy: [{ createdAt: "desc" }, { chunkIndex: "asc" }],
    take: 120,
  });

  if (chunks.length < 24) {
    chunks = await prisma.knowledgeChunk.findMany({
      where: baseWhere,
      include,
      orderBy: [{ createdAt: "desc" }, { chunkIndex: "asc" }],
      take: 240,
    });
  }

  const hybridWithCards = rankHybridCandidates(query, chunks)
    .slice(0, 24)
    .map((candidate) => ({
      ...candidate,
      card: parseKnowledgeCard(candidate.chunk.content),
    }));
  const scopedHybrid = routePlan && routePlan.confidence !== "low"
    ? hybridWithCards.filter((candidate) => routeScopeScore(
        `${candidate.card.topic}\n${candidate.chunk.content}`,
        candidate.card.tags,
        routePlan,
      ) > 0)
    : hybridWithCards;
  const hybrid = (scopedHybrid.length >= 3 ? scopedHybrid : hybridWithCards).slice(0, 10);
  const reranked = await rerankKnowledgeCardsWithFallback(
    query,
    hybrid,
    3,
  );
  const topDomain = reranked[0] ? primaryDomainTag(reranked[0].card.tags) : null;
  const domainFiltered =
    topDomain && reranked.some((candidate) => primaryDomainTag(candidate.card.tags) === topDomain)
      ? reranked.filter((candidate) => primaryDomainTag(candidate.card.tags) === topDomain)
      : reranked;
  const accepted = domainFiltered.filter((candidate, index) => {
    if (candidate.rerankScore < 0.9) return false;
    if (index > 0 && domainFiltered[0] && candidate.rerankScore < domainFiltered[0].rerankScore * 0.45) return false;
    return true;
  }).slice(0, limit);
  const finalCandidates = accepted.length > 0 ? accepted : domainFiltered.slice(0, Math.min(2, domainFiltered.length));
  const groundingConfidence = deriveGroundingConfidence(
    finalCandidates.map((candidate) => candidate.rerankScore),
  );
  const lowGroundingConfidence = groundingConfidence === "low";

  const sources: ChatSourceCitation[] = finalCandidates.map(({ chunk }) => ({
    collectionId: chunk.document.collectionId,
    documentId: chunk.documentId,
    title: chunk.document.title,
    chunkIndex: chunk.chunkIndex,
    excerpt: chunk.content.slice(0, 240),
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
      ? renderEvidenceBrief(evidenceRun.output, { lowGroundingConfidence, groundingConfidence })
      : buildGroundedBrief(
          finalCandidates.map(({ card }) => card),
          {
            groundingConfidence,
            lowGroundingConfidence,
            sourceRefs: finalCandidates.map(({ chunk }) => ({
              id: chunk.documentId,
              title: chunk.document.title,
            })),
          },
        );
  const sourceHints = finalCandidates
    .map(
      ({ chunk, card }, index) =>
        `[Kaynak ${index + 1}: ${chunk.document.title}]\n${card.topic ? `Konu: ${card.topic}\n` : ""}${fallbackContext(
          card.patientSummary || chunk.content,
        )}`,
    )
    .join("\n\n");

  const contextText = [brief, sourceHints].filter(Boolean).join("\n\n");
  return { contextText, sources, lowGroundingConfidence, groundingConfidence, evidence: evidenceRun.output };
}
