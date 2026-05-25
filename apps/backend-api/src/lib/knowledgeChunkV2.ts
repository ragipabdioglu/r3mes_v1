import type { DocumentArtifactKind, KnowledgeChunkDraft, KnowledgeSourceType } from "./knowledgeText.js";

export type KnowledgeChunkKind = DocumentArtifactKind | "untyped_text";

export type KnowledgeChunkSplitReason =
  | "artifact_boundary"
  | "artifact_continuation"
  | "legacy_text_chunk";

export type ChunkIntegrityWarning =
  | "empty_content"
  | "invalid_token_count"
  | "duplicate_chunk_index"
  | "non_contiguous_chunk_index"
  | "artifact_reference_incomplete"
  | "artifact_split_index_missing"
  | "orphan_artifact_split_index";

export interface KnowledgeChunkSourceContext {
  collectionId?: string;
  documentId?: string;
  documentVersionId?: string;
  filename?: string;
  sourceType?: KnowledgeSourceType;
}

export interface KnowledgeChunkSourceReference extends KnowledgeChunkSourceContext {
  artifactId?: string;
  artifactKind?: DocumentArtifactKind;
  sectionTitle?: string | null;
  pageNumber?: number | null;
}

/**
 * Read-only Phase 2 contract view of an existing chunk draft.
 * It intentionally carries the current content into each consumer text field
 * until later phases introduce evidence-specific transformations.
 */
export interface KnowledgeChunkV2 extends KnowledgeChunkDraft {
  schemaVersion: 2;
  embeddingText: string;
  rerankText: string;
  evidenceText: string;
  chunkKind: KnowledgeChunkKind;
  source: KnowledgeChunkSourceReference;
  splitReason: KnowledgeChunkSplitReason;
  integrityWarnings: ChunkIntegrityWarning[];
}

export interface ChunkingDiagnostics {
  schemaVersion: 2;
  inputContract: "KnowledgeChunkDraft";
  outputContract: "KnowledgeChunkV2";
  runtimeBehaviorChanged: false;
  sourceChunkCount: number;
  adaptedChunkCount: number;
  artifactBackedChunkCount: number;
  untypedTextChunkCount: number;
  splitContinuationCount: number;
  scaffoldChunkCount: number;
  kindCounts: Partial<Record<KnowledgeChunkKind, number>>;
  integrity: {
    contiguousIndexes: boolean;
    emptyContentCount: number;
    invalidTokenCount: number;
    warningCounts: Partial<Record<ChunkIntegrityWarning, number>>;
  };
  warnings: ChunkIntegrityWarning[];
}

export interface AdaptKnowledgeChunksV2Result {
  chunks: KnowledgeChunkV2[];
  diagnostics: ChunkingDiagnostics;
}

function hasArtifactReference(chunk: KnowledgeChunkDraft): boolean {
  return chunk.artifactId !== undefined || chunk.artifactKind !== undefined;
}

function splitReasonForChunk(chunk: KnowledgeChunkDraft): KnowledgeChunkSplitReason {
  if (!hasArtifactReference(chunk)) return "legacy_text_chunk";
  return (chunk.artifactSplitIndex ?? 0) > 0 ? "artifact_continuation" : "artifact_boundary";
}

function incrementCount<Key extends string>(counts: Partial<Record<Key, number>>, key: Key): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function findGlobalIndexWarnings(chunks: readonly KnowledgeChunkDraft[]): {
  duplicateIndexes: Set<number>;
  nonContiguousIndexes: Set<number>;
} {
  const counts = new Map<number, number>();
  for (const chunk of chunks) {
    counts.set(chunk.chunkIndex, (counts.get(chunk.chunkIndex) ?? 0) + 1);
  }

  const duplicateIndexes = new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([chunkIndex]) => chunkIndex),
  );
  const nonContiguousIndexes = new Set<number>();
  const sortedIndexes = [...counts.keys()].sort((left, right) => left - right);
  sortedIndexes.forEach((chunkIndex, expectedIndex) => {
    if (chunkIndex !== expectedIndex) nonContiguousIndexes.add(chunkIndex);
  });

  return { duplicateIndexes, nonContiguousIndexes };
}

