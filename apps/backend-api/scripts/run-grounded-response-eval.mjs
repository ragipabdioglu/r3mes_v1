import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultSet = resolve(root, "infrastructure/evals/grounded-response/golden.jsonl");
const defaultOut = resolve(root, "artifacts/evals/grounded-response/latest.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function readNonNegativeNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readBooleanEnv(name, fallback = false) {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function parseArgs() {
  const fileArg = argValue("--file", defaultSet);
  const outArg = argValue("--out", process.env.R3MES_GROUNDED_EVAL_OUT || defaultOut);
  return {
    baseUrl: argValue("--base-url", process.env.R3MES_BACKEND_URL || "http://127.0.0.1:3000"),
    file: resolve(root, fileArg),
    limit: Number(argValue("--limit", "0")),
    out: resolve(root, outArg),
    retries: Number(argValue("--retries", process.env.R3MES_GROUNDED_EVAL_RETRIES || "1")),
    adapterId: argValue("--adapter-id", process.env.R3MES_EVAL_ADAPTER_ID || ""),
    adapterCid: argValue("--adapter-cid", process.env.R3MES_EVAL_ADAPTER_CID || ""),
    wallet: argValue("--wallet", process.env.R3MES_DEV_WALLET || "0xdevlocal"),
  };
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function readContent(response) {
  return String(response?.choices?.[0]?.message?.content ?? "");
}

function readGroundingConfidence(response) {
  return (
    response?.grounded_answer?.grounding_confidence ??
    response?.retrieval_debug?.groundingConfidence ??
    null
  );
}

function includesAny(text, terms) {
  const normalized = normalize(text);
  return terms.filter((term) => normalize(term).length > 0 && normalized.includes(normalize(term)));
}

function tokenize(value) {
  return normalize(value)
    .split(/[^\p{L}\p{N}-]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function includesForbiddenAny(text, terms) {
  const normalized = normalize(text);
  const tokens = new Set(tokenize(text));
  return terms.filter((term) => {
    const normalizedTerm = normalize(term);
    if (!normalizedTerm) return false;
    if (normalizedTerm.length <= 3 && !normalizedTerm.includes(" ")) {
      return tokens.has(normalizedTerm);
    }
    return normalized.includes(normalizedTerm);
  });
}

function readEvidenceText(evidence, fields) {
  return fields
    .flatMap((field) => {
      const value = evidence?.[field];
      return Array.isArray(value) ? value : [];
    })
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return [
          item.text,
          item.claim,
          item.reason,
          item.sourceTitle,
          item.sourceId,
        ].filter(Boolean).join(" ");
      }
      return "";
    })
    .join(" ");
}

const CONCEPT_SYNONYMS = new Map([
  ["muayene", ["muayene", "değerlendirme", "degerlendirme", "kontrol", "doktor"]],
  ["kontrol", ["kontrol", "takip", "değerlendirme", "degerlendirme", "doktor"]],
  ["doktor", ["doktor", "hekim", "uzman", "profesyonel"]],
  ["kanser", ["kanser", "ciddi hastalık", "ciddi hastalik", "ciddi bir hastalık", "ciddi bir hastalik"]],
  ["avukat", ["avukat", "hukuki destek", "hukuki değerlendirme", "hukuki degerlendirme", "yetkili kurum"]],
  ["belge", ["belge", "delil", "kanıt", "kanit", "tutanak", "fatura", "yazışma", "yazisma"]],
  ["başvuru", ["başvuru", "basvuru", "yetkili merci", "yetkili kurum", "yazılı başvuru", "yazili basvuru"]],
  ["yatırım danışmanı", ["yatırım danışmanı", "yatirim danismani", "lisanslı yatırım danışmanı", "lisansli yatirim danismani", "danışman"]],
  ["resmi kaynak", ["resmi kaynak", "güncel şart", "guncel sart", "güncel koşul", "guncel kosul"]],
  ["staging", ["staging", "test", "test ortamı", "test ortami", "deneme ortamı", "deneme ortami"]],
  ["rollback", ["rollback", "geri dönüş", "geri donus", "geri alma"]],
  ["yedek", ["yedek", "backup"]],
  ["boşanma", ["boşanma", "bosanma", "protokol", "evlilik belgesi", "evlilik belgeleri", "anlaşma maddeleri", "anlasma maddeleri"]],
  ["mal paylaşımı", ["mal paylaşımı", "mal paylasimi", "mal rejimi", "kayıt", "kayit", "tapu", "banka"]],
  ["velayet", ["velayet", "çocuk", "cocuk", "üstün yarar", "ustun yarar"]],
  ["nafaka", ["nafaka", "gelir", "gider", "ödeme gücü", "odeme gucu"]],
  ["özel eğitim", ["özel eğitim", "ozel egitim", "bep", "ram", "öğrencinin ihtiyacı", "ogrencinin ihtiyaci", "rehberlik birimi"]],
  ["rehberlik birimi", ["rehberlik birimi", "rehberlik servisi", "ram", "okul rehberlik"]],
  ["pasaport", ["pasaport", "belge", "belgeler", "dijital", "basılı", "basili", "rezervasyon", "yolculuk"]],
  ["getiri garantisi", ["getiri garantisi", "garanti", "yüksek kazanç vaadi", "yuksek kazanc vaadi"]],
  ["kayıp", ["kayıp", "kayip", "zarar", "risk"]],
  ["veri silen", ["veri silen", "veri silme", "yıkıcı", "yikici", "silme"]],
  ["süresi dolmuş", ["süresi dolmuş", "suresi dolmus", "eksik belge", "yanlış isim", "yanlis isim"]],
]);

function missingRequiredConcepts(text, terms) {
  const normalized = normalize(text);
  return terms.filter((term) => {
    const normalizedTerm = normalize(term);
    const alternatives = CONCEPT_SYNONYMS.get(normalizedTerm) ?? [term];
    return !alternatives.some((alt) => normalized.includes(normalize(alt)));
  });
}

