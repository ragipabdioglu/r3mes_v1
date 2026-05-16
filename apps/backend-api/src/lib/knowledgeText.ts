import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createKnowledgeParserRegistry,
  type KnowledgeExternalParserProfile,
  type KnowledgeParserAdapter,
  type KnowledgeParserCapability,
  type KnowledgeParserRegistryEntry,
  type KnowledgeSourceType,
} from "./parserRegistry.js";
import { parseCsvSpreadsheet } from "./spreadsheetKnowledgeParser.js";
import type { StructuredDocumentArtifact } from "./structuredDocumentArtifact.js";

export type {
  KnowledgeExternalParserProfile,
  KnowledgeParserAdapter,
  KnowledgeParserCapability,
  KnowledgeParserHealth,
  KnowledgeParserInputMode,
  KnowledgeSourceType,
} from "./parserRegistry.js";

export type DocumentArtifactKind =
  | "title"
  | "heading"
  | "paragraph"
  | "definition"
  | "list"
  | "table"
  | "qa"
  | "url"
  | "footer"
  | "page_marker"
  | "image_caption";

export interface DocumentArtifact {
  id: string;
  kind: DocumentArtifactKind;
  text: string;
  title?: string | null;
  page?: number | null;
  level?: number | null;
  items?: string[];
  metadata?: Record<string, unknown>;
  answerabilityScore: number;
}

export interface ParsedKnowledgeDocument {
  sourceType: KnowledgeSourceType;
  text: string;
  artifacts: DocumentArtifact[];
  structuredArtifacts?: StructuredDocumentArtifact[];
  parser: {
    id: string;
    version: number;
  };
  diagnostics: {
    originalBytes: number;
    normalizedChars: number;
    warnings: string[];
  };
}

export function getKnowledgeExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function parsedDocument(opts: {
  adapter: KnowledgeParserAdapter<ParsedKnowledgeDocument>;
  text: string;
  originalBytes: number;
  sourceType?: KnowledgeSourceType;
  artifacts?: DocumentArtifact[];
  structuredArtifacts?: StructuredDocumentArtifact[];
  warnings?: string[];
}): ParsedKnowledgeDocument {
  const sourceType = opts.sourceType ?? opts.adapter.sourceType;
  const text = normalizeParsedKnowledgeText(opts.text, sourceType).trim();
  if (!text) {
    throw new Error("Boş bilgi dosyası yüklenemez");
  }
  return {
    sourceType,
    text,
    artifacts: normalizeDocumentArtifacts(opts.artifacts, text, sourceType),
    structuredArtifacts: opts.structuredArtifacts,
    parser: {
      id: opts.adapter.id,
      version: opts.adapter.version,
    },
    diagnostics: {
      originalBytes: opts.originalBytes,
      normalizedChars: text.length,
      warnings: opts.warnings ?? [],
    },
  };
}

const INGESTION_GENERIC_STRUCTURE_LABELS = [
  "Topic",
  "Tags",
  "Source Summary",
  "Key Takeaway",
  "Başlık",
  "Etiketler",
  "Temel Bilgi",
  "Soru",
  "Cevap",
  "Kaynak",
  "Özet",
  "Ozet",
];
const LEGACY_DOMAIN_CARD_STRUCTURE_LABELS = [
  "Patient Summary",
  "Clinical Takeaway",
  "Safe Guidance",
  "Red Flags",
  "Do Not Infer",
  "Triage",
  "Uyarı Bulguları",
  "Çıkarım Yapma",
];
const MARKDOWN_TABLE_LINE_PATTERN = /^\s*\|.*\|\s*$/u;
const MARKDOWN_TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;

function hasKnownStructureLabel(line: string): boolean {
  const labels = [...INGESTION_GENERIC_STRUCTURE_LABELS, ...LEGACY_DOMAIN_CARD_STRUCTURE_LABELS];
  return labels.some((label) => line.toLocaleLowerCase("tr-TR").startsWith(`${label.toLocaleLowerCase("tr-TR")}:`));
}

function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    !trimmed ||
    /^#{1,6}\s+\S/u.test(trimmed) ||
    /^[-*]\s+\S/u.test(trimmed) ||
    /^\d+[.)]\s+\S/u.test(trimmed) ||
    hasKnownStructureLabel(trimmed) ||
    MARKDOWN_TABLE_LINE_PATTERN.test(trimmed) ||
    MARKDOWN_TABLE_SEPARATOR_PATTERN.test(trimmed)
  );
}

