import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type KnowledgeSourceType = "TEXT" | "MARKDOWN" | "JSON" | "PDF" | "DOCX" | "PPTX" | "HTML";
export type KnowledgeParserInputMode = "utf8" | "binary";
export type KnowledgeExternalParserProfile = "docling" | "marker" | "external";
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

export interface KnowledgeParserAdapter {
  id: string;
  version: number;
  sourceType: KnowledgeSourceType;
  sourceTypeForFilename?: (filename: string) => KnowledgeSourceType;
  extensions: string[];
  inputMode: KnowledgeParserInputMode;
  parse(opts: { filename: string; buffer: Buffer; raw: string }): ParsedKnowledgeDocument;
}

export interface KnowledgeParserCapability {
  id: string;
  version: number;
  sourceType: KnowledgeSourceType;
  extensions: string[];
  inputMode: KnowledgeParserInputMode;
  available: boolean;
  kind: "built_in" | "external";
  profile?: KnowledgeExternalParserProfile | null;
  reason?: string | null;
}

export function getKnowledgeExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function parsedDocument(opts: {
  adapter: KnowledgeParserAdapter;
  text: string;
  originalBytes: number;
  sourceType?: KnowledgeSourceType;
  artifacts?: DocumentArtifact[];
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

const STRUCTURAL_LINE_PATTERN =
  /^(?:#{1,6}\s+\S|[-*]\s+\S|\d+[.)]\s+\S|(?:Topic|Tags|Source Summary|Key Takeaway|Patient Summary|Clinical Takeaway|Safe Guidance|Red Flags|Do Not Infer|Başlık|Etiketler|Temel Bilgi|Triage|Uyarı Bulguları|Çıkarım Yapma|Soru|Cevap|Kaynak|Özet|Ozet)\s*:)/iu;
const MARKDOWN_TABLE_LINE_PATTERN = /^\s*\|.*\|\s*$/u;
const MARKDOWN_TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;

function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    !trimmed ||
    STRUCTURAL_LINE_PATTERN.test(trimmed) ||
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
  for (const [index, artifact] of source.entries()) {
    const text = cleanArtifactText(String(artifact.text ?? ""));
    if (!text) continue;
    const rawKind = normalizeArtifactKind(artifact.kind);
    const kind = shouldReclassifyScaffold && rawKind === "paragraph" && isLikelyStandaloneHeading(text)
      ? "heading"
      : rawKind;
    out.push({
      id: artifact.id || `artifact-${index}`,
      kind,
      text,
      title: artifact.title ?? null,
      page: typeof artifact.page === "number" ? artifact.page : null,
      level: typeof artifact.level === "number" ? artifact.level : null,
      items: Array.isArray(artifact.items) ? artifact.items.map((item) => cleanArtifactText(String(item))).filter(Boolean) : undefined,
      metadata: artifact.metadata && typeof artifact.metadata === "object" ? artifact.metadata : undefined,
      answerabilityScore: Math.max(0, Math.min(100, Math.round(
        typeof artifact.answerabilityScore === "number"
          ? artifact.answerabilityScore
          : artifactAnswerabilityScore(kind, text),
      ))),
    });
  }
  return out;
}

const TEXT_PARSER: KnowledgeParserAdapter = {
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

const MARKDOWN_PARSER: KnowledgeParserAdapter = {
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

const JSON_PARSER: KnowledgeParserAdapter = {
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

const BUILT_IN_KNOWLEDGE_PARSERS: KnowledgeParserAdapter[] = [
  TEXT_PARSER,
  MARKDOWN_PARSER,
  JSON_PARSER,
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

function isLikelyDefinition(text: string): boolean {
  const normalized = text.toLocaleLowerCase("tr-TR");
  return /\b(?:nedir|ne demek|denir|ifade eder|tanımlanır|tanimlanir|bütünüdür|butunudur)\b/u.test(normalized);
}

function isLikelyStandaloneHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.length > 120 || isLikelyDefinition(trimmed)) return false;
  const withoutDecimalDots = trimmed.replace(/\d+\.\d+/gu, "");
  if (/[.!?;:]/u.test(withoutDecimalDots)) return false;
  const words = trimmed.split(/\s+/u).filter(Boolean);
  return words.length > 1 && words.length <= 12;
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
    return "R3MES_DOCUMENT_PARSER_COMMAND not configured; recommended profile is docling for PDF/DOCX structured markdown";
  }
  if (profile === "marker") {
    return "R3MES_DOCUMENT_PARSER_COMMAND not configured; recommended profile is marker for PDF/DOCX structured markdown";
  }
  return "R3MES_DOCUMENT_PARSER_COMMAND not configured";
}

function externalParserArgs(inputPath: string): string[] {
  const template = process.env.R3MES_DOCUMENT_PARSER_ARGS?.trim() || "{input}";
  return splitCommandLineArgs(template).map((arg) => arg.replaceAll("{input}", inputPath));
}

function externalDocumentParser(): KnowledgeParserAdapter | null {
  const command = process.env.R3MES_DOCUMENT_PARSER_COMMAND?.trim();
  if (!command) return null;
  return {
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
          throw result.error;
        }
        if (result.status !== 0) {
          throw new Error(`External document parser failed with exit code ${result.status ?? "unknown"}: ${String(result.stderr ?? "").slice(0, 500)}`);
        }
        const parsedOutput = parseExternalParserOutput(String(result.stdout ?? ""), filename);
        return parsedDocument({
          adapter: externalDocumentParser() ?? TEXT_PARSER,
          sourceType: parsedOutput.sourceType,
          text: parsedOutput.text,
          artifacts: parsedOutput.artifacts,
          originalBytes: buffer.length,
          warnings: String(result.stderr ?? "").trim()
            ? [`external_parser_stderr:${String(result.stderr).trim().slice(0, 240)}`]
            : [],
        });
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}

function parseExternalParserOutput(stdout: string, filename: string): {
  sourceType: KnowledgeSourceType;
  text: string;
  artifacts?: DocumentArtifact[];
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
      for (const [index, item] of rawArtifacts.entries()) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const textValue = String(record.text ?? "").trim();
          if (!textValue) continue;
          artifacts.push({
            id: String(record.id ?? `artifact-${index}`),
            kind: normalizeArtifactKind(record.kind),
            text: textValue,
            title: typeof record.title === "string" ? record.title : null,
            page: typeof record.page === "number" ? record.page : null,
            level: typeof record.level === "number" ? record.level : null,
            items: Array.isArray(record.items) ? record.items.map((value) => String(value)) : undefined,
            metadata: record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : undefined,
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
        };
      }
    } catch {
      // Keep compatibility with legacy parser commands that print Markdown.
    }
  }
  return {
    sourceType: fallbackSourceType,
    text: trimmed,
    artifacts: inferDocumentArtifactsFromText(trimmed),
  };
}

function knowledgeParsers(): KnowledgeParserAdapter[] {
  const external = externalDocumentParser();
  return external ? [...BUILT_IN_KNOWLEDGE_PARSERS, external] : BUILT_IN_KNOWLEDGE_PARSERS;
}

export function listKnowledgeParserAdapters(): Array<Pick<KnowledgeParserAdapter, "id" | "version" | "sourceType" | "extensions">> {
  return knowledgeParsers().map((parser) => ({
    id: parser.id,
    version: parser.version,
    sourceType: parser.sourceType,
    extensions: [...parser.extensions],
  }));
}

export function listKnowledgeParserCapabilities(): KnowledgeParserCapability[] {
  const externalConfigured = Boolean(process.env.R3MES_DOCUMENT_PARSER_COMMAND?.trim());
  const profile = externalParserProfile();
  return [
    ...BUILT_IN_KNOWLEDGE_PARSERS.map((parser) => ({
      id: parser.id,
      version: parser.version,
      sourceType: parser.sourceType,
      extensions: [...parser.extensions],
      inputMode: parser.inputMode,
      available: true,
      kind: "built_in" as const,
      reason: null,
    })),
    {
      id: "external-document-parser-v1",
      version: 1,
      sourceType: "MARKDOWN",
      extensions: [".pdf", ".docx"],
      inputMode: "binary",
      available: externalConfigured,
      kind: "external",
      profile,
      reason: externalConfigured ? null : missingExternalParserReason(profile),
    },
  ];
}

export function getKnowledgeParserForFilename(filename: string): KnowledgeParserAdapter | null {
  const ext = getKnowledgeExtension(filename);
  return knowledgeParsers().find((parser) => parser.extensions.includes(ext)) ?? null;
}

export function isSupportedKnowledgeFilename(filename: string): boolean {
  const ext = getKnowledgeExtension(filename);
  return knowledgeParsers().some((parser) => parser.extensions.includes(ext));
}

export function parseKnowledgeBuffer(filename: string, buffer: Buffer): ParsedKnowledgeDocument {
  const parser = getKnowledgeParserForFilename(filename);
  if (!parser) {
    throw new Error("Desteklenmeyen bilgi dosyası. Yalnızca .txt, .md ve .json kabul edilir; PDF/DOCX için R3MES_DOCUMENT_PARSER_COMMAND gerekir.");
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
  artifactKind?: DocumentArtifactKind;
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
  const addChunk = (content: string, artifact: DocumentArtifact) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      chunkIndex: chunks.length,
      content: trimmed,
      tokenCount: approximateTokenCount(trimmed),
      artifactKind: artifact.kind,
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
    for (const piece of pieces) addChunk(piece, artifact);
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
