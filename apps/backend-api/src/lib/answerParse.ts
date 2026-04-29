import {
  EMPTY_GROUNDED_MEDICAL_ANSWER,
  type AnswerIntent,
  type AnswerDomain,
  type GroundedMedicalAnswer,
  type GroundingConfidence,
} from "./answerSchema.js";

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const direct = trimmed.match(/\{[\s\S]*\}/);
  if (direct?.[0]) return direct[0];

  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  return repairTruncatedJson(trimmed.slice(start));
}

function repairTruncatedJson(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate.startsWith("{")) return null;
  candidate = candidate.replace(/```json|```/gi, "").trim();

  let inString = false;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quoteCount = 0;

  for (const char of candidate) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      quoteCount += 1;
      continue;
    }
    if (inString) continue;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
  }

  let repaired = candidate.replace(/,\s*$/, "");
  if (quoteCount % 2 !== 0) {
    const lastComma = repaired.lastIndexOf(",");
    const lastBrace = repaired.lastIndexOf("{");
    if (lastComma > lastBrace) {
      repaired = repaired.slice(0, lastComma);
      bracketDepth = 0;
      braceDepth = 1;
    } else {
      const lastQuote = repaired.lastIndexOf("\"");
      const previousChar = lastQuote > 0 ? repaired[lastQuote - 1] : "";
      if (lastQuote > 0 && previousChar !== "\\") {
        repaired = repaired.slice(0, lastQuote + 1);
      }
    }
  }
  if (quoteCount % 2 !== 0) repaired += "\"";
  if (bracketDepth > 0) repaired += "]".repeat(bracketDepth);
  if (braceDepth > 0) repaired += "}".repeat(braceDepth);
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  return repaired;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeConfidence(value: unknown): GroundingConfidence {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "high" || raw === "yuksek") return "high";
  if (raw === "medium" || raw === "orta") return "medium";
  return "low";
}

function normalizeDomain(value: unknown): AnswerDomain {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "medical" || raw === "health" || raw === "saglik" || raw === "sağlık") return "medical";
  if (raw === "legal" || raw === "law" || raw === "hukuk") return "legal";
  if (raw === "finance" || raw === "financial" || raw === "finans") return "finance";
  if (raw === "technical" || raw === "tech" || raw === "teknik") return "technical";
  if (raw === "education" || raw === "egitim" || raw === "eğitim") return "education";
  return "general";
}

function normalizeIntent(value: unknown): AnswerIntent {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "reassure" || raw === "calm" || raw === "rahatlat") return "reassure";
  if (raw === "triage" || raw === "risk" || raw === "acil") return "triage";
  if (raw === "explain" || raw === "yorumla" || raw === "açıkla" || raw === "acikla") return "explain";
  if (raw === "steps" || raw === "plan" || raw === "takip" || raw === "adim") return "steps";
  if (raw === "compare" || raw === "karsilastir" || raw === "karşılaştır") return "compare";
  return "unknown";
}

export function parseGroundedMedicalAnswer(raw: string): GroundedMedicalAnswer | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const normalized: GroundedMedicalAnswer = {
      answer_domain: normalizeDomain(parsed.answer_domain),
      answer_intent: normalizeIntent(parsed.answer_intent),
      grounding_confidence: normalizeConfidence(parsed.grounding_confidence),
      user_query: normalizeString(parsed.user_query),
      answer: normalizeString(parsed.answer),
      condition_context: normalizeString(parsed.condition_context),
      safe_action: normalizeString(parsed.safe_action),
      visit_triggers: normalizeStringArray(parsed.visit_triggers),
      one_sentence_summary: normalizeString(parsed.one_sentence_summary),
      general_assessment: normalizeString(parsed.general_assessment),
      recommended_action: normalizeString(parsed.recommended_action),
      doctor_visit_when: normalizeStringArray(parsed.doctor_visit_when),
      red_flags: normalizeStringArray(parsed.red_flags),
      avoid_inference: normalizeStringArray(parsed.avoid_inference),
      short_summary: normalizeString(parsed.short_summary),
      used_source_ids: normalizeStringArray(parsed.used_source_ids),
    };

    const hasAnyContent =
      normalized.answer ||
      normalized.condition_context ||
      normalized.safe_action ||
      normalized.visit_triggers.length > 0 ||
      normalized.one_sentence_summary ||
      normalized.general_assessment ||
      normalized.recommended_action ||
      normalized.doctor_visit_when.length > 0 ||
      normalized.red_flags.length > 0 ||
      normalized.short_summary;

    return hasAnyContent ? normalized : { ...EMPTY_GROUNDED_MEDICAL_ANSWER, grounding_confidence: normalized.grounding_confidence };
  } catch {
    return null;
  }
}
