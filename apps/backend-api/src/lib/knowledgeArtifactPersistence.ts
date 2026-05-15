import { createHash } from "node:crypto";

import type { KnowledgeIngestionStepStatus, Prisma } from "@prisma/client";

import type { DocumentArtifact, KnowledgeChunkDraft, ParsedKnowledgeDocument } from "./knowledgeText.js";

export interface KnowledgeDocumentVersionPersistenceInput {
  documentId: string;
  parsed: ParsedKnowledgeDocument;
  version: number;
  versionIndex?: number;
  versionId?: string;
  contentHash?: string | null;
  sourceMime?: string | null;
  sourceExtension?: string | null;
  storagePath?: string | null;
  storageCid?: string | null;
  readinessStatus?: KnowledgeIngestionStepStatus;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeArtifactPersistenceInput {
  documentId: string;
  parsed: ParsedKnowledgeDocument;
  versionId?: string;
}

export interface KnowledgeChunkArtifactPersistenceInput {
  documentId: string;
  chunks: KnowledgeChunkDraft[];
  versionId?: string;
}

export interface KnowledgeArtifactPersistencePayloads {
  version: Prisma.KnowledgeDocumentVersionUncheckedCreateInput;
  artifacts: Prisma.KnowledgeArtifactCreateManyInput[];
  chunks: Prisma.KnowledgeChunkCreateManyInput[];
}

const ARTIFACT_ROW_ID_PREFIX = "ka_";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeInputJson(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (depth > 8) return undefined;
  if (value === null) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeInputJson(item, depth + 1))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
  }
  if (typeof value !== "object") return undefined;

  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const clean = sanitizeInputJson(raw, depth + 1);
    if (clean !== undefined) out[key] = clean;
  }
  return Object.keys(out).length > 0 ? out as Prisma.InputJsonObject : undefined;
}

function artifactMetadataJson(artifact: DocumentArtifact): Prisma.InputJsonValue | undefined {
  const metadata: Record<string, unknown> = {
    ...(artifact.metadata ?? {}),
  };
  if (Array.isArray(artifact.items) && artifact.items.length > 0) {
    metadata.items = artifact.items;
  }
  return sanitizeInputJson(metadata);
}

function stableArtifactId(artifact: DocumentArtifact): string {
  const provided = artifact.id.trim();
  if (provided) return provided;
  return `artifact-${sha256Hex(JSON.stringify({
    kind: artifact.kind,
    page: artifact.page ?? null,
    title: artifact.title ?? null,
    level: artifact.level ?? null,
    text: artifact.text,
  })).slice(0, 16)}`;
}

export function buildKnowledgeArtifactRowId(input: {
  documentId: string;
  artifactId: string;
  versionId?: string;
}): string {
  const basis = JSON.stringify({
    documentId: input.documentId,
    versionId: input.versionId ?? null,
    artifactId: input.artifactId,
  });
  return `${ARTIFACT_ROW_ID_PREFIX}${sha256Hex(basis).slice(0, 24)}`;
}

export function buildKnowledgeArtifactKey(input: {
  documentId: string;
  artifactId: string;
  versionId?: string;
}): string {
  return `${ARTIFACT_ROW_ID_PREFIX}${sha256Hex(JSON.stringify({
    documentId: input.documentId,
    versionId: input.versionId ?? null,
    artifactId: input.artifactId,
    key: "artifact",
  })).slice(0, 32)}`;
}

