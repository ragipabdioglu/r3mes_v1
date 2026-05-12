import { Readable } from "node:stream";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ChatSourceCitation } from "@r3mes/shared-types";
import { getConfiguredChatRuntime, normalizeAdapterPath } from "../lib/adapterRuntimeSelect.js";
import { parseGroundedMedicalAnswer } from "../lib/answerParse.js";
import { hasLowLanguageQuality, polishAnswerText } from "../lib/answerQuality.js";
import { EMPTY_GROUNDED_MEDICAL_ANSWER, type GroundedMedicalAnswer } from "../lib/answerSchema.js";
import { buildAnswerSpec } from "../lib/answerSpec.js";
import { sendApiError } from "../lib/apiErrors.js";
import { resolveAdapterCidForChatProxy } from "../lib/chatAdapterResolve.js";
import { shouldExposeChatDebugFromHeaders } from "../lib/chatDebugBoundary.js";
import { stripChatDebugFields } from "../lib/chatResponseBoundary.js";
import { createChatTrace, type ChatTraceBuilder } from "../lib/chatTrace.js";
import type { CompiledEvidence } from "../lib/compiledEvidence.js";
import type { ConversationalIntentDecision } from "../lib/conversationalIntent.js";
import { composeAnswerSpec } from "../lib/domainEvidenceComposer.js";
import { evaluateFeedbackShadowRuntime, type FeedbackShadowRuntimeReport } from "../lib/feedbackShadowRuntime.js";
import { getDomainPolicy, inferAnswerDomain, type DomainPolicy } from "../lib/domainPolicy.js";
import { retrieveKnowledgeContextTrueHybrid } from "../lib/hybridKnowledgeRetrieval.js";
import {
  buildKnowledgeRouteDecision,
  collectionHasSpecificRouteSupport,
  inferKnowledgeCollectionAnswerDomain,
  rankMetadataRouteCandidates,
  rankSuggestedKnowledgeCollections,
  queryUnderstandingProfilesForCollections,
  readKnowledgeCollectionStrictRouteEligible,
  readKnowledgeCollectionSourceQuality,
  resolveAccessibleKnowledgeCollections,
  resolveSuggestibleKnowledgeCollections,
  type KnowledgeCollectionAccessItem,
  type KnowledgeMetadataRouteCandidate,
} from "../lib/knowledgeAccess.js";
import { retrieveKnowledgeContext } from "../lib/knowledgeRetrieval.js";
import { retrieveKnowledgeContextQdrant } from "../lib/qdrantRetrieval.js";
import { buildQueryUnderstanding, summarizeQueryUnderstandingForTrace } from "../lib/queryUnderstanding.js";
import { renderGroundedMedicalAnswer } from "../lib/renderMedicalAnswer.js";
import { buildRouteDecisionLogEvent } from "../lib/routeDecisionLog.js";
import { resolveRetrievalBudget } from "../lib/retrievalBudget.js";
import { evaluateSafetyGate } from "../lib/safetyGate.js";
import type { DomainRoutePlan } from "../lib/queryRouter.js";
import type { EvidenceExtractorOutput, QueryPlannerOutput } from "../lib/skillPipeline.js";
import { runQueryPlannerSkill } from "../lib/skillPipeline.js";
import { walletAuthPreHandler } from "../lib/walletAuth.js";
import {
  assertOperatorCanPayChatFee,
  getOperatorCapObjectId,
  getOperatorKeypair,
  getPublishedPackageId,
  getRewardPoolObjectId,
  recordChatUsageOnChain,
} from "../lib/suiOperator.js";

const AI_ENGINE_DEFAULT = "http://127.0.0.1:8000";
const DEFAULT_CHAT_STOPS = [
  "<|im_start|>",
  "</|im_start|>",
  "<|im_end|>",
  "</|im_end|>",
];
const DEFAULT_VALIDATOR_MAX_TOKENS = 180;
const DEFAULT_COMPOSER_MAX_TOKENS = 160;
const MEDICAL_COMPOSER_MAX_TOKENS = 120;
const DEFAULT_VALIDATOR_MIN_MAX_TOKENS = 180;
type GroundedComposerMode = "deterministic" | "model" | "auto";

interface ChatRetrievalDebug {
  groundingConfidence: "high" | "medium" | "low";
  queryPlan: QueryPlannerOutput | null;
  routePlan: DomainRoutePlan | null;
  evidence: EvidenceExtractorOutput | null;
  compiledEvidence?: CompiledEvidence | null;
  domain: DomainPolicy["domain"];
  responseMode: "natural" | "json";
  retrievalMode?: "true_hybrid" | "qdrant" | "prisma" | "legacy_hybrid";
  retrievalDiagnostics?: Record<string, unknown>;
  sourceSelection: {
    selectionMode: "none" | "selected" | "public" | "selected_plus_public";
    requestedCollectionIds: string[];
    accessibleCollectionIds: string[];
    searchedCollectionIds: string[];
    usedCollectionIds: string[];
    groundedCollectionIds: string[];
    unusedSelectedCollectionIds: string[];
    suggestedCollections: Array<{ id: string; name: string; reason: string }>;
    metadataRouteCandidates: KnowledgeMetadataRouteCandidate[];
    includePublic: boolean;
    routeDomain: DomainRoutePlan["domain"] | null;
    hasSources: boolean;
    warning: string | null;
    routeDecision: {
      mode: "strict" | "broad" | "suggest" | "no_source";
      primaryDomain: DomainRoutePlan["domain"] | null;
      confidence: "low" | "medium" | "high";
      selectedCollectionIds: string[];
      usedCollectionIds: string[];
      suggestedCollectionIds: string[];
      rejectedCollectionIds: string[];
      reasons: string[];
    };
    shadowRuntime?: FeedbackShadowRuntimeReport;
  };
  quality: {
    sourceCount: number;
    directFactCount: number;
    riskFactCount: number;
    hasUsableGrounding: boolean;
    composerMode?: GroundedComposerMode;
  };
}

function getAiEngineBase(): string {
  return (process.env.R3MES_AI_ENGINE_URL ?? process.env.AI_ENGINE_URL ?? AI_ENGINE_DEFAULT).replace(/\/$/, "");
}

function getRetrievalEngine(): "prisma" | "qdrant" | "hybrid" {
  const raw = (process.env.R3MES_RETRIEVAL_ENGINE ?? "prisma").trim().toLowerCase();
  return raw === "qdrant" || raw === "hybrid" ? raw : "prisma";
}

