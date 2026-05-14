const REPEATED_WORD_PATTERN = /\b([\p{L}\p{N}]{3,})(?:\s+\1){2,}\b/giu;
const REPEATED_PHRASE_PATTERN = /\b((?:[\p{L}\p{N}]{2,}\s+){1,3}[\p{L}\p{N}]{2,})(?:\s+\1){1,}\b/giu;
const FOREIGN_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/u;

const GENERAL_REPAIRS: Array<[RegExp, string]> = [
  [/\bkontrolu\b/giu, "kontrolü"],
  [/\bcevabiniz\b/giu, "cevabınız"],
  [/\bagri\b/giu, "ağrı"],
  [/\bagris[iı]\b/giu, "ağrısı"],
  [/\bkasik\b/giu, "kasık"],
  [/\bdegerlendirme\b/giu, "değerlendirme"],
  [/\bdegerlendirilmelidir\b/giu, "değerlendirilmelidir"],
  [/\bdoktorunuzla görüşmenin gerekli olduğunu düşünebilirsiniz\b/giu, "doktorunuzla görüşmeniz uygun olur"],
  [/\bdaha fazla izin vermeniz gerekebilir\b/giu, "yeniden değerlendirme gerekebilir"],
  [/\bher şeyi her şeyi\b/giu, "bunları"],
  [/\bherşeyi\b/giu, "her şeyi"],
];

const AWKWARD_PHRASE_REPAIRS: Array<[RegExp, string]> = [
  [/\bkasık ağını\b/giu, "kasık ağrısını"],
  [/\bkasık ağına\b/giu, "kasık ağrısına"],
  [/\bkasık ağı\b/giu, "kasık ağrısı"],
  [/\bkasık ağınlamanızdan\b/giu, "kasık ağrınızdan"],
  [/\bTemizlik sonucu\b/gu, "Temiz sonuç"],
  [/\btemizlik sonucu\b/gu, "temiz sonuç"],
];

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTransportArtifacts(text: string): string {
  return text
    .replace(/^```(?:json|text)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .replace(/^Yanıt\s*:?\s*/iu, "")
    .replace(/\s*[•]\s*/gu, ", ")
    .replace(/:\s*,\s*/gu, ": ")
    .replace(/\bve,\s+/giu, "ve ")
    .replace(/,\s*([.!?])/gu, "$1")
    .trim();
}

function repairRepeatedWords(text: string): string {
  return text.replace(REPEATED_WORD_PATTERN, "$1").replace(REPEATED_PHRASE_PATTERN, "$1");
}

function trimIncompleteTrailingSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /[.!?…]$/u.test(trimmed)) return trimmed;
  const lastPunctuation = Math.max(
    trimmed.lastIndexOf("."),
    trimmed.lastIndexOf("!"),
    trimmed.lastIndexOf("?"),
    trimmed.lastIndexOf("…"),
  );
  if (lastPunctuation < 40) return trimmed;
  return trimmed.slice(0, lastPunctuation + 1).trim();
}

export function polishAnswerText(text: string): string {
  let out = normalizeWhitespace(stripTransportArtifacts(text));
  for (const [pattern, replacement] of GENERAL_REPAIRS) {
    out = out.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of AWKWARD_PHRASE_REPAIRS) {
    out = out.replace(pattern, replacement);
  }
  return normalizeWhitespace(trimIncompleteTrailingSentence(repairRepeatedWords(out)));
}

export function hasLowLanguageQuality(text: string): boolean {
  REPEATED_WORD_PATTERN.lastIndex = 0;
  REPEATED_PHRASE_PATTERN.lastIndex = 0;
  const hasRepeatedWords = REPEATED_WORD_PATTERN.test(text);
  const hasRepeatedPhrases = REPEATED_PHRASE_PATTERN.test(text);
  const rawNormalized = text.toLocaleLowerCase("tr-TR");
  const normalized = polishAnswerText(text).toLocaleLowerCase("tr-TR");
  if (!normalized) return true;
  if (hasRepeatedWords || hasRepeatedPhrases) return true;
  if (FOREIGN_SCRIPT_PATTERN.test(text)) return true;
  const badSignals = [
    "daha fazla izin vermeniz",
    "kasık ağı",
    "kasık ağını",
    "ağınlamanız",
    "endüzi",
    "翻译错误",
    "运动",
  ];
  return badSignals.some((signal) => rawNormalized.includes(signal) || normalized.includes(signal));
}
