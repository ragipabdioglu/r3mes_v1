import { normalizeConceptText } from "./conceptNormalizer.js";
import { detectRequestedFields, type RequestedField, type RequestedFieldDetection } from "./requestedFieldDetector.js";

export type AnswerTaskType =
  | "conversation"
  | "definition"
  | "list_items"
  | "compare_concepts"
  | "summarize_opinions"
  | "procedure"
  | "field_extraction"
  | "source_grounded_explain"
  | "unknown";

export type AnswerOutputFormat = "bullets" | "short" | "table" | "freeform";

export interface AnswerOutputConstraints {
  maxWords?: number;
  maxSentencesPerBullet?: number;
  forbidCaution: boolean;
  noRawTableDump: boolean;
  format: AnswerOutputFormat;
  sourceGroundedOnly: boolean;
}

export interface TargetDocumentHint {
  kind: "week" | "document" | "source_title";
  value: string;
  confidence: "low" | "medium" | "high";
}

export interface AnswerTaskDetection {
  taskType: AnswerTaskType;
  answerIntent: "steps" | "triage" | "explain" | "compare" | "reassure" | "unknown";
  requestedFields: RequestedField[];
  requestedFieldDetection: RequestedFieldDetection;
  outputConstraints: AnswerOutputConstraints;
  forbiddenAdditions: string[];
  targetDocumentHints: TargetDocumentHint[];
  confidence: "low" | "medium" | "high";
  diagnostics: {
    normalizedQuery: string;
    taskReasons: string[];
    constraintReasons: string[];
  };
}

function normalize(value: string): string {
  return normalizeConceptText(value);
}

function hasAny(normalizedQuery: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(normalizedQuery));
}

function detectOutputFormat(normalizedQuery: string): AnswerOutputFormat {
  if (/\b(madde\w*|maddeli|bullet|liste\w*|sirala|sırala)\b/u.test(normalizedQuery)) return "bullets";
  if (/\b(tablo|table)\b/u.test(normalizedQuery)) return "table";
  if (/\b(kisa|kısa|tek cumle|tek cümle|sadece|ozet|özet)\b/u.test(normalizedQuery)) return "short";
  return "freeform";
}

function detectMaxWords(normalizedQuery: string, format: AnswerOutputFormat): number | undefined {
  if (/\btek cumle|tek cümle\b/u.test(normalizedQuery)) return 32;
  if (/\ben fazla\s+(\d+)\s+(?:kelime|word)\b/u.test(normalizedQuery)) {
    const match = normalizedQuery.match(/\ben fazla\s+(\d+)\s+(?:kelime|word)\b/u);
    const value = Number(match?.[1]);
    if (Number.isFinite(value) && value > 0) return Math.min(240, value);
  }
  if (/\bkisa|kısa|sadece\b/u.test(normalizedQuery)) return 80;
  if (format === "bullets" && /\bher\s+madde\s+en\s+fazla\s+1\s+cumle\b/u.test(normalizedQuery)) return 120;
  return undefined;
}

function detectsCautionSuppression(normalizedQuery: string): boolean {
  return (
    /\b(risk|alarm|uyari|uyarı|yorum|tavsiye|doktor|uzman)\s+(yorumu\s+)?(ekleme|katma|yazma|verme)\b/u.test(normalizedQuery) ||
    /\bsadece\s+(sorulan|rakam|rakamlari|rakamları|sayi|sayı|sayilari|sayıları|deger|değer|tanim|tanım|madde|maddeleri?)\b/u.test(normalizedQuery)
  );
}

function detectTargetDocumentHints(normalizedQuery: string): TargetDocumentHint[] {
  const hints: TargetDocumentHint[] = [];
  for (const match of normalizedQuery.matchAll(/\b(\d{1,2})\s*[.]?\s*hafta\b/gu)) {
    hints.push({ kind: "week", value: `${match[1]}. hafta`, confidence: "high" });
  }
  for (const match of normalizedQuery.matchAll(/\b([a-z0-9_ -]{2,80})\s+(?:dosyasi|dosyası|belgesi|kaynaği|kaynağı)\b/gu)) {
    const value = match[1]?.trim();
    if (value && !/^(bu|hangi|kaynak|ders|not)\b/u.test(value)) {
      hints.push({ kind: "document", value, confidence: "medium" });
    }
  }
  return dedupeHints(hints).slice(0, 6);
}