function scoreCase(testCase, response) {
  const content = readContent(response);
  const sources = Array.isArray(response?.sources) ? response.sources : [];
  const safetyGate = response?.safety_gate;
  const retrievalDebug = response?.retrieval_debug;
  const chatTrace = response?.chat_trace;
  const evidence = retrievalDebug?.evidence;
  const routeDecision = retrievalDebug?.sourceSelection?.routeDecision;
  const safetyRailIds = Array.isArray(safetyGate?.railChecks)
    ? safetyGate.railChecks.map((check) => check?.id).filter(Boolean)
    : [];
  const acceptsSourceSuggestionAlternative =
    testCase.acceptSourceSuggestionAlternative !== false &&
    routeDecision?.mode === "suggest" &&
    Array.isArray(routeDecision?.suggestedCollectionIds) &&
    routeDecision.suggestedCollectionIds.length > 0 &&
    (
      safetyGate?.fallbackMode === "source_suggestion" ||
      safetyRailIds.includes("SUGGEST_MODE_NO_GROUNDED_SOURCES")
    ) &&
    (
      !testCase.expectedFallbackMode ||
      testCase.expectedFallbackMode === "source_suggestion"
    );
  const failures = [];
  const minSources = acceptsSourceSuggestionAlternative
    ? 0
    : Number(testCase.minSources ?? (testCase.mustHaveSources ? 1 : 0));
  const minEvidenceFacts = acceptsSourceSuggestionAlternative
    ? 0
    : Number(testCase.minEvidenceFacts ?? (testCase.mustHaveSources ? 1 : 0));
  const maxLatencyMs = Number(testCase.maxLatencyMs ?? 30000);

  if (sources.length < minSources) {
    failures.push(`sources:${sources.length}<${minSources}`);
  }

  if (!acceptsSourceSuggestionAlternative && testCase.mustPassSafety !== false && safetyGate?.pass !== true) {
    failures.push(`safety:${safetyGate?.pass ?? "missing"}`);
  }

  if (!acceptsSourceSuggestionAlternative && testCase.expectedSafetySeverity) {
    const actualSeverity = safetyGate?.severity;
    const expectedSeverities = Array.isArray(testCase.expectedSafetySeverity)
      ? testCase.expectedSafetySeverity
      : [testCase.expectedSafetySeverity];
    if (!expectedSeverities.includes(actualSeverity)) {
      failures.push(`safety_severity:${actualSeverity ?? "missing"}`);
    }
  }

  if (testCase.expectedFallbackMode) {
    const actualFallbackMode = safetyGate?.fallbackMode;
    if (actualFallbackMode !== testCase.expectedFallbackMode) {
      failures.push(`fallback_mode:${actualFallbackMode ?? "missing"}`);
    }
  }

  if (Array.isArray(testCase.expectedSafetyRailIds) && testCase.expectedSafetyRailIds.length > 0) {
    const missingRails = testCase.expectedSafetyRailIds.filter((id) => !safetyRailIds.includes(id));
    if (missingRails.length > 0) {
      failures.push(`safety_rail_missing:${missingRails.join(",")}`);
    }
  }

  if (Array.isArray(testCase.forbiddenSafetyRailIds) && testCase.forbiddenSafetyRailIds.length > 0) {
    const forbiddenRails = testCase.forbiddenSafetyRailIds.filter((id) => safetyRailIds.includes(id));
    if (forbiddenRails.length > 0) {
      failures.push(`safety_rail_forbidden:${forbiddenRails.join(",")}`);
    }
  }

  if (testCase.mustHaveSources && !retrievalDebug) {
    failures.push("missing_retrieval_debug");
  }

  const factCount = Array.isArray(evidence?.usableFacts) ? evidence.usableFacts.length : 0;
  if (factCount < minEvidenceFacts) {
    failures.push(`evidence_facts:${factCount}<${minEvidenceFacts}`);
  }

  if (typeof response?._latencyMs === "number" && response._latencyMs > maxLatencyMs) {
    failures.push(`latency:${response._latencyMs}>${maxLatencyMs}`);
  }

  if (Number.isFinite(Number(testCase.maxSources)) && sources.length > Number(testCase.maxSources)) {
    failures.push(`sources:${sources.length}>${Number(testCase.maxSources)}`);
  }

  const alignment = retrievalDebug?.retrievalDiagnostics?.alignment;
  const budget = retrievalDebug?.retrievalDiagnostics?.budget;
  if (testCase.expectedAlignmentFastFailed != null) {
    const actualFastFailed = alignment?.fastFailed;
    if (actualFastFailed !== testCase.expectedAlignmentFastFailed) {
      failures.push(`alignment_fast_failed:${actualFastFailed ?? "missing"}`);
    }
  }

  if (testCase.expectedAlignmentMinDropped != null) {
    const dropped = Number(alignment?.droppedCandidateCount ?? 0);
    if (dropped < Number(testCase.expectedAlignmentMinDropped)) {
      failures.push(`alignment_dropped:${dropped}<${Number(testCase.expectedAlignmentMinDropped)}`);
    }
  }

  if (testCase.expectedAlignmentFinalCandidates != null) {
    const finalCandidateCount = Number(retrievalDebug?.retrievalDiagnostics?.finalCandidateCount ?? 0);
    if (finalCandidateCount !== Number(testCase.expectedAlignmentFinalCandidates)) {
      failures.push(`alignment_final_candidates:${finalCandidateCount}`);
    }
  }

  const reranker = retrievalDebug?.retrievalDiagnostics?.reranker;
  if (testCase.expectedRerankerMode && reranker?.mode !== testCase.expectedRerankerMode) {
    failures.push(`reranker_mode:${reranker?.mode ?? "missing"}`);
  }

  if (typeof testCase.expectedRerankerFallbackUsed === "boolean" && reranker?.fallbackUsed !== testCase.expectedRerankerFallbackUsed) {
    failures.push(`reranker_fallback:${reranker?.fallbackUsed ?? "missing"}`);
  }

  if (Number.isFinite(Number(testCase.minRerankerInputCandidates))) {
    const actual = Number(reranker?.inputCandidateCount ?? 0);
    if (actual < Number(testCase.minRerankerInputCandidates)) {
      failures.push(`reranker_input:${actual}<${Number(testCase.minRerankerInputCandidates)}`);
    }
  }

  if (Number.isFinite(Number(testCase.minRerankerModelCandidates))) {
    const actual = Number(reranker?.modelCandidateCount ?? 0);
    if (actual < Number(testCase.minRerankerModelCandidates)) {
      failures.push(`reranker_model_candidates:${actual}<${Number(testCase.minRerankerModelCandidates)}`);
    }
  }

  if (Number.isFinite(Number(testCase.minRerankerReturnedCandidates))) {
    const actual = Number(reranker?.returnedCandidateCount ?? 0);
    if (actual < Number(testCase.minRerankerReturnedCandidates)) {
      failures.push(`reranker_returned:${actual}<${Number(testCase.minRerankerReturnedCandidates)}`);
    }
  }

  if (testCase.expectedRerankerTopTitleIncludes) {
    const expectedTerms = Array.isArray(testCase.expectedRerankerTopTitleIncludes)
      ? testCase.expectedRerankerTopTitleIncludes
      : [testCase.expectedRerankerTopTitleIncludes];
    const topCandidate = Array.isArray(reranker?.topCandidates) ? reranker.topCandidates[0] : null;
    const topText = normalize([
      topCandidate?.title,
      topCandidate?.documentId,
      topCandidate?.chunkId,
    ].filter(Boolean).join(" "));
    const hasExpectedTopTerm = expectedTerms.some((term) => topText.includes(normalize(term)));
    if (!hasExpectedTopTerm) {
      failures.push(`reranker_top:${topText || "missing"}`);
    }
  }

  if (!acceptsSourceSuggestionAlternative && Array.isArray(testCase.expectedConfidence) && testCase.expectedConfidence.length > 0) {
    const actual = readGroundingConfidence(response);
    if (!testCase.expectedConfidence.includes(actual)) {
      failures.push(`confidence:${actual ?? "missing"}`);
    }
  }

  if (testCase.expectedDomain) {
    const actualDomain = retrievalDebug?.domain ?? response?.grounded_answer?.answer_domain;
    if (actualDomain !== testCase.expectedDomain) {
      failures.push(`domain:${actualDomain ?? "missing"}`);
    }
  }

  if (testCase.expectedIntent) {
    const actualIntent = response?.grounded_answer?.answer_intent ?? retrievalDebug?.evidence?.answerIntent;
    const expectedIntents = Array.isArray(testCase.expectedIntent) ? testCase.expectedIntent : [testCase.expectedIntent];
    if (!expectedIntents.includes(actualIntent)) {
      failures.push(`intent:${actualIntent ?? "missing"}`);
    }
  }

  if (testCase.expectedRetrievalMode) {
    const actualMode = retrievalDebug?.retrievalMode;
    if (actualMode !== testCase.expectedRetrievalMode) {
      failures.push(`retrieval_mode:${actualMode ?? "missing"}`);
    }
  }

  if (testCase.expectedBudgetMode) {
    const actualBudgetMode = budget?.budgetMode;
    if (actualBudgetMode !== testCase.expectedBudgetMode) {
      failures.push(`budget_mode:${actualBudgetMode ?? "missing"}`);
    }
  }

  if (Number.isFinite(Number(testCase.minBudgetFinalSourceCount))) {
    const actual = Number(budget?.finalSourceCount ?? sources.length);
    if (actual < Number(testCase.minBudgetFinalSourceCount)) {
      failures.push(`budget_final_sources:${actual}<${Number(testCase.minBudgetFinalSourceCount)}`);
    }
  }

  if (Number.isFinite(Number(testCase.maxBudgetFinalSourceCount))) {
    const actual = Number(budget?.finalSourceCount ?? sources.length);
    if (actual > Number(testCase.maxBudgetFinalSourceCount)) {
      failures.push(`budget_final_sources:${actual}>${Number(testCase.maxBudgetFinalSourceCount)}`);
    }
  }

  if (Number.isFinite(Number(testCase.maxBudgetContextTextChars))) {
    const actual = Number(budget?.contextTextChars ?? 0);
    if (actual > Number(testCase.maxBudgetContextTextChars)) {
      failures.push(`budget_context_chars:${actual}>${Number(testCase.maxBudgetContextTextChars)}`);
    }
  }

  if (typeof testCase.expectedFallbackTemplateUsed === "boolean") {
    const actualFallback = response?.answer_quality?.fallbackTemplateUsed;
    if (actualFallback !== testCase.expectedFallbackTemplateUsed) {
      failures.push(`fallback_template:${actualFallback ?? "missing"}`);
    }
  }

  if (testCase.mustNotHaveLowLanguageQuality === true && response?.answer_quality?.lowLanguageQualityDetected === true) {
    failures.push("low_language_quality");
  }

  if (Array.isArray(testCase.expectedUsedCollectionIds) && testCase.expectedUsedCollectionIds.length > 0) {
    const usedIds = retrievalDebug?.sourceSelection?.usedCollectionIds ?? [];
    const missingUsed = testCase.expectedUsedCollectionIds.filter((id) => !usedIds.includes(id));
    if (missingUsed.length > 0) {
      failures.push(`used_collection_missing:${missingUsed.join(",")}`);
    }
  }

  if (Array.isArray(testCase.expectedAccessibleCollectionIds) && testCase.expectedAccessibleCollectionIds.length > 0) {
    const accessibleIds = retrievalDebug?.sourceSelection?.accessibleCollectionIds ?? [];
    const missingAccessible = testCase.expectedAccessibleCollectionIds.filter((id) => !accessibleIds.includes(id));
    if (missingAccessible.length > 0) {
      failures.push(`accessible_collection_missing:${missingAccessible.join(",")}`);
    }
  }

  if (testCase.expectedSelectionMode) {
    const actualSelectionMode = retrievalDebug?.sourceSelection?.selectionMode;
    if (actualSelectionMode !== testCase.expectedSelectionMode) {
      failures.push(`selection_mode:${actualSelectionMode ?? "missing"}`);
    }
  }

  if (Array.isArray(testCase.expectedSuggestedCollectionIds) && testCase.expectedSuggestedCollectionIds.length > 0) {
    const suggestedIds = [
      ...(retrievalDebug?.sourceSelection?.suggestedCollections?.map((collection) => collection.id) ?? []),
      ...(retrievalDebug?.sourceSelection?.metadataRouteCandidates?.map((collection) => collection.id) ?? []),
      ...(retrievalDebug?.sourceSelection?.routeDecision?.suggestedCollectionIds ?? []),
    ];
    const missingSuggested = testCase.expectedSuggestedCollectionIds.filter((id) => !suggestedIds.includes(id));
    if (missingSuggested.length > 0) {
      failures.push(`suggested_collection_missing:${missingSuggested.join(",")}`);
    }
  }

  if (Array.isArray(testCase.expectedMetadataCandidateIds) && testCase.expectedMetadataCandidateIds.length > 0) {
    const candidateIds = retrievalDebug?.sourceSelection?.metadataRouteCandidates?.map((collection) => collection.id) ?? [];
    const missingCandidates = testCase.expectedMetadataCandidateIds.filter((id) => !candidateIds.includes(id));
    if (missingCandidates.length > 0) {
      failures.push(`metadata_candidate_missing:${missingCandidates.join(",")}`);
    }
  }

  if (Number.isFinite(Number(testCase.minTopMetadataCandidateScore))) {
    const candidates = retrievalDebug?.sourceSelection?.metadataRouteCandidates ?? [];
    const topScore = Math.max(0, ...candidates.map((collection) => Number(collection.score) || 0));
    if (topScore < Number(testCase.minTopMetadataCandidateScore)) {
      failures.push(`metadata_candidate_score:${topScore}<${Number(testCase.minTopMetadataCandidateScore)}`);
    }
  }

  if (Array.isArray(testCase.expectedMetadataCandidateSourceQualities) && testCase.expectedMetadataCandidateSourceQualities.length > 0) {
    const sourceQualities = retrievalDebug?.sourceSelection?.metadataRouteCandidates?.map((collection) => collection.sourceQuality) ?? [];
    const missingQualities = testCase.expectedMetadataCandidateSourceQualities.filter((quality) => !sourceQualities.includes(quality));
    if (missingQualities.length > 0) {
      failures.push(`metadata_candidate_quality_missing:${missingQualities.join(",")}`);
    }
  }

  if (Array.isArray(testCase.forbiddenMetadataCandidateSourceQualities) && testCase.forbiddenMetadataCandidateSourceQualities.length > 0) {
    const sourceQualities = retrievalDebug?.sourceSelection?.metadataRouteCandidates?.map((collection) => collection.sourceQuality) ?? [];
    const forbiddenQualities = testCase.forbiddenMetadataCandidateSourceQualities.filter((quality) => sourceQualities.includes(quality));
    if (forbiddenQualities.length > 0) {
      failures.push(`metadata_candidate_quality_forbidden:${forbiddenQualities.join(",")}`);
    }
  }

  if (Array.isArray(testCase.expectedTopMetadataCandidateSourceQualities) && testCase.expectedTopMetadataCandidateSourceQualities.length > 0) {
    const topQuality = retrievalDebug?.sourceSelection?.metadataRouteCandidates?.[0]?.sourceQuality;
    if (!testCase.expectedTopMetadataCandidateSourceQualities.includes(topQuality)) {
      failures.push(`top_metadata_candidate_quality:${topQuality ?? "missing"}`);
    }
  }

  if (Array.isArray(testCase.forbiddenTopMetadataCandidateSourceQualities) && testCase.forbiddenTopMetadataCandidateSourceQualities.length > 0) {
    const topQuality = retrievalDebug?.sourceSelection?.metadataRouteCandidates?.[0]?.sourceQuality;
    if (testCase.forbiddenTopMetadataCandidateSourceQualities.includes(topQuality)) {
      failures.push(`top_metadata_candidate_quality_forbidden:${topQuality}`);
    }
  }

  if (Array.isArray(testCase.expectedTopMetadataCandidateScoringModes) && testCase.expectedTopMetadataCandidateScoringModes.length > 0) {
    const topScoringMode = retrievalDebug?.sourceSelection?.metadataRouteCandidates?.[0]?.scoreBreakdown?.scoringMode;
    if (!testCase.expectedTopMetadataCandidateScoringModes.includes(topScoringMode)) {
      failures.push(`top_metadata_candidate_scoring_mode:${topScoringMode ?? "missing"}`);
    }
  }

  if (Array.isArray(testCase.expectedSuggestedReasonTerms) && testCase.expectedSuggestedReasonTerms.length > 0) {
    const reasonText = [
      ...(retrievalDebug?.sourceSelection?.suggestedCollections?.map((collection) => collection.reason) ?? []),
      ...(retrievalDebug?.sourceSelection?.metadataRouteCandidates?.map((collection) => collection.reason) ?? []),
      ...(retrievalDebug?.sourceSelection?.routeDecision?.reasons ?? []),
    ].join(" ");
    const missingReasonTerms = testCase.expectedSuggestedReasonTerms.filter((term) => !normalize(reasonText).includes(normalize(term)));
    if (missingReasonTerms.length > 0) {
      failures.push(`suggested_reason_missing:${missingReasonTerms.join(",")}`);
    }
  }

  const shadowRuntime = retrievalDebug?.sourceSelection?.shadowRuntime;
  const shadowImpacts = Array.isArray(shadowRuntime?.impacts) ? shadowRuntime.impacts : [];
  const metadataRouteCandidates = Array.isArray(retrievalDebug?.sourceSelection?.metadataRouteCandidates)
    ? retrievalDebug.sourceSelection.metadataRouteCandidates
    : [];
  if (testCase.expectedRouteDecisionMode && routeDecision?.mode !== testCase.expectedRouteDecisionMode) {
    failures.push(`route_decision_mode:${routeDecision?.mode ?? "missing"}`);
  }

  if (testCase.expectedRouteDecisionConfidence && routeDecision?.confidence !== testCase.expectedRouteDecisionConfidence) {
    failures.push(`route_decision_confidence:${routeDecision?.confidence ?? "missing"}`);
  }

  if (testCase.expectedRoutePrimaryDomain && routeDecision?.primaryDomain !== testCase.expectedRoutePrimaryDomain) {
    failures.push(`route_primary_domain:${routeDecision?.primaryDomain ?? "missing"}`);
  }

  if (Array.isArray(testCase.expectedRouteReasonTerms) && testCase.expectedRouteReasonTerms.length > 0) {
    const reasonText = (routeDecision?.reasons ?? []).join(" ");
    const missingReasonTerms = testCase.expectedRouteReasonTerms.filter((term) => !normalize(reasonText).includes(normalize(term)));
    if (missingReasonTerms.length > 0) {
      failures.push(`route_reason_missing:${missingReasonTerms.join(",")}`);
    }
  }

  if (Array.isArray(testCase.expectedRejectedCollectionIds) && testCase.expectedRejectedCollectionIds.length > 0) {
    const rejectedIds = routeDecision?.rejectedCollectionIds ?? [];
    const missingRejected = testCase.expectedRejectedCollectionIds.filter((id) => !rejectedIds.includes(id));
    if (missingRejected.length > 0) {
      failures.push(`rejected_collection_missing:${missingRejected.join(",")}`);
    }
  }

  if (typeof testCase.expectedShadowRuntimeAffected === "boolean") {
    const actual = shadowRuntime?.runtimeAffected;
    if (actual !== testCase.expectedShadowRuntimeAffected) {
      failures.push(`shadow_runtime_affected:${actual ?? "missing"}`);
    }
  }

  if (typeof testCase.expectedShadowWouldChangeTopCandidate === "boolean") {
    const actual = shadowRuntime?.wouldChangeTopCandidate;
    if (actual !== testCase.expectedShadowWouldChangeTopCandidate) {
      failures.push(`shadow_top_change:${actual ?? "missing"}`);
    }
  }

  if (Number.isFinite(Number(testCase.minShadowPromotedCandidates))) {
    const actual = Number(shadowRuntime?.promotedCandidateCount ?? 0);
    if (actual < Number(testCase.minShadowPromotedCandidates)) {
      failures.push(`shadow_promoted:${actual}<${Number(testCase.minShadowPromotedCandidates)}`);
    }
  }

  if (Array.isArray(testCase.expectedShadowImpactCollectionIds) && testCase.expectedShadowImpactCollectionIds.length > 0) {
    const impactIds = shadowImpacts.map((impact) => impact.collectionId).filter(Boolean);
    const missingImpactIds = testCase.expectedShadowImpactCollectionIds.filter((id) => !impactIds.includes(id));
    if (missingImpactIds.length > 0) {
      failures.push(`shadow_impact_missing:${missingImpactIds.join(",")}`);
    }
  }

  if (testCase.expectedAnswerPathName) {
    const actualAnswerPath = chatTrace?.answerPath?.name;
    if (actualAnswerPath !== testCase.expectedAnswerPathName) {
      failures.push(`answer_path:${actualAnswerPath ?? "missing"}`);
    }
  }

  const forbidden = includesForbiddenAny(content, testCase.forbiddenTerms ?? []);
  if (forbidden.length > 0) {
    failures.push(`forbidden:${forbidden.join(",")}`);
  }

  const missing = missingRequiredConcepts(content, testCase.requiredConcepts ?? []);
  if (missing.length > 0) {
    failures.push(`missing_concepts:${missing.join(",")}`);
  }

  if (Array.isArray(testCase.requiredEvidenceTerms) && testCase.requiredEvidenceTerms.length > 0) {
    const evidenceText = readEvidenceText(evidence, ["usableFacts", "supportingFacts", "directFacts", "redFlags"]);
    const missingEvidenceTerms = testCase.requiredEvidenceTerms.filter((term) => !normalize(evidenceText).includes(normalize(term)));
    if (missingEvidenceTerms.length > 0) {
      failures.push(`missing_evidence_terms:${missingEvidenceTerms.join(",")}`);
    }
  }

  if (Array.isArray(testCase.forbiddenEvidenceTerms) && testCase.forbiddenEvidenceTerms.length > 0) {
    const evidenceText = readEvidenceText(evidence, ["usableFacts", "supportingFacts", "directFacts", "redFlags"]);
    const forbiddenEvidenceTerms = includesForbiddenAny(evidenceText, testCase.forbiddenEvidenceTerms);
    if (forbiddenEvidenceTerms.length > 0) {
      failures.push(`forbidden_evidence_terms:${forbiddenEvidenceTerms.join(",")}`);
    }
  }

  if (Array.isArray(testCase.requiredNotSupportedTerms) && testCase.requiredNotSupportedTerms.length > 0) {
    const notSupportedText = readEvidenceText(evidence, ["notSupported", "missingInfo"]);
    const missingNotSupportedTerms = testCase.requiredNotSupportedTerms.filter((term) => !normalize(notSupportedText).includes(normalize(term)));
    if (missingNotSupportedTerms.length > 0) {
      failures.push(`missing_not_supported_terms:${missingNotSupportedTerms.join(",")}`);
    }
  }

  return {
    id: testCase.id,
    bucket: testCase.bucket ?? "default",
    ok: failures.length === 0,
    failures,
    confidence: readGroundingConfidence(response),
    sourceCount: sources.length,
    safetyPass: safetyGate?.pass ?? null,
    safetySeverity: safetyGate?.severity ?? null,
    safetyRailIds,
    fallbackMode: safetyGate?.fallbackMode ?? null,
    sourceSuggestionAlternativeAccepted: acceptsSourceSuggestionAlternative,
    factCount,
    redFlagCount: Array.isArray(evidence?.redFlags) ? evidence.redFlags.length : 0,
    notSupportedCount: Array.isArray(evidence?.notSupported) ? evidence.notSupported.length : 0,
    alignmentFastFailed: alignment?.fastFailed ?? null,
    alignmentDroppedCandidateCount: alignment?.droppedCandidateCount ?? null,
    budgetMode: budget?.budgetMode ?? null,
    budgetContextMode: budget?.contextMode ?? null,
    budgetRequestedSourceLimit: budget?.requestedSourceLimit ?? null,
    budgetFinalSourceLimit: budget?.finalSourceLimit ?? null,
    budgetFinalSourceCount: budget?.finalSourceCount ?? null,
    budgetContextTextChars: budget?.contextTextChars ?? null,
    budgetEvidenceDirectFactCount: budget?.evidenceDirectFactCount ?? null,
    budgetEvidenceSupportingFactCount: budget?.evidenceSupportingFactCount ?? null,
    budgetEvidenceRiskFactCount: budget?.evidenceRiskFactCount ?? null,
    budgetEvidenceUsableFactCount: budget?.evidenceUsableFactCount ?? null,
    rerankerMode: reranker?.mode ?? null,
    rerankerFallbackUsed: reranker?.fallbackUsed ?? null,
    rerankerInputCandidateCount: reranker?.inputCandidateCount ?? null,
    rerankerModelCandidateCount: reranker?.modelCandidateCount ?? null,
    rerankerReturnedCandidateCount: reranker?.returnedCandidateCount ?? null,
    rerankerTopCandidateIds: Array.isArray(reranker?.topCandidates)
      ? reranker.topCandidates.map((candidate) => candidate.chunkId ?? candidate.documentId ?? candidate.title).filter(Boolean)
      : [],
    rerankerTopCandidateTitles: Array.isArray(reranker?.topCandidates)
      ? reranker.topCandidates.map((candidate) => candidate.title ?? candidate.documentId ?? candidate.chunkId).filter(Boolean)
      : [],
    selectionMode: retrievalDebug?.sourceSelection?.selectionMode ?? null,
    routeDecisionMode: routeDecision?.mode ?? null,
    routeDecisionConfidence: routeDecision?.confidence ?? null,
    routePrimaryDomain: routeDecision?.primaryDomain ?? null,
    usedCollectionIds: retrievalDebug?.sourceSelection?.usedCollectionIds ?? [],
    suggestedCollectionIds: routeDecision?.suggestedCollectionIds ?? [],
    suggestedCollectionReasons: retrievalDebug?.sourceSelection?.suggestedCollections?.map((collection) => collection.reason) ?? [],
    rejectedCollectionIds: routeDecision?.rejectedCollectionIds ?? [],
    routeDecisionReasons: routeDecision?.reasons ?? [],
    metadataRouteCandidateIds: metadataRouteCandidates.map((collection) => collection.id).filter(Boolean),
    metadataRouteCandidateQualities: metadataRouteCandidates.map((collection) => collection.sourceQuality ?? "missing"),
    metadataRouteCandidateScores: metadataRouteCandidates.map((collection) => Number(collection.score ?? 0)).filter(Number.isFinite),
    metadataRouteCandidateScoringModes: metadataRouteCandidates
      .map((collection) => collection.scoreBreakdown?.scoringMode ?? "missing")
      .filter(Boolean),
    metadataRouteCandidateTop: metadataRouteCandidates[0]
      ? {
          id: metadataRouteCandidates[0].id,
          score: Number(metadataRouteCandidates[0].score ?? 0),
          sourceQuality: metadataRouteCandidates[0].sourceQuality ?? null,
          scoringMode: metadataRouteCandidates[0].scoreBreakdown?.scoringMode ?? null,
          matchedTermCount: Array.isArray(metadataRouteCandidates[0].matchedTerms)
            ? metadataRouteCandidates[0].matchedTerms.length
            : 0,
          signals: metadataRouteCandidates[0].scoreBreakdown?.signals ?? {},
          contributions: metadataRouteCandidates[0].scoreBreakdown?.contributions ?? {},
          adaptiveBonus: metadataRouteCandidates[0].scoreBreakdown?.adaptiveBonus ?? 0,
          missingSignals: metadataRouteCandidates[0].scoreBreakdown?.missingSignals ?? [],
        }
      : null,
    expectedTopMetadataCandidateSourceQualities: Array.isArray(testCase.expectedTopMetadataCandidateSourceQualities)
      ? testCase.expectedTopMetadataCandidateSourceQualities
      : [],
    forbiddenTopMetadataCandidateSourceQualities: Array.isArray(testCase.forbiddenTopMetadataCandidateSourceQualities)
      ? testCase.forbiddenTopMetadataCandidateSourceQualities
      : [],
    expectedTopMetadataCandidateScoringModes: Array.isArray(testCase.expectedTopMetadataCandidateScoringModes)
      ? testCase.expectedTopMetadataCandidateScoringModes
      : [],
    expectedRouteDecisionMode: testCase.expectedRouteDecisionMode ?? null,
    expectedBudgetMode: testCase.expectedBudgetMode ?? null,
    expectedUsedCollectionIds: Array.isArray(testCase.expectedUsedCollectionIds) ? testCase.expectedUsedCollectionIds : [],
    expectedSuggestedCollectionIds: Array.isArray(testCase.expectedSuggestedCollectionIds) ? testCase.expectedSuggestedCollectionIds : [],
    shadowRuntime: shadowRuntime
      ? {
          runtimeAffected: shadowRuntime.runtimeAffected,
          activeAdjustmentCount: shadowRuntime.activeAdjustmentCount ?? 0,
          promotedCandidateCount: shadowRuntime.promotedCandidateCount ?? 0,
          currentTopCandidateId: shadowRuntime.currentTopCandidateId ?? null,
          shadowTopCandidateId: shadowRuntime.shadowTopCandidateId ?? null,
          wouldChangeTopCandidate: shadowRuntime.wouldChangeTopCandidate === true,
          impactCollectionIds: shadowImpacts.map((impact) => impact.collectionId).filter(Boolean),
          recommendations: shadowImpacts.reduce((acc, impact) => {
            const key = impact.recommendation ?? "missing";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
        }
      : null,
    latencyMs: response?._latencyMs ?? null,
    answerPathName: chatTrace?.answerPath?.name ?? null,
    traceTotalDurationMs: Number.isFinite(Number(chatTrace?.totalDurationMs)) ? Number(chatTrace.totalDurationMs) : null,
    traceStageDurations: Array.isArray(chatTrace?.stages)
      ? chatTrace.stages.map((stage) => ({
          name: stage?.name ?? "unknown",
          durationMs: Number.isFinite(Number(stage?.durationMs)) ? Number(stage.durationMs) : null,
          status: stage?.status ?? null,
          detailName: stage?.detail?.name ?? null,
          detailReason: stage?.detail?.reason ?? null,
        }))
      : [],
    content,
  };
}

async function loadCases(file, limit) {
  const raw = await readFile(file, "utf8");
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function increment(acc, key, amount = 1) {
  const safeKey = String(key ?? "missing");
  acc[safeKey] = (acc[safeKey] ?? 0) + amount;
  return acc;
}

function averageNumericRecords(records) {
  const sums = {};
  const counts = {};
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    for (const [key, value] of Object.entries(record)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      sums[key] = (sums[key] ?? 0) + numeric;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(sums)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, sum]) => [key, Number((sum / Math.max(counts[key] ?? 1, 1)).toFixed(3))]),
  );
}