function shouldJoinSoftWrappedLine(previous: string, next: string): boolean {
  const left = previous.trim();
  const right = next.trim();
  if (!left || !right) return false;
  if (isStructuralLine(left) || isStructuralLine(right)) return false;
  if (/[.!?:;)]$/u.test(left)) return false;
  if (/^[A-ZÇĞİÖŞÜ0-9][\p{L}\p{N}\s-]{0,48}:$/u.test(right)) return false;
  return true;
}

function joinSoftWrappedLines(text: string): string {
  const output: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/u, "");
    if (output.length === 0) {
      output.push(line.trim());
      continue;
    }
    const previous = output[output.length - 1] ?? "";
    if (shouldJoinSoftWrappedLine(previous, line)) {
      output[output.length - 1] = previous.endsWith("-")
        ? `${previous.slice(0, -1)}${line.trimStart()}`
        : `${previous} ${line.trimStart()}`;
    } else {
      output.push(line.trim());
    }
  }
  return output.join("\n");
}

export function normalizeParsedKnowledgeText(text: string, sourceType: KnowledgeSourceType): string {
  if (sourceType === "JSON") return text.trim();
  return joinSoftWrappedLines(
    text
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\f+/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n"),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sourceTypeForExtension(filename: string): KnowledgeSourceType {
  const ext = getKnowledgeExtension(filename);
  if (ext === ".pdf") return "PDF";
  if (ext === ".docx") return "DOCX";
  if (ext === ".pptx") return "PPTX";
  if (ext === ".html" || ext === ".htm") return "HTML";
  if (ext === ".md") return "MARKDOWN";
  if (ext === ".json") return "JSON";
  return "TEXT";
}

function normalizeSourceType(value: unknown, fallback: KnowledgeSourceType): KnowledgeSourceType {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "TEXT" || raw === "MARKDOWN" || raw === "JSON" || raw === "PDF" || raw === "DOCX" || raw === "PPTX" || raw === "HTML") {
    return raw;
  }
  return fallback;
}

function normalizeArtifactKind(value: unknown): DocumentArtifactKind {
  const raw = String(value ?? "").trim().toLowerCase();
  if (
    raw === "title" ||
    raw === "heading" ||
    raw === "paragraph" ||
    raw === "definition" ||
    raw === "list" ||
    raw === "table" ||
    raw === "qa" ||
    raw === "url" ||
    raw === "footer" ||
    raw === "page_marker" ||
    raw === "image_caption"
  ) return raw;
  return "paragraph";
}

function normalizeArtifactMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return { ...(value as Record<string, unknown>) };
}

function stableDocumentArtifactId(artifact: DocumentArtifact): string {
  const provided = artifact.id.trim();
  if (provided) return provided;
  const basis = JSON.stringify({
    kind: normalizeArtifactKind(artifact.kind),
    text: String(artifact.text ?? "").trim(),
    title: artifact.title ?? null,
    page: artifact.page ?? null,
    level: artifact.level ?? null,
    items: artifact.items ?? [],
    metadata: normalizeArtifactMetadata(artifact.metadata) ?? null,
  });
  return `artifact-${createHash("sha256").update(basis, "utf8").digest("hex").slice(0, 16)}`;
}

function artifactAnswerabilityScore(kind: DocumentArtifactKind, text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (kind === "definition") return 92;
  if (kind === "table" || kind === "list" || kind === "qa") return 84;
  if (kind === "paragraph") return 68;
  if (kind === "heading" || kind === "title") return 28;
  if (kind === "url" || kind === "footer" || kind === "page_marker") return 4;
  return 45;
}

function cleanArtifactText(value: string): string {
  return normalizeParsedKnowledgeText(value, "MARKDOWN")
    .replace(/^#{1,6}\s*/u, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => !isLowValueDocumentLine(line))
    .join("\n")
    .trim();
}

function normalizeDocumentArtifacts(
  artifacts: DocumentArtifact[] | undefined,
  fallbackText: string,
  sourceType: KnowledgeSourceType,
): DocumentArtifact[] {
  const source = artifacts && artifacts.length > 0 ? artifacts : inferDocumentArtifactsFromText(fallbackText);
  const shouldReclassifyScaffold =
    sourceType === "PDF" || sourceType === "DOCX" || sourceType === "PPTX" || sourceType === "HTML";
  const out: DocumentArtifact[] = [];
  const usedIds = new Map<string, number>();
  for (const artifact of source) {
    const text = cleanArtifactText(String(artifact.text ?? ""));
    if (!text) continue;
    const rawKind = normalizeArtifactKind(artifact.kind);
    const kind = shouldReclassifyScaffold && rawKind === "paragraph" && isLikelyStandaloneHeading(text)
      ? "heading"
      : rawKind;
    const baseId = stableDocumentArtifactId({ ...artifact, kind, text });
    const idUseCount = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, idUseCount + 1);
    out.push({
      id: idUseCount === 0 ? baseId : `${baseId}-${idUseCount + 1}`,
      kind,
      text,
      title: artifact.title ?? null,
      page: typeof artifact.page === "number" ? artifact.page : null,
      level: typeof artifact.level === "number" ? artifact.level : null,
      items: Array.isArray(artifact.items) ? artifact.items.map((item) => cleanArtifactText(String(item))).filter(Boolean) : undefined,
      metadata: normalizeArtifactMetadata(artifact.metadata),
      answerabilityScore: Math.max(0, Math.min(100, Math.round(
        typeof artifact.answerabilityScore === "number"
          ? artifact.answerabilityScore
          : artifactAnswerabilityScore(kind, text),
      ))),
    });
  }
  return out;
}

