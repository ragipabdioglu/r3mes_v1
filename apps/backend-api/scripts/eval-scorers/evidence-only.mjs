function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function compactStrings(values = []) {
  return values
    .flatMap((value) => asArray(value))
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function includesTerm(text, term) {
  const normalizedTerm = normalize(term);
  return normalizedTerm.length > 0 && normalize(text).includes(normalizedTerm);
}

function missingTerms(text, terms) {
  return compactStrings(terms).filter((term) => !includesTerm(text, term));
}

function presentTerms(text, terms) {
  return compactStrings(terms).filter((term) => includesTerm(text, term));
}

const EVIDENCE_TYPE_ALIASES = new Map([
  ["definition", ["definition"]],
  ["define", ["definition"]],
  ["list", ["list", "list_item", "list_items"]],
  ["list_items", ["list", "list_item", "list_items"]],
  ["comparison", ["comparison", "comparison_point", "compare", "compare_concepts"]],
  ["compare", ["comparison", "comparison_point", "compare", "compare_concepts"]],
  ["procedure", ["procedure", "procedure_step", "how_to", "steps"]],
  ["how_to", ["procedure", "procedure_step", "how_to", "steps"]],
  ["event", ["event", "text_fact", "definition", "procedure_step"]],
  ["timing", ["timing", "text_fact", "definition", "procedure_step"]],
  ["code", ["code", "code_fact", "code_explanation", "procedure_step"]],
  ["code_explanation", ["code", "code_fact", "code_explanation", "procedure_step"]],
  ["visual_layout", ["visual_layout", "layout", "image_layout", "figure", "visual"]],
  ["summary", ["summary", "text_fact", "grounded_summary"]],
]);

function evidenceTypeAlternatives(value) {
  const normalized = normalize(value);
  return EVIDENCE_TYPE_ALIASES.get(normalized) ?? [normalized];
}

function joinTextParts(parts) {
  return compactStrings(parts).join(" ");
}

function readSourceTitle(source) {
  if (!source || typeof source !== "object") return "";
  return joinTextParts([
    source.title,
    source.sourceTitle,
    source.documentTitle,
    source.name,
    source.filename,
    source.fileName,
    source.metadata?.title,
    source.metadata?.sourceTitle,
    source.metadata?.documentTitle,
    source.metadata?.filename,
    source.metadata?.fileName,
  ]);
}

function readSourceIdentity(source) {
  if (!source || typeof source !== "object") return "";
  return joinTextParts([
    readSourceTitle(source),
    source.id,
    source.sourceId,
    source.documentId,
    source.collectionId,
    source.cid,
    source.url,
    source.metadata?.id,
    source.metadata?.sourceId,
    source.metadata?.documentId,
    source.metadata?.collectionId,
    source.metadata?.cid,
    source.metadata?.url,
  ]);
}

function evidenceItemText(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  return joinTextParts([
    item.text,
    item.content,
    item.chunk,
    item.snippet,
    item.quote,
    item.claim,
    item.normalizedClaim,
    item.reason,
    item.answer,
    item.value,
    item.sourceTitle,
    item.title,
    item.sourceId,
    item.documentId,
    item.metadata?.title,
    item.metadata?.sourceTitle,
  ]);
}

function evidenceItemType(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.evidenceType ?? item.type ?? item.kind ?? item.category ?? item.bucket ?? "").trim();
}

function readRetrievalDebug(response) {
  return response?.retrieval_debug ?? response?.retrievalDebug ?? {};
}

function readCompiledEvidence(response) {
  const retrievalDebug = readRetrievalDebug(response);
  return retrievalDebug?.compiledEvidence ?? response?.compiledEvidence ?? {};
}

function readEvidenceBundle(response) {
  const retrievalDebug = readRetrievalDebug(response);
  const compiledEvidence = readCompiledEvidence(response);
  return retrievalDebug?.evidenceBundle ?? compiledEvidence?.evidenceBundle ?? response?.evidenceBundle ?? {};
}