function resultArray(result, key) {
  const value = result?.[key];
  return Array.isArray(value) ? value : [];
}

function summarizeRouterQuality(results) {
  const casesWithMetadataCandidates = results.filter((result) => resultArray(result, "metadataRouteCandidateIds").length > 0);
  const topMetadataCandidates = results.map((result) => result.metadataRouteCandidateTop).filter(Boolean);
  const expectedRouteCases = results.filter((result) => result.expectedRouteDecisionMode);
  const routeExpectationMismatches = results
    .filter((result) => result.expectedRouteDecisionMode && result.routeDecisionMode !== result.expectedRouteDecisionMode)
    .map((result) => ({
      id: result.id,
      bucket: result.bucket,
      expected: result.expectedRouteDecisionMode,
      actual: result.routeDecisionMode ?? "missing",
    }));
  const expectedUsedCollectionCases = results.filter((result) => resultArray(result, "expectedUsedCollectionIds").length > 0);
  const usedCollectionMismatches = results
    .filter((result) => {
      const expectedUsedCollectionIds = resultArray(result, "expectedUsedCollectionIds");
      if (expectedUsedCollectionIds.length === 0) return false;
      const usedCollectionIds = resultArray(result, "usedCollectionIds");
      return expectedUsedCollectionIds.some((id) => !usedCollectionIds.includes(id));
    })
    .map((result) => ({
      id: result.id,
      bucket: result.bucket,
      expected: result.expectedUsedCollectionIds,
      actual: result.usedCollectionIds,
    }));
  const expectedSuggestedCollectionCases = results.filter((result) => resultArray(result, "expectedSuggestedCollectionIds").length > 0);
  const suggestedCollectionMismatches = results
    .filter((result) => {
      const expectedSuggestedCollectionIds = resultArray(result, "expectedSuggestedCollectionIds");
      if (expectedSuggestedCollectionIds.length === 0) return false;
      const suggestedCollectionIds = resultArray(result, "suggestedCollectionIds");
      return expectedSuggestedCollectionIds.some((id) => !suggestedCollectionIds.includes(id));
    })
    .map((result) => ({
      id: result.id,
      bucket: result.bucket,
      expected: result.expectedSuggestedCollectionIds,
      actual: result.suggestedCollectionIds,
    }));
  const expectedTopQualityCases = results.filter((result) => resultArray(result, "expectedTopMetadataCandidateSourceQualities").length > 0);
  const topQualityMismatches = results
    .filter((result) => {
      const expectedTopMetadataCandidateSourceQualities = resultArray(result, "expectedTopMetadataCandidateSourceQualities");
      if (expectedTopMetadataCandidateSourceQualities.length === 0) return false;
      return !expectedTopMetadataCandidateSourceQualities.includes(result.metadataRouteCandidateTop?.sourceQuality);
    })
    .map((result) => ({
      id: result.id,
      bucket: result.bucket,
      expected: result.expectedTopMetadataCandidateSourceQualities,
      actual: result.metadataRouteCandidateTop?.sourceQuality ?? "missing",
    }));
  const forbiddenTopQualityCases = results.filter((result) => resultArray(result, "forbiddenTopMetadataCandidateSourceQualities").length > 0);
  const forbiddenTopQualityViolations = results
    .filter((result) => {
      const forbiddenTopMetadataCandidateSourceQualities = resultArray(result, "forbiddenTopMetadataCandidateSourceQualities");
      if (forbiddenTopMetadataCandidateSourceQualities.length === 0) return false;
      return forbiddenTopMetadataCandidateSourceQualities.includes(result.metadataRouteCandidateTop?.sourceQuality);
    })
    .map((result) => ({
      id: result.id,
      bucket: result.bucket,
      forbidden: result.forbiddenTopMetadataCandidateSourceQualities,
      actual: result.metadataRouteCandidateTop?.sourceQuality ?? "missing",
    }));
  const expectedTopScoringModeCases = results.filter((result) => resultArray(result, "expectedTopMetadataCandidateScoringModes").length > 0);
  const topScoringModeMismatches = results
    .filter((result) => {
      const expectedTopMetadataCandidateScoringModes = resultArray(result, "expectedTopMetadataCandidateScoringModes");
      if (expectedTopMetadataCandidateScoringModes.length === 0) return false;
      return !expectedTopMetadataCandidateScoringModes.includes(result.metadataRouteCandidateTop?.scoringMode);
    })
    .map((result) => ({
      id: result.id,
      bucket: result.bucket,
      expected: result.expectedTopMetadataCandidateScoringModes,
      actual: result.metadataRouteCandidateTop?.scoringMode ?? "missing",
    }));

  return {
    routeDecisionModes: results.reduce((acc, result) => increment(acc, result.routeDecisionMode), {}),
    routeDecisionConfidences: results.reduce((acc, result) => increment(acc, result.routeDecisionConfidence), {}),
    routePrimaryDomains: results.reduce((acc, result) => increment(acc, result.routePrimaryDomain), {}),
    selectionModes: results.reduce((acc, result) => increment(acc, result.selectionMode), {}),
    metadataCandidateCoverage: {
      casesWithCandidates: casesWithMetadataCandidates.length,
      ratio: results.length === 0 ? 0 : Number((casesWithMetadataCandidates.length / results.length).toFixed(3)),
      averageCandidateCount:
        results.length === 0
          ? 0
          : Number(
              (
                results.reduce((sum, result) => sum + resultArray(result, "metadataRouteCandidateIds").length, 0) / results.length
              ).toFixed(3),
            ),
      sourceQualities: results.reduce((acc, result) => {
        for (const quality of resultArray(result, "metadataRouteCandidateQualities")) increment(acc, quality);
        return acc;
      }, {}),
      scoringModes: results.reduce((acc, result) => {
        for (const mode of resultArray(result, "metadataRouteCandidateScoringModes")) increment(acc, mode);
        return acc;
      }, {}),
      topSourceQualities: topMetadataCandidates.reduce((acc, candidate) => increment(acc, candidate.sourceQuality), {}),
      topScoringModes: topMetadataCandidates.reduce((acc, candidate) => increment(acc, candidate.scoringMode), {}),
      averageTopScore:
        topMetadataCandidates.length === 0
          ? 0
          : Number(
              (
                topMetadataCandidates.reduce((sum, candidate) => sum + Number(candidate.score ?? 0), 0) /
                topMetadataCandidates.length
              ).toFixed(3),
            ),
      averageTopMatchedTerms:
        topMetadataCandidates.length === 0
          ? 0
          : Number(
              (
                topMetadataCandidates.reduce((sum, candidate) => sum + Number(candidate.matchedTermCount ?? 0), 0) /
                topMetadataCandidates.length
              ).toFixed(3),
            ),
      topSignalAverages: averageNumericRecords(topMetadataCandidates.map((candidate) => candidate.signals)),
      topContributionAverages: averageNumericRecords(topMetadataCandidates.map((candidate) => candidate.contributions)),
    },
    expectations: {
      routeDecision: {
        total: expectedRouteCases.length,
        matched: expectedRouteCases.length - routeExpectationMismatches.length,
        mismatches: routeExpectationMismatches,
      },
      usedCollections: {
        total: expectedUsedCollectionCases.length,
        matched: expectedUsedCollectionCases.length - usedCollectionMismatches.length,
        mismatches: usedCollectionMismatches,
      },
      suggestedCollections: {
        total: expectedSuggestedCollectionCases.length,
        matched: expectedSuggestedCollectionCases.length - suggestedCollectionMismatches.length,
        mismatches: suggestedCollectionMismatches,
      },
      topMetadataCandidateQuality: {
        total: expectedTopQualityCases.length,
        matched: expectedTopQualityCases.length - topQualityMismatches.length,
        mismatches: topQualityMismatches,
      },
      forbiddenTopMetadataCandidateQuality: {
        total: forbiddenTopQualityCases.length,
        matched: forbiddenTopQualityCases.length - forbiddenTopQualityViolations.length,
        mismatches: forbiddenTopQualityViolations,
      },
      topMetadataCandidateScoringMode: {
        total: expectedTopScoringModeCases.length,
        matched: expectedTopScoringModeCases.length - topScoringModeMismatches.length,
        mismatches: topScoringModeMismatches,
      },
    },
  };
}

