const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".json"]);

export interface ParsedKnowledgeDocument {
  sourceType: "TEXT" | "MARKDOWN" | "JSON";
  text: string;
}

export function getKnowledgeExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

export function isSupportedKnowledgeFilename(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(getKnowledgeExtension(filename));
}

export function parseKnowledgeBuffer(filename: string, buffer: Buffer): ParsedKnowledgeDocument {
  const ext = getKnowledgeExtension(filename);
  const raw = buffer.toString("utf8").trim();
  if (!raw) {
    throw new Error("Boş bilgi dosyası yüklenemez");
  }

  if (ext === ".json") {
    const parsed = JSON.parse(raw) as unknown;
    return {
      sourceType: "JSON",
      text: JSON.stringify(parsed, null, 2),
    };
  }

  if (ext === ".md") {
    return { sourceType: "MARKDOWN", text: raw };
  }

  if (ext === ".txt") {
    return { sourceType: "TEXT", text: raw };
  }

  throw new Error("Desteklenmeyen bilgi dosyası. Yalnızca .txt, .md ve .json kabul edilir.");
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
