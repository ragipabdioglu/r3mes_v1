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
  const evidence = retrievalDebug?.evidence;
  const failures = [];
  const minSources = Number(testCase.minSources ?? (testCase.mustHaveSources ? 1 : 0));
  const minEvidenceFacts = Number(testCase.minEvidenceFacts ?? (testCase.mustHaveSources ? 1 : 0));
  const maxLatencyMs = Number(testCase.maxLatencyMs ?? 30000);

  if (sources.length < minSources) {
    failures.push(`sources:${sources.length}<${minSources}`);
  }

  if (testCase.mustPassSafety !== false && safetyGate?.pass !== true) {
    failures.push(`safety:${safetyGate?.pass ?? "missing"}`);
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

  if (Array.isArray(testCase.expectedConfidence) && testCase.expectedConfidence.length > 0) {
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
    if (actualIntent !== testCase.expectedIntent) {
      failures.push(`intent:${actualIntent ?? "missing"}`);
    }
  }

  if (testCase.expectedRetrievalMode) {
    const actualMode = retrievalDebug?.retrievalMode;
    if (actualMode !== testCase.expectedRetrievalMode) {
      failures.push(`retrieval_mode:${actualMode ?? "missing"}`);
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

  const routeDecision = retrievalDebug?.sourceSelection?.routeDecision;
  if (testCase.expectedRouteDecisionMode && routeDecision?.mode !== testCase.expectedRouteDecisionMode) {
    failures.push(`route_decision_mode:${routeDecision?.mode ?? "missing"}`);
  }

  if (testCase.expectedRouteDecisionConfidence && routeDecision?.confidence !== testCase.expectedRouteDecisionConfidence) {
    failures.push(`route_decision_confidence:${routeDecision?.confidence ?? "missing"}`);
  }

  if (testCase.expectedRoutePrimaryDomain && routeDecision?.primaryDomain !== testCase.expectedRoutePrimaryDomain) {
    failures.push(`route_primary_domain:${routeDecision?.primaryDomain ?? "missing"}`);
  }

  if (Array.isArray(testCase.expectedRejectedCollectionIds) && testCase.expectedRejectedCollectionIds.length > 0) {
    const rejectedIds = routeDecision?.rejectedCollectionIds ?? [];
    const missingRejected = testCase.expectedRejectedCollectionIds.filter((id) => !rejectedIds.includes(id));
    if (missingRejected.length > 0) {
      failures.push(`rejected_collection_missing:${missingRejected.join(",")}`);
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

  return {
    id: testCase.id,
    ok: failures.length === 0,
    failures,
    confidence: readGroundingConfidence(response),
    sourceCount: sources.length,
    safetyPass: safetyGate?.pass ?? null,
    factCount,
    redFlagCount: Array.isArray(evidence?.redFlags) ? evidence.redFlags.length : 0,
    routeDecisionMode: routeDecision?.mode ?? null,
    routeDecisionConfidence: routeDecision?.confidence ?? null,
    routePrimaryDomain: routeDecision?.primaryDomain ?? null,
    latencyMs: response?._latencyMs ?? null,
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
      if (response.status >= 500 && attempt < attempts) continue;
      return {
        id: testCase.id,
        ok: false,
        failures: [lastError],
        confidence: null,
        sourceCount: 0,
        safetyPass: null,
        factCount: 0,
        redFlagCount: 0,
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
    ok: false,
    failures: [lastError || "transport:unknown"],
    confidence: null,
    sourceCount: 0,
    safetyPass: null,
    factCount: 0,
    redFlagCount: 0,
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
      `${mark} ${result.id} confidence=${result.confidence ?? "-"} sources=${result.sourceCount} facts=${result.factCount} safety=${result.safetyPass} latency=${result.latencyMs ?? "-"}ms`,
    );
    if (!result.ok) {
      console.log(`  ${result.failures.join("; ")}`);
      console.log(`  ${result.content.replace(/\s+/g, " ").slice(0, 240)}`);
    }
  }

  const passed = results.filter((result) => result.ok).length;
  const summary = {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : Number((passed / results.length).toFixed(3)),
    durationMs: Date.now() - started,
  };
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
  console.log(`wrote ${opts.out}`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