function averageField(results, field) {
  const values = results.map((result) => Number(result[field])).filter(Number.isFinite);
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function percentile(values, ratio) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[index].toFixed(3));
}

function summarizeLatencyByBudget(results) {
  const groups = new Map();
  for (const result of results) {
    const mode = result.budgetMode ?? "missing";
    const latency = Number(result.latencyMs);
    if (!Number.isFinite(latency)) continue;
    const values = groups.get(mode) ?? [];
    values.push(latency);
    groups.set(mode, values);
  }
  return Object.fromEntries(
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mode, values]) => [
      mode,
      {
        count: values.length,
        avgMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
        p50Ms: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
        maxMs: Number(Math.max(...values).toFixed(3)),
      },
    ]),
  );
}

function summarizeNumericByGroup(results, groupField, valueField) {
  const groups = new Map();
  for (const result of results) {
    const group = result[groupField] ?? "missing";
    const value = Number(result[valueField]);
    if (!Number.isFinite(value)) continue;
    const values = groups.get(group) ?? [];
    values.push(value);
    groups.set(group, values);
  }
  return Object.fromEntries(
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, values]) => [
      group,
      {
        count: values.length,
        avg: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        max: Number(Math.max(...values).toFixed(3)),
      },
    ]),
  );
}

function summarizeRerankerQuality(results) {
  const casesWithReranker = results.filter((result) => result.rerankerMode);
  const fallbackCases = casesWithReranker.filter((result) => result.rerankerFallbackUsed === true);
  return {
    observedCases: casesWithReranker.length,
    coverageRatio: results.length === 0 ? 0 : Number((casesWithReranker.length / results.length).toFixed(3)),
    modes: results.reduce((acc, result) => increment(acc, result.rerankerMode), {}),
    fallbackCases: fallbackCases.length,
    fallbackRatio:
      casesWithReranker.length === 0
        ? 0
        : Number((fallbackCases.length / casesWithReranker.length).toFixed(3)),
    averages: {
      inputCandidates: averageField(casesWithReranker, "rerankerInputCandidateCount"),
      modelCandidates: averageField(casesWithReranker, "rerankerModelCandidateCount"),
      returnedCandidates: averageField(casesWithReranker, "rerankerReturnedCandidateCount"),
    },
    modelCandidatesByBudgetMode: summarizeNumericByGroup(casesWithReranker, "budgetMode", "rerankerModelCandidateCount"),
    inputCandidatesByBudgetMode: summarizeNumericByGroup(casesWithReranker, "budgetMode", "rerankerInputCandidateCount"),
    latencyByRerankerMode: summarizeNumericByGroup(casesWithReranker, "rerankerMode", "latencyMs"),
  };
}