const TEXT_PARSER: KnowledgeParserAdapter<ParsedKnowledgeDocument> = {
  id: "plain-text-v1",
  version: 1,
  sourceType: "TEXT",
  extensions: [".txt"],
  inputMode: "utf8",
  parse: ({ buffer, raw }) =>
    parsedDocument({
      adapter: TEXT_PARSER,
      text: raw,
      originalBytes: buffer.length,
    }),
};

const MARKDOWN_PARSER: KnowledgeParserAdapter<ParsedKnowledgeDocument> = {
  id: "markdown-v1",
  version: 1,
  sourceType: "MARKDOWN",
  extensions: [".md"],
  inputMode: "utf8",
  parse: ({ buffer, raw }) =>
    parsedDocument({
      adapter: MARKDOWN_PARSER,
      text: raw,
      originalBytes: buffer.length,
    }),
};

const JSON_PARSER: KnowledgeParserAdapter<ParsedKnowledgeDocument> = {
  id: "json-normalized-v1",
  version: 1,
  sourceType: "JSON",
  extensions: [".json"],
  inputMode: "utf8",
  parse: ({ buffer, raw }) =>
    parsedDocument({
      adapter: JSON_PARSER,
      text: JSON.stringify(JSON.parse(raw) as unknown, null, 2),
      originalBytes: buffer.length,
    }),
};

const CSV_PARSER: KnowledgeParserAdapter<ParsedKnowledgeDocument> = {
  id: "csv-spreadsheet-v1",
  version: 1,
  sourceType: "TEXT",
  extensions: [".csv"],
  inputMode: "utf8",
  parse: ({ filename, buffer, raw }) => {
    const parsed = parseCsvSpreadsheet(raw, filename);
    return parsedDocument({
      adapter: CSV_PARSER,
      text: parsed.text,
      originalBytes: buffer.length,
      artifacts: parsed.artifacts,
      structuredArtifacts: parsed.structuredArtifacts,
      warnings: parsed.warnings,
    });
  },
};

const BUILT_IN_KNOWLEDGE_PARSERS: KnowledgeParserAdapter<ParsedKnowledgeDocument>[] = [
  TEXT_PARSER,
  MARKDOWN_PARSER,
  JSON_PARSER,
  CSV_PARSER,
];

function isLikelyUrlLine(line: string): boolean {
  return /^https?:\/\/\S+$/iu.test(line.trim());
}

function isLikelyFooterLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^page\s+\d+$/iu.test(trimmed) ||
    /^#{0,6}\s*page\s+\d+$/iu.test(trimmed) ||
    /^hafta\s+\d+(?:\s*[-–]\s*\d+)?$/iu.test(trimmed) ||
    (trimmed.length <= 140 &&
      /\b(?:ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\s+20\d{2}\b/iu.test(trimmed)) ||
    /^[\p{L}\p{N}\s._-]{2,80}\s+(?:mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\s+20\d{2}$/iu.test(trimmed)
  );
}

function isLowValueDocumentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    /^©\s*copyright\b/iu.test(trimmed) ||
    /^copyright\s+20\d{2}\b/iu.test(trimmed) ||
    /^her hakk[ıi] sakl[ıi]d[ıi]r\.?$/iu.test(trimmed) ||
    /^all rights reserved\.?$/iu.test(trimmed) ||
    isLikelyFooterLine(trimmed) ||
    isLikelyUrlLine(trimmed)
  );
}

function isLikelyDefinition(text: string): boolean {
  const normalized = text.toLocaleLowerCase("tr-TR");
  return /\b(?:nedir|ne demek|denir|ifade eder|tanımlanır|tanimlanir|bütünüdür|butunudur)\b/u.test(normalized);
}

function isLikelyStandaloneHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 180 || isLikelyDefinition(trimmed)) return false;
  const lines = trimmed.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 3) return false;
  if (lines.some((line) => line.length > 90)) return false;
  const withoutDecorators = trimmed.replace(/[*•#-]+/gu, " ");
  const withoutDecimalDots = withoutDecorators.replace(/\d+\.\d+/gu, "");
  if (/[.!?;:]/u.test(withoutDecimalDots)) return false;
  const words = withoutDecorators.split(/\s+/u).filter(Boolean);
  return words.length >= 1 && words.length <= 12;
}

function isMarkdownTableLike(text: string): boolean {
  return text.split(/\r?\n/).some((line) => MARKDOWN_TABLE_LINE_PATTERN.test(line));
}

function flushArtifactBlock(opts: {
  artifacts: DocumentArtifact[];
  lines: string[];
  kind?: DocumentArtifactKind;
  title?: string | null;
  page?: number | null;
  level?: number | null;
}): void {
  const text = opts.lines.join("\n").trim();
  if (!text) return;
  const kind = opts.kind ?? (isMarkdownTableLike(text) ? "table" : isLikelyDefinition(text) ? "definition" : "paragraph");
  opts.artifacts.push({
    id: `artifact-${opts.artifacts.length}`,
    kind,
    text,
    title: opts.title ?? null,
    page: opts.page ?? null,
    level: opts.level ?? null,
    answerabilityScore: artifactAnswerabilityScore(kind, text),
  });
  opts.lines.length = 0;
}

export function inferDocumentArtifactsFromText(text: string): DocumentArtifact[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const artifacts: DocumentArtifact[] = [];
  let currentLines: string[] = [];
  let currentTitle: string | null = null;
  let currentPage: number | null = null;
  let currentLevel: number | null = null;

  const flush = () => flushArtifactBlock({
    artifacts,
    lines: currentLines,
    title: currentTitle,
    page: currentPage,
    level: currentLevel,
  });

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    const pageMatch = line.match(/^#{0,6}\s*Page\s+(\d+)\s*$/iu);
    if (pageMatch) {
      flush();
      currentPage = Number.parseInt(pageMatch[1] ?? "0", 10) || currentPage;
      artifacts.push({
        id: `artifact-${artifacts.length}`,
        kind: "page_marker",
        text: line.replace(/^#+\s*/u, ""),
        page: currentPage,
        title: currentTitle,
        answerabilityScore: 2,
      });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/u);
    if (headingMatch) {
      flush();
      currentLevel = headingMatch[1]?.length ?? 1;
      currentTitle = cleanArtifactText(headingMatch[2] ?? line);
      artifacts.push({
        id: `artifact-${artifacts.length}`,
        kind: currentLevel === 1 ? "title" : "heading",
        text: currentTitle,
        title: currentTitle,
        page: currentPage,
        level: currentLevel,
        answerabilityScore: currentLevel === 1 ? 24 : 30,
      });
      continue;
    }

    if (isLikelyUrlLine(line)) {
      flush();
      artifacts.push({
        id: `artifact-${artifacts.length}`,
        kind: "url",
        text: line,
        title: currentTitle,
        page: currentPage,
        answerabilityScore: 1,
      });
      continue;
    }

    if (isLikelyFooterLine(line)) {
      flush();
      artifacts.push({
        id: `artifact-${artifacts.length}`,
        kind: "footer",
        text: line,
        title: currentTitle,
        page: currentPage,
        answerabilityScore: 3,
      });
      continue;
    }

    currentLines.push(line);
  }
  flush();

  return artifacts.length > 0
    ? artifacts
    : [{
        id: "artifact-0",
        kind: "paragraph",
        text: normalized.trim(),
        title: null,
        page: null,
        answerabilityScore: artifactAnswerabilityScore("paragraph", normalized),
      }];
}

function splitCommandLineArgs(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;

  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) args.push(current);
  return args;
}

function externalParserTimeoutMs(): number {
  const value = Number.parseInt(process.env.R3MES_DOCUMENT_PARSER_TIMEOUT_MS ?? "30000", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 120000) : 30000;
}

function externalParserProfile(): KnowledgeExternalParserProfile {
  const raw = process.env.R3MES_DOCUMENT_PARSER_PROFILE?.trim().toLowerCase();
  if (raw === "docling" || raw === "marker") return raw;
  return "external";
}

function missingExternalParserReason(profile: KnowledgeExternalParserProfile): string {
  if (profile === "docling") {
    return "External document parser is not configured; docling profile expects a local parser bridge for structured PDF/DOCX/PPTX/HTML output";
  }
  if (profile === "marker") {
    return "External document parser is not configured; marker profile expects a local parser bridge for structured PDF/DOCX/PPTX/HTML output";
  }
  return "External document parser is not configured for PDF/DOCX/PPTX/HTML";
}

function externalParserArgs(inputPath: string): string[] {
  const template = process.env.R3MES_DOCUMENT_PARSER_ARGS?.trim() || "{input}";
  return splitCommandLineArgs(template).map((arg) => arg.replaceAll("{input}", inputPath));
}

function externalDocumentParser(): KnowledgeParserAdapter<ParsedKnowledgeDocument> | null {
  const command = process.env.R3MES_DOCUMENT_PARSER_COMMAND?.trim();
  if (!command) return null;
  const adapter: KnowledgeParserAdapter<ParsedKnowledgeDocument> = {
    id: "external-document-parser-v1",
    version: 1,
    sourceType: "PDF",
    sourceTypeForFilename: sourceTypeForExtension,
    extensions: [".pdf", ".docx", ".pptx", ".html", ".htm"],
    inputMode: "binary",
    parse: ({ filename, buffer }) => {
      const ext = getKnowledgeExtension(filename) || ".bin";
      const tempDir = mkdtempSync(join(tmpdir(), "r3mes-doc-parse-"));
      const inputPath = join(tempDir, `input${ext}`);
      try {
        writeFileSync(inputPath, buffer);
        const result = spawnSync(command, externalParserArgs(inputPath), {
          encoding: "utf8",
          timeout: externalParserTimeoutMs(),
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
        if (result.error) {
          throw new Error("External document parser could not be executed; check parser configuration");
        }
        if (result.status !== 0) {
          throw new Error(`External document parser failed with exit code ${result.status ?? "unknown"}; check parser logs`);
        }
        const parsedOutput = parseExternalParserOutput(String(result.stdout ?? ""), filename);
        const warnings = [
          ...(String(result.stderr ?? "").trim() ? ["external_parser_stderr"] : []),
          ...parsedOutput.warnings,
        ];
        return parsedDocument({
          adapter,
          sourceType: parsedOutput.sourceType,
          text: parsedOutput.text,
          artifacts: parsedOutput.artifacts,
          originalBytes: buffer.length,
          warnings,
        });
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
  return adapter;
}

function parseExternalParserOutput(stdout: string, filename: string): {
  sourceType: KnowledgeSourceType;
  text: string;
  artifacts?: DocumentArtifact[];
  warnings: string[];
} {
  const trimmed = stdout.trim();
  const fallbackSourceType = sourceTypeForExtension(filename);
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        sourceType?: unknown;
        text?: unknown;
        markdown?: unknown;
        artifacts?: unknown;
      };
      const sourceType = normalizeSourceType(parsed.sourceType, fallbackSourceType);
      const text = String(parsed.text ?? parsed.markdown ?? "").trim();
      const rawArtifacts = Array.isArray(parsed.artifacts) ? parsed.artifacts : [];
      const artifacts: DocumentArtifact[] = [];
      for (const item of rawArtifacts) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const textValue = String(record.text ?? "").trim();
          if (!textValue) continue;
          artifacts.push({
            id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : "",
            kind: normalizeArtifactKind(record.kind),
            text: textValue,
            title: typeof record.title === "string" ? record.title : null,
            page: typeof record.page === "number" ? record.page : null,
            level: typeof record.level === "number" ? record.level : null,
            items: Array.isArray(record.items) ? record.items.map((value) => String(value)) : undefined,
            metadata: normalizeArtifactMetadata(record.metadata),
            answerabilityScore: typeof record.answerabilityScore === "number"
              ? record.answerabilityScore
              : artifactAnswerabilityScore(normalizeArtifactKind(record.kind), textValue),
          });
      }
      if (text) {
        return {
          sourceType: sourceType === "TEXT" ? fallbackSourceType : sourceType,
          text,
          artifacts,
          warnings: [],
        };
      }
      return {
        sourceType: sourceType === "TEXT" ? fallbackSourceType : sourceType,
        text: trimmed,
        artifacts: inferDocumentArtifactsFromText(trimmed),
        warnings: ["external_parser_json_missing_text"],
      };
    } catch {
      // Keep compatibility with legacy parser commands that print Markdown.
    }
  }
  return {
    sourceType: fallbackSourceType,
    text: trimmed,
    artifacts: inferDocumentArtifactsFromText(trimmed),
    warnings: [],
  };
}

function builtInParserEntries(): KnowledgeParserRegistryEntry<ParsedKnowledgeDocument>[] {
  return BUILT_IN_KNOWLEDGE_PARSERS.map((parser) => ({
    adapter: parser,
    capability: {
      id: parser.id,
      version: parser.version,
      sourceType: parser.sourceType,
      sourceTypes: [parser.sourceType],
      extensions: [...parser.extensions],
      mimeTypes: parser.id === "csv-spreadsheet-v1" ? ["text/csv", "application/csv", "text/plain"] : builtInParserMimeTypes(parser.sourceType),
      inputMode: parser.inputMode,
      available: true,
      kind: "built_in" as const,
      health: "ready" as const,
      priority: parser.id === "csv-spreadsheet-v1" ? 85 : builtInParserPriority(parser.sourceType),
      supportsTables: parser.sourceType === "MARKDOWN" || parser.id === "csv-spreadsheet-v1",
      supportsOcr: false,
      supportsSpreadsheets: parser.id === "csv-spreadsheet-v1",
      outputSchemaVersion: 1,
      reason: null,
    },
  }));
}

function builtInParserMimeTypes(sourceType: KnowledgeSourceType): string[] {
  if (sourceType === "TEXT") return ["text/plain"];
  if (sourceType === "MARKDOWN") return ["text/markdown", "text/x-markdown"];
  if (sourceType === "JSON") return ["application/json"];
  return [];
}

function builtInParserPriority(sourceType: KnowledgeSourceType): number {
  if (sourceType === "JSON") return 80;
  if (sourceType === "MARKDOWN") return 70;
  return 60;
}

function xlsxParserCapability(): KnowledgeParserCapability {
  const intakeFlagEnabled = process.env.R3MES_ENABLE_XLSX_INTAKE === "1";
  return {
    id: "xlsx-spreadsheet-parser-v1",
    version: 1,
    sourceType: "TEXT",
    sourceTypes: ["TEXT"],
    extensions: [".xlsx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    inputMode: "binary",
    available: false,
    kind: "built_in",
    health: "unavailable",
    priority: 40,
    supportsTables: true,
    supportsOcr: false,
    supportsSpreadsheets: true,
    outputSchemaVersion: 1,
    reason: intakeFlagEnabled
      ? "XLSX intake validation is enabled, but no XLSX parser dependency is configured in this build."
      : "XLSX intake is behind R3MES_ENABLE_XLSX_INTAKE and parsing is unavailable without an XLSX parser dependency.",
  };
}

function externalParserCapability(): KnowledgeParserCapability {
  const externalConfigured = Boolean(process.env.R3MES_DOCUMENT_PARSER_COMMAND?.trim());
  const profile = externalParserProfile();
  const sourceTypes: KnowledgeSourceType[] = ["PDF", "DOCX", "PPTX", "HTML"];
  return {
    id: "external-document-parser-v1",
    version: 1,
    sourceType: "PDF",
    sourceTypes,
    extensions: [".pdf", ".docx", ".pptx", ".html", ".htm"],
    mimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/html",
      "application/xhtml+xml",
    ],
    inputMode: "binary",
    available: externalConfigured,
    kind: "external",
    profile,
    reason: externalConfigured ? null : missingExternalParserReason(profile),
    health: externalConfigured ? "ready" : "unavailable",
    priority: 50,
    supportsTables: true,
    supportsOcr: profile === "docling" || profile === "marker",
    supportsSpreadsheets: false,
    outputSchemaVersion: 1,
  };
}

function knowledgeParserRegistry() {
  const external = externalDocumentParser();
  return createKnowledgeParserRegistry<ParsedKnowledgeDocument>([
    ...builtInParserEntries(),
    {
      adapter: null,
      capability: xlsxParserCapability(),
    },
    {
      adapter: external,
      capability: externalParserCapability(),
    },
  ]);
}

export function listKnowledgeParserAdapters(): Array<Pick<KnowledgeParserAdapter<ParsedKnowledgeDocument>, "id" | "version" | "sourceType" | "extensions">> {
  return knowledgeParserRegistry().listAdapters();
}

export function listKnowledgeParserCapabilities(): KnowledgeParserCapability[] {
  return knowledgeParserRegistry().listCapabilities();
}

export function getKnowledgeParserForFilename(filename: string): KnowledgeParserAdapter<ParsedKnowledgeDocument> | null {
  const ext = getKnowledgeExtension(filename);
  return knowledgeParserRegistry().getForExtension(ext);
}

export function isSupportedKnowledgeFilename(filename: string): boolean {
  const ext = getKnowledgeExtension(filename);
  return knowledgeParserRegistry().supportsExtension(ext);
}

export function parseKnowledgeBuffer(filename: string, buffer: Buffer): ParsedKnowledgeDocument {
  const parser = getKnowledgeParserForFilename(filename);
  if (!parser) {
    throw new Error("Desteklenmeyen bilgi dosyası. .txt, .md ve .json yerleşik desteklenir; .pdf/.docx/.pptx/.html için R3MES_DOCUMENT_PARSER_COMMAND gerekir.");
  }
  const raw = parser.inputMode === "utf8" ? buffer.toString("utf8").trim() : "";
  if (parser.inputMode === "utf8" && !raw) {
    throw new Error("Boş bilgi dosyası yüklenemez");
  }
  return parser.parse({ filename, buffer, raw });
}

export interface KnowledgeChunkDraft {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  artifactId?: string;
  artifactKind?: DocumentArtifactKind;
  artifactMetadata?: Record<string, unknown>;
  artifactSplitIndex?: number;
  sectionTitle?: string | null;
  pageNumber?: number | null;
  isScaffold?: boolean;
  answerabilityScore?: number;
}

const RECORD_HEADING_PATTERN = /^##\s+Kayıt\b/m;

function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function createChunkDrafts(contents: string[]): KnowledgeChunkDraft[] {
  return contents.map((content, chunkIndex) => ({
    chunkIndex,
    content,
    tokenCount: approximateTokenCount(content),
  }));
}

function createArtifactChunkDrafts(artifacts: DocumentArtifact[], maxChars: number): KnowledgeChunkDraft[] {
  const chunks: KnowledgeChunkDraft[] = [];
  const addChunk = (content: string, artifact: DocumentArtifact, artifactSplitIndex: number) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      chunkIndex: chunks.length,
      content: trimmed,
      tokenCount: approximateTokenCount(trimmed),
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      artifactMetadata: normalizeArtifactMetadata(artifact.metadata),
      artifactSplitIndex,
      sectionTitle: artifact.title ?? null,
      pageNumber: artifact.page ?? null,
      isScaffold: artifact.kind === "title" || artifact.kind === "heading" || artifact.kind === "footer" || artifact.kind === "page_marker" || artifact.kind === "url",
      answerabilityScore: artifact.answerabilityScore,
    });
  };

  for (const artifact of artifacts) {
    if (artifact.kind === "footer" || artifact.kind === "page_marker" || artifact.kind === "url" || artifact.kind === "title" || artifact.kind === "heading") {
      continue;
    }
    const content = artifact.text;
    const pieces = content.length > maxChars ? splitOversizedText(content, maxChars) : [content];
    pieces.forEach((piece, pieceIndex) => addChunk(piece, artifact, pieceIndex));
  }

  return chunks;
}