function integrityWarningsForChunk(
  chunk: KnowledgeChunkDraft,
  duplicateIndexes: ReadonlySet<number>,
  nonContiguousIndexes: ReadonlySet<number>,
): ChunkIntegrityWarning[] {
  const warnings: ChunkIntegrityWarning[] = [];
  if (!chunk.content.trim()) warnings.push("empty_content");
  if (!Number.isFinite(chunk.tokenCount) || chunk.tokenCount < 1) warnings.push("invalid_token_count");
  if (duplicateIndexes.has(chunk.chunkIndex)) warnings.push("duplicate_chunk_index");
  if (nonContiguousIndexes.has(chunk.chunkIndex)) warnings.push("non_contiguous_chunk_index");

  const hasArtifactId = chunk.artifactId !== undefined;
  const hasArtifactKind = chunk.artifactKind !== undefined;
  if (hasArtifactId !== hasArtifactKind) warnings.push("artifact_reference_incomplete");
  if (hasArtifactReference(chunk) && chunk.artifactSplitIndex === undefined) warnings.push("artifact_split_index_missing");
  if (!hasArtifactReference(chunk) && chunk.artifactSplitIndex !== undefined) warnings.push("orphan_artifact_split_index");
  return warnings;
}

function buildSourceReference(
  chunk: KnowledgeChunkDraft,
  source: KnowledgeChunkSourceContext | undefined,
): KnowledgeChunkSourceReference {
  return {
    ...source,
    artifactId: chunk.artifactId,
    artifactKind: chunk.artifactKind,
    sectionTitle: chunk.sectionTitle,
    pageNumber: chunk.pageNumber,
  };
}

/**
 * Adapts the legacy write model without changing chunk text, order, or
 * retrieval behavior. Consumers can opt into the V2 view incrementally.
 */
export function adaptKnowledgeChunkDraftsToV2(
  input: readonly KnowledgeChunkDraft[],
  source?: KnowledgeChunkSourceContext,
): AdaptKnowledgeChunksV2Result {
  const { duplicateIndexes, nonContiguousIndexes } = findGlobalIndexWarnings(input);
  const kindCounts: Partial<Record<KnowledgeChunkKind, number>> = {};
  const warningCounts: Partial<Record<ChunkIntegrityWarning, number>> = {};

  const chunks = input.map((chunk) => {
    const chunkKind: KnowledgeChunkKind = chunk.artifactKind ?? "untyped_text";
    const integrityWarnings = integrityWarningsForChunk(chunk, duplicateIndexes, nonContiguousIndexes);
    incrementCount(kindCounts, chunkKind);
    integrityWarnings.forEach((warning) => incrementCount(warningCounts, warning));

    return {
      ...chunk,
      schemaVersion: 2 as const,
      embeddingText: chunk.content,
      rerankText: chunk.content,
      evidenceText: chunk.content,
      chunkKind,
      source: buildSourceReference(chunk, source),
      splitReason: splitReasonForChunk(chunk),
      integrityWarnings,
    };
  });

  const warnings = Object.keys(warningCounts) as ChunkIntegrityWarning[];
  return {
    chunks,
    diagnostics: {
      schemaVersion: 2,
      inputContract: "KnowledgeChunkDraft",
      outputContract: "KnowledgeChunkV2",
      runtimeBehaviorChanged: false,
      sourceChunkCount: input.length,
      adaptedChunkCount: chunks.length,
      artifactBackedChunkCount: chunks.filter((chunk) => chunk.chunkKind !== "untyped_text").length,
      untypedTextChunkCount: chunks.filter((chunk) => chunk.chunkKind === "untyped_text").length,
      splitContinuationCount: chunks.filter((chunk) => chunk.splitReason === "artifact_continuation").length,
      scaffoldChunkCount: chunks.filter((chunk) => chunk.isScaffold === true).length,
      kindCounts,
      integrity: {
        contiguousIndexes: duplicateIndexes.size === 0 && nonContiguousIndexes.size === 0,
        emptyContentCount: chunks.filter((chunk) => chunk.integrityWarnings.includes("empty_content")).length,
        invalidTokenCount: chunks.filter((chunk) => chunk.integrityWarnings.includes("invalid_token_count")).length,
        warningCounts,
      },
      warnings,
    },
  };
}