function summarizeBudgetQuality(results) {
  const casesWithBudget = results.filter((result) => result.budgetMode);
  const expectedBudgetCases = results.filter((result) => result.expectedBudgetMode);
  const budgetModeMismatches = results
    .filter((result) => result.expectedBudgetMode && result.budgetMode !== result.expectedBudgetMode)
    .map((result) => ({
      id: result.id,
      bucket: result.bucket,
      expected: result.expectedBudgetMode,
      actual: result.budgetMode ?? "missing",
    }));

  return {
    observedCases: casesWithBudget.length,
    coverageRatio: results.length === 0 ? 0 : Number((casesWithBudget.length / results.length).toFixed(3)),
    budgetModes: results.reduce((acc, result) => increment(acc, result.budgetMode), {}),
    contextModes: results.reduce((acc, result) => increment(acc, result.budgetContextMode), {}),
    averages: {
      requestedSourceLimit: averageField(casesWithBudget, "budgetRequestedSourceLimit"),
      finalSourceLimit: averageField(casesWithBudget, "budgetFinalSourceLimit"),
      finalSourceCount: averageField(casesWithBudget, "budgetFinalSourceCount"),
      contextTextChars: averageField(casesWithBudget, "budgetContextTextChars"),
      evidenceDirectFacts: averageField(casesWithBudget, "budgetEvidenceDirectFactCount"),
      evidenceSupportingFacts: averageField(casesWithBudget, "budgetEvidenceSupportingFactCount"),
      evidenceRiskFacts: averageField(casesWithBudget, "budgetEvidenceRiskFactCount"),
      evidenceUsableFacts: averageField(casesWithBudget, "budgetEvidenceUsableFactCount"),
    },
    latencyByBudgetMode: summarizeLatencyByBudget(casesWithBudget),
    expectations: {
      budgetMode: {
        total: expectedBudgetCases.length,
        matched: expectedBudgetCases.length - budgetModeMismatches.length,
        mismatches: budgetModeMismatches,
      },
    },
  };
}