function chunkParagraphs(paragraphs: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const content = current.trim();
    if (!content) return;
    chunks.push(content);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      chunks.push(...splitOversizedText(paragraph, maxChars));
      continue;
    }

    if (!current) {
      current = paragraph;
      continue;
    }

    const candidate = `${current}\n\n${paragraph}`;
    if (candidate.length > maxChars) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}

function isMarkdownTableBlock(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (
    lines.length >= 3 &&
    MARKDOWN_TABLE_LINE_PATTERN.test(lines[0] ?? "") &&
    MARKDOWN_TABLE_SEPARATOR_PATTERN.test(lines[1] ?? "") &&
    lines.slice(2).some((line) => MARKDOWN_TABLE_LINE_PATTERN.test(line))
  );
}

function splitMarkdownTable(text: string, maxChars: number): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!isMarkdownTableBlock(text)) return [];
  const header = lines.slice(0, 2);
  const rows = lines.slice(2);
  const chunks: string[] = [];
  let currentRows: string[] = [];

  const flush = () => {
    if (currentRows.length === 0) return;
    chunks.push([...header, ...currentRows].join("\n"));
    currentRows = [];
  };

  for (const row of rows) {
    const candidate = [...header, ...currentRows, row].join("\n");
    if (currentRows.length > 0 && candidate.length > maxChars) {
      flush();
    }
    currentRows.push(row);
  }

  flush();
  return chunks;
}

