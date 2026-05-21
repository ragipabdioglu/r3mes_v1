function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function compactStrings(values) {
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
    item.claim,
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

function collectEvidenceItems(response) {
  const retrievalDebug = response?.retrieval_debug ?? response?.retrievalDebug ?? {};
  const compiledEvidence = retrievalDebug?.compiledEvidence ?? response?.compiledEvidence ?? {};
  const evidenceBundle = retrievalDebug?.evidenceBundle ?? compiledEvidence?.evidenceBundle ?? response?.evidenceBundle ?? {};
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
  return testCase?.evidenceOnlyExpectations ?? testCase?.evidenceExpectations ?? {};
}

export function scoreEvidenceOnly(testCase, response) {
  const expectations = readExpectations(testCase);
  if (!expectations || typeof expectations !== "object") {
    return { ok: true, failures: [], findings: [], observed: {} };
  }

  const sources = asArray(response?.sources);
  const evidenceItems = collectEvidenceItems(response);
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

  const findings = [];
  const expectedSourceTerms = [
    ...asArray(expectations.expectedSourceTerms),
    ...asArray(expectations.requiredSourceTerms),
  ];
  const expectedTitleTerms = [
    ...asArray(expectations.expectedTitleTerms),
    ...asArray(expectations.requiredTitleTerms),
  ];

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

  const expectedEvidenceTypes = compactStrings([
    expectations.expectedEvidenceType,
    expectations.requiredEvidenceType,
    expectations.allowedEvidenceTypes,
  ]);
  if (expectedEvidenceTypes.length > 0) {
    const normalizedActualTypes = new Set(evidenceTypes.map(normalize));
    const matched = expectedEvidenceTypes.some((type) => normalizedActualTypes.has(normalize(type)));
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
      evidenceTypes,
      sourceText,
      titleText,
      contextText,
    },
  };
}