function buildEvalGuardrails(opts) {
  const strict = readBooleanEnv("R3MES_EVAL_GUARDRAILS_STRICT", false);
  const thresholds = {
    maxRerankerFallbackRatio: readNonNegativeNumberEnv("R3MES_EVAL_MAX_RERANKER_FALLBACK_RATIO", 0),
    maxFastGroundedP95Ms: readNonNegativeNumberEnv("R3MES_EVAL_MAX_FAST_GROUNDED_P95_MS", 6000),
    maxNormalRagP95Ms: readNonNegativeNumberEnv("R3MES_EVAL_MAX_NORMAL_RAG_P95_MS", 8000),
    maxDeepRagP95Ms: readNonNegativeNumberEnv("R3MES_EVAL_MAX_DEEP_RAG_P95_MS", 10000),
    maxFastGroundedModelCandidateP95: readNonNegativeNumberEnv("R3MES_EVAL_MAX_FAST_GROUNDED_MODEL_CANDIDATE_P95", 3),
    maxNormalRagModelCandidateP95: readNonNegativeNumberEnv("R3MES_EVAL_MAX_NORMAL_RAG_MODEL_CANDIDATE_P95", 5),
    maxDeepRagModelCandidateP95: readNonNegativeNumberEnv("R3MES_EVAL_MAX_DEEP_RAG_MODEL_CANDIDATE_P95", 8),
  };
  const violations = [];
  const pushIfOver = (id, actual, max, detail) => {
    if (!Number.isFinite(Number(actual)) || Number(actual) <= max) return;
    violations.push({
      id,
      actual: Number(actual),
      max,
      detail,
    });
  };

  pushIfOver(
    "reranker_fallback_ratio",
    opts.rerankerQuality?.fallbackRatio,
    thresholds.maxRerankerFallbackRatio,
    "Cross-encoder reranker fallback oranı beklenenden yüksek.",
  );

  const latencyByBudget = opts.budgetQuality?.latencyByBudgetMode ?? {};
  pushIfOver(
    "fast_grounded_p95_latency",
    latencyByBudget.fast_grounded?.p95Ms,
    thresholds.maxFastGroundedP95Ms,
    "Fast path p95 latency budget üstüne çıktı.",
  );
  pushIfOver(
    "normal_rag_p95_latency",
    latencyByBudget.normal_rag?.p95Ms,
    thresholds.maxNormalRagP95Ms,
    "Normal RAG p95 latency budget üstüne çıktı.",
  );
  pushIfOver(
    "deep_rag_p95_latency",
    latencyByBudget.deep_rag?.p95Ms,
    thresholds.maxDeepRagP95Ms,
    "Deep RAG p95 latency budget üstüne çıktı.",
  );

  const modelCandidatesByBudget = opts.rerankerQuality?.modelCandidatesByBudgetMode ?? {};
  pushIfOver(
    "fast_grounded_model_candidate_p95",
    modelCandidatesByBudget.fast_grounded?.p95,
    thresholds.maxFastGroundedModelCandidateP95,
    "Fast path reranker model havuzu beklenenden genişledi.",
  );
  pushIfOver(
    "normal_rag_model_candidate_p95",
    modelCandidatesByBudget.normal_rag?.p95,
    thresholds.maxNormalRagModelCandidateP95,
    "Normal RAG reranker model havuzu beklenenden genişledi.",
  );
  pushIfOver(
    "deep_rag_model_candidate_p95",
    modelCandidatesByBudget.deep_rag?.p95,
    thresholds.maxDeepRagModelCandidateP95,
    "Deep RAG reranker model havuzu beklenenden genişledi.",
  );

  return {
    status: violations.length === 0 ? "pass" : strict ? "fail" : "warn",
    strict,
    thresholds,
    violations,
  };
}

