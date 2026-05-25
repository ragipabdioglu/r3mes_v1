import { createHash } from "node:crypto";

import type { QdrantPayloadV2 } from "@r3mes/shared-types";

export type QdrantPayloadV2BuildInput = Omit<QdrantPayloadV2, "payloadSchemaVersion" | "payloadHash">;
export type QdrantPayloadV2HashInput = Omit<QdrantPayloadV2, "payloadHash"> & { payloadHash?: string };

export type QdrantPayloadV2DiagnosticCode =
  | "missing_required_field"
  | "invalid_field_type"
  | "invalid_field_value"
  | "payload_hash_mismatch";

export interface QdrantPayloadV2Diagnostic {
  field: keyof QdrantPayloadV2 | "$";
  code: QdrantPayloadV2DiagnosticCode;
  expected: string;
  received?: unknown;
}

export interface QdrantPayloadV2ValidationResult {
  valid: boolean;
  diagnostics: QdrantPayloadV2Diagnostic[];
}

export type QdrantPayloadV2IndexFieldName = Exclude<keyof QdrantPayloadV2, "metadata">;

export interface QdrantPayloadV2IndexField {
  fieldName: QdrantPayloadV2IndexFieldName;
  fieldSchema: "keyword" | "integer" | "bool" | "datetime";
}

export const QDRANT_PAYLOAD_V2_INDEX_FIELDS: readonly QdrantPayloadV2IndexField[] = [
  { fieldName: "payloadSchemaVersion", fieldSchema: "integer" },
  { fieldName: "targetKind", fieldSchema: "keyword" },
  { fieldName: "targetId", fieldSchema: "keyword" },
  { fieldName: "collectionId", fieldSchema: "keyword" },
  { fieldName: "documentId", fieldSchema: "keyword" },
  { fieldName: "documentVersionId", fieldSchema: "keyword" },
  { fieldName: "logicalChunkId", fieldSchema: "keyword" },
  { fieldName: "visibility", fieldSchema: "keyword" },
  { fieldName: "ownerScopeId", fieldSchema: "keyword" },
  { fieldName: "sourceQuality", fieldSchema: "keyword" },
  { fieldName: "parseQualityLevel", fieldSchema: "keyword" },
  { fieldName: "strictRouteEligible", fieldSchema: "bool" },
  { fieldName: "strictAnswerEligible", fieldSchema: "bool" },
  { fieldName: "artifactKind", fieldSchema: "keyword" },
  { fieldName: "evidenceTypes", fieldSchema: "keyword" },
  { fieldName: "contentHash", fieldSchema: "keyword" },
  { fieldName: "embeddingTextHash", fieldSchema: "keyword" },
  { fieldName: "payloadHash", fieldSchema: "keyword" },
  { fieldName: "embeddingProvider", fieldSchema: "keyword" },
  { fieldName: "embeddingModel", fieldSchema: "keyword" },
  { fieldName: "embeddingDimension", fieldSchema: "integer" },
  { fieldName: "indexedAt", fieldSchema: "datetime" },
] as const;

const TARGET_KINDS = new Set([
  "chunk",
  "parent_chunk",
  "structured_fact",
  "table_row",
  "collection_profile",
  "document_profile",
]);
const VISIBILITIES = new Set(["PRIVATE", "PUBLIC"]);
const PARSE_QUALITY_LEVELS = new Set(["clean", "usable", "noisy"]);
const EMBEDDING_PROVIDERS = new Set(["bge-m3", "deterministic-dev", "external"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item) ?? null);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return undefined;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashQdrantPayloadText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function computeQdrantPayloadV2Hash(payload: QdrantPayloadV2HashInput): string {
  const hashablePayload = { ...payload };
  delete hashablePayload.payloadHash;
  return createHash("sha256").update(canonicalJson(hashablePayload), "utf8").digest("hex");
}

export function buildQdrantPayloadV2(input: QdrantPayloadV2BuildInput): QdrantPayloadV2 {
  const hashablePayload: Omit<QdrantPayloadV2, "payloadHash"> = {
    payloadSchemaVersion: 2,
    ...input,
  };

  return {
    ...hashablePayload,
    payloadHash: computeQdrantPayloadV2Hash(hashablePayload),
  };
}

function pushMissingDiagnostic(
  diagnostics: QdrantPayloadV2Diagnostic[],
  field: keyof QdrantPayloadV2,
  expected: string,
): void {
  diagnostics.push({ field, code: "missing_required_field", expected });
}

function pushInvalidDiagnostic(
  diagnostics: QdrantPayloadV2Diagnostic[],
  field: keyof QdrantPayloadV2,
  expected: string,
  received: unknown,
  code: "invalid_field_type" | "invalid_field_value" = "invalid_field_type",
): void {
  diagnostics.push({ field, code, expected, received });
}