function tableContextFromLines(lines: string[]): string {
  const candidates = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4);
  while (candidates.join("\n").length > 420 && candidates.length > 1) {
    candidates.shift();
  }
  return candidates.join("\n");
}

function splitPlainOversizedText(text: string, maxChars: number): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    return chunkParagraphs(sentences, maxChars);
  }

  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitEmbeddedMarkdownTables(text: string, maxChars: number): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let proseLines: string[] = [];
  let foundTable = false;

  const flushProse = () => {
    const prose = proseLines.join("\n").trim();
    if (prose) chunks.push(...splitPlainOversizedText(prose, maxChars));
    proseLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    const next = lines[i + 1]?.trim() ?? "";
    if (MARKDOWN_TABLE_LINE_PATTERN.test(line) && MARKDOWN_TABLE_SEPARATOR_PATTERN.test(next)) {
      foundTable = true;
      const context = tableContextFromLines(proseLines);
      flushProse();

      const tableLines = [line, next];
      i += 2;
      while (i < lines.length && MARKDOWN_TABLE_LINE_PATTERN.test(lines[i]?.trim() ?? "")) {
        tableLines.push(lines[i]?.trim() ?? "");
        i += 1;
      }
      i -= 1;

      const tableBudget = context ? Math.max(180, maxChars - context.length - 2) : maxChars;
      const tableChunks = splitMarkdownTable(tableLines.join("\n"), tableBudget);
      for (const tableChunk of tableChunks) {
        chunks.push(context ? `${context}\n\n${tableChunk}` : tableChunk);
      }
      continue;
    }

    proseLines.push(lines[i] ?? "");
  }

  flushProse();
  return foundTable ? chunks.filter(Boolean) : [];
}