async function runCase(opts, testCase) {
  const body = {
    messages: [{ role: "user", content: testCase.query }],
    collectionIds: testCase.collectionIds,
    includePublic: testCase.includePublic === true,
    stream: false,
  };
  if (opts.adapterId) body.adapterId = opts.adapterId;
  if (opts.adapterCid) body.adapter_cid = opts.adapterCid;

  const started = Date.now();
  let lastError = "";
  const attempts = Math.max(1, Number.isFinite(opts.retries) ? opts.retries + 1 : 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-r3mes-debug": "1",
          "x-wallet-address": opts.wallet,
          "x-message": JSON.stringify({
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 900,
            address: opts.wallet,
          }),
          "x-signature": "dev-eval-skip-wallet-auth",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = `transport:${error instanceof Error ? error.message : String(error)}`;
      if (attempt < attempts) continue;
      break;
    }

    if (!response.ok) {
      const text = await response.text();
      lastError = `http:${response.status}`;
      const expectedHttpStatus = Number(testCase.expectedHttpStatus ?? 0);
      if (expectedHttpStatus === response.status) {
        let errorCode = "";
        try {
          const parsedError = JSON.parse(text);
          errorCode = typeof parsedError?.error === "string" ? parsedError.error : "";
        } catch {
          errorCode = "";
        }
        const expectedErrorCode = typeof testCase.expectedErrorCode === "string" ? testCase.expectedErrorCode : "";
        const failures = expectedErrorCode && errorCode !== expectedErrorCode
          ? [`error_code:${errorCode || "missing"}`]
          : [];
        return {
          id: testCase.id,
          bucket: testCase.bucket ?? "default",
          ok: failures.length === 0,
          failures,
          confidence: null,
          sourceCount: 0,
          safetyPass: null,
          safetySeverity: null,
          safetyRailIds: [],
          fallbackMode: null,
          factCount: 0,
          redFlagCount: 0,
          alignmentFastFailed: null,
          alignmentDroppedCandidateCount: null,
          latencyMs: Date.now() - started,
          content: text.slice(0, 500),
        };
      }
      if (response.status >= 500 && attempt < attempts) continue;
      return {
        id: testCase.id,
        bucket: testCase.bucket ?? "default",
        ok: false,
        failures: [lastError],
        confidence: null,
        sourceCount: 0,
        safetyPass: null,
        safetySeverity: null,
        safetyRailIds: [],
        fallbackMode: null,
        factCount: 0,
        redFlagCount: 0,
        alignmentFastFailed: null,
        alignmentDroppedCandidateCount: null,
        latencyMs: Date.now() - started,
        content: text.slice(0, 500),
      };
    }

    const json = await response.json();
    json._latencyMs = Date.now() - started;
    return scoreCase(testCase, json);
  }

  return {
    id: testCase.id,
    bucket: testCase.bucket ?? "default",
    ok: false,
    failures: [lastError || "transport:unknown"],
    confidence: null,
    sourceCount: 0,
    safetyPass: null,
    safetySeverity: null,
    safetyRailIds: [],
    fallbackMode: null,
    factCount: 0,
    redFlagCount: 0,
    alignmentFastFailed: null,
    alignmentDroppedCandidateCount: null,
    latencyMs: Date.now() - started,
    content: "",
  };
}