function shouldUseTrueHybridRetrieval(): boolean {
  const raw = (process.env.R3MES_ENABLE_TRUE_HYBRID_RETRIEVAL ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function getChatResponseMode(): "natural" | "json" {
  const raw = (process.env.R3MES_CHAT_RESPONSE_MODE ?? "natural").trim().toLowerCase();
  return raw === "json" ? "json" : "natural";
}

function getGroundedComposerMode(): GroundedComposerMode {
  const raw = (process.env.R3MES_GROUNDED_COMPOSER_MODE ?? "deterministic").trim().toLowerCase();
  return raw === "model" || raw === "auto" ? raw : "deterministic";
}

function getComposerMaxTokens(answerDomain: DomainPolicy["domain"]): number {
  return answerDomain === "medical" ? MEDICAL_COMPOSER_MAX_TOKENS : DEFAULT_COMPOSER_MAX_TOKENS;
}

function shouldSkipChatFee(): boolean {
  return process.env.R3MES_SKIP_CHAT_FEE === "1";
}

function mergeDefaultChatStops(stop: unknown): string[] {
  const merged = [...DEFAULT_CHAT_STOPS];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
  };

  if (typeof stop === "string") {
    push(stop);
  } else if (Array.isArray(stop)) {
    for (const item of stop) push(item);
  }

  return merged;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function candidateQualityLabel(candidate: KnowledgeMetadataRouteCandidate): string {
  if (candidate.sourceQuality === "structured") return "structured profile";
  if (candidate.sourceQuality === "inferred") return "inferred profile";
  if (candidate.sourceQuality === "thin") return "thin profile, temkinli öneri";
  return "metadata profile";
}

function explainMetadataCandidateSuggestion(candidate: KnowledgeMetadataRouteCandidate): string {
  const quality = candidateQualityLabel(candidate);
  const score = Math.round(candidate.score);
  if (candidate.matchedTerms.length > 0) {
    return `Profile eşleşmesi (${quality}, skor ${score}): ${candidate.matchedTerms.slice(0, 4).join(", ")}.`;
  }
  return `${candidate.reason} (${quality}, skor ${score}).`;
}

function buildSourceSelectionSummary(opts: {
  query: string;
  requestedCollectionIds: string[];
  accessibleCollectionIds: string[];
  suggestibleCollections: KnowledgeCollectionAccessItem[];
  sources: ChatSourceCitation[];
  includePublic: boolean;
  routePlan: DomainRoutePlan | null;
  retrievalSuggestedCollectionIds?: string[];
  skipSuggestions?: boolean;
}): ChatRetrievalDebug["sourceSelection"] {
  const groundedCollectionIds = uniqueStrings(opts.sources.map((source) => source.collectionId));
  const selectedSearchedCollectionIds = uniqueStrings(
    opts.requestedCollectionIds.filter((id) => opts.accessibleCollectionIds.includes(id)),
  );
  const searchedCollectionIds = uniqueStrings(opts.accessibleCollectionIds);
  const usedCollectionIds =
    groundedCollectionIds.length > 0
      ? groundedCollectionIds
      : selectedSearchedCollectionIds;
  const unusedSelectedCollectionIds = opts.requestedCollectionIds.filter(
    (id) => !groundedCollectionIds.includes(id),
  );
  const selectionMode =
    opts.requestedCollectionIds.length > 0 && opts.includePublic
      ? "selected_plus_public"
      : opts.requestedCollectionIds.length > 0
        ? "selected"
      : opts.includePublic
        ? "public"
        : "none";
  const excluded = new Set([...usedCollectionIds, ...opts.requestedCollectionIds]);
  const retrievalSuggestedIds = opts.retrievalSuggestedCollectionIds ?? [];
  const useFastMetadataSuggestions =
    groundedCollectionIds.length === 0;
  const metadataRouteCandidates = opts.skipSuggestions
    ? []
    : rankMetadataRouteCandidates({
        collections: opts.suggestibleCollections,
        routePlan: opts.routePlan,
        query: opts.query,
        excludedIds: new Set(opts.requestedCollectionIds),
        limit: 8,
        fast: useFastMetadataSuggestions,
      });
  const metadataCandidateById = new Map(metadataRouteCandidates.map((candidate) => [candidate.id, candidate]));
  const rankedSuggestedCollections = metadataRouteCandidates
    .filter((candidate) => !excluded.has(candidate.id))
    .map((candidate) => {
      const collection = opts.suggestibleCollections.find((item) => item.id === candidate.id);
      return collection ? { collection, candidate } : null;
    })
    .filter((item): item is { collection: KnowledgeCollectionAccessItem; candidate: KnowledgeMetadataRouteCandidate } =>
      Boolean(item),
    );
  const thinProfileCollectionIds = uniqueStrings([
    ...metadataRouteCandidates
      .filter((candidate) => candidate.sourceQuality === "thin")
      .map((candidate) => candidate.id),
    ...groundedCollectionIds.filter((id) => {
      const collection = opts.suggestibleCollections.find((item) => item.id === id);
      return collection
        ? readKnowledgeCollectionSourceQuality(collection) === "thin" ||
            !readKnowledgeCollectionStrictRouteEligible(collection)
        : false;
    }),
  ]);
  const suggestedCollections = [...rankedSuggestedCollections]
    .sort((a, b) => {
      const aRetrieval = retrievalSuggestedIds.includes(a.collection.id) ? 0 : 1;
      const bRetrieval = retrievalSuggestedIds.includes(b.collection.id) ? 0 : 1;
      if (aRetrieval !== bRetrieval) return aRetrieval - bRetrieval;
      if (b.candidate.score !== a.candidate.score) return b.candidate.score - a.candidate.score;
      return 0;
    })
    .slice(0, 3)
    .map(({ collection, candidate }) => ({
      id: collection.id,
      name: collection.name,
      reason: retrievalSuggestedIds.includes(collection.id)
        ? `${explainMetadataCandidateSuggestion(candidate)} Retrieval probe bu kaynaktan kanıt buldu.`
        : explainMetadataCandidateSuggestion(candidate),
    }));
  const usedCollectionsMatchRoute =
    suggestedCollections.length === 0 ||
    !opts.routePlan?.domain ||
    opts.routePlan.domain === "general" ||
    groundedCollectionIds.some((id) => {
      const collection = opts.suggestibleCollections.find((item) => item.id === id);
      const candidate = metadataCandidateById.get(id);
      if (candidate && candidate.sourceQuality !== "thin" && candidate.score >= 70 && (!collection || readKnowledgeCollectionStrictRouteEligible(collection))) return true;
      return collection ? collectionHasSpecificRouteSupport(collection, opts.routePlan, opts.query) : false;
    });
  const warning =
    opts.accessibleCollectionIds.length === 0
      ? "Knowledge kaynağı seçilmedi; cevap RAG kullanmadan üretilebilir."
      : groundedCollectionIds.length === 0
        ? "Seçilen/erişilebilir kaynaklardan bu soru için yeterli kanıt bulunamadı."
        : unusedSelectedCollectionIds.length > 0
          ? "Bazı seçili kaynaklardan bu soru için kanıt kullanılmadı."
          : suggestedCollections.length > 0 && !usedCollectionsMatchRoute
            ? "Seçilen kaynak kullanıldı fakat soru domain'iyle daha uyumlu kaynak önerileri var."
          : null;
  const routeDecision = buildKnowledgeRouteDecision({
    routePlan: opts.routePlan,
    requestedCollectionIds: opts.requestedCollectionIds,
    accessibleCollectionIds: opts.accessibleCollectionIds,
    usedCollectionIds,
    unusedSelectedCollectionIds,
    suggestedCollections,
    metadataRouteCandidates,
    thinProfileCollectionIds,
    hasSources: groundedCollectionIds.length > 0,
  });

  return {
    selectionMode,
    requestedCollectionIds: opts.requestedCollectionIds,
    accessibleCollectionIds: opts.accessibleCollectionIds,
    searchedCollectionIds,
    usedCollectionIds,
    groundedCollectionIds,
    unusedSelectedCollectionIds,
    suggestedCollections,
    metadataRouteCandidates,
    includePublic: opts.includePublic,
    routeDomain: opts.routePlan?.domain ?? null,
    hasSources: groundedCollectionIds.length > 0,
    warning,
    routeDecision,
  };
}

async function resolveRetrievalBackedSuggestionIds(opts: {
  query: string;
  evidenceQuery: string;
  routePlan: DomainRoutePlan | null;
  suggestibleCollections: KnowledgeCollectionAccessItem[];
  excludedIds: Set<string>;
}): Promise<string[]> {
  const candidates = rankSuggestedKnowledgeCollections({
    collections: opts.suggestibleCollections,
    routePlan: opts.routePlan,
    query: opts.query,
    excludedIds: opts.excludedIds,
    limit: 8,
  });
  const candidateIds = candidates.map((collection) => collection.id);
  if (candidateIds.length === 0) return [];

  try {
    const probe = await retrieveKnowledgeContextTrueHybrid({
      query: opts.query,
      evidenceQuery: opts.evidenceQuery,
      accessibleCollectionIds: candidateIds,
      routePlan: opts.routePlan,
      limit: 3,
    });
    return uniqueStrings(probe.sources.map((source) => source.collectionId));
  } catch {
    return [];
  }
}

function shouldSkipSourceSuggestions(opts: {
  query: string;
  requestedCollectionIds: string[];
  retrievalSources: ChatSourceCitation[];
  groundingConfidence: "high" | "medium" | "low";
}): boolean {
  void opts.query;
  return (
    opts.requestedCollectionIds.length > 0 &&
    opts.retrievalSources.length > 0 &&
    opts.groundingConfidence === "high"
  );
}

function shouldRunRetrievalBackedSuggestionProbe(opts: {
  retrievalQuery: string;
  skipSourceSuggestions: boolean;
  requestedCollectionIds: string[];
  retrievalSources: ChatSourceCitation[];
  groundingConfidence: "high" | "medium" | "low";
}): boolean {
  if (!opts.retrievalQuery || opts.skipSourceSuggestions) return false;
  if (opts.requestedCollectionIds.length === 0) return false;
  if (
    opts.requestedCollectionIds.length > 0 &&
    opts.retrievalSources.length === 0 &&
    opts.groundingConfidence === "low"
  ) {
    return false;
  }
  return true;
}

function shouldUseMiniValidator(stream: boolean, hasRetrieval: boolean): boolean {
  if (stream) return false;
  if (!hasRetrieval) return false;
  return process.env.R3MES_ENABLE_MINI_VALIDATOR !== "0";
}

function shouldForceMiniValidator(): boolean {
  return (process.env.R3MES_ENABLE_MINI_VALIDATOR ?? "").trim().toLowerCase() === "force";
}

function shouldUseFastGroundedComposer(opts: {
  stream: boolean;
  hasRetrieval: boolean;
  groundingConfidence: "high" | "medium" | "low";
}): boolean {
  const mode = (process.env.R3MES_ENABLE_FAST_GROUNDED_COMPOSER ?? "0").trim().toLowerCase();
  if (mode === "0" || mode === "false" || mode === "off") return false;
  if (opts.stream || !opts.hasRetrieval) return false;
  if (mode === "force") return true;
  return opts.groundingConfidence !== "low";
}

function shouldUseRagFastPath(opts: {
  stream: boolean;
  hasRetrieval: boolean;
  sourceCount: number;
  groundingConfidence: "high" | "medium" | "low";
  answerDomain: DomainPolicy["domain"];
  composerMode?: GroundedComposerMode;
}): boolean {
  if (opts.composerMode === "model") return false;
  if (opts.composerMode === "auto" && opts.answerDomain !== "medical") return false;
  const raw = (process.env.R3MES_ENABLE_RAG_FAST_PATH ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (opts.stream || !opts.hasRetrieval || opts.sourceCount === 0) return false;
  if (raw === "force") return true;
  if (opts.groundingConfidence === "low") return false;
  if (opts.answerDomain === "medical" && raw === "non-medical-only") return false;
  return true;
}

function shouldExposeChatDebug(req: FastifyRequest): boolean {
  return shouldExposeChatDebugFromHeaders(req.headers);
}

function extractRetrievalQuery(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages]
    .reverse()
    .find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).role === "user" &&
        typeof (item as Record<string, unknown>).content === "string",
    ) as { content?: string } | undefined;
  return lastUser?.content?.trim() ?? "";
}

function injectRetrievedContextIntoMessages(
  body: Record<string, unknown>,
  contextText: string,
  lowGroundingConfidence: boolean,
  groundingConfidence: "high" | "medium" | "low",
  domainPolicy: DomainPolicy,
  answerIntent: string,
  responseMode: "natural" | "json",
): Record<string, unknown> {
  if (!contextText) return body;
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  const outputRules =
    responseMode === "json"
      ? [
          "Yalnızca GEÇERLİ bir JSON nesnesi döndür.",
          "JSON şeması:",
          "{",
          `  \"answer_domain\": \"${domainPolicy.domain}\",`,
          `  \"answer_intent\": \"${answerIntent}\",`,
          '  \"grounding_confidence\": \"high | medium | low\",',
          '  \"user_query\": \"kullanıcı sorusunu kısa aynen özetle\",',
          '  \"answer\": \"kullanıcının niyetine göre yazılmış doğal, kısa cevap\",',
          '  \"red_flags\": [\"string\"],',
          '  \"avoid_inference\": [\"string\"],',
          '  \"used_source_ids\": [\"string\"]',
          "}",
          "Bu şemadaki answer alanı ZORUNLUDUR ve boş bırakılamaz.",
          "condition_context, safe_action, general_assessment, recommended_action, short_summary gibi eski alanları yazma.",
          "Alan dışı metin, markdown, açıklama veya başlık yazma.",
          "Öncelikle answer alanını doldur. Son kullanıcıya gösterilecek ana cevap budur.",
        ]
      : [
          "Doğal Türkçe cevap döndür. JSON, markdown tablo veya teknik alan adı yazma.",
          "Cevap 3-5 kısa cümleyi veya 3 kısa maddeyi geçmesin.",
          "Önce kullanıcının sorduğu ana noktaya cevap ver; sonra yalnız gerekiyorsa güvenli takip adımı ekle.",
          "Kaynak cümlelerini birebir kopyalama; anlamını bozmadan sade anlat.",
        ];
  const contextMessage = {
    role: "system",
    content:
      [
        `Sen ${domainPolicy.assistantRole}sın.`,
        "Aşağıdaki içerik, seçilmiş kaynaklardan derlenmiş kısa grounded notlardır.",
        "Ham kayıt dili üretme, kaynakları olduğu gibi kopyalama.",
        `Kullanıcı niyeti: ${answerIntent}. Bu niyet sadece cevap tonunu ayarlasın; hazır şablon üretme.`,
        ...outputRules,
        "Yalnızca kullanılabilir bilgilere dayan. İlgisiz alan bilgisi, test, değer, madde veya terim ekleme.",
        "Kullanıcının sormadığı belirtiyi ana durum gibi yazma; yalnız alarm/risk uyarısı olarak gerekliyse red_flags alanında belirt.",
        "Cevabı kullanıcının tam sorusuna göre özelleştir; hazır şablon veya kaynak özetini birebir tekrar etme.",
        "Elde açık dayanak yoksa ciddi sonuç, kesin hüküm veya belirli işlem ima etme.",
        "Kaynakta açıkça geçmeyen neden, tanı, etken, test, ilaç, süre veya prosedür ekleme.",
        "Bir bulgu ile bir şikayet arasında kaynak açıkça neden-sonuç ilişkisi kurmuyorsa neden ilişkisi kurma.",
        "Neden bilinmiyorsa neden uydurma; 'bu tek başına açıklamaz' veya 'bunun için muayene gerekir' gibi güvenli ifade kullan.",
        "Alan kuralları:",
        ...domainPolicy.rules.map((rule) => `- ${rule}`),
        "Bilgi yetersizse bunu JSON içinde kısa ve açık biçimde belirt.",
        "Kaynaklarda risk/alarm/istisna bilgisi varsa red_flags alanında belirt.",
        `answer_domain alanını bu istek için '${domainPolicy.domain}' olarak doldur.`,
        `Grounding confidence alanını bu istek için '${groundingConfidence}' olarak doldur.`,
        lowGroundingConfidence
          ? "Bu istekte grounding sınırlı. Kesin konuşma, yalnız güvenli yönlendirme yap."
          : "Bu istekte grounding yeterli. Yine de yalnız kaynaklı bilgiye dayan.",
        "",
        "Kullanılacak kayıtlar:",
        contextText,
      ].join("\n"),
  };
  return {
    ...body,
    messages: [contextMessage, ...messages],
  };
}

function extractAssistantContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof first?.message?.content === "string" ? first.message.content : null;
}

function buildValidatorPayload(opts: {
  baseBody: Record<string, unknown>;
  draftAnswer: string;
  retrievalContext: string;
  lowGroundingConfidence: boolean;
  groundingConfidence: "high" | "medium" | "low";
  domainPolicy: DomainPolicy;
}): Record<string, unknown> {
  const { baseBody, draftAnswer, retrievalContext, lowGroundingConfidence, groundingConfidence, domainPolicy } = opts;
  return {
    ...baseBody,
    temperature: 0.1,
    top_p: 0.8,
    max_tokens:
      typeof baseBody.max_tokens === "number" && Number.isFinite(baseBody.max_tokens)
        ? Math.max(Math.min(baseBody.max_tokens, 320), DEFAULT_VALIDATOR_MIN_MAX_TOKENS)
        : DEFAULT_VALIDATOR_MAX_TOKENS,
    messages: [
      {
        role: "system",
        content: [
          "Sen dar görevli bir cevap doğrulayıcı ve düzelticisin.",
          "Aşağıdaki taslak JSON cevabı yalnızca verilen grounding bağlamına göre değerlendir.",
          "Kontrol et:",
          "- Kaynak dışına çıkmış mı?",
          "- Uydurma veya alakasız alan bilgisi var mı?",
          "- Fazla kesin veya riskli ifade var mı?",
          "- JSON şemasını bozmuş mu?",
          "Sorun varsa cevabı daha güvenli, daha doğru ve daha kısa hale getir.",
          "Çıktı mutlaka GEÇERLİ bir JSON nesnesi olsun. Şema aynen korunmalı:",
          "{ answer_domain, answer_intent, grounding_confidence, user_query, answer, red_flags, avoid_inference, used_source_ids }",
          "Öncelikle answer alanını düzelt; kullanıcıya gösterilecek ana cevap budur.",
          "Kaynak cümlesini birebir kopyalama, ama kaynak dışı bilgi de ekleme.",
          "Yeni bilgi ekleme. Yalnızca grounded bağlamı kullan.",
          "Alan kuralları:",
          ...domainPolicy.rules.map((rule) => `- ${rule}`),
          `answer_domain alanı '${domainPolicy.domain}' olmalı.`,
          `grounding_confidence alanı '${groundingConfidence}' olmalı.`,
          lowGroundingConfidence
            ? "Grounding sınırlı olduğu için kesin konuşma ve güvenli yönlendirmeyle kal."
            : "Grounding yeterli olsa bile yalnız bağlamdaki bilgiye dayan.",
          "",
          "GROUNDING BAGLAMI:",
          retrievalContext,
          "",
          "TASLAK CEVAP:",
          draftAnswer,
        ].join("\n"),
      },
    ],
  };
}

async function postJsonToAiEngine(
  upstream: string,
  payload: Record<string, unknown>,
  accept: string,
): Promise<Response> {
  return await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json", accept },
    body: JSON.stringify(payload),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postChatCompletionToAiEngine(opts: {
  upstream: string;
  payload: Record<string, unknown>;
  stream: boolean;
}): Promise<Response> {
  const { upstream, payload, stream } = opts;
  const accept = stream ? "text/event-stream" : "application/json";
  const body = JSON.stringify(payload);
  const send = () =>
    fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json", accept },
      body,
    });

  const first = await send();
  if (stream || first.status < 500) return first;

  // llama.cpp can occasionally return a transient 500 while a prior generation
  // is settling. Retry once inside the same paid request instead of surfacing a
  // flaky UI failure.
  await first.arrayBuffer().catch(() => undefined);
  await delay(300);
  return await send();
}

function summarizeRetrievalDiagnostics(diagnostics?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!diagnostics) return undefined;
  const alignment = typeof diagnostics.alignment === "object" && diagnostics.alignment
    ? diagnostics.alignment as Record<string, unknown>
    : undefined;
  const reranker = typeof diagnostics.reranker === "object" && diagnostics.reranker
    ? diagnostics.reranker as Record<string, unknown>
    : undefined;
  const budget = typeof diagnostics.budget === "object" && diagnostics.budget
    ? diagnostics.budget as Record<string, unknown>
    : undefined;

  return {
    retrievalMode: diagnostics.retrievalMode,
    qdrantCandidateCount: diagnostics.qdrantCandidateCount,
    prismaCandidateCount: diagnostics.prismaCandidateCount,
    dedupedCandidateCount: diagnostics.dedupedCandidateCount,
    preRankedCandidateCount: diagnostics.preRankedCandidateCount,
    rerankedCandidateCount: diagnostics.rerankedCandidateCount,
    finalCandidateCount: diagnostics.finalCandidateCount,
    alignment: alignment
      ? {
          enabled: alignment.enabled,
          minScore: alignment.minScore,
          weakScore: alignment.weakScore,
          alignedCandidateCount: alignment.alignedCandidateCount,
          weakCandidateCount: alignment.weakCandidateCount,
          mismatchCandidateCount: alignment.mismatchCandidateCount,
          droppedCandidateCount: alignment.droppedCandidateCount,
          fastFailed: alignment.fastFailed,
        }
      : undefined,
    reranker: reranker
      ? {
          mode: reranker.mode,
          modelEnabled: reranker.modelEnabled,
          fallbackUsed: reranker.fallbackUsed,
          fallbackReason: reranker.fallbackReason,
          inputCandidateCount: reranker.inputCandidateCount,
          deterministicCandidateCount: reranker.deterministicCandidateCount,
          modelCandidateCount: reranker.modelCandidateCount,
          returnedCandidateCount: reranker.returnedCandidateCount,
          candidateLimit: reranker.candidateLimit,
          topCandidates: Array.isArray(reranker.topCandidates) ? reranker.topCandidates.slice(0, 3) : undefined,
        }
      : undefined,
    budget: budget
      ? {
          mode: budget.budgetMode,
          contextMode: budget.contextMode,
          requestedSourceLimit: budget.requestedSourceLimit,
          finalSourceLimit: budget.finalSourceLimit,
          finalSourceCount: budget.finalSourceCount,
          contextTextChars: budget.contextTextChars,
          evidenceUsableFactCount: budget.evidenceUsableFactCount,
          evidenceRiskFactCount: budget.evidenceRiskFactCount,
        }
      : undefined,
  };
}

function summarizeSourceSelectionForTrace(
  sourceSelection: ChatRetrievalDebug["sourceSelection"],
): Record<string, unknown> {
  return {
    selectionMode: sourceSelection.selectionMode,
    includePublic: sourceSelection.includePublic,
    requestedCollectionCount: sourceSelection.requestedCollectionIds.length,
    accessibleCollectionCount: sourceSelection.accessibleCollectionIds.length,
    searchedCollectionCount: sourceSelection.searchedCollectionIds.length,
    usedCollectionCount: sourceSelection.usedCollectionIds.length,
    groundedCollectionCount: sourceSelection.groundedCollectionIds.length,
    unusedSelectedCollectionCount: sourceSelection.unusedSelectedCollectionIds.length,
    suggestedCollectionCount: sourceSelection.suggestedCollections.length,
    metadataRouteCandidateCount: sourceSelection.metadataRouteCandidates.length,
    topMetadataRouteCandidates: sourceSelection.metadataRouteCandidates.slice(0, 3).map((candidate) => ({
      id: candidate.id,
      score: Math.round(candidate.score * 100) / 100,
      domain: candidate.domain,
      sourceQuality: candidate.sourceQuality,
      matchedTermCount: candidate.matchedTerms.length,
      scoringMode: candidate.scoreBreakdown?.scoringMode,
      scoreSignals: candidate.scoreBreakdown?.signals,
      scoreContributions: candidate.scoreBreakdown?.contributions,
      adaptiveBonus: candidate.scoreBreakdown?.adaptiveBonus,
      missingSignals: candidate.scoreBreakdown?.missingSignals,
    })),
    hasSources: sourceSelection.hasSources,
    warning: sourceSelection.warning,
    decision: {
      mode: sourceSelection.routeDecision.mode,
      confidence: sourceSelection.routeDecision.confidence,
      selectedCollectionCount: sourceSelection.routeDecision.selectedCollectionIds.length,
      usedCollectionCount: sourceSelection.routeDecision.usedCollectionIds.length,
      suggestedCollectionCount: sourceSelection.routeDecision.suggestedCollectionIds.length,
      rejectedCollectionCount: sourceSelection.routeDecision.rejectedCollectionIds.length,
      reasons: sourceSelection.routeDecision.reasons,
    },
    shadowRuntime: sourceSelection.shadowRuntime
      ? {
          runtimeMode: sourceSelection.shadowRuntime.runtimeMode,
          runtimeAffected: sourceSelection.shadowRuntime.runtimeAffected,
          activeAdjustmentCount: sourceSelection.shadowRuntime.activeAdjustmentCount,
          promotedCandidateCount: sourceSelection.shadowRuntime.promotedCandidateCount,
          wouldChangeTopCandidate: sourceSelection.shadowRuntime.wouldChangeTopCandidate,
          currentTopCandidateId: sourceSelection.shadowRuntime.currentTopCandidateId,
          shadowTopCandidateId: sourceSelection.shadowRuntime.shadowTopCandidateId,
          adjustedCandidateCollectionIds: sourceSelection.shadowRuntime.adjustedCandidateCollectionIds.slice(0, 5),
          topImpacts: sourceSelection.shadowRuntime.impacts.slice(0, 3).map((impact) => ({
            collectionId: impact.collectionId,
            totalScoreDelta: impact.totalScoreDelta,
            recommendation: impact.recommendation,
            promotionStage: impact.promotionStage,
            rollbackRecommended: impact.rollbackRecommended,
            nextSafeAction: impact.nextSafeAction,
            blockedReasonCount: impact.blockedReasons.length,
          })),
        }
      : undefined,
  };
}

