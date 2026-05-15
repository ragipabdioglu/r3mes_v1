import type { KnowledgeChunkDraft, KnowledgeSourceType } from "./knowledgeText.js";

export type KnowledgeParseQualityLevel = "clean" | "usable" | "noisy";

export interface KnowledgeParseQuality {
  score: number;
  level: KnowledgeParseQualityLevel;
  warnings: string[];
  signals: {
    textLength: number;
    chunkCount: number;
    averageChunkChars: number;
    replacementCharRatio: number;
    mojibakeMarkerCount: number;
    controlCharRatio: number;
    symbolRatio: number;
    shortLineRatio: number;
    structureSignalCount: number;
    tableSignalCount: number;
    numericDensity: number;
    ocrRiskScore: number;
  };
}

const MOJIBAKE_MARKERS = /[ÄÅÃÂÐÞþð]/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const STRUCTURE_PATTERNS = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /\|[^|\n]+\|/,
  /\b(topic|tags|summary|soru|cevap|kaynak|madde|risk|özet|ozet)\s*:/iu,
];
const TABLE_PATTERNS = [
  /\|[^|\n]+\|[^|\n]+\|/,
  /^\s*[^\n|;]+(?:[;,\t]\s*[^\n|;]+){3,}$/m,
  /\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:TL|TRY|USD|EUR|%)\b/iu,
  /\b(?:gelir|gider|aktif|pasif|kar|zarar|özkaynak|ozkaynak|nakit|hasılat|hasilat)\b/iu,
];

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function structureSignalCount(text: string, sourceType: KnowledgeSourceType): number {
  const base = STRUCTURE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  return sourceType === "JSON" ? base + 1 : base;
}

function tableSignalCount(text: string): number {
  return TABLE_PATTERNS.filter((pattern) => pattern.test(text)).length;
}

function qualityLevel(score: number): KnowledgeParseQualityLevel {
  if (score >= 76) return "clean";
  if (score >= 48) return "usable";
  return "noisy";
}

export function scoreKnowledgeParseQuality(opts: {
  filename: string;
  sourceType: KnowledgeSourceType;
  text: string;
  chunks: KnowledgeChunkDraft[];
}): KnowledgeParseQuality {
  const text = opts.text.trim();
  const textLength = text.length;
  const chunkCount = opts.chunks.length;
  const averageChunkChars =
    chunkCount > 0
      ? opts.chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunkCount
      : 0;
  const replacementCharRatio = ratio(countMatches(text, /\uFFFD/g), textLength);
  const mojibakeMarkerCount = countMatches(text, MOJIBAKE_MARKERS);
  const controlCharRatio = ratio(countMatches(text, CONTROL_CHARS), textLength);
  const symbolRatio = ratio(countMatches(text, /[^\p{L}\p{N}\s.,;:!?()[\]{}'"%/@#\-+_=|]/gu), textLength);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const shortLineRatio = ratio(lines.filter((line) => line.length <= 18).length, lines.length);
  const structureSignals = structureSignalCount(text, opts.sourceType);
  const tableSignals = tableSignalCount(text);
  const numericDensity = ratio(countMatches(text, /\d/g), textLength);
  const ocrRiskScore = Math.min(
    100,
    Math.round(
      replacementCharRatio * 10000
        + mojibakeMarkerCount * 3
        + controlCharRatio * 4000
        + Math.max(0, symbolRatio - 0.08) * 300,
    ),
  );

  const warnings: string[] = [];
  let score = 72;

  if (opts.sourceType === "JSON" || opts.sourceType === "MARKDOWN") score += 5;
  if (structureSignals >= 2) score += 10;
  else if (structureSignals === 1) score += 4;
  if (tableSignals >= 2) {
    score += 5;
    warnings.push("table_like_content");
  }

  if (textLength < 160) {
    score -= 26;
    warnings.push("very_short_text");
  } else if (textLength < 420) {
    score -= 10;
  }

  if (chunkCount === 0) {
    score -= 42;
    warnings.push("no_chunks");
  } else if (chunkCount === 1 && averageChunkChars < 260) {
    score -= 14;
    warnings.push("single_tiny_chunk");
  }

  if (replacementCharRatio > 0.001) {
    score -= 30;
    warnings.push("replacement_char_detected");
  }

  if (mojibakeMarkerCount >= 8) {
    score -= 28;
    warnings.push("mojibake_detected");
  } else if (mojibakeMarkerCount >= 3) {
    score -= 14;
    warnings.push("possible_mojibake");
  }

  if (controlCharRatio > 0.002) {
    score -= 18;
    warnings.push("high_control_char_ratio");
  }

  if (symbolRatio > 0.08) {
    score -= 16;
    warnings.push("high_symbol_noise");
  }

  if (shortLineRatio > 0.58 && lines.length >= 8) {
    score -= 12;
    warnings.push("fragmented_lines");
  }

  if (ocrRiskScore >= 35) {
    warnings.push("ocr_risk_high");
  } else if (ocrRiskScore >= 12) {
    warnings.push("ocr_risk_medium");
  }

  if (numericDensity > 0.18 && tableSignals === 0 && textLength > 400) {
    score -= 8;
    warnings.push("dense_numbers_without_table_structure");
  }

  if (structureSignals === 0 && textLength > 700) {
    score -= 6;
    warnings.push("low_structural_signal");
  }

  return {
    score: clampScore(score),
    level: qualityLevel(clampScore(score)),
    warnings: [...new Set(warnings)],
    signals: {
      textLength,
      chunkCount,
      averageChunkChars: Math.round(averageChunkChars),
      replacementCharRatio: Number(replacementCharRatio.toFixed(5)),
      mojibakeMarkerCount,
      controlCharRatio: Number(controlCharRatio.toFixed(5)),
      symbolRatio: Number(symbolRatio.toFixed(5)),
      shortLineRatio: Number(shortLineRatio.toFixed(5)),
      structureSignalCount: structureSignals,
      tableSignalCount: tableSignals,
      numericDensity: Number(numericDensity.toFixed(5)),
      ocrRiskScore,
    },
  };
}