function splitOversizedText(text: string, maxChars: number): string[] {
  const tableChunks = splitMarkdownTable(text, maxChars);
  if (tableChunks.length > 0) {
    return tableChunks;
  }

  const embeddedTableChunks = splitEmbeddedMarkdownTables(text, maxChars);
  if (embeddedTableChunks.length > 0) {
    return embeddedTableChunks;
  }

  return splitPlainOversizedText(text, maxChars);
}

function splitRecordSection(section: string, maxChars: number): string[] {
  if (section.length <= maxChars) {
    return [section];
  }

  const blocks = splitParagraphs(section);
  if (blocks.length <= 1) {
    return splitOversizedText(section, maxChars);
  }

  const [recordHeader, ...bodyBlocks] = blocks;
  const chunks: string[] = [];
  let current = recordHeader!;

  const flush = () => {
    if (current.trim() !== recordHeader.trim()) {
      chunks.push(current.trim());
    }
    current = recordHeader!;
  };

  for (const block of bodyBlocks) {
    const candidate = `${current}\n\n${block}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    flush();

    const prefixedBlock = `${recordHeader}\n\n${block}`;
    if (prefixedBlock.length <= maxChars) {
      current = prefixedBlock;
      continue;
    }

    const availableChars = Math.max(120, maxChars - recordHeader.length - 2);
    const pieces = splitOversizedText(block, availableChars);
    for (const piece of pieces) {
      chunks.push(`${recordHeader}\n\n${piece}`.trim());
    }
  }

  flush();
  return chunks;
}

function chunkRecordAwareMarkdown(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const headingMatches = Array.from(normalized.matchAll(/^##\s+Kayıt\b.*$/gm));
  if (headingMatches.length === 0) {
    return [];
  }

  const sections: string[] = [];
  for (let i = 0; i < headingMatches.length; i += 1) {
    const start = headingMatches[i]?.index ?? 0;
    const end = headingMatches[i + 1]?.index ?? normalized.length;
    const section = normalized.slice(start, end).trim();
    if (section) {
      sections.push(section);
    }
  }

  return sections.flatMap((section) => splitRecordSection(section, maxChars));
}

export function chunkKnowledgeText(text: string, maxChars = 900): KnowledgeChunkDraft[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const recordAwareChunks = RECORD_HEADING_PATTERN.test(trimmed)
    ? chunkRecordAwareMarkdown(trimmed, maxChars)
    : [];
  if (recordAwareChunks.length > 0) {
    return createChunkDrafts(recordAwareChunks);
  }

  const paragraphs = splitParagraphs(trimmed);
  return createChunkDrafts(
    chunkParagraphs(paragraphs.length > 0 ? paragraphs : [trimmed], maxChars),
  );
}

export function chunkParsedKnowledgeDocument(document: ParsedKnowledgeDocument, maxChars = 900): KnowledgeChunkDraft[] {
  const artifactChunks = createArtifactChunkDrafts(document.artifacts, maxChars);
  if (artifactChunks.length > 0) return artifactChunks;
  return chunkKnowledgeText(document.text, maxChars);
}

export function approximateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
