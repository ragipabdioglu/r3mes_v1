import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type KnowledgeSourceType = "TEXT" | "MARKDOWN" | "JSON";
export type KnowledgeParserInputMode = "utf8" | "binary";

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
  const text = opts.text.trim();
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
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
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

function splitOversizedText(text: string, maxChars: number): string[] {
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