function collectEvidenceItems(response) {
  const retrievalDebug = readRetrievalDebug(response);
  const compiledEvidence = readCompiledEvidence(response);
  const evidenceBundle = readEvidenceBundle(response);
  const evidence = retrievalDebug?.evidence ?? response?.evidence ?? {};
  return [
    ...asArray(response?.evidence),
    ...asArray(response?.context),
    ...asArray(response?.contextItems),
    ...asArray(response?.retrievedContext),
    ...asArray(response?.retrieved_context),
    ...asArray(evidence?.direct),
    ...asArray(evidence?.supporting),
    ...asArray(evidence?.risks),
    ...asArray(evidence?.unknowns),
    ...asArray(compiledEvidence?.facts),
    ...asArray(compiledEvidence?.risks),
    ...asArray(compiledEvidence?.unknowns),
    ...asArray(compiledEvidence?.contradictions),
    ...asArray(evidenceBundle?.items),
    ...asArray(evidenceBundle?.facts),
  ].filter((item) => item !== undefined && item !== null);
}

function collectEvidenceFacts(response) {
  const retrievalDebug = readRetrievalDebug(response);
  const compiledEvidence = readCompiledEvidence(response);
  const evidence = retrievalDebug?.evidence ?? response?.evidence ?? {};
  return [
    ...asArray(evidence?.usableFacts),
    ...asArray(evidence?.supportingFacts),
    ...asArray(evidence?.directFacts),
    ...asArray(evidence?.redFlags),
    ...asArray(compiledEvidence?.facts),
  ].filter((item) => item !== undefined && item !== null);
}

function readContextText(response, evidenceItems) {
  const retrievalDebug = response?.retrieval_debug ?? response?.retrievalDebug ?? {};
  return joinTextParts([
    response?.context,
    response?.retrievedContext,
    response?.retrieved_context,
    retrievalDebug?.context,
    retrievalDebug?.retrievedContext,
    retrievalDebug?.retrieved_context,
    retrievalDebug?.compiledEvidence?.summary,
    evidenceItems.map(evidenceItemText),
  ]);
}

function pushFinding(findings, failureClass, code, detail = {}) {
  findings.push({
    class: failureClass,
    code,
    severity: detail.severity ?? "fail",
    expected: detail.expected,
    actual: detail.actual,
    message: detail.message ?? code,
  });
}

function readExpectations(testCase) {
  const legacy = testCase?.evidenceOnlyExpectations;
  const contract = testCase?._evalContractV2;
  const v2Enabled = contract?.evalModes?.evidence !== false;
  const v2 = v2Enabled ? (contract?.evidenceExpectations ?? testCase?.evidenceExpectations) : undefined;

  return {
    ...(legacy && typeof legacy === "object" ? legacy : {}),
    ...(v2 && typeof v2 === "object" ? v2 : {}),
  };
}

function readGroundingConfidence(response) {
  return (
    response?.grounded_answer?.grounding_confidence ??
    response?.retrieval_debug?.groundingConfidence ??
    response?.retrievalDebug?.groundingConfidence ??
    response?.groundingConfidence ??
    null
  );
}

function increment(acc, key, amount = 1) {
  const safeKey = String(key ?? "missing");
  acc[safeKey] = (acc[safeKey] ?? 0) + amount;
  return acc;
}

function readEvidenceKindCounts(evidenceBundle, evidenceTypes) {
  const kindCounts = evidenceBundle?.diagnostics?.kindCounts;
  if (kindCounts && typeof kindCounts === "object" && !Array.isArray(kindCounts)) {
    return Object.fromEntries(
      Object.entries(kindCounts)
        .map(([key, value]) => [key, Number(value)])
        .filter(([, value]) => Number.isFinite(value)),
    );
  }
  return compactStrings(evidenceTypes).reduce((acc, kind) => increment(acc, kind), {});
}