function validateRequiredField(
  record: Record<string, unknown>,
  diagnostics: QdrantPayloadV2Diagnostic[],
  field: keyof QdrantPayloadV2,
  expected: string,
  isValid: (value: unknown) => boolean,
  code?: "invalid_field_type" | "invalid_field_value",
): void {
  if (!(field in record) || record[field] === undefined) {
    pushMissingDiagnostic(diagnostics, field, expected);
    return;
  }
  if (!isValid(record[field])) {
    pushInvalidDiagnostic(diagnostics, field, expected, record[field], code);
  }
}

function validateOptionalField(
  record: Record<string, unknown>,
  diagnostics: QdrantPayloadV2Diagnostic[],
  field: keyof QdrantPayloadV2,
  expected: string,
  isValid: (value: unknown) => boolean,
  code?: "invalid_field_type" | "invalid_field_value",
): void {
  if (record[field] !== undefined && !isValid(record[field])) {
    pushInvalidDiagnostic(diagnostics, field, expected, record[field], code);
  }
}

export function validateQdrantPayloadV2(value: unknown): QdrantPayloadV2ValidationResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      diagnostics: [{ field: "$", code: "invalid_field_type", expected: "object", received: value }],
    };
  }

  const diagnostics: QdrantPayloadV2Diagnostic[] = [];
  const isNonEmptyString = (input: unknown): boolean => typeof input === "string" && input.trim().length > 0;
  const isBoolean = (input: unknown): boolean => typeof input === "boolean";
  const isPositiveInteger = (input: unknown): boolean =>
    typeof input === "number" && Number.isInteger(input) && input > 0;
  const isIsoDateString = (input: unknown): boolean =>
    typeof input === "string" &&
    input.trim().length > 0 &&
    !Number.isNaN(Date.parse(input)) &&
    new Date(input).toISOString() === input;

  validateRequiredField(value, diagnostics, "payloadSchemaVersion", "2", (input) => input === 2, "invalid_field_value");
  validateRequiredField(value, diagnostics, "targetKind", "VectorIndexTargetKind", (input) => TARGET_KINDS.has(String(input)), "invalid_field_value");
  validateRequiredField(value, diagnostics, "targetId", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateRequiredField(value, diagnostics, "collectionId", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateRequiredField(value, diagnostics, "visibility", "PRIVATE | PUBLIC", (input) => VISIBILITIES.has(String(input)), "invalid_field_value");
  validateRequiredField(value, diagnostics, "ownerScopeId", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateRequiredField(value, diagnostics, "contentHash", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateRequiredField(value, diagnostics, "embeddingTextHash", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateRequiredField(value, diagnostics, "payloadHash", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateRequiredField(value, diagnostics, "embeddingProvider", "EmbeddingProvider", (input) => EMBEDDING_PROVIDERS.has(String(input)), "invalid_field_value");
  validateRequiredField(value, diagnostics, "embeddingModel", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateRequiredField(value, diagnostics, "embeddingDimension", "positive integer", isPositiveInteger, "invalid_field_value");
  validateRequiredField(value, diagnostics, "indexedAt", "ISO date string", isIsoDateString, "invalid_field_value");

  validateOptionalField(value, diagnostics, "documentId", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateOptionalField(value, diagnostics, "documentVersionId", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateOptionalField(value, diagnostics, "logicalChunkId", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateOptionalField(value, diagnostics, "sourceQuality", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateOptionalField(value, diagnostics, "parseQualityLevel", "clean | usable | noisy", (input) => PARSE_QUALITY_LEVELS.has(String(input)), "invalid_field_value");
  validateOptionalField(value, diagnostics, "strictRouteEligible", "boolean", isBoolean);
  validateOptionalField(value, diagnostics, "strictAnswerEligible", "boolean", isBoolean);
  validateOptionalField(value, diagnostics, "artifactKind", "non-empty string", isNonEmptyString, "invalid_field_value");
  validateOptionalField(value, diagnostics, "evidenceTypes", "non-empty string[]", (input) =>
    Array.isArray(input) && input.every((item) => isNonEmptyString(item)), "invalid_field_value");
  validateOptionalField(value, diagnostics, "metadata", "record", isRecord);

  if (typeof value.payloadHash === "string") {
    const actualHash = computeQdrantPayloadV2Hash(value as QdrantPayloadV2HashInput);
    if (value.payloadHash !== actualHash) {
      diagnostics.push({
        field: "payloadHash",
        code: "payload_hash_mismatch",
        expected: actualHash,
        received: value.payloadHash,
      });
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}
