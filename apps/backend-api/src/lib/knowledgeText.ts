import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type KnowledgeSourceType = "TEXT" | "MARKDOWN" | "JSON";
export type KnowledgeParserInputMode = "utf8" | "binary";
export type KnowledgeExternalParserProfile = "docling" | "marker" | "external";

export interface ParsedKnowledgeDocument {
  sourceType: KnowledgeSourceType;
  text: string;
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
  warnings?: string[];
}): ParsedKnowledgeDocument {
  const text = normalizeParsedKnowledgeText(opts.text, opts.adapter.sourceType).trim();
  if (!text) {
    throw new Error("Boş bilgi dosyası yüklenemez");
  }
  return {
    sourceType: opts.adapter.sourceType,
    text,
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
    sourceType: "MARKDOWN",
    extensions: [".pdf", ".docx"],
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
        return parsedDocument({
          adapter: externalDocumentParser() ?? TEXT_PARSER,
          text: String(result.stdout ?? ""),
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

function splitOversizedText(text: string, maxChars: number): string[] {
  const tableChunks = splitMarkdownTable(text, maxChars);
  if (tableChunks.length > 0) {
    return tableChunks;
  }

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

export function approximateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