function dedupeHints(hints: TargetDocumentHint[]): TargetDocumentHint[] {
  const seen = new Set<string>();
  const out: TargetDocumentHint[] = [];
  for (const hint of hints) {
    const key = `${hint.kind}:${hint.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hint);
  }
  return out;
}

function detectTask(normalizedQuery: string, requestedFields: RequestedField[]): {
  taskType: AnswerTaskType;
  answerIntent: AnswerTaskDetection["answerIntent"];
  reasons: string[];
} {
  const reasons: string[] = [];
  if (requestedFields.length > 0) {
    reasons.push("requested_field_match");
    return { taskType: "field_extraction", answerIntent: "explain", reasons };
  }
  if (hasAny(normalizedQuery, [/\b(fark|farki|farkı|karsilastir|karşılaştır|ayni sey mi|aynı şey mi|arasindaki|arasındaki)\b/u])) {
    reasons.push("compare_language");
    return { taskType: "compare_concepts", answerIntent: "compare", reasons };
  }
  if (hasAny(normalizedQuery, [/\b(nelerdir|neler|ozellikleri|özellikleri|bilesenleri|bileşenleri|maddeleri|adimlari|adımları|sirala|sırala|5v)\b/u])) {
    reasons.push("list_language");
    return { taskType: "list_items", answerIntent: "explain", reasons };
  }
  if (hasAny(normalizedQuery, [/\b(nedir|ne demek|tanim|tanım|tanima gore|tanıma göre)\b/u])) {
    reasons.push("definition_language");
    return { taskType: "definition", answerIntent: "explain", reasons };
  }
  if (hasAny(normalizedQuery, [/\b(gorusler|görüşler|genel gorus|genel görüş|ne yonde|ne yönde|yorumlari|yorumları)\b/u])) {
    reasons.push("opinion_summary_language");
    return { taskType: "summarize_opinions", answerIntent: "explain", reasons };
  }
  if (hasAny(normalizedQuery, [/\b(ne yap|nasil|nasıl|hangi adim|hangi adım|basvuru sart|başvuru şart|hazirla|hazırla)\b/u])) {
    reasons.push("procedure_language");
    return { taskType: "procedure", answerIntent: "steps", reasons };
  }
  if (hasAny(normalizedQuery, [/\bkaynaga gore|kaynağa göre|kaynaklara gore|kaynaklara göre|ders notlarina gore|ders notlarına göre\b/u])) {
    reasons.push("source_grounded_language");
    return { taskType: "source_grounded_explain", answerIntent: "explain", reasons };
  }
  return { taskType: "unknown", answerIntent: "unknown", reasons };
}

export function detectAnswerTask(query: string): AnswerTaskDetection {
  const normalizedQuery = normalize(query);
  const requestedFieldDetection = detectRequestedFields(query);
  const task = detectTask(normalizedQuery, requestedFieldDetection.requestedFields);
  const format = detectOutputFormat(normalizedQuery);
  const forbidCaution = requestedFieldDetection.constraints.forbidCaution || detectsCautionSuppression(normalizedQuery);
  const noRawTableDump =
    requestedFieldDetection.constraints.noRawTableDump ||
    task.taskType === "field_extraction" ||
    /\b(ham tablo|raw table|tablo basma|tabloyu basma|sadece)\b/u.test(normalizedQuery);
  const sourceGroundedOnly = /\b(kaynaga gore|kaynağa göre|kaynaklara gore|kaynaklara göre|ders notlarina gore|ders notlarına göre)\b/u.test(normalizedQuery);
  const maxWords = requestedFieldDetection.constraints.maxWords ?? detectMaxWords(normalizedQuery, format);
  const maxSentencesPerBullet = /\bher\s+madde\s+en\s+fazla\s+1\s+cumle\b/u.test(normalizedQuery) ? 1 : undefined;
  const constraintReasons = [
    ...requestedFieldDetection.diagnostics.constraintReasons,
    ...(forbidCaution ? ["forbid_optional_caution"] : []),
    ...(noRawTableDump ? ["no_raw_table_dump"] : []),
    ...(sourceGroundedOnly ? ["source_grounded_only"] : []),
    ...(maxWords ? [`max_words_${maxWords}`] : []),
    ...(maxSentencesPerBullet ? [`max_sentences_per_bullet_${maxSentencesPerBullet}`] : []),
    ...(format !== "freeform" ? [`format_${format}`] : []),
  ];
  const targetDocumentHints = detectTargetDocumentHints(normalizedQuery);
  const confidence: AnswerTaskDetection["confidence"] =
    requestedFieldDetection.requestedFields.length > 0 || task.reasons.length > 0 || targetDocumentHints.length > 0
      ? "high"
      : normalizedQuery.split(/\s+/u).filter(Boolean).length >= 3
        ? "medium"
        : "low";

  return {
    taskType: task.taskType,
    answerIntent: task.answerIntent,
    requestedFields: requestedFieldDetection.requestedFields,
    requestedFieldDetection,
    outputConstraints: {
      maxWords,
      maxSentencesPerBullet,
      forbidCaution,
      noRawTableDump,
      format,
      sourceGroundedOnly,
    },
    forbiddenAdditions: [
      ...(forbidCaution ? ["optional_caution", "risk_commentary"] : []),
      ...(noRawTableDump ? ["raw_table_dump"] : []),
      ...(sourceGroundedOnly ? ["source_external_inference"] : []),
    ],
    targetDocumentHints,
    confidence,
    diagnostics: {
      normalizedQuery,
      taskReasons: task.reasons,
      constraintReasons: [...new Set(constraintReasons)],
    },
  };
}
