function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(/[^\p{L}\p{N}-]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function wordCount(value) {
  return tokenize(value).length;
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

function answerLooksLikeNoSource(content) {
  const normalized = normalize(content);
  return (
    normalized.includes("kaynak yok") ||
    normalized.includes("kaynak bulunamad") ||
    normalized.includes("kaynaklarda bulunamad") ||
    normalized.includes("ilgili kaynak bulunamad") ||
    normalized.includes("no source") ||
    normalized.includes("not found in the source")
  );
}

function answerLooksTemplated(content) {
  return includesForbiddenAny(content, [
    "Dikkat edilmesi gereken nokta",
    "Kaynakta özel alarm",
    "Kaynakta açık dayanak yoksa",
    "Bu yanıt genel bilgilendirme amaçlıdır",
    "Karar vermeden önce güncel ve yetkili kaynakla doğrulama yapın",
  ]).length > 0;
}

function selectedFieldIds(answerPlan) {
  return (Array.isArray(answerPlan?.selectedFacts) ? answerPlan.selectedFacts : [])
    .map((fact) => fact?.fieldId ?? fact?.field)
    .filter(Boolean)
    .map(normalize);
}

function planMissingFieldIds(answerPlan) {
  return (Array.isArray(answerPlan?.diagnostics?.missingFieldIds) ? answerPlan.diagnostics.missingFieldIds : [])
    .filter(Boolean)
    .map(normalize);
}

function missingRequiredFields(requiredFields, answerPlan) {
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) return [];
  if (!answerPlan) return requiredFields;
  const missingInPlan = new Set(planMissingFieldIds(answerPlan));
  const selected = new Set(selectedFieldIds(answerPlan));
  if (answerPlan.coverage === "complete" && missingInPlan.size === 0) return [];
  return requiredFields.filter((field) => {
    const normalizedField = normalize(field);
    if (missingInPlan.has(normalizedField)) return true;
    return selected.size > 0 ? !selected.has(normalizedField) : false;
  });
}

export function detectAnswerQualityFindings(testCase, content, context = {}) {
  const expectations = testCase.qualityExpectations;
  if (!expectations || typeof expectations !== "object") return [];
  const findings = [];
  const normalized = normalize(content);
  const words = wordCount(content);
  const push = (bucket, severity, message) => findings.push({ bucket, severity, message });

  if (Number.isFinite(Number(expectations.maxWords)) && words > Number(expectations.maxWords)) {
    push("answer_too_long", "fail", `answer has ${words} words, max ${Number(expectations.maxWords)}`);
  }

  if (Array.isArray(expectations.requiredAnswerTerms)) {
    const missingTerms = expectations.requiredAnswerTerms.filter((term) => !normalized.includes(normalize(term)));
    if (missingTerms.length > 0) {
      push("incomplete_answer", "fail", `missing answer terms: ${missingTerms.join(",")}`);
    }
  }

  if (Array.isArray(expectations.forbiddenAnswerTerms)) {
    const forbiddenTerms = includesForbiddenAny(content, expectations.forbiddenAnswerTerms);
    if (forbiddenTerms.length > 0) {
      push("template_answer", "fail", `forbidden answer terms: ${forbiddenTerms.join(",")}`);
    }
  }

  if (answerLooksTemplated(content)) {
    push("template_answer", "warn", "answer contains a generic/template safety phrase");
  }

  if (expectations.forbidCaution === true) {
    const cautionTerms = includesForbiddenAny(content, [
      "Dikkat edilmesi gereken",
      "Dikkat:",
      "Riskler:",
      "Kaynakta özel alarm",
      "yatırım tavsiyesi",
      "risk koşulu",
    ]);
    if (cautionTerms.length > 0) {
      push("unnecessary_warning", "fail", `unnecessary caution terms: ${cautionTerms.join(",")}`);
    }
  }

  if (expectations.noRawTableDump === true) {
    const rawTableSignals = [
      /\|[^|\n]{1,80}\|[^|\n]{1,80}\|/u,
      /(?:\d[\d.,-]*\s+){5,}/u,
      /\b(?:SPK'?ya Göre|Yasal Kayıtlara Göre).{80,}/iu,
    ];
    if (rawTableSignals.some((pattern) => pattern.test(content))) {
      push("raw_table_dump", "fail", "answer looks like a raw table row dump");
    }
  }

  if (expectations.format === "bullets") {
    const bulletLines = content.split(/\r?\n/).filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/u.test(line));
    if (bulletLines.length === 0) {
      push("wrong_output_format", "fail", "expected bullet/list formatted answer");
    }
  }

  if (expectations.format === "short" && Number.isFinite(Number(expectations.maxSentences))) {
    const sentenceCount = content
      .split(/[.!?]+/u)
      .map((part) => part.trim())
      .filter(Boolean).length;
    if (sentenceCount > Number(expectations.maxSentences)) {
      push("wrong_output_format", "fail", `answer has ${sentenceCount} sentences`);
    }
  }

  const missingFields = missingRequiredFields(expectations.requiredFields, context.answerPlan);
  if (missingFields.length > 0) {
    push("table_field_mismatch", "fail", `missing required fields in answer plan: ${missingFields.join(",")}`);
  }

  const missingRequiredFieldValues = [];
  if (Array.isArray(expectations.requiredFieldValues)) {
    for (const expected of expectations.requiredFieldValues) {
      if (!expected || typeof expected !== "object") continue;
      const value = String(expected.value ?? "").trim();
      if (!value) continue;
      if (!normalized.includes(normalize(value))) {
        missingRequiredFieldValues.push(expected);
        push(
          "source_found_but_bad_answer",
          "fail",
          `missing required field value${expected.fieldId ? ` for ${expected.fieldId}` : ""}: ${value}`,
        );
        continue;
      }
      if (expected.label && !normalized.includes(normalize(expected.label))) {
        push("table_field_mismatch", "fail", `value ${value} appears without expected field label: ${expected.label}`);
      }
    }
  }

  const hasSourceEvidence =
    Number(context.sourceCount ?? 0) > 0 &&
    (Number(context.evidenceFactCount ?? 0) > 0 || Number(context.evidenceBundleItemCount ?? 0) > 0);
  if (hasSourceEvidence) {
    if (answerLooksLikeNoSource(content)) {
      push("over_aggressive_no_source", "fail", "answer says no source despite available source/evidence");
    }
    if (missingRequiredFieldValues.length > 0) {
      push("source_found_but_bad_answer", "fail", "source/evidence exists but required answer content is missing");
    }
  }

  if (testCase.mustHaveSources === false && Number(context.sourceCount ?? 0) === 0 && context.noSourceExpected === true) {
    if (!answerLooksLikeNoSource(content)) {
      push("ignored_user_constraint", "warn", "no-source response was expected but answer did not clearly say source is unavailable");
    }
  }

  if (Array.isArray(expectations.forbiddenBuckets)) {
    for (const bucket of expectations.forbiddenBuckets) {
      const matched = findings.find((finding) => finding.bucket === bucket);
      if (matched) matched.severity = "fail";
    }
  }

  return findings;
}