function applyFeedbackRuntimeToSourceSelection(
  sourceSelection: ChatRetrievalDebug["sourceSelection"],
  shadowRuntime: FeedbackShadowRuntimeReport,
): ChatRetrievalDebug["sourceSelection"] {
  if (!shadowRuntime.runtimeAffected || shadowRuntime.adjustedCandidateCollectionIds.length === 0) {
    return {
      ...sourceSelection,
      shadowRuntime,
    };
  }
  const rank = new Map(shadowRuntime.adjustedCandidateCollectionIds.map((id, index) => [id, index]));
  const order = (id: string | null | undefined) => rank.get(id ?? "") ?? Number.MAX_SAFE_INTEGER;
  const orderByFeedback = <T extends { id: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => order(a.id) - order(b.id));
  const orderedSuggestedIds = [...sourceSelection.routeDecision.suggestedCollectionIds]
    .sort((a, b) => order(a) - order(b));
  return {
    ...sourceSelection,
    suggestedCollections: orderByFeedback(sourceSelection.suggestedCollections),
    metadataRouteCandidates: orderByFeedback(sourceSelection.metadataRouteCandidates),
    routeDecision: {
      ...sourceSelection.routeDecision,
      suggestedCollectionIds: orderedSuggestedIds,
      reasons: [
        ...sourceSelection.routeDecision.reasons,
        "Feedback runtime aktif; eval gate geçmiş query-scoped adjustment candidate sıralamasına uygulandı.",
      ],
    },
    shadowRuntime,
  };
}

function applyRenderedAnswer(
  payload: Record<string, unknown>,
  answer: GroundedMedicalAnswer,
  sources: ChatSourceCitation[],
  userQuery = "",
  retrievalWasUsed = false,
  retrievalDebug: ChatRetrievalDebug | null = null,
  opts: { useFallbackTemplate?: boolean; exposeDebug?: boolean; chatTrace?: ChatTraceBuilder; answerPath?: string } = {},
): Record<string, unknown> {
  const cloned = structuredClone(payload) as Record<string, unknown>;
  const next = opts.exposeDebug === true ? cloned : stripChatDebugFields(cloned);
  const enrichedAnswer = enrichAnswerWithEvidence({
    ...answer,
    answer_domain: retrievalDebug?.domain ?? answer.answer_domain,
    user_query: userQuery || answer.user_query,
  }, retrievalDebug?.evidence ?? null);
  const answerSpec = buildAnswerSpec({
    answerDomain: enrichedAnswer.answer_domain,
    groundingConfidence: enrichedAnswer.grounding_confidence,
    userQuery: userQuery || enrichedAnswer.user_query,
    evidence: retrievalDebug?.evidence ?? null,
    compiledEvidence: retrievalDebug?.compiledEvidence ?? null,
  });
  const useSafeTemplate =
    opts.useFallbackTemplate === true ||
    shouldUseSafeRenderedTemplate(enrichedAnswer, retrievalWasUsed);
  const rendered =
    useSafeTemplate
      ? composeAnswerSpec(answerSpec)
      : renderGroundedMedicalAnswer(enrichedAnswer, {
          useFallbackTemplate: useSafeTemplate,
        });
  const finalRendered = polishAnswerText(rendered);
  const languageSourceText = enrichedAnswer.answer.trim() || rendered;
  const answerQuality = {
    lowLanguageQualityDetected: hasLowLanguageQuality(languageSourceText),
    polishChangedOutput: finalRendered !== rendered,
    fallbackTemplateUsed: useSafeTemplate,
  };
  const safetyGate = evaluateSafetyGate({
    answerText: finalRendered,
    answer: enrichedAnswer,
    answerSpec,
    sources,
    retrievalWasUsed,
    evidence: retrievalDebug?.evidence ?? null,
    retrievalDiagnostics: retrievalDebug?.retrievalDiagnostics ?? null,
    sourceSelection: retrievalDebug?.sourceSelection ?? null,
  });
  const shouldHideCitations =
    safetyGate.blockedReasons.includes("NO_USABLE_FACTS") ||
    safetyGate.blockedReasons.includes("QUERY_SOURCE_MISMATCH") ||
    safetyGate.fallbackMode === "source_suggestion" ||
    safetyGate.fallbackMode === "privacy_safe";
  const exposedSources = shouldHideCitations ? [] : sources;
  const exposedAnswer = shouldHideCitations ? { ...enrichedAnswer, used_source_ids: [] } : enrichedAnswer;
  opts.chatTrace?.recordNow("render_safety", "ok", {
    pass: safetyGate.pass,
    fallbackMode: safetyGate.fallbackMode,
    blockedReasons: safetyGate.blockedReasons,
    exposedSourceCount: exposedSources.length,
    hiddenSourceCount: sources.length - exposedSources.length,
    fallbackTemplateUsed: answerQuality.fallbackTemplateUsed,
    lowLanguageQualityDetected: answerQuality.lowLanguageQualityDetected,
  });
  const finalContent = shouldHideCitations
    ? (safetyGate.safeFallback ?? finalRendered)
        .replace(
          "Bu kaynaklarla net ve kesin bir cevap vermek doğru olmaz; aşağıdaki yanıt yalnızca eldeki sınırlı dayanağa göre okunmalı.",
          "Seçili kaynaklarda bu soruya doğrudan yeterli bilgi bulamadım; aşağıdaki yanıt genel ve temkinli yönlendirme olarak okunmalı.",
        )
        .replace(
          "Eldeki kaynaklar bu soruya sınırlı dayanak sağlıyor.",
          "Seçili kaynaklarda bu soruya doğrudan yeterli bilgi bulunamadı.",
        )
    : safetyGate.safeFallback ?? finalRendered;
  const choices = Array.isArray(next.choices) ? [...next.choices] : [];
  if (choices.length > 0) {
    const first = { ...(choices[0] as Record<string, unknown>) };
    const message = typeof first.message === "object" && first.message ? { ...(first.message as Record<string, unknown>) } : {};
    message.content = finalContent;
    first.message = message;
    choices[0] = first;
  }
  next.choices = choices;
  next.sources = exposedSources;
  if (opts.exposeDebug === true) {
    next.grounded_answer = exposedAnswer;
    next.safety_gate = safetyGate;
    next.answer_quality = answerQuality;
    if (retrievalDebug) next.retrieval_debug = retrievalDebug;
    if (opts.chatTrace) {
      next.chat_trace = opts.chatTrace.snapshot({
        route: retrievalDebug?.routePlan
          ? {
              domain: retrievalDebug.routePlan.domain,
              confidence: retrievalDebug.routePlan.confidence,
              subtopics: retrievalDebug.routePlan.subtopics,
            }
          : undefined,
        retrieval: retrievalDebug
          ? {
              mode: retrievalDebug.retrievalMode,
              groundingConfidence: retrievalDebug.groundingConfidence,
              sourceCount: retrievalDebug.quality.sourceCount,
              directFactCount: retrievalDebug.quality.directFactCount,
              hasUsableGrounding: retrievalDebug.quality.hasUsableGrounding,
              diagnostics: summarizeRetrievalDiagnostics(retrievalDebug.retrievalDiagnostics),
            }
          : undefined,
        sourceSelection: retrievalDebug
          ? summarizeSourceSelectionForTrace(retrievalDebug.sourceSelection)
          : undefined,
        answerPath: {
          name: opts.answerPath ?? "unknown",
          retrievalWasUsed,
          responseMode: retrievalDebug?.responseMode ?? null,
        },
        safety: {
          pass: safetyGate.pass,
          fallbackMode: safetyGate.fallbackMode,
          blockedReasons: safetyGate.blockedReasons,
          exposedSourceCount: exposedSources.length,
        },
      });
    }
  }
  return next;
}

