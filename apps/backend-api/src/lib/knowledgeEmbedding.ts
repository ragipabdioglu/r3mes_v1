const EMBEDDING_DIMENSIONS = 256;

export function getKnowledgeEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}

export function normalizeKnowledgeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

export function tokenizeKnowledgeText(text: string): string[] {
  return text
    ? normalizeKnowledgeText(text)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 || /\d/.test(part))
    : [];
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export function embedKnowledgeText(text: string): number[] {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = tokenizeKnowledgeText(text);
  for (const token of tokens) {
    const idx = hashToken(token) % EMBEDDING_DIMENSIONS;
    values[idx] += 1;
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const idx = hashToken(`${tokens[i]}_${tokens[i + 1]}`) % EMBEDDING_DIMENSIONS;
    values[idx] += 0.5;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return values;
  return values.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function formatVectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value.toFixed(8))).join(",")}]`;
}
