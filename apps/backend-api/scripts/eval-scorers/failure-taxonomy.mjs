export function classifyFailure(failure) {
  const value = String(failure ?? "unknown");
  if (
    value.startsWith("provider_strict_failure:") ||
    value.startsWith("reranker_real_required_fallback:") ||
    value.includes("QDRANT_PROVIDER_UNAVAILABLE") ||
    value.includes("qdrant_provider_failed")
  ) {
    return "provider_failure";
  }
  if (
    value.includes("raw_json_fallback_missing_contract") ||
    value.startsWith("debug_contract_") ||
    value.startsWith("eval_debug_contract.")
  ) {
    return "debug_contract";
  }
  if (
    value.startsWith("runtime_fallback:") ||
    value.startsWith("fallback_template:") ||
    value.startsWith("reranker_fallback:") ||
    value.startsWith("qdrant_fallback:")
  ) {
    return "runtime_fallback";
  }
  if (
    value.startsWith("safety") ||
    value.startsWith("fallback_mode:") ||
    value.startsWith("generic_caution:")
  ) {
    return "safety";
  }
  if (value.startsWith("latency:")) return "latency";
  if (
    value.startsWith("answer_quality:") ||
    value.startsWith("missing_answer_terms:") ||
    value.startsWith("forbidden_answer_terms:") ||
    value.startsWith("answer_words:") ||
    value.startsWith("answer_chars:") ||
    value === "low_language_quality"
  ) {
    return "answer_quality";
  }
  if (
    value.startsWith("evidence") ||
    value.startsWith("compiled_evidence") ||
    value.startsWith("missing_evidence_terms:") ||
    value.startsWith("forbidden_evidence_terms:") ||
    value.startsWith("missing_not_supported_terms:")
  ) {
    return "evidence_quality";
  }
  if (
    value.startsWith("query_") ||
    value.startsWith("intent:") ||
    value.startsWith("domain:") ||
    value.startsWith("confidence:")
  ) {
    return "query_understanding";
  }
  if (
    value.startsWith("sources:") ||
    value.startsWith("alignment_") ||
    value.startsWith("reranker_") ||
    value.startsWith("retrieval_mode:") ||
    value.startsWith("budget_") ||
    value.startsWith("selection_mode:") ||
    value.startsWith("used_collection_missing:") ||
    value.startsWith("accessible_collection_missing:") ||
    value.startsWith("suggested_collection_missing:") ||
    value.startsWith("thin_profile_missing:") ||
    value.startsWith("metadata_candidate") ||
    value.startsWith("top_metadata_candidate") ||
    value.startsWith("route_") ||
    value.startsWith("rejected_collection_missing:")
  ) {
    return "retrieval_quality";
  }
  if (
    value.startsWith("forbidden:") ||
    value.startsWith("missing_concepts:") ||
    value.startsWith("transport:") ||
    value.startsWith("expected_error_code:")
  ) {
    return "boundary";
  }
  if (value.startsWith("shadow_") || value.startsWith("answer_path:")) return "runtime_path";
  return "unknown";
}

function increment(acc, key, amount = 1) {
  const normalized = key ?? "missing";
  acc[normalized] = (acc[normalized] ?? 0) + amount;
  return acc;
}

export function summarizeFailureTaxonomy(results) {
  const failedResults = results.filter((result) => Array.isArray(result.failures) && result.failures.length > 0);
  const cases = failedResults.map((result) => {
    const classes = [...new Set(result.failures.map((failure) => classifyFailure(failure)))];
    return {
      id: result.id,
      bucket: result.bucket ?? "default",
      classes,
      failures: result.failures,
    };
  });
  const classes = {};
  const byBucket = {};
  for (const result of failedResults) {
    const bucket = result.bucket ?? "default";
    byBucket[bucket] ??= {};
    for (const failure of result.failures) {
      const failureClass = classifyFailure(failure);
      increment(classes, failureClass);
      increment(byBucket[bucket], failureClass);
    }
  }
  const blockerClasses = ["provider_failure", "runtime_fallback", "debug_contract", "boundary"];
  const blockers = cases.filter((item) => item.classes.some((failureClass) => blockerClasses.includes(failureClass)));
  return {
    failedCaseCount: failedResults.length,
    failureCount: failedResults.reduce((sum, result) => sum + result.failures.length, 0),
    classes,
    byBucket,
    blockers,
  };
}

export function mergeFailureTaxonomy(suiteResults) {
  const classes = {};
  const bySuite = {};
  const blockers = [];
  let failedCaseCount = 0;
  let failureCount = 0;
  for (const suite of suiteResults) {
    const taxonomy = suite.failureTaxonomy;
    if (!taxonomy || typeof taxonomy !== "object") continue;
    failedCaseCount += Number(taxonomy.failedCaseCount ?? 0);
    failureCount += Number(taxonomy.failureCount ?? 0);
    bySuite[suite.id] = taxonomy.classes ?? {};
    for (const [failureClass, count] of Object.entries(taxonomy.classes ?? {})) {
      increment(classes, failureClass, Number(count));
    }
    for (const blocker of Array.isArray(taxonomy.blockers) ? taxonomy.blockers : []) {
      blockers.push({ suite: suite.id, ...blocker });
    }
  }
  return {
    failedCaseCount,
    failureCount,
    classes,
    bySuite,
    blockers,
  };
}