function createChatCompletionPayload(content = ""): Record<string, unknown> {
  return {
    id: `chatcmpl_${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "r3mes-grounded-composer",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
  };
}

function buildDeterministicGroundedAnswer(opts: {
  answerDomain: GroundedMedicalAnswer["answer_domain"];
  groundingConfidence: GroundedMedicalAnswer["grounding_confidence"];
  userQuery: string;
  evidence: EvidenceExtractorOutput | null;
  compiledEvidence?: CompiledEvidence | null;
}): GroundedMedicalAnswer {
  const spec = buildAnswerSpec({
    answerDomain: opts.answerDomain,
    groundingConfidence: opts.groundingConfidence,
    userQuery: opts.userQuery,
    evidence: opts.evidence,
    compiledEvidence: opts.compiledEvidence,
  });

  return {
    ...EMPTY_GROUNDED_MEDICAL_ANSWER,
    answer_domain: spec.answerDomain,
    answer_intent: spec.answerIntent,
    grounding_confidence: spec.groundingConfidence,
    user_query: spec.userQuery,
    answer: spec.assessment,
    condition_context: spec.assessment,
    safe_action: spec.action,
    visit_triggers: spec.caution.slice(0, 3),
    one_sentence_summary: spec.summary,
    general_assessment: spec.assessment,
    recommended_action: spec.action,
    doctor_visit_when: spec.caution.slice(0, 3),
    red_flags: spec.caution.slice(0, 3),
    avoid_inference: spec.unknowns.slice(0, 3),
    short_summary: spec.summary,
    used_source_ids: spec.sourceIds,
  };
}

function createConversationalIntentPayload(opts: {
  decision: ConversationalIntentDecision;
  exposeDebug: boolean;
  chatTrace: ChatTraceBuilder;
}): Record<string, unknown> {
  const payload = createChatCompletionPayload(opts.decision.response);
  payload.sources = [];
  if (opts.exposeDebug) {
    payload.chat_trace = opts.chatTrace.snapshot({
      answerPath: {
        name: "conversational_intent",
        retrievalWasUsed: false,
        intent: opts.decision.kind,
        confidence: opts.decision.confidence,
        reason: opts.decision.reason,
      },
    });
  }
  return payload;
}

function isThinOrGenericText(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return true;
  if (["empty", "null", "none", "n/a", "-"].includes(normalized)) return true;
  if (isSourceIdentifierLike(stripSourcePrefix(value))) return true;
  return [
    "bilgi dayanağı yeterli",
    "bilgi dayanagi yeterli",
    "bilgi kısmen yeterli",
    "bilgi kismen yeterli",
    "eldeki dayanak sınırlı",
    "eldeki dayanak sinirli",
  ].some((marker) => normalized.includes(marker));
}

function stripSourcePrefix(value: string): string {
  return stripDocumentScaffold(value.replace(/^[^:]{1,120}:\s*/, "").trim());
}

function stripDocumentScaffold(value: string): string {
  const cleaned = value
    .replace(/^#+\s*Page\s+\d+\s*/giu, "")
    .replace(/^#+\s*XML Text Fallback\s*/giu, "")
    .replace(/^#+\s*word\/[^\s]+\s*/giu, "")
    .replace(/^\s*(?:[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9()[\]\s_-]{8,})\s+\d+\s*[•\-–:]\s*/u, "")
    .replace(/^\s*(?:[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9()[\]\s_-]{8,})\s+\d+\s+/u, "")
    .replace(/^\s*(?:[A-ZÇĞİÖŞÜ0-9()[\]\s_-]{24,}?)\s+(?=(Bu|Bu\s+ilaç|Eğer|Eller|Okul|Öğrenci|Hasta|Veli|Kaynak|Amaç)\b)/u, "")
    .trim();
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  const uppercaseLetters = cleaned.match(/\p{Lu}/gu) ?? [];
  if (letters.length >= 6 && uppercaseLetters.length / letters.length > 0.85 && cleaned.length <= 140) {
    return "";
  }
  return cleaned;
}

function isSourceIdentifierLike(value: string): boolean {
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) return false;
  return /^[a-z][a-z0-9]+(?:-[a-z0-9]+){1,}$/i.test(trimmed);
}

function extractSalientQueryTerms(query: string): string[] {
  const acronymTerms = query.match(/\b[A-ZÇĞİÖŞÜ]{2,}(?:-[A-ZÇĞİÖŞÜ]{2,})?\b/g) ?? [];
  const normalized = query.toLocaleLowerCase("tr-TR");
  const tokens = new Set(normalized.split(/[^\p{L}\p{N}-]+/u).filter(Boolean));
  const containsQueryTerm = (term: string): boolean => {
    const normalizedTerm = term.toLocaleLowerCase("tr-TR");
    if (normalizedTerm.includes(" ")) return normalized.includes(normalizedTerm);
    if (tokens.has(normalizedTerm)) return true;
    if (normalizedTerm.length < 4) return false;
    return [...tokens].some((token) => token.startsWith(normalizedTerm));
  };
  const knownTerms = [
    "smear",
    "hpv",
    "kist",
    "boyut",
    "menopoz",
    "gebelik",
    "patoloji",
    "biyopsi",
    "ultrason",
    "lekelenme",
    "kanama",
    "akıntı",
    "akinti",
    "kasık",
    "kasik",
    "ağrı",
    "agri",
    "aşı",
    "asi",
    "depozito",
    "yatırım",
    "yatirim",
    "danışman",
    "danisman",
    "migration",
    "yedek",
    "rollback",
    "staging",
    "pasaport",
    "rezervasyon",
    "resmi kaynak",
    "boşanma",
    "bosanma",
    "velayet",
    "nafaka",
    "mal paylaşımı",
    "mal paylasimi",
    "miras",
    "icra",
    "sınav",
    "sinav",
    "müfredat",
    "mufredat",
    "disiplin",
    "özel eğitim",
    "ozel egitim",
    "ram",
    "bep",
    "veli",
    "okul",
  ]
    .filter(containsQueryTerm);
  const uniqueTerms: string[] = [];
  const seen = new Set<string>();
  for (const term of [...acronymTerms, ...knownTerms]) {
    const key = term.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTerms.push(term);
  }
  return uniqueTerms.slice(0, 4);
}

function lowerFirstForInline(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return `${trimmed.charAt(0).toLocaleLowerCase("tr-TR")}${trimmed.slice(1)}`;
}

function preserveSalientQueryTerms(text: string, query: string): string {
  const terms = extractSalientQueryTerms(query)
    .filter((term) => !text.toLocaleLowerCase("tr-TR").includes(term.toLocaleLowerCase("tr-TR")));
  if (terms.length === 0) return text;
  return `${terms.slice(0, 2).join(" / ")} açısından ${lowerFirstForInline(text)}`;
}

function legalActionNeedsEvidence(action: string): boolean {
  const normalized = action.toLocaleLowerCase("tr-TR");
  if (!normalized.trim()) return true;
  return !["avukat", "hukuki", "yetkili", "kurum", "merci", "belge", "delil", "kanıt", "kanit", "süre", "sure"]
    .some((term) => normalized.includes(term));
}

function domainActionEvidenceTerms(domain: GroundedMedicalAnswer["answer_domain"]): string[] {
  if (domain === "medical") {
    return ["muayene", "kontrol", "takip", "doktor", "hekim", "değerlendirme", "degerlendirme"];
  }
  if (domain === "legal") {
    return ["avukat", "hukuki", "yetkili", "kurum", "merci", "belge", "delil", "kanıt", "kanit", "süre", "sure"];
  }
  if (domain === "finance") {
    return ["risk", "vade", "maliyet", "kayıp", "kayip", "danışman", "danisman", "garanti", "çeşitlendirme", "cesitlendirme"];
  }
  if (domain === "technical") {
    return ["yedek", "backup", "staging", "test", "rollback", "geri dönüş", "geri donus", "log"];
  }
  if (domain === "education") {
    return ["okul", "öğrenci", "ogrenci", "veli", "rehberlik", "başvuru", "basvuru", "resmi", "değerlendirme", "degerlendirme"];
  }
  if (domain === "general") {
    return ["belge", "rezervasyon", "resmi", "güncel", "guncel", "pasaport", "kopya"];
  }
  return [];
}

function actionNeedsDomainEvidence(domain: GroundedMedicalAnswer["answer_domain"], action: string): boolean {
  const normalized = action.toLocaleLowerCase("tr-TR");
  if (!normalized.trim()) return true;
  const terms = domainActionEvidenceTerms(domain);
  return terms.length > 0 && !terms.some((term) => normalized.includes(term));
}

function selectDomainEvidenceFact(
  domain: GroundedMedicalAnswer["answer_domain"],
  facts: string[],
): string | null {
  const terms = domainActionEvidenceTerms(domain);
  if (terms.length === 0) return null;
  return facts.find((fact) => {
    const normalized = fact.toLocaleLowerCase("tr-TR");
    return terms.some((term) => normalized.includes(term));
  }) ?? null;
}

function selectFactContaining(facts: string[], terms: string[]): string | null {
  return facts.find((fact) => {
    const normalized = fact.toLocaleLowerCase("tr-TR");
    return terms.some((term) => normalized.includes(term));
  }) ?? null;
}

function strengthenDomainAction(
  domain: GroundedMedicalAnswer["answer_domain"],
  action: string,
  facts: string[],
  userQuery: string,
): string {
  const normalized = action.toLocaleLowerCase("tr-TR");
  if (
    domain === "legal" &&
    userQuery.toLocaleLowerCase("tr-TR").includes("mesai") &&
    !["kanıt", "kanit", "delil"].some((term) => normalized.includes(term))
  ) {
    return selectFactContaining(facts, ["kanıt", "kanit", "delil"]) ?? action;
  }
  if (
    domain === "legal" &&
    userQuery.toLocaleLowerCase("tr-TR").includes("itiraz") &&
    !["belge", "delil", "kanıt", "kanit"].some((term) => normalized.includes(term))
  ) {
    return selectFactContaining(facts, ["belge", "delil", "kanıt", "kanit"]) ?? action;
  }
  if (domain === "finance" && !["danışman", "danisman"].some((term) => normalized.includes(term))) {
    return selectFactContaining(facts, ["danışman", "danisman"]) ?? action;
  }
  if (
    domain === "medical" &&
    userQuery.toLocaleLowerCase("tr-TR").includes("kist") &&
    !normalized.includes("takip")
  ) {
    return selectFactContaining(facts, ["takip", "kontrol"]) ?? action;
  }
  if (
    domain === "general" &&
    userQuery.toLocaleLowerCase("tr-TR").includes("pasaport") &&
    !normalized.includes("pasaport")
  ) {
    return selectFactContaining(facts, ["pasaport"]) ?? action;
  }
  if (domain === "general" && !["resmi", "güncel", "guncel"].some((term) => normalized.includes(term))) {
    return selectFactContaining(facts, ["resmi", "güncel", "guncel"]) ?? action;
  }
  if (domain === "education" && !["okul", "veli", "rehberlik", "başvuru", "basvuru", "resmi"].some((term) => normalized.includes(term))) {
    return selectFactContaining(facts, ["okul", "veli", "rehberlik", "başvuru", "basvuru", "resmi"]) ?? action;
  }
  if (
    domain === "education" &&
    ["müfredat", "mufredat", "ders plan"].some((term) => userQuery.toLocaleLowerCase("tr-TR").includes(term)) &&
    !["resmi kaynak", "resmi kaynaklar"].some((term) => normalized.includes(term))
  ) {
    return selectFactContaining(facts, ["resmi kaynak"]) ?? action;
  }
  return action;
}

function mergeEvidenceItems(primary: string[], evidenceItems: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...primary, ...evidenceItems].map((value) => value.trim()).filter(Boolean)) {
    const key = item.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function enrichAnswerWithEvidence(
  answer: GroundedMedicalAnswer,
  evidence: EvidenceExtractorOutput | null,
): GroundedMedicalAnswer {
  if (!evidence) return answer;
  const facts = evidence.usableFacts.map(stripSourcePrefix).filter((value) => Boolean(value) && !isSourceIdentifierLike(value));
  const redFlags = evidence.redFlags.map(stripSourcePrefix).filter(Boolean);
  const uncertain = [...evidence.uncertainOrUnusable, ...evidence.missingInfo]
    .map(stripSourcePrefix)
    .filter(Boolean);
  if (answer.answer.trim()) {
    return {
      ...answer,
      answer_intent: answer.answer_intent === "unknown" ? evidence.answerIntent : answer.answer_intent,
      answer: preserveSalientQueryTerms(stripDocumentScaffold(answer.answer), answer.user_query),
      condition_context: isThinOrGenericText(answer.condition_context)
        ? preserveSalientQueryTerms(facts[0] ?? answer.condition_context, answer.user_query)
        : preserveSalientQueryTerms(answer.condition_context, answer.user_query),
      safe_action: isThinOrGenericText(answer.safe_action)
        ? preserveSalientQueryTerms(facts[1] ?? facts[0] ?? answer.safe_action, answer.user_query)
        : preserveSalientQueryTerms(answer.safe_action, answer.user_query),
      general_assessment: isThinOrGenericText(answer.general_assessment)
        ? preserveSalientQueryTerms(facts[0] ?? answer.general_assessment, answer.user_query)
        : preserveSalientQueryTerms(answer.general_assessment, answer.user_query),
      recommended_action: isThinOrGenericText(answer.recommended_action)
        ? preserveSalientQueryTerms(facts[1] ?? facts[0] ?? answer.recommended_action, answer.user_query)
        : preserveSalientQueryTerms(answer.recommended_action, answer.user_query),
      one_sentence_summary: isThinOrGenericText(answer.one_sentence_summary)
        ? preserveSalientQueryTerms(facts[0] ?? answer.one_sentence_summary, answer.user_query)
        : preserveSalientQueryTerms(answer.one_sentence_summary, answer.user_query),
      short_summary: isThinOrGenericText(answer.short_summary)
        ? preserveSalientQueryTerms(facts[0] ?? answer.short_summary, answer.user_query)
        : preserveSalientQueryTerms(answer.short_summary, answer.user_query),
      red_flags: mergeEvidenceItems(answer.red_flags, redFlags, 3),
      visit_triggers: mergeEvidenceItems(answer.visit_triggers, redFlags, 3),
      avoid_inference:
        answer.avoid_inference.length > 0 ? answer.avoid_inference : uncertain.slice(0, 3),
      used_source_ids: answer.used_source_ids.length > 0 ? answer.used_source_ids : evidence.sourceIds,
    };
  }
  const modelSummary = !isThinOrGenericText(answer.one_sentence_summary)
    ? answer.one_sentence_summary
    : !isThinOrGenericText(answer.short_summary)
      ? answer.short_summary
      : "";
  const modelAction = !isThinOrGenericText(answer.recommended_action) ? answer.recommended_action : "";

  const conditionContext = isThinOrGenericText(answer.condition_context)
    ? facts[0] ?? (modelSummary || answer.condition_context)
    : answer.condition_context;
  const oneSentenceSummary = isThinOrGenericText(answer.one_sentence_summary)
    ? facts[0] ?? (modelSummary || answer.one_sentence_summary)
    : answer.one_sentence_summary;

  const safeAction = isThinOrGenericText(answer.safe_action)
    ? facts[1] ?? facts[0] ?? (modelAction || answer.safe_action)
    : answer.safe_action;
  const legalSafeAction =
    answer.answer_domain === "legal" && legalActionNeedsEvidence(safeAction)
      ? selectDomainEvidenceFact(answer.answer_domain, facts) ?? safeAction
      : safeAction;
  const domainSafeAction =
    answer.answer_domain !== "legal" && actionNeedsDomainEvidence(answer.answer_domain, safeAction)
      ? selectDomainEvidenceFact(answer.answer_domain, facts) ?? safeAction
      : legalSafeAction;
  const strengthenedSafeAction = strengthenDomainAction(
    answer.answer_domain,
    domainSafeAction,
    facts,
    answer.user_query,
  );

  return {
    ...answer,
    answer_intent: answer.answer_intent === "unknown" ? evidence.answerIntent : answer.answer_intent,
    condition_context: preserveSalientQueryTerms(conditionContext, answer.user_query),
    safe_action: preserveSalientQueryTerms(strengthenedSafeAction, answer.user_query),
    visit_triggers: mergeEvidenceItems(answer.visit_triggers, redFlags, 3),
    red_flags: mergeEvidenceItems(answer.red_flags, redFlags, 3),
    avoid_inference: answer.avoid_inference.length > 0 ? answer.avoid_inference : uncertain.slice(0, 3),
    one_sentence_summary: preserveSalientQueryTerms(oneSentenceSummary, answer.user_query),
    short_summary: preserveSalientQueryTerms(
      isThinOrGenericText(answer.short_summary)
        ? facts[0] ?? answer.short_summary
        : answer.short_summary,
      answer.user_query,
    ),
    used_source_ids: answer.used_source_ids.length > 0 ? answer.used_source_ids : evidence.sourceIds,
  };
}

function hasThinGroundedAnswer(answer: GroundedMedicalAnswer): boolean {
  if (answer.answer.trim()) return answer.answer.trim().length < 40;
  return !answer.general_assessment || !answer.recommended_action || !answer.short_summary;
}

function shouldUseSafeRenderedTemplate(answer: GroundedMedicalAnswer, retrievalWasUsed: boolean): boolean {
  if (!retrievalWasUsed) return false;
  if (answer.grounding_confidence === "low") return false;
  const draft = answer.answer.trim();
  if (!draft) return true;
  const normalized = draft.toLocaleLowerCase("tr-TR");
  if (answer.answer_domain === "legal") {
    return [
      /\bkesin\b[\s\S]{0,80}\b(?:kazan|sonuç|tazminat|boşan)/u,
      /\bgaranti\b[\s\S]{0,80}\b(?:kazan|sonuç|hak)/u,
      /\bavukata gerek yok\b/u,
    ].some((pattern) => pattern.test(normalized));
  }
  if (answer.answer_domain === "finance") {
    return [
      /\b(?:kesin|garantili)\b[\s\S]{0,80}\b(?:getiri|kazanç|kâr|kar)\b/u,
      /\b(?:al|sat|tut)\b[.!]?$/u,
    ].some((pattern) => pattern.test(normalized));
  }
  if (answer.answer_domain === "technical") {
    return [
      /\bproduction\b[\s\S]{0,80}\bdoğrudan\b[\s\S]{0,80}\bçalıştır/u,
      /\b(?:drop|truncate|delete)\b/u,
      /\bgeri yükle(?:yin|mek)?\b/u,
      /\btüm tablolar[ıi]\b[\s\S]{0,80}\b(?:sil|geri yükle|değiştir)/u,
    ].some((pattern) => pattern.test(normalized));
  }
  if (answer.answer_domain === "education") {
    return [
      /\bkesin\b[\s\S]{0,80}\b(?:geçer|kalır|kabul|red)\b/u,
      /\bresmi tarih\b[\s\S]{0,80}\b(?:şudur|budur)\b/u,
    ].some((pattern) => pattern.test(normalized));
  }
  if (answer.answer_domain !== "medical") return false;
  const unsafeUnsupportedMedicalSignals = [
    /\bkanser\b[\s\S]{0,80}\bolabilir\b/u,
    /\bkesin(?:likle)?\b[\s\S]{0,80}\baçıklıyor\b/u,
    /\btemiz\b[\s\S]{0,60}\bneden/u,
    /\b(?:nedeni|nedenlerinden|kaynaklanan)\b[\s\S]{0,80}\bolabilir\b/u,
  ];
  return unsafeUnsupportedMedicalSignals.some((pattern) => pattern.test(normalized));
}

function isFeeConfigured(): boolean {
  return Boolean(
    getOperatorKeypair() &&
      getPublishedPackageId() &&
      getRewardPoolObjectId() &&
      getOperatorCapObjectId(),
  );
}

export async function registerChatProxyRoutes(app: FastifyInstance) {
  app.post(
    "/v1/chat/completions",
    { preHandler: walletAuthPreHandler },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const wallet = req.verifiedWalletAddress ?? "";
      if (!wallet) {
        return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
      }

      const body = req.body as Record<string, unknown> | undefined;
      const stream = body?.stream === true;
      const exposeDebug = shouldExposeChatDebug(req);

      if (!shouldSkipChatFee()) {
        if (!isFeeConfigured()) {
          return sendApiError(
            reply,
            503,
            "CHAT_FEE_NOT_CONFIGURED",
            "R3MES_OPERATOR_PRIVATE_KEY, R3MES_PACKAGE_ID, R3MES_REWARD_POOL_OBJECT_ID, R3MES_OPERATOR_CAP_OBJECT_ID ayarlayın veya R3MES_SKIP_CHAT_FEE=1 kullanın (üretimde skip yasak, bkz. .env.example)",
          );
        }
        try {
          await assertOperatorCanPayChatFee();
          await recordChatUsageOnChain(wallet);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (
            msg === "INSUFFICIENT_SUI_FOR_CHAT_FEE" ||
            msg.includes("InsufficientCoin") ||
            msg.includes("insufficient")
          ) {
            return sendApiError(
              reply,
              402,
              "PAYMENT_REQUIRED",
              "Operatör SUI bakiyesi chat ücreti için yetersiz",
            );
          }
          return sendApiError(reply, 402, "PAYMENT_REQUIRED", msg);
        }
      }

      const rawBody = (body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {}) as Record<
        string,
        unknown
      >;
      const includePublic = rawBody.includePublic === true;
      const requestedCollectionIds = normalizeStringArray(rawBody.collectionIds);
      const retrievalQuery = extractRetrievalQuery(rawBody);
      const chatTrace = createChatTrace({
        query: retrievalQuery,
        stream,
        includePublic,
        requestedCollectionCount: requestedCollectionIds.length,
      });
      chatTrace.recordNow("request", "ok", {
        hasQuery: retrievalQuery.trim().length > 0,
        messageCount: Array.isArray(rawBody.messages) ? rawBody.messages.length : 0,
      });
      const queryUnderstanding = buildQueryUnderstanding(retrievalQuery);
      chatTrace.recordNow("query_understanding", "ok", {
        name: "query_understanding",
        ...summarizeQueryUnderstandingForTrace(queryUnderstanding),
      });
      const sourceAccessTrace = chatTrace.start("source_access");
      const accessibleCollections =
        requestedCollectionIds.length > 0 || includePublic
          ? await resolveAccessibleKnowledgeCollections({
              walletAddress: wallet,
              requestedCollectionIds,
              includePublic,
            })
          : [];
      chatTrace.finish(sourceAccessTrace, "ok", {
        requestedCollectionCount: requestedCollectionIds.length,
        accessibleCollectionCount: accessibleCollections.length,
        includePublic,
      });

      if (requestedCollectionIds.length > 0 && accessibleCollections.length !== requestedCollectionIds.length) {
        chatTrace.recordNow("answer_path", "error", {
          name: "knowledge_access_denied",
          requestedCollectionCount: requestedCollectionIds.length,
          accessibleCollectionCount: accessibleCollections.length,
        });
        return sendApiError(
          reply,
          403,
          "KNOWLEDGE_ACCESS_DENIED",
          "İstenen knowledge collection'ların en az biri erişilebilir değil",
        );
      }

      const conversationalIntent = queryUnderstanding.conversationalIntent;
      if (!stream && conversationalIntent) {
        chatTrace.recordNow("query_planning", "skipped", {
          name: "conversational_intent",
          intent: conversationalIntent.kind,
          confidence: conversationalIntent.confidence,
          reason: conversationalIntent.reason,
        });
        chatTrace.recordNow("retrieval", "skipped", {
          reason: "non-knowledge conversational intent",
        });
        chatTrace.recordNow("answer_path", "ok", {
          name: "conversational_intent",
          retrievalWasUsed: false,
          intent: conversationalIntent.kind,
        });
        return reply.type("application/json").send(
          createConversationalIntentPayload({
            decision: conversationalIntent,
            exposeDebug,
            chatTrace,
          }),
        );
      }

      const queryUnderstandingProfiles = queryUnderstandingProfilesForCollections(accessibleCollections);
      const retrievalQueryUnderstanding = queryUnderstandingProfiles.length > 0
        ? buildQueryUnderstanding(retrievalQuery, { profiles: queryUnderstandingProfiles })
        : queryUnderstanding;
      if (queryUnderstandingProfiles.length > 0) {
        chatTrace.recordNow("query_understanding", "ok", {
          name: "profile_aware_query_understanding",
          profileCount: queryUnderstandingProfiles.length,
          ...summarizeQueryUnderstandingForTrace(retrievalQueryUnderstanding),
        });
      }

      const queryPlanningTrace = chatTrace.start("query_planning");
      const queryPlan = retrievalQuery
        ? await runQueryPlannerSkill({ userQuery: retrievalQuery, language: "tr" })
        : null;
      const profileExpandedRetrievalQuery = [
        queryPlan?.output.retrievalQuery || retrievalQuery,
        ...retrievalQueryUnderstanding.profileConcepts.slice(0, 8),
      ].filter(Boolean).join(" ");
      const plannedRetrievalQuery = profileExpandedRetrievalQuery || retrievalQuery;
      const routePlan = queryPlan?.output.routePlan ?? null;
      const suggestibleCollections = retrievalQuery
        ? await resolveSuggestibleKnowledgeCollections({
            walletAddress: wallet,
            includePublic: true,
          })
        : [];
      chatTrace.finish(queryPlanningTrace, retrievalQuery ? "ok" : "skipped", {
        routeDomain: routePlan?.domain ?? null,
        routeConfidence: routePlan?.confidence ?? null,
        subtopicCount: routePlan?.subtopics.length ?? 0,
        suggestibleCollectionCount: suggestibleCollections.length,
        plannedQueryChanged: plannedRetrievalQuery !== retrievalQuery,
      });

      const accessibleCollectionIds = accessibleCollections.map((item) => item.id);
      const retrievalTrace = chatTrace.start("retrieval");
      const retrievalBudget = resolveRetrievalBudget({
        routePlan,
        requestedCollectionIds,
        includePublic,
        query: retrievalQuery,
        queryUnderstanding: retrievalQueryUnderstanding,
      });
      const retrieval =
        retrievalQuery && accessibleCollectionIds.length > 0
          ? await (async () => {
              const engine = getRetrievalEngine();
              if (engine === "hybrid" && shouldUseTrueHybridRetrieval()) {
                const hybridRetrieval = await retrieveKnowledgeContextTrueHybrid({
                  query: plannedRetrievalQuery,
                  evidenceQuery: retrievalQuery,
                  accessibleCollectionIds,
                  routePlan,
                  limit: retrievalBudget.sourceLimit,
                  budgetMode: retrievalBudget.mode,
                });
                return {
                  ...hybridRetrieval,
                  retrievalMode: "true_hybrid" as const,
                  retrievalDiagnostics: hybridRetrieval.diagnostics,
                };
              }
              if (engine === "qdrant" || engine === "hybrid") {
                try {
                  const qdrantRetrieval = await retrieveKnowledgeContextQdrant({
                    query: plannedRetrievalQuery,
                    evidenceQuery: retrievalQuery,
                    accessibleCollectionIds,
                    routePlan,
                  });
                  if (engine === "qdrant" || qdrantRetrieval.sources.length > 0) {
                    return {
                      ...qdrantRetrieval,
                      retrievalMode: "qdrant" as const,
                      retrievalDiagnostics: null,
                    };
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  req.log.warn({ err: message }, "Qdrant retrieval failed, falling back to Prisma retrieval");
                  if (engine === "qdrant") {
                    return {
                      contextText: "",
                      sources: [] as ChatSourceCitation[],
                      lowGroundingConfidence: true,
                      groundingConfidence: "low" as const,
                      evidence: null,
                      retrievalMode: "qdrant" as const,
                      retrievalDiagnostics: null,
                    };
                  }
                }
              }
              const prismaRetrieval = await retrieveKnowledgeContext({
                query: plannedRetrievalQuery,
                evidenceQuery: retrievalQuery,
                accessibleCollectionIds,
                routePlan,
              });
              return {
                ...prismaRetrieval,
                retrievalMode: engine === "hybrid" ? "legacy_hybrid" as const : "prisma" as const,
                retrievalDiagnostics: null,
              };
            })()
          : {
              contextText: "",
              sources: [] as ChatSourceCitation[],
              lowGroundingConfidence: true,
              groundingConfidence: "low" as const,
              evidence: null,
              retrievalMode: "prisma" as const,
              retrievalDiagnostics: null,
            };
      chatTrace.finish(retrievalTrace, retrievalQuery && accessibleCollectionIds.length > 0 ? "ok" : "skipped", {
        mode: retrieval.retrievalMode,
        groundingConfidence: retrieval.groundingConfidence,
        sourceCount: retrieval.sources.length,
        contextLength: retrieval.contextText.length,
        hasEvidence: Boolean(retrieval.evidence),
        budgetDecision: retrievalBudget,
        diagnostics: summarizeRetrievalDiagnostics(retrieval.retrievalDiagnostics ?? undefined),
      });

      const groundedComposerMode = getGroundedComposerMode();
      const responseMode = getChatResponseMode();
      const skipSourceSuggestions = shouldSkipSourceSuggestions({
        query: retrievalQuery,
        requestedCollectionIds,
        retrievalSources: retrieval.sources,
        groundingConfidence: retrieval.groundingConfidence,
      });
      const runSuggestionProbe = shouldRunRetrievalBackedSuggestionProbe({
        retrievalQuery,
        skipSourceSuggestions,
        requestedCollectionIds,
        retrievalSources: retrieval.sources,
        groundingConfidence: retrieval.groundingConfidence,
      });
      const suggestionProbeTrace = chatTrace.start("suggestion_probe");
      const retrievalSuggestedCollectionIds = runSuggestionProbe
        ? await resolveRetrievalBackedSuggestionIds({
            query: plannedRetrievalQuery,
            evidenceQuery: retrievalQuery,
            routePlan,
            suggestibleCollections,
            excludedIds: new Set([
              ...requestedCollectionIds,
              ...retrieval.sources.map((source) => source.collectionId),
            ]),
          })
        : [];
      chatTrace.finish(suggestionProbeTrace, runSuggestionProbe ? "ok" : "skipped", {
        suggestedCollectionCount: retrievalSuggestedCollectionIds.length,
        reason: skipSourceSuggestions
          ? "selected source already returned high-confidence evidence"
          : runSuggestionProbe
            ? undefined
            : "metadata-only suggestion path",
      });
      const metadataSelectionTrace = chatTrace.start("source_selection");
      let sourceSelection = buildSourceSelectionSummary({
        query: plannedRetrievalQuery,
        requestedCollectionIds,
        accessibleCollectionIds,
        suggestibleCollections,
        sources: retrieval.sources,
        includePublic,
        routePlan,
        retrievalSuggestedCollectionIds,
        skipSuggestions: skipSourceSuggestions,
      });
      chatTrace.finish(metadataSelectionTrace, "ok", {
        name: "metadata_route_selection",
        suggestedCollectionCount: sourceSelection.suggestedCollections.length,
        metadataRouteCandidateCount: sourceSelection.metadataRouteCandidates.length,
      });
      const shadowCandidateCollectionIds = uniqueStrings([
        ...sourceSelection.usedCollectionIds,
        ...sourceSelection.suggestedCollections.map((collection) => collection.id),
        ...sourceSelection.metadataRouteCandidates.map((collection) => collection.id),
        ...accessibleCollectionIds,
      ]);
      const shadowRuntimeTrace = chatTrace.start("source_selection");
      const shadowRuntime = await evaluateFeedbackShadowRuntime({
        walletAddress: wallet,
        query: retrievalQuery,
        candidateCollectionIds: shadowCandidateCollectionIds,
      });
      sourceSelection = applyFeedbackRuntimeToSourceSelection(sourceSelection, shadowRuntime);
      const selectedCollectionDomainForAnswer =
        retrieval.sources.length > 0 && sourceSelection.routeDecision.mode !== "suggest"
          ? inferKnowledgeCollectionAnswerDomain({
              collections: accessibleCollections,
              usedCollectionIds: sourceSelection.usedCollectionIds,
            })
          : null;
      const answerDomain = inferAnswerDomain({
        userQuery: retrievalQuery,
        evidence: retrieval.evidence,
        contextText: retrieval.contextText,
        routePlan: sourceSelection.routeDecision.primaryDomain
          ? {
              ...(routePlan ?? {
                subtopics: [],
                riskLevel: "low",
                retrievalHints: [],
                mustIncludeTerms: [],
                mustExcludeTerms: [],
                confidence: "medium",
              }),
              domain: sourceSelection.routeDecision.primaryDomain,
              confidence: sourceSelection.routeDecision.mode === "suggest" ? "high" : routePlan?.confidence ?? "medium",
            }
          : routePlan,
        selectedCollectionDomain: selectedCollectionDomainForAnswer,
      });
      const domainPolicy = getDomainPolicy(answerDomain);
      chatTrace.finish(shadowRuntimeTrace, "ok", {
        name: "feedback_shadow_runtime",
        runtimeMode: shadowRuntime.runtimeMode,
        activeAdjustmentCount: shadowRuntime.activeAdjustmentCount,
        promotedCandidateCount: shadowRuntime.promotedCandidateCount,
        wouldChangeTopCandidate: shadowRuntime.wouldChangeTopCandidate,
        runtimeAffected: shadowRuntime.runtimeAffected,
      });
      chatTrace.recordNow("source_selection", "ok", summarizeSourceSelectionForTrace(sourceSelection));
      const routeDecisionQuality = {
        sourceCount: retrieval.sources.length,
        directFactCount: retrieval.evidence?.directAnswerFacts.length ?? retrieval.evidence?.usableFacts.length ?? 0,
        riskFactCount: retrieval.evidence?.riskFacts.length ?? retrieval.evidence?.redFlags.length ?? 0,
        hasUsableGrounding: retrieval.sources.length > 0 && retrieval.groundingConfidence !== "low",
      };
      req.log.info(
        buildRouteDecisionLogEvent({
          query: retrievalQuery,
          routePlan,
          sourceSelection,
          retrievalDiagnostics: retrieval.retrievalDiagnostics ?? undefined,
          quality: routeDecisionQuality,
        }),
        "Knowledge route decision",
      );

      const retrievalDebug: ChatRetrievalDebug | null = retrievalQuery
        ? {
            groundingConfidence: retrieval.groundingConfidence,
            queryPlan: queryPlan?.output ?? null,
            routePlan,
            evidence: retrieval.evidence,
            compiledEvidence: "compiledEvidence" in retrieval ? retrieval.compiledEvidence ?? null : null,
            domain: answerDomain,
            responseMode,
            retrievalMode: retrieval.retrievalMode,
            retrievalDiagnostics: retrieval.retrievalDiagnostics ?? undefined,
            sourceSelection,
            quality: {
              ...routeDecisionQuality,
              composerMode: groundedComposerMode,
            },
          }
        : null;

      const retrievalWasUsed = retrieval.contextText.length > 0;
      if (
        !stream &&
        retrievalQuery &&
        retrieval.sources.length === 0 &&
        retrieval.groundingConfidence === "low" &&
        (
          requestedCollectionIds.length > 0 ||
          sourceSelection.routeDecision.mode === "suggest" ||
          sourceSelection.routeDecision.mode === "no_source"
        )
      ) {
        chatTrace.recordNow("answer_path", "ok", {
          name: "no_source_fallback",
          retrievalWasUsed: false,
          sourceCount: retrieval.sources.length,
        });
        const deterministicAnswer = buildDeterministicGroundedAnswer({
          answerDomain,
          groundingConfidence: retrieval.groundingConfidence,
          userQuery: retrievalQuery,
          evidence: retrieval.evidence,
          compiledEvidence: "compiledEvidence" in retrieval ? retrieval.compiledEvidence ?? null : null,
        });
        return reply.type("application/json").send(
          applyRenderedAnswer(
            createChatCompletionPayload(),
            deterministicAnswer,
            retrieval.sources,
            retrievalQuery,
            false,
            retrievalDebug,
            { useFallbackTemplate: true, exposeDebug, chatTrace, answerPath: "no_source_fallback" },
          ),
        );
      }
      if (
        shouldUseRagFastPath({
          stream,
          hasRetrieval: retrievalWasUsed,
          sourceCount: retrieval.sources.length,
          groundingConfidence: retrieval.groundingConfidence,
          answerDomain,
          composerMode: groundedComposerMode,
        })
      ) {
        chatTrace.recordNow("answer_path", "ok", {
          name: "rag_fast_path",
          retrievalWasUsed,
          sourceCount: retrieval.sources.length,
        });
        const deterministicAnswer = buildDeterministicGroundedAnswer({
          answerDomain,
          groundingConfidence: retrieval.groundingConfidence,
          userQuery: retrievalQuery,
          evidence: retrieval.evidence,
          compiledEvidence: "compiledEvidence" in retrieval ? retrieval.compiledEvidence ?? null : null,
        });
        return reply.type("application/json").send(
          applyRenderedAnswer(
            createChatCompletionPayload(),
            deterministicAnswer,
            retrieval.sources,
            retrievalQuery,
            retrievalWasUsed,
            retrievalDebug,
            { useFallbackTemplate: true, exposeDebug, chatTrace, answerPath: "rag_fast_path" },
          ),
        );
      }
      if (
        shouldUseFastGroundedComposer({
          stream,
          hasRetrieval: retrievalWasUsed,
          groundingConfidence: retrieval.groundingConfidence,
        })
      ) {
        chatTrace.recordNow("answer_path", "ok", {
          name: "fast_grounded_composer",
          retrievalWasUsed,
          sourceCount: retrieval.sources.length,
        });
        const deterministicAnswer = buildDeterministicGroundedAnswer({
          answerDomain,
          groundingConfidence: retrieval.groundingConfidence,
          userQuery: retrievalQuery,
          evidence: retrieval.evidence,
          compiledEvidence: "compiledEvidence" in retrieval ? retrieval.compiledEvidence ?? null : null,
        });
        return reply.type("application/json").send(
          applyRenderedAnswer(
            createChatCompletionPayload(),
            deterministicAnswer,
            retrieval.sources,
            retrievalQuery,
            retrievalWasUsed,
            retrievalDebug,
            { useFallbackTemplate: true, exposeDebug, chatTrace, answerPath: "fast_grounded_composer" },
          ),
        );
      }

      const orchestratedBody = injectRetrievedContextIntoMessages(
        rawBody,
        retrieval.contextText,
        retrieval.lowGroundingConfidence,
        retrieval.groundingConfidence,
        domainPolicy,
        retrieval.evidence?.answerIntent ?? "unknown",
        responseMode,
      );
      const numericTemperature =
        typeof orchestratedBody.temperature === "number" && Number.isFinite(orchestratedBody.temperature)
          ? orchestratedBody.temperature
          : null;
      orchestratedBody.temperature =
        retrieval.contextText.length > 0 ? Math.min(numericTemperature ?? 0.2, 0.25) : numericTemperature ?? 0.3;
      if (orchestratedBody.top_p == null && retrieval.contextText.length > 0) {
        orchestratedBody.top_p = 0.85;
      }
      if (retrieval.contextText.length > 0) {
        const numericMaxTokens =
          typeof orchestratedBody.max_tokens === "number" && Number.isFinite(orchestratedBody.max_tokens)
            ? orchestratedBody.max_tokens
            : null;
        const composerMaxTokens = getComposerMaxTokens(answerDomain);
        orchestratedBody.max_tokens = Math.min(numericMaxTokens ?? composerMaxTokens, composerMaxTokens);
      }
      orchestratedBody.stop = mergeDefaultChatStops(orchestratedBody.stop);
      orchestratedBody.runtime = getConfiguredChatRuntime();
      const adapterPath = normalizeAdapterPath(orchestratedBody.adapterPath ?? orchestratedBody.adapter_path);
      if (adapterPath) {
        orchestratedBody.adapter_path = adapterPath;
      }
      delete orchestratedBody.adapterPath;
      if (typeof orchestratedBody.adapterId === "string" && !orchestratedBody.adapter_db_id) {
        orchestratedBody.adapter_db_id = orchestratedBody.adapterId;
      }
      delete orchestratedBody.adapterId;
      delete orchestratedBody.collectionIds;
      delete orchestratedBody.includePublic;

      const resolved = await resolveAdapterCidForChatProxy({ body: orchestratedBody, answerDomain });
      if (!resolved.ok) {
        chatTrace.recordNow("answer_path", "error", {
          name: "adapter_resolution_failed",
          statusCode: resolved.statusCode,
        });
        reply.code(resolved.statusCode);
        return resolved.body;
      }

      const cid = resolved.upstreamBody.adapter_cid;
      req.log.info({
        e2eLifecycle: "chat_proxy_resolved",
        hasAdapterCid: typeof cid === "string" && cid.length > 0,
      });
      chatTrace.recordNow("answer_path", "ok", {
        name: "ai_engine",
        retrievalWasUsed,
        sourceCount: retrieval.sources.length,
        hasAdapterCid: typeof cid === "string" && cid.length > 0,
      });

      const upstream = `${getAiEngineBase()}/v1/chat/completions`;
      let res: Response;
      const aiEngineTrace = chatTrace.start("ai_engine");
      try {
        res = await postChatCompletionToAiEngine({
          upstream,
          payload: resolved.upstreamBody,
          stream,
        });
        chatTrace.finish(aiEngineTrace, res.ok ? "ok" : "error", {
          status: res.status,
          stream,
          contentType: res.headers.get("content-type") ?? null,
        });
      } catch (error) {
        chatTrace.finish(aiEngineTrace, "error", { stream }, error);
        req.log.error({ err: error, upstream }, "AI engine chat request failed");
        return sendApiError(
          reply,
          503,
          "AI_ENGINE_UNAVAILABLE",
          "AI engine şu an yanıt vermiyor. Servisi başlatıp yeniden deneyin.",
        );
      }

      if (stream && res.ok && res.body) {
        const ct = res.headers.get("content-type") ?? "text/event-stream";
        reply.header("content-type", ct);
        reply.header("x-r3mes-sources", Buffer.from(JSON.stringify(retrieval.sources)).toString("base64"));
        return reply.send(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]));
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "application/json";
      reply.code(res.status);
      if (res.ok && !stream && ct.includes("application/json")) {
        try {
          const parsed = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
          const parsedAnswer = parseGroundedMedicalAnswer(extractAssistantContent(parsed) ?? "");
          const retrievalWasUsed = retrieval.contextText.length > 0;
          const shouldRunValidator =
            shouldUseMiniValidator(stream, retrievalWasUsed) &&
            (
              shouldForceMiniValidator() ||
              retrieval.groundingConfidence === "low" ||
              parsedAnswer == null ||
              hasThinGroundedAnswer(parsedAnswer)
            );
          if (shouldRunValidator) {
            const draftAnswer = extractAssistantContent(parsed);
            if (draftAnswer) {
              const validatorTrace = chatTrace.start("validator");
              const validatorPayload = buildValidatorPayload({
                baseBody: resolved.upstreamBody,
                draftAnswer,
                retrievalContext: retrieval.contextText,
                lowGroundingConfidence: retrieval.lowGroundingConfidence,
                groundingConfidence: retrieval.groundingConfidence,
                domainPolicy,
              });
              const validatorRes = await postJsonToAiEngine(upstream, validatorPayload, "application/json");
              chatTrace.finish(validatorTrace, validatorRes.ok ? "ok" : "error", {
                status: validatorRes.status,
              });
              if (validatorRes.ok) {
                const validatorParsed = (await validatorRes.json()) as Record<string, unknown>;
                const validatedAnswer = parseGroundedMedicalAnswer(
                  extractAssistantContent(validatorParsed) ?? "",
                );
                if (validatedAnswer) {
                  return reply.type("application/json").send(
                    applyRenderedAnswer(
                      validatorParsed,
                      validatedAnswer,
                      retrieval.sources,
                      retrievalQuery,
                      retrievalWasUsed,
                      retrievalDebug,
                      { exposeDebug, chatTrace, answerPath: "ai_engine_validated" },
                    ),
                  );
                }
              }
            }
          } else {
            chatTrace.recordNow("validator", "skipped", {
              retrievalWasUsed,
              groundingConfidence: retrieval.groundingConfidence,
              parsedAnswer: parsedAnswer != null,
            });
          }
          if (parsedAnswer) {
            return reply.type(ct).send(
              applyRenderedAnswer(
                parsed,
                parsedAnswer,
                retrieval.sources,
                retrievalQuery,
                retrievalWasUsed,
                retrievalDebug,
                { exposeDebug, chatTrace, answerPath: "ai_engine_parsed" },
              ),
            );
          }
          if (retrievalWasUsed || retrieval.evidence) {
            const draftContent = extractAssistantContent(parsed)?.trim() ?? "";
            if (draftContent) {
              return reply.type(ct).send(
                applyRenderedAnswer(
                  parsed,
                  {
                    ...EMPTY_GROUNDED_MEDICAL_ANSWER,
                    answer_domain: answerDomain,
                    answer_intent: retrieval.evidence?.answerIntent ?? "unknown",
                    grounding_confidence: retrieval.groundingConfidence,
                    user_query: retrievalQuery,
                    answer: draftContent,
                  },
                  retrieval.sources,
                  retrievalQuery,
                  retrievalWasUsed,
                  retrievalDebug,
                  { exposeDebug, chatTrace, answerPath: "ai_engine_draft_wrapped" },
                ),
              );
            }
            return reply.type(ct).send(
              applyRenderedAnswer(
                parsed,
                {
                  ...EMPTY_GROUNDED_MEDICAL_ANSWER,
                  answer_domain: answerDomain,
                  grounding_confidence: retrieval.groundingConfidence,
                  user_query: retrievalQuery,
                },
                retrieval.sources,
                retrievalQuery,
                retrievalWasUsed,
                retrievalDebug,
                { exposeDebug, chatTrace, answerPath: "ai_engine_empty_wrapped" },
              ),
            );
          }
          const safeParsed = exposeDebug ? parsed : stripChatDebugFields(parsed);
          safeParsed.sources = retrieval.sources;
          if (exposeDebug && retrievalDebug) parsed.retrieval_debug = retrievalDebug;
          if (exposeDebug) {
            safeParsed.chat_trace = chatTrace.snapshot({
              retrieval: retrievalDebug
                ? {
                    mode: retrievalDebug.retrievalMode,
                    groundingConfidence: retrievalDebug.groundingConfidence,
                    sourceCount: retrievalDebug.quality.sourceCount,
                  }
                : undefined,
              answerPath: {
                name: "ai_engine_raw_json",
                retrievalWasUsed,
                responseMode,
              },
            });
          }
          return reply.type(ct).send(safeParsed);
        } catch {
          // fall through to raw buffer
        }
      }
      return reply.type(ct).send(buf);
    },
  );
}
