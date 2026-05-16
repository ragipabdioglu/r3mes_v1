const RATE_BUCKET_FIELDS = new Map([
  ["raw_table_dump", "rawTableDumpRate"],
  ["table_field_mismatch", "tableFieldMismatchRate"],
  ["unnecessary_warning", "unnecessaryWarningRate"],
  ["over_aggressive_no_source", "overAggressiveNoSourceRate"],
  ["source_found_but_bad_answer", "sourceFoundBadAnswerRate"],
]);

function ratio(numerator, denominator) {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(3));
}

function increment(acc, key, amount = 1) {
  const safeKey = String(key ?? "missing");
  acc[safeKey] = (acc[safeKey] ?? 0) + amount;
  return acc;
}

export function summarizeAnswerQualityTrends(results) {
  const total = results.length;
  const bucketCounts = {};
  const failBucketCounts = {};
  let casesWithFindings = 0;
  let casesWithFailFindings = 0;

  for (const result of results) {
    const findings = Array.isArray(result?.answerQualityFindings) ? result.answerQualityFindings : [];
    if (findings.length > 0) casesWithFindings += 1;
    if (findings.some((finding) => finding?.severity === "fail")) casesWithFailFindings += 1;

    for (const finding of findings) {
      const bucket = finding?.bucket ?? "missing";
      increment(bucketCounts, bucket);
      if (finding?.severity === "fail") increment(failBucketCounts, bucket);
    }
  }

  const failureRatesByBucket = Object.fromEntries(
    Object.entries(failBucketCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, count]) => [bucket, ratio(count, total)]),
  );
  const namedRates = Object.fromEntries(
    [...RATE_BUCKET_FIELDS.entries()].map(([bucket, field]) => [
      field,
      ratio(failBucketCounts[bucket] ?? 0, total),
    ]),
  );

  return {
    total,
    casesWithFindings,
    casesWithFailFindings,
    answerQualityFailureRate: ratio(casesWithFailFindings, total),
    bucketCounts: Object.fromEntries(Object.entries(bucketCounts).sort(([a], [b]) => a.localeCompare(b))),
    failBucketCounts: Object.fromEntries(Object.entries(failBucketCounts).sort(([a], [b]) => a.localeCompare(b))),
    failureRatesByBucket,
    ...namedRates,
  };
}
