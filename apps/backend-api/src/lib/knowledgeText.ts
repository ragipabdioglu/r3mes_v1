export type KnowledgeSourceType = "TEXT" | "MARKDOWN" | "JSON";

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
  parse: ({ buffer, raw }) =>
    parsedDocument({
      adapter: JSON_PARSER,
      text: JSON.stringify(JSON.parse(raw) as unknown, null, 2),
      originalBytes: buffer.length,
    }),
};

const KNOWLEDGE_PARSERS: KnowledgeParserAdapter[] = [
  TEXT_PARSER,
  MARKDOWN_PARSER,
  JSON_PARSER,
];

const SUPPORTED_EXTENSIONS = new Set(KNOWLEDGE_PARSERS.flatMap((parser) => parser.extensions));

export function listKnowledgeParserAdapters(): Array<Pick<KnowledgeParserAdapter, "id" | "version" | "sourceType" | "extensions">> {
  return KNOWLEDGE_PARSERS.map((parser) => ({
    id: parser.id,
    version: parser.version,
    sourceType: parser.sourceType,
    extensions: [...parser.extensions],
  }));
}

export function getKnowledgeParserForFilename(filename: string): KnowledgeParserAdapter | null {
  const ext = getKnowledgeExtension(filename);
  return KNOWLEDGE_PARSERS.find((parser) => parser.extensions.includes(ext)) ?? null;
}

export function isSupportedKnowledgeFilename(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(getKnowledgeExtension(filename));
}

export function parseKnowledgeBuffer(filename: string, buffer: Buffer): ParsedKnowledgeDocument {
  const parser = getKnowledgeParserForFilename(filename);
  if (!parser) {
    throw new Error("Desteklenmeyen bilgi dosyası. Yalnızca .txt, .md ve .json kabul edilir.");
  }
  const raw = buffer.toString("utf8").trim();
  if (!raw) {
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
