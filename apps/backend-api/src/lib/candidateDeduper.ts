import { normalizeConceptText } from "./conceptNormalizer.js";
import type { HybridKnowledgeCandidate } from "./hybridKnowledgeRetrieval.js";

export type CandidateDeduplicationRule = "exact_chunk_identity" | "same_document_identical_content";

export interface CandidateDeduplicationMerge {
  rule: CandidateDeduplicationRule;
  reason: string;
  retainedChunkId: string;
  mergedChunkId: string;
  documentId: string;
  retainedSources: HybridKnowledgeCandidate["sources"];
  mergedSources: HybridKnowledgeCandidate["sources"];
  outputSources: HybridKnowledgeCandidate["sources"];
}

export interface CandidateDeduplicationDiagnostics {
  inputCandidateCount: number;
  outputCandidateCount: number;
  mergedCandidateCount: number;
  merges: CandidateDeduplicationMerge[];
}

export interface CandidateDeduperResult {
  candidates: HybridKnowledgeCandidate[];
  diagnostics: CandidateDeduplicationDiagnostics;
}

function exactChunkKey(candidate: HybridKnowledgeCandidate): string {
  return candidate.chunk.id || `${candidate.chunk.documentId}:${candidate.chunk.chunkIndex}`;
}

function normalizedContentKey(content: string): string {
  return normalizeConceptText(content).replace(/\s+/g, " ").trim();
}

function mergeCandidate(
  existing: HybridKnowledgeCandidate,
  candidate: HybridKnowledgeCandidate,
): HybridKnowledgeCandidate {
  const merged: HybridKnowledgeCandidate = {
    ...existing,
    sources: [...new Set([...existing.sources, ...candidate.sources])],
    vectorScore: Math.max(existing.vectorScore ?? Number.NEGATIVE_INFINITY, candidate.vectorScore ?? Number.NEGATIVE_INFINITY),
    lexicalScore: Math.max(existing.lexicalScore ?? Number.NEGATIVE_INFINITY, candidate.lexicalScore ?? Number.NEGATIVE_INFINITY),
    preRankScore: Math.max(existing.preRankScore, candidate.preRankScore),
  };
  if (merged.vectorScore === Number.NEGATIVE_INFINITY) delete merged.vectorScore;
  if (merged.lexicalScore === Number.NEGATIVE_INFINITY) delete merged.lexicalScore;
  return merged;
}

export function dedupeCandidatesIdentitySafe(candidates: HybridKnowledgeCandidate[]): CandidateDeduperResult {
  const output: HybridKnowledgeCandidate[] = [];
  const outputIndexByChunk = new Map<string, number>();
  const outputIndexByDocumentContent = new Map<string, number>();
  const merges: CandidateDeduplicationMerge[] = [];

  for (const candidate of candidates) {
    const chunkKey = exactChunkKey(candidate);
    const documentContentKey = `${candidate.chunk.documentId}\0${normalizedContentKey(candidate.chunk.content)}`;
    const exactChunkIndex = outputIndexByChunk.get(chunkKey);
    const sameDocumentContentIndex = outputIndexByDocumentContent.get(documentContentKey);
    const targetIndex = exactChunkIndex ?? sameDocumentContentIndex;
    if (targetIndex === undefined) {
      outputIndexByChunk.set(chunkKey, output.length);
      outputIndexByDocumentContent.set(documentContentKey, output.length);
      output.push({ ...candidate, sources: [...candidate.sources] });
      continue;
    }

    const existing = output[targetIndex]!;
    const rule: CandidateDeduplicationRule =
      exactChunkIndex !== undefined ? "exact_chunk_identity" : "same_document_identical_content";
    const retainedSources = [...existing.sources];
    const merged = mergeCandidate(existing, candidate);
    output[targetIndex] = merged;
    outputIndexByChunk.set(chunkKey, targetIndex);
    merges.push({
      rule,
      reason:
        rule === "exact_chunk_identity"
          ? "Candidate channels resolve to the same chunk identity."
          : "Distinct chunks in the same document carry identical normalized content.",
      retainedChunkId: existing.chunk.id,
      mergedChunkId: candidate.chunk.id,
      documentId: existing.chunk.documentId,
      retainedSources,
      mergedSources: [...candidate.sources],
      outputSources: [...merged.sources],
    });
  }

  return {
    candidates: output,
    diagnostics: {
      inputCandidateCount: candidates.length,
      outputCandidateCount: output.length,
      mergedCandidateCount: merges.length,
      merges,
    },
  };
}
