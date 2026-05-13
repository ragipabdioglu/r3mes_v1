import { cosineSimilarity, embedKnowledgeText } from "./knowledgeEmbedding.js";
import { buildLexicalCorpusStats, scoreLexicalMatch } from "./knowledgeRetrieval.js";
import { getDecisionConfig } from "./decisionConfig.js";

export interface HybridCandidate<TChunk> {
  chunk: TChunk;
  lexicalScore: number;
  embeddingScore: number;
  fusedScore: number;
}

export function rankHybridCandidates<TChunk extends { content: string; embedding?: { values: number[] } | null }>(
  query: string,
  chunks: TChunk[],
): HybridCandidate<TChunk>[] {
  const weights = getDecisionConfig().hybridRetrieval;
  const queryEmbedding = embedKnowledgeText(query);
  const lexicalCorpusStats = buildLexicalCorpusStats(chunks.map((chunk) => chunk.content));

  return chunks
    .map((chunk) => {
      const lexicalScore = scoreLexicalMatch(query, chunk.content, lexicalCorpusStats);
      const embeddingScore = cosineSimilarity(queryEmbedding, chunk.embedding?.values ?? []);
      return {
        chunk,
        lexicalScore,
        embeddingScore,
        fusedScore: lexicalScore * weights.lexicalWeight + embeddingScore * weights.embeddingWeight,
      };
    })
    .sort((a, b) => b.fusedScore - a.fusedScore);
}

