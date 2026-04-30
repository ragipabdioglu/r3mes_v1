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
import { composeDomainEvidenceAnswer } from "../lib/domainEvidenceComposer.js";
import { getDomainPolicy, inferAnswerDomain, type DomainPolicy } from "../lib/domainPolicy.js";
import { retrieveKnowledgeContextTrueHybrid } from "../lib/hybridKnowledgeRetrieval.js";
import {
  buildKnowledgeRouteDecision,
  collectionHasSpecificRouteSupport,
  explainCollectionRouteSuggestion,
  rankMetadataRouteCandidates,
  rankSuggestedKnowledgeCollections,
  readKnowledgeCollectionSourceQuality,
  resolveAccessibleKnowledgeCollections,
  resolveSuggestibleKnowledgeCollections,
  type KnowledgeCollectionAccessItem,
} from "../lib/knowledgeAccess.js";
import { retrieveKnowledgeContext } from "../lib/knowledgeRetrieval.js";
import { retrieveKnowledgeContextQdrant } from "../lib/qdrantRetrieval.js";
import { renderGroundedMedicalAnswer } from "../lib/renderMedicalAnswer.js";
import { buildRouteDecisionLogEvent } from "../lib/routeDecisionLog.js";
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

interface ChatRetrievalDebug {
  groundingConfidence: "high" | "medium" | "low";
  queryPlan: QueryPlannerOutput | null;
  routePlan: DomainRoutePlan | null;
  evidence: EvidenceExtractorOutput | null;
  domain: DomainPolicy["domain"];
  responseMode: "natural" | "json";
  retrievalMode?: "true_hybrid" | "qdrant" | "prisma" | "legacy_hybrid";
  retrievalDiagnostics?: Record<string, unknown>;
  sourceSelection: {
    selectionMode: "none" | "selected" | "public" | "selected_plus_public";
    requestedCollectionIds: string[];
    accessibleCollectionIds: string[];
      usedCollectionIds: string[];
      unusedSelectedCollectionIds: string[];
      suggestedCollections: Array<{ id: string; name: string; reason: string }>;
      metadataRouteCandidates: Array<{
        id: string;
        name: string;
        score: number;
        domain: string | null;
        subtopics: string[];
        matchedTerms: string[];
        reason: string;
        sourceQuality: "structured" | "inferred" | "thin" | null;
      }>;
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
  };
  quality: {
    sourceCount: number;
    directFactCount: number;
    riskFactCount: number;
    hasUsableGrounding: boolean;
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

function buildSourceSelectionSummary(opts: {
  query: string;
  requestedCollectionIds: string[];
  accessibleCollectionIds: string[];
  suggestibleCollections: KnowledgeCollectionAccessItem[];
  sources: ChatSourceCitation[];
  includePublic: boolean;
  routePlan: DomainRoutePlan | null;
  retrievalSuggestedCollectionIds?: string[];
}): ChatRetrievalDebug["sourceSelection"] {
  const usedCollectionIds = uniqueStrings(opts.sources.map((source) => source.collectionId));
  const unusedSelectedCollectionIds = opts.requestedCollectionIds.filter(
    (id) => !usedCollectionIds.includes(id),
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
  const rankedSuggestedCollections = rankSuggestedKnowledgeCollections({
    collections: opts.suggestibleCollections,
    routePlan: opts.routePlan,
    query: opts.query,
    excludedIds: excluded,
    limit: 8,
  });
  const retrievalSuggestedIds = opts.retrievalSuggestedCollectionIds ?? [];
  const metadataRouteCandidates = rankMetadataRouteCandidates({
    collections: opts.suggestibleCollections,
    routePlan: opts.routePlan,
    query: opts.query,
    excludedIds: new Set(opts.requestedCollectionIds),
    limit: 5,
  });
  const thinProfileCollectionIds = uniqueStrings([
    ...metadataRouteCandidates
      .filter((candidate) => candidate.sourceQuality === "thin")
      .map((candidate) => candidate.id),
    ...usedCollectionIds.filter((id) => {
      const collection = opts.suggestibleCollections.find((item) => item.id === id);
      return collection ? readKnowledgeCollectionSourceQuality(collection) === "thin" : false;
    }),
  ]);
  const suggestedCollections = [...rankedSuggestedCollections]
    .sort((a, b) => {
      const aRetrieval = retrievalSuggestedIds.includes(a.id) ? 0 : 1;
      const bRetrieval = retrievalSuggestedIds.includes(b.id) ? 0 : 1;
      if (aRetrieval !== bRetrieval) return aRetrieval - bRetrieval;
      return 0;
    })
    .slice(0, 3)
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      reason: retrievalSuggestedIds.includes(collection.id)
        ? `${explainCollectionRouteSuggestion(collection, opts.routePlan, opts.query)} Retrieval probe bu kaynaktan kanıt buldu.`
        : explainCollectionRouteSuggestion(collection, opts.routePlan, opts.query),
    }));
  const usedCollectionsMatchRoute =
    !opts.routePlan?.domain ||
    opts.routePlan.domain === "general" ||
    usedCollectionIds.some((id) => {
      const collection = opts.suggestibleCollections.find((item) => item.id === id);
      return collection ? collectionHasSpecificRouteSupport(collection, opts.routePlan) : false;
    });
  const warning =
    opts.accessibleCollectionIds.length === 0
      ? "Knowledge kaynağı seçilmedi; cevap RAG kullanmadan üretilebilir."
      : usedCollectionIds.length === 0
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
    hasSources: usedCollectionIds.length > 0,
  });

  return {
    selectionMode,
    requestedCollectionIds: opts.requestedCollectionIds,
    accessibleCollectionIds: opts.accessibleCollectionIds,
    usedCollectionIds,
    unusedSelectedCollectionIds,
    suggestedCollections,
    metadataRouteCandidates,
    includePublic: opts.includePublic,
    routeDomain: opts.routePlan?.domain ?? null,
    hasSources: usedCollectionIds.length > 0,
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
}): boolean {
  const raw = (process.env.R3MES_ENABLE_RAG_FAST_PATH ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (opts.stream || !opts.hasRetrieval || opts.sourceCount === 0) return false;
  if (raw === "force") return true;
  if (opts.groundingConfidence === "low") return false;
  if (opts.answerDomain === "medical" && raw === "non-medical-only") return false;
  return true;
}

function shouldExposeChatDebug(req: FastifyRequest): boolean {
  if (process.env.R3MES_EXPOSE_CHAT_DEBUG === "1") return true;
  const header = req.headers["x-r3mes-debug"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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

function applyRenderedAnswer(
  payload: Record<string, unknown>,
  answer: GroundedMedicalAnswer,
  sources: ChatSourceCitation[],
  userQuery = "",
  retrievalWasUsed = false,
  retrievalDebug: ChatRetrievalDebug | null = null,
  opts: { useFallbackTemplate?: boolean; exposeDebug?: boolean } = {},
): Record<string, unknown> {
  const next = structuredClone(payload) as Record<string, unknown>;
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
  });
  const useSafeTemplate =
    opts.useFallbackTemplate === true ||
    shouldUseSafeRenderedTemplate(enrichedAnswer, retrievalWasUsed);
  const rendered =
    useSafeTemplate
      ? composeDomainEvidenceAnswer(enrichedAnswer)
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
}): GroundedMedicalAnswer {
  const spec = buildAnswerSpec({
    answerDomain: opts.answerDomain,
    groundingConfidence: opts.groundingConfidence,
    userQuery: opts.userQuery,
    evidence: opts.evidence,
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
  return value.replace(/^[^:]{1,120}:\s*/, "").trim();
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
      const accessibleCollections =
        requestedCollectionIds.length > 0 || includePublic
          ? await resolveAccessibleKnowledgeCollections({
              walletAddress: wallet,
              requestedCollectionIds,
              includePublic,
            })
          : [];

      if (requestedCollectionIds.length > 0 && accessibleCollections.length !== requestedCollectionIds.length) {
        return sendApiError(
          reply,
          403,
          "KNOWLEDGE_ACCESS_DENIED",
          "İstenen knowledge collection'ların en az biri erişilebilir değil",
        );
      }

        const queryPlan = retrievalQuery
          ? await runQueryPlannerSkill({ userQuery: retrievalQuery, language: "tr" })
          : null;
        const plannedRetrievalQuery = queryPlan?.output.retrievalQuery || retrievalQuery;
        const routePlan = queryPlan?.output.routePlan ?? null;
        const suggestibleCollections = retrievalQuery
          ? await resolveSuggestibleKnowledgeCollections({
              walletAddress: wallet,
              includePublic: true,
            })
          : [];

        const accessibleCollectionIds = accessibleCollections.map((item) => item.id);
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

      const answerDomain = inferAnswerDomain({
        userQuery: retrievalQuery,
        evidence: retrieval.evidence,
        contextText: retrieval.contextText,
        routePlan,
      });
      const domainPolicy = getDomainPolicy(answerDomain);
        const responseMode = getChatResponseMode();
        const retrievalSuggestedCollectionIds = retrievalQuery
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
        const sourceSelection = buildSourceSelectionSummary({
          query: plannedRetrievalQuery,
          requestedCollectionIds,
          accessibleCollectionIds,
          suggestibleCollections,
          sources: retrieval.sources,
          includePublic,
          routePlan,
          retrievalSuggestedCollectionIds,
        });
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
            domain: answerDomain,
              responseMode,
              retrievalMode: retrieval.retrievalMode,
              retrievalDiagnostics: retrieval.retrievalDiagnostics ?? undefined,
              sourceSelection,
              quality: routeDecisionQuality,
          }
        : null;

      const retrievalWasUsed = retrieval.contextText.length > 0;
      if (
        !stream &&
        requestedCollectionIds.length > 0 &&
        retrieval.sources.length === 0 &&
        retrieval.groundingConfidence === "low"
      ) {
        const deterministicAnswer = buildDeterministicGroundedAnswer({
          answerDomain,
          groundingConfidence: retrieval.groundingConfidence,
          userQuery: retrievalQuery,
          evidence: retrieval.evidence,
        });
        return reply.type("application/json").send(
          applyRenderedAnswer(
            createChatCompletionPayload(),
            deterministicAnswer,
            retrieval.sources,
            retrievalQuery,
            false,
            retrievalDebug,
            { useFallbackTemplate: true, exposeDebug },
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
        })
      ) {
        const deterministicAnswer = buildDeterministicGroundedAnswer({
          answerDomain,
          groundingConfidence: retrieval.groundingConfidence,
          userQuery: retrievalQuery,
          evidence: retrieval.evidence,
        });
        return reply.type("application/json").send(
          applyRenderedAnswer(
            createChatCompletionPayload(),
            deterministicAnswer,
            retrieval.sources,
            retrievalQuery,
            retrievalWasUsed,
            retrievalDebug,
            { useFallbackTemplate: true, exposeDebug },
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
        const deterministicAnswer = buildDeterministicGroundedAnswer({
          answerDomain,
          groundingConfidence: retrieval.groundingConfidence,
          userQuery: retrievalQuery,
          evidence: retrieval.evidence,
        });
        return reply.type("application/json").send(
          applyRenderedAnswer(
            createChatCompletionPayload(),
            deterministicAnswer,
            retrieval.sources,
            retrievalQuery,
            retrievalWasUsed,
            retrievalDebug,
            { useFallbackTemplate: true, exposeDebug },
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
        reply.code(resolved.statusCode);
        return resolved.body;
      }

      const cid = resolved.upstreamBody.adapter_cid;
      req.log.info({
        e2eLifecycle: "chat_proxy_resolved",
        hasAdapterCid: typeof cid === "string" && cid.length > 0,
      });

      const upstream = `${getAiEngineBase()}/v1/chat/completions`;
      let res: Response;
      try {
        res = await postChatCompletionToAiEngine({
          upstream,
          payload: resolved.upstreamBody,
          stream,
        });
      } catch (error) {
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
              const validatorPayload = buildValidatorPayload({
                baseBody: resolved.upstreamBody,
                draftAnswer,
                retrievalContext: retrieval.contextText,
                lowGroundingConfidence: retrieval.lowGroundingConfidence,
                groundingConfidence: retrieval.groundingConfidence,
                domainPolicy,
              });
              const validatorRes = await postJsonToAiEngine(upstream, validatorPayload, "application/json");
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
                      { exposeDebug },
                    ),
                  );
                }
              }
            }
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
                { exposeDebug },
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
                  { exposeDebug },
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
                { exposeDebug },
              ),
            );
          }
          parsed.sources = retrieval.sources;
          if (exposeDebug && retrievalDebug) parsed.retrieval_debug = retrievalDebug;
          return reply.type(ct).send(parsed);
        } catch {
          // fall through to raw buffer
        }
      }
      return reply.type(ct).send(buf);
    },
  );
}
