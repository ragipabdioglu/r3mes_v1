import { normalizeKnowledgeText, tokenizeKnowledgeText } from "./knowledgeEmbedding.js";

export interface LexicalCorpusStats {
  averageDocumentLength: number;
  documentCount: number;
  documentFrequencies: Map<string, number>;
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function buildBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

export function buildLexicalCorpusStats(documents: string[]): LexicalCorpusStats {
  const documentFrequencies = new Map<string, number>();
  let totalDocumentLength = 0;

  for (const document of documents) {
    const tokens = tokenizeKnowledgeText(document);
    totalDocumentLength += tokens.length;

    for (const token of new Set(tokens)) {
      documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
    }
  }

  return {
    averageDocumentLength:
      documents.length > 0 ? totalDocumentLength / documents.length : 0,
    documentCount: documents.length,
    documentFrequencies,
  };
}

export function scoreLexicalMatch(
  query: string,
  content: string,
  corpusStats: LexicalCorpusStats,
): number {
  const queryTokens = tokenizeKnowledgeText(query);
  const contentTokens = tokenizeKnowledgeText(content);
  if (queryTokens.length === 0 || contentTokens.length === 0) {
    return 0;
  }

  const queryCounts = countTokens(queryTokens);
  const contentCounts = countTokens(contentTokens);
  const docLength = contentTokens.length;
  const avgDocLength = Math.max(1, corpusStats.averageDocumentLength || docLength);
  const docCount = Math.max(1, corpusStats.documentCount);

  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  let matchedTerms = 0;

  for (const [token, queryFrequency] of queryCounts.entries()) {
    const termFrequency = contentCounts.get(token) ?? 0;
    if (termFrequency === 0) {
      continue;
    }

    matchedTerms += 1;
    const documentFrequency = corpusStats.documentFrequencies.get(token) ?? 0;
    const idf = Math.log(1 + (docCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
    const tfWeight =
      (termFrequency * (k1 + 1)) /
      (termFrequency + k1 * (1 - b + b * (docLength / avgDocLength)));
    score += idf * tfWeight * (1 + 0.2 * (queryFrequency - 1));
  }

  const uniqueQueryTerms = queryCounts.size;
  if (uniqueQueryTerms > 0) {
    score += (matchedTerms / uniqueQueryTerms) * 0.75;
  }

  const normalizedQuery = normalizeKnowledgeText(query).trim();
  const normalizedContent = normalizeKnowledgeText(content);
  if (normalizedQuery.length >= 6 && normalizedContent.includes(normalizedQuery)) {
    score += 1.25;
  }

  const queryBigrams = buildBigrams(queryTokens);
  if (queryBigrams.length > 0) {
    const contentBigrams = new Set(buildBigrams(contentTokens));
    const bigramHits = queryBigrams.reduce(
      (sum, bigram) => sum + (contentBigrams.has(bigram) ? 1 : 0),
      0,
    );
    score += (bigramHits / queryBigrams.length) * 0.8;
  }

  return score;
}