export function buildKnowledgeDocumentVersionCreateInput(
  input: KnowledgeDocumentVersionPersistenceInput,
): Prisma.KnowledgeDocumentVersionUncheckedCreateInput {
  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new Error("Knowledge document version must be a positive integer");
  }
  if (input.versionIndex !== undefined && (!Number.isInteger(input.versionIndex) || input.versionIndex <= 0)) {
    throw new Error("Knowledge document versionIndex must be a positive integer");
  }

  const metadata = sanitizeInputJson(input.metadata);
  const payload: Prisma.KnowledgeDocumentVersionUncheckedCreateInput = {
    documentId: input.documentId,
    version: input.version,
    versionIndex: input.versionIndex ?? input.version,
    sourceType: input.parsed.sourceType,
    parserId: input.parsed.parser.id,
    parserVersion: input.parsed.parser.version,
    textHash: sha256Hex(input.parsed.text),
    originalBytes: input.parsed.diagnostics.originalBytes,
    normalizedChars: input.parsed.diagnostics.normalizedChars,
    warnings: input.parsed.diagnostics.warnings,
  };

  if (input.versionId) payload.id = input.versionId;
  if (input.contentHash) payload.contentHash = input.contentHash;
  if (input.sourceMime) payload.sourceMime = input.sourceMime;
  if (input.sourceExtension) payload.sourceExtension = input.sourceExtension;
  if (input.storagePath) payload.storagePath = input.storagePath;
  if (input.storageCid) payload.storageCid = input.storageCid;
  if (input.readinessStatus) payload.readinessStatus = input.readinessStatus;
  if (metadata !== undefined) payload.metadata = metadata;

  return payload;
}

export function buildKnowledgeArtifactCreateManyInput(
  input: KnowledgeArtifactPersistenceInput,
): Prisma.KnowledgeArtifactCreateManyInput[] {
  return input.parsed.artifacts.map((artifact, ordinal) => {
    const artifactId = stableArtifactId(artifact);
    const payload: Prisma.KnowledgeArtifactCreateManyInput = {
      id: buildKnowledgeArtifactRowId({
        documentId: input.documentId,
        artifactId,
        versionId: input.versionId,
      }),
      documentId: input.documentId,
      artifactId,
      artifactKey: buildKnowledgeArtifactKey({
        documentId: input.documentId,
        artifactId,
        versionId: input.versionId,
      }),
      ordinal,
      kind: artifact.kind,
      page: normalizeOptionalInteger(artifact.page),
      pageNumber: normalizeOptionalInteger(artifact.page),
      title: normalizeOptionalString(artifact.title),
      level: normalizeOptionalInteger(artifact.level),
      text: artifact.text,
      answerabilityScore: normalizeScore(artifact.answerabilityScore),
    };

    if (input.versionId) payload.versionId = input.versionId;
    const metadata = artifactMetadataJson(artifact);
    if (metadata !== undefined) payload.metadata = metadata;

    return payload;
  });
}

export function buildKnowledgeChunkCreateManyInput(
  input: KnowledgeChunkArtifactPersistenceInput,
): Prisma.KnowledgeChunkCreateManyInput[] {
  return input.chunks.map((chunk) => {
    const payload: Prisma.KnowledgeChunkCreateManyInput = {
      documentId: input.documentId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
    };

    if (input.versionId) payload.versionId = input.versionId;
    if (chunk.artifactId) {
      payload.artifactId = chunk.artifactId;
      payload.artifactRowId = buildKnowledgeArtifactRowId({
        documentId: input.documentId,
        artifactId: chunk.artifactId,
        versionId: input.versionId,
      });
    }
    if (Number.isInteger(chunk.artifactSplitIndex)) {
      payload.artifactSplitIndex = chunk.artifactSplitIndex;
    }

    return payload;
  });
}

export function buildKnowledgeArtifactPersistencePayloads(input: KnowledgeDocumentVersionPersistenceInput & {
  chunks: KnowledgeChunkDraft[];
}): KnowledgeArtifactPersistencePayloads {
  return {
    version: buildKnowledgeDocumentVersionCreateInput(input),
    artifacts: buildKnowledgeArtifactCreateManyInput({
      documentId: input.documentId,
      parsed: input.parsed,
      versionId: input.versionId,
    }),
    chunks: buildKnowledgeChunkCreateManyInput({
      documentId: input.documentId,
      chunks: input.chunks,
      versionId: input.versionId,
    }),
  };
}