export function scoreEvidenceOnly(testCase, response) {
  const expectations = readExpectations(testCase);
  if (!expectations || typeof expectations !== "object") {
    return { ok: true, failures: [], findings: [], observed: {} };
  }

  const sources = asArray(response?.sources);
  const evidenceItems = collectEvidenceItems(response);
  const evidenceFacts = collectEvidenceFacts(response);
  const evidenceBundle = readEvidenceBundle(response);
  const compiledEvidence = readCompiledEvidence(response);
  const sourceText = joinTextParts(sources.map(readSourceIdentity));
  const titleText = joinTextParts(sources.map(readSourceTitle));
  const contextText = readContextText(response, evidenceItems);
  const evidenceTypes = compactStrings([
    response?.evidenceType,
    response?.evidence_type,
    response?.retrieval_debug?.evidenceType,
    response?.retrieval_debug?.evidence_type,
    response?.retrieval_debug?.compiledEvidence?.evidenceType,
    response?.retrieval_debug?.compiledEvidence?.type,
    evidenceItems.map(evidenceItemType),
  ]);
  const evidenceKindCounts = readEvidenceKindCounts(evidenceBundle, evidenceTypes);

  const findings = [];
  const expectedSourceTerms = [
    ...asArray(expectations.expectedSourceTerms),
    ...asArray(expectations.requiredSourceTerms),
  ];
  const expectedTitleTerms = [
    ...asArray(expectations.expectedTitleTerms),
    ...asArray(expectations.requiredTitleTerms),
  ];

  if (expectations.mustHaveSources === true && sources.length === 0) {
    pushFinding(findings, "source_missing", "expected_sources_missing", {
      expected: "at least one source",
      actual: sources.length,
      message: "expected sources but none were observed",
    });
  }

  if (Number.isFinite(Number(expectations.minSources)) && sources.length < Number(expectations.minSources)) {
    pushFinding(findings, "source_count_below_minimum", "min_sources_not_met", {
      expected: Number(expectations.minSources),
      actual: sources.length,
      message: `source count ${sources.length} is below minimum ${Number(expectations.minSources)}`,
    });
  }

  if (Number.isFinite(Number(expectations.maxSources)) && sources.length > Number(expectations.maxSources)) {
    pushFinding(findings, "source_count_above_maximum", "max_sources_exceeded", {
      expected: Number(expectations.maxSources),
      actual: sources.length,
      message: `source count ${sources.length} is above maximum ${Number(expectations.maxSources)}`,
    });
  }

  if (Number.isFinite(Number(expectations.minEvidenceFacts)) && evidenceFacts.length < Number(expectations.minEvidenceFacts)) {
    pushFinding(findings, "evidence_fact_count_below_minimum", "min_evidence_facts_not_met", {
      expected: Number(expectations.minEvidenceFacts),
      actual: evidenceFacts.length,
      message: `evidence fact count ${evidenceFacts.length} is below minimum ${Number(expectations.minEvidenceFacts)}`,
    });
  }

  const evidenceBundleItemCount = Array.isArray(evidenceBundle?.items)
    ? evidenceBundle.items.length
    : Number(evidenceBundle?.diagnostics?.itemCount ?? evidenceBundle?.itemCount ?? 0);
  if (
    Number.isFinite(Number(expectations.minEvidenceBundleItemCount)) &&
    evidenceBundleItemCount < Number(expectations.minEvidenceBundleItemCount)
  ) {
    pushFinding(findings, "evidence_bundle_item_count_below_minimum", "min_evidence_bundle_items_not_met", {
      expected: Number(expectations.minEvidenceBundleItemCount),
      actual: evidenceBundleItemCount,
      message: `evidence bundle item count ${evidenceBundleItemCount} is below minimum ${Number(expectations.minEvidenceBundleItemCount)}`,
    });
  }

  const expectedConfidence = compactStrings(expectations.expectedConfidence);
  if (expectedConfidence.length > 0) {
    const actualConfidence = readGroundingConfidence(response);
    if (!expectedConfidence.map(normalize).includes(normalize(actualConfidence))) {
      pushFinding(findings, "evidence_confidence_mismatch", "expected_evidence_confidence_missing", {
        expected: expectedConfidence,
        actual: actualConfidence,
        message: `expected evidence confidence not observed: ${expectedConfidence.join(", ")}`,
      });
    }
  }

  if (expectations.expectedCompiledEvidenceConfidence) {
    const actualConfidence = compiledEvidence?.confidence ?? compiledEvidence?.groundingConfidence ?? null;
    if (normalize(actualConfidence) !== normalize(expectations.expectedCompiledEvidenceConfidence)) {
      pushFinding(findings, "compiled_evidence_confidence_mismatch", "expected_compiled_evidence_confidence_missing", {
        expected: expectations.expectedCompiledEvidenceConfidence,
        actual: actualConfidence,
        message: `expected compiled evidence confidence not observed: ${expectations.expectedCompiledEvidenceConfidence}`,
      });
    }
  }

  const compiledContradictionCount = asArray(compiledEvidence?.contradictions).length;
  if (
    Number.isFinite(Number(expectations.minCompiledEvidenceContradictionCount)) &&
    compiledContradictionCount < Number(expectations.minCompiledEvidenceContradictionCount)
  ) {
    pushFinding(findings, "compiled_evidence_contradiction_count_below_minimum", "min_compiled_evidence_contradictions_not_met", {
      expected: Number(expectations.minCompiledEvidenceContradictionCount),
      actual: compiledContradictionCount,
      message: `compiled evidence contradiction count ${compiledContradictionCount} is below minimum ${Number(expectations.minCompiledEvidenceContradictionCount)}`,
    });
  }

  const missingSourceTerms = missingTerms(sourceText, expectedSourceTerms);
  if (missingSourceTerms.length > 0) {
    pushFinding(findings, "source_term_missing", "expected_source_terms_missing", {
      expected: missingSourceTerms,
      actual: sourceText,
      message: `missing expected source terms: ${missingSourceTerms.join(", ")}`,
    });
  }

  const missingTitleTerms = missingTerms(titleText, expectedTitleTerms);
  if (missingTitleTerms.length > 0) {
    pushFinding(findings, "title_term_missing", "expected_title_terms_missing", {
      expected: missingTitleTerms,
      actual: titleText,
      message: `missing expected title terms: ${missingTitleTerms.join(", ")}`,
    });
  }

  const missingContextTerms = missingTerms(contextText, expectations.requiredContextTerms);
  if (missingContextTerms.length > 0) {
    pushFinding(findings, "required_context_term_missing", "required_context_terms_missing", {
      expected: missingContextTerms,
      actual: contextText,
      message: `missing required context terms: ${missingContextTerms.join(", ")}`,
    });
  }

  const forbiddenContextTerms = presentTerms(contextText, expectations.forbiddenContextTerms);
  if (forbiddenContextTerms.length > 0) {
    pushFinding(findings, "forbidden_context_term_present", "forbidden_context_terms_present", {
      expected: [],
      actual: forbiddenContextTerms,
      message: `forbidden context terms present: ${forbiddenContextTerms.join(", ")}`,
    });
  }

  const missingEvidenceTerms = missingTerms(contextText, expectations.requiredEvidenceTerms);
  if (missingEvidenceTerms.length > 0) {
    pushFinding(findings, "required_evidence_term_missing", "required_evidence_terms_missing", {
      expected: missingEvidenceTerms,
      actual: contextText,
      message: `missing required evidence terms: ${missingEvidenceTerms.join(", ")}`,
    });
  }

  const forbiddenEvidenceTerms = presentTerms(contextText, expectations.forbiddenEvidenceTerms);
  if (forbiddenEvidenceTerms.length > 0) {
    pushFinding(findings, "forbidden_evidence_term_present", "forbidden_evidence_terms_present", {
      expected: [],
      actual: forbiddenEvidenceTerms,
      message: `forbidden evidence terms present: ${forbiddenEvidenceTerms.join(", ")}`,
    });
  }

  const missingNotSupportedTerms = missingTerms(contextText, expectations.requiredNotSupportedTerms);
  if (missingNotSupportedTerms.length > 0) {
    pushFinding(findings, "not_supported_term_missing", "required_not_supported_terms_missing", {
      expected: missingNotSupportedTerms,
      actual: contextText,
      message: `missing required not-supported terms: ${missingNotSupportedTerms.join(", ")}`,
    });
  }

  const expectedEvidenceTypes = compactStrings([
    expectations.expectedEvidenceType,
    expectations.requiredEvidenceType,
    expectations.allowedEvidenceTypes,
  ]);
  if (expectedEvidenceTypes.length > 0) {
    const normalizedActualTypes = new Set(evidenceTypes.map(normalize));
    const matched = expectedEvidenceTypes.some((type) =>
      evidenceTypeAlternatives(type).some((candidate) => normalizedActualTypes.has(candidate)),
    );
    if (!matched) {
      pushFinding(findings, "evidence_type_mismatch", "expected_evidence_type_missing", {
        expected: expectedEvidenceTypes,
        actual: evidenceTypes,
        message: `expected evidence type not observed: ${expectedEvidenceTypes.join(", ")}`,
      });
    }
  }

  return {
    ok: findings.every((finding) => finding.severity !== "fail"),
    failures: findings.filter((finding) => finding.severity === "fail").map((finding) => finding.code),
    findings,
    observed: {
      sourceCount: sources.length,
      evidenceItemCount: evidenceItems.length,
      evidenceFactCount: evidenceFacts.length,
      evidenceBundleItemCount,
      compiledEvidenceContradictionCount: compiledContradictionCount,
      evidenceTypes,
      evidenceKindCounts,
      sourceText,
      titleText,
      contextText,
    },
  };
}