async function main() {
  const opts = parseArgs();
  const cases = await loadCases(opts.file, opts.limit);
  const started = Date.now();
  const results = [];
  let warmedUp = false;

  for (const testCase of cases) {
    if (!warmedUp) {
      try {
        await fetch(`${opts.baseUrl.replace(/\/$/, "")}/health`, { method: "GET" });
      } catch {
        // The first eval case will report a transport failure if the backend is unavailable.
      }
      warmedUp = true;
    }
    const result = await runCase(opts, testCase);
    results.push(result);
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(
      `${mark} ${result.id} bucket=${result.bucket ?? "default"} route=${result.routeDecisionMode ?? "-"} selection=${result.selectionMode ?? "-"} budget=${result.budgetMode ?? "-"} confidence=${result.confidence ?? "-"} sources=${result.sourceCount} facts=${result.factCount} safety=${result.safetyPass} severity=${result.safetySeverity ?? "-"} shadow=${result.shadowRuntime?.promotedCandidateCount ?? 0}/${result.shadowRuntime?.activeAdjustmentCount ?? 0} topChange=${result.shadowRuntime?.wouldChangeTopCandidate === true} latency=${result.latencyMs ?? "-"}ms`,
    );
    if (!result.ok) {
      console.log(`  ${result.failures.join("; ")}`);
      console.log(`  ${result.content.replace(/\s+/g, " ").slice(0, 240)}`);
    }
  }

  const passed = results.filter((result) => result.ok).length;
  const routerQuality = summarizeRouterQuality(results);
  const budgetQuality = summarizeBudgetQuality(results);
  const rerankerQuality = summarizeRerankerQuality(results);
  const evalGuardrails = buildEvalGuardrails({ budgetQuality, rerankerQuality });
  const summary = {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : Number((passed / results.length).toFixed(3)),
    routeDecisionModes: results.reduce((acc, result) => {
      const key = result.routeDecisionMode ?? "missing";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    routerQuality,
    budgetQuality,
    rerankerQuality,
    evalGuardrails,
    shadowRuntime: {
      observed: results.filter((result) => result.shadowRuntime).length,
      activeAdjustmentCases: results.filter((result) => (result.shadowRuntime?.activeAdjustmentCount ?? 0) > 0).length,
      promotedCandidateCases: results.filter((result) => (result.shadowRuntime?.promotedCandidateCount ?? 0) > 0).length,
      topChangeCases: results.filter((result) => result.shadowRuntime?.wouldChangeTopCandidate === true).length,
      runtimeAffectedCases: results.filter((result) => result.shadowRuntime?.runtimeAffected === true).length,
      recommendations: results.reduce((acc, result) => {
        const recommendations = result.shadowRuntime?.recommendations ?? {};
        for (const [key, value] of Object.entries(recommendations)) {
          acc[key] = (acc[key] ?? 0) + Number(value);
        }
        return acc;
      }, {}),
    },
    selectionModes: results.reduce((acc, result) => {
      const key = result.selectionMode ?? "missing";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    buckets: results.reduce((acc, result) => {
      const key = result.bucket ?? "default";
      const current = acc[key] ?? { total: 0, passed: 0, failed: 0 };
      current.total += 1;
      if (result.ok) current.passed += 1;
      else current.failed += 1;
      acc[key] = current;
      return acc;
    }, {}),
    durationMs: Date.now() - started,
  };
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
  console.log(`wrote ${opts.out}`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.failed === 0 && evalGuardrails.status !== "fail" ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
