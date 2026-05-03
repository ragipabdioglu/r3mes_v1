import { createHash } from "node:crypto";

import type { KnowledgeVisibility } from "@r3mes/shared-types";

import { getQdrantVectorSize } from "./qdrantEmbedding.js";

const DEFAULT_QDRANT_URL = "http://127.0.0.1:6333";
const DEFAULT_QDRANT_COLLECTION = "r3mes_knowledge";

export interface QdrantKnowledgePayload {
  ownerWallet: string;
  visibility: KnowledgeVisibility;
  collectionId: string;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  title: string;
  domain: string;
  domains: string[];
  subtopics: string[];
  profileSubtopics: string[];
  tags: string[];
  keywords: string[];
  entities: string[];
  topicPhrases: string[];
  answerableConcepts: string[];
  negativeHints: string[];
  documentType: string;
  audience: string;
  riskLevel: "low" | "medium" | "high";
  sourceQuality: "structured" | "inferred" | "thin";
  metadataConfidence: "low" | "medium" | "high";
  collectionProfileVersion: number;
  collectionProfileTextHash: string;
  collectionLastProfiledAt: string;
  collectionProfileText: string;
  profileSummary: string;
  content: string;
  createdAt: string;
}

export interface QdrantScoredPoint {
  id: string | number;
  score: number;
  payload: QdrantKnowledgePayload;
}

function getQdrantBaseUrl(): string {
  return (process.env.R3MES_QDRANT_URL ?? DEFAULT_QDRANT_URL).replace(/\/$/, "");
}

export function getQdrantCollectionName(): string {
  return process.env.R3MES_QDRANT_COLLECTION ?? DEFAULT_QDRANT_COLLECTION;
}

function qdrantPointId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function metadataProfile(value: unknown): Record<string, unknown> | null {
  const record = metadataRecord(value);
  return record?.profile && typeof record.profile === "object" ? record.profile as Record<string, unknown> : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function validRiskLevel(value: unknown): "low" | "medium" | "high" | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function validSourceQuality(value: unknown): "structured" | "inferred" | "thin" | null {
  return value === "structured" || value === "inferred" || value === "thin" ? value : null;
}

function validConfidence(value: unknown): "low" | "medium" | "high" | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function profileVersion(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function collectionProfilePayload(collectionProfile: Record<string, unknown> | null): Pick<
  QdrantKnowledgePayload,
  | "collectionProfileVersion"
  | "collectionProfileTextHash"
  | "collectionLastProfiledAt"
  | "collectionProfileText"
> {
  return {
    collectionProfileVersion: profileVersion(collectionProfile?.profileVersion),
    collectionProfileTextHash: firstString(collectionProfile?.profileTextHash) ?? "",
    collectionLastProfiledAt: firstString(collectionProfile?.lastProfiledAt) ?? "",
    collectionProfileText: firstString(collectionProfile?.profileText) ?? "",
  };
}

export function buildQdrantPayloadMetadata(opts: {
  collectionMetadata?: unknown;
  documentMetadata?: unknown;
  chunkMetadata?: unknown;
  fallbackDomain: string;
  fallbackSubtopics?: string[];
  fallbackTags?: string[];
}): Pick<
  QdrantKnowledgePayload,
  | "domain"
  | "domains"
  | "subtopics"
  | "profileSubtopics"
  | "tags"
  | "keywords"
  | "entities"
  | "topicPhrases"
  | "answerableConcepts"
  | "negativeHints"
  | "documentType"
  | "audience"
  | "riskLevel"
  | "sourceQuality"
  | "metadataConfidence"
  | "collectionProfileVersion"
  | "collectionProfileTextHash"
  | "collectionLastProfiledAt"
  | "collectionProfileText"
  | "profileSummary"
> {
  const collection = metadataRecord(opts.collectionMetadata);
  const document = metadataRecord(opts.documentMetadata);
  const chunk = metadataRecord(opts.chunkMetadata);
  const collectionProfile = metadataProfile(opts.collectionMetadata);
  const documentProfile = metadataProfile(opts.documentMetadata);
  const chunkProfile = metadataProfile(opts.chunkMetadata);
  const domains = uniqueStrings([
    ...stringArray(collectionProfile?.domains),
    ...stringArray(documentProfile?.domains),
    ...stringArray(chunkProfile?.domains),
    firstString(collection?.domain, document?.domain, chunk?.domain, opts.fallbackDomain) ?? opts.fallbackDomain,
  ]);
  const profileSubtopics = uniqueStrings([
    ...stringArray(collectionProfile?.subtopics),
    ...stringArray(documentProfile?.subtopics),
    ...stringArray(chunkProfile?.subtopics),
  ]);
  const subtopics = uniqueStrings([
    ...profileSubtopics,
    ...stringArray(collection?.subtopics),
    ...stringArray(document?.subtopics),
    ...stringArray(chunk?.subtopics),
    ...(opts.fallbackSubtopics ?? []),
  ]);
  const keywords = uniqueStrings([
    ...stringArray(collectionProfile?.keywords),
    ...stringArray(documentProfile?.keywords),
    ...stringArray(chunkProfile?.keywords),
    ...stringArray(collection?.keywords),
    ...stringArray(document?.keywords),
    ...stringArray(chunk?.keywords),
    ...(opts.fallbackTags ?? []),
  ]);

  return {
    domain: domains[0] ?? opts.fallbackDomain,
    domains,
    subtopics,
    profileSubtopics,
    tags: uniqueStrings([...keywords, ...(opts.fallbackTags ?? [])]),
    keywords,
    entities: uniqueStrings([
      ...stringArray(collectionProfile?.entities),
      ...stringArray(documentProfile?.entities),
      ...stringArray(chunkProfile?.entities),
      ...stringArray(collection?.entities),
      ...stringArray(document?.entities),
      ...stringArray(chunk?.entities),
    ]),
    topicPhrases: uniqueStrings([
      ...stringArray(documentProfile?.topicPhrases),
      ...stringArray(chunkProfile?.topicPhrases),
    ]),
    answerableConcepts: uniqueStrings([
      ...stringArray(documentProfile?.answerableConcepts),
      ...stringArray(chunkProfile?.answerableConcepts),
    ]),
    negativeHints: uniqueStrings([
      ...stringArray(documentProfile?.negativeHints),
      ...stringArray(chunkProfile?.negativeHints),
    ]),
    documentType: firstString(chunk?.documentType, document?.documentType, collection?.documentType) ?? "knowledge_note",
    audience: firstString(chunk?.audience, document?.audience, collection?.audience) ?? "general_user",
    riskLevel:
      validRiskLevel(chunk?.riskLevel) ??
      validRiskLevel(document?.riskLevel) ??
      validRiskLevel(collection?.riskLevel) ??
      validRiskLevel(chunkProfile?.riskLevel) ??
      validRiskLevel(documentProfile?.riskLevel) ??
      validRiskLevel(collectionProfile?.riskLevel) ??
      "low",
    sourceQuality:
      validSourceQuality(chunk?.sourceQuality) ??
      validSourceQuality(document?.sourceQuality) ??
      validSourceQuality(collection?.sourceQuality) ??
      validSourceQuality(chunkProfile?.sourceQuality) ??
      validSourceQuality(documentProfile?.sourceQuality) ??
      validSourceQuality(collectionProfile?.sourceQuality) ??
      "thin",
    metadataConfidence:
      validConfidence(chunkProfile?.confidence) ??
      validConfidence(documentProfile?.confidence) ??
      validConfidence(collectionProfile?.confidence) ??
      "low",
    ...collectionProfilePayload(collectionProfile),
    profileSummary: firstString(chunkProfile?.summary, documentProfile?.summary, collectionProfile?.summary, chunk?.summary, document?.summary, collection?.summary) ?? "",
  };
}

async function qdrantFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${getQdrantBaseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function isQdrantAvailable(): Promise<boolean> {
  try {
    const response = await qdrantFetch("/healthz", { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureQdrantKnowledgeCollection(): Promise<void> {
  const collection = encodeURIComponent(getQdrantCollectionName());
  const exists = await qdrantFetch(`/collections/${collection}`, { method: "GET" });
  if (!exists.ok) {
    const created = await qdrantFetch(`/collections/${collection}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: getQdrantVectorSize(),
          distance: "Cosine",
        },
      }),
    });
    if (!created.ok) {
      throw new Error(`Qdrant collection bootstrap failed: ${created.status} ${await created.text()}`);
    }
  }
  await ensureQdrantPayloadIndexes();
}

let payloadIndexesEnsured = false;

async function ensureQdrantPayloadIndexes(): Promise<void> {
  if (payloadIndexesEnsured) return;
  const collection = encodeURIComponent(getQdrantCollectionName());
  const fields: Array<{ field_name: string; field_schema: "keyword" | "integer" }> = [
    { field_name: "collectionId", field_schema: "keyword" },
    { field_name: "visibility", field_schema: "keyword" },
    { field_name: "ownerWallet", field_schema: "keyword" },
    { field_name: "domain", field_schema: "keyword" },
    { field_name: "domains", field_schema: "keyword" },
    { field_name: "subtopics", field_schema: "keyword" },
    { field_name: "profileSubtopics", field_schema: "keyword" },
    { field_name: "keywords", field_schema: "keyword" },
    { field_name: "sourceQuality", field_schema: "keyword" },
    { field_name: "metadataConfidence", field_schema: "keyword" },
    { field_name: "collectionProfileVersion", field_schema: "integer" },
    { field_name: "collectionProfileTextHash", field_schema: "keyword" },
  ];
  for (const { field_name, field_schema } of fields) {
    const response = await qdrantFetch(`/collections/${collection}/index?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ field_name, field_schema }),
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`Qdrant payload index failed for ${field_name}: ${response.status} ${await response.text()}`);
    }
  }
  payloadIndexesEnsured = true;
}

export async function upsertQdrantKnowledgePoints(
  points: Array<{ chunkId: string; vector: number[]; payload: QdrantKnowledgePayload }>,
): Promise<void> {
  if (points.length === 0) return;
  await ensureQdrantKnowledgeCollection();
  const collection = encodeURIComponent(getQdrantCollectionName());
  const response = await qdrantFetch(`/collections/${collection}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: points.map((point) => ({
        id: qdrantPointId(point.chunkId),
        vector: point.vector,
        payload: point.payload,
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`Qdrant upsert failed: ${response.status} ${await response.text()}`);
  }
}

export async function setQdrantCollectionProfileMetadata(
  collectionId: string,
  collectionMetadata?: unknown,
): Promise<void> {
  if (!(await isQdrantAvailable())) return;
  await ensureQdrantKnowledgeCollection();
  const profilePayload = collectionProfilePayload(metadataProfile(collectionMetadata));
  const collection = encodeURIComponent(getQdrantCollectionName());
  const response = await qdrantFetch(`/collections/${collection}/points/payload?wait=true`, {
    method: "POST",
    body: JSON.stringify({
      payload: profilePayload,
      filter: {
        must: [{ key: "collectionId", match: { value: collectionId } }],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Qdrant collection profile metadata update failed: ${response.status} ${await response.text()}`);
  }
}

export async function setQdrantCollectionVisibility(
  collectionId: string,
  visibility: KnowledgeVisibility,
): Promise<void> {
  if (!(await isQdrantAvailable())) return;
  await ensureQdrantKnowledgeCollection();
  const collection = encodeURIComponent(getQdrantCollectionName());
  const response = await qdrantFetch(`/collections/${collection}/points/payload?wait=true`, {
    method: "POST",
    body: JSON.stringify({
      payload: { visibility },
      filter: {
        must: [{ key: "collectionId", match: { value: collectionId } }],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Qdrant visibility update failed: ${response.status} ${await response.text()}`);
  }
}

export async function searchQdrantKnowledge(opts: {
  vector: number[];
  accessibleCollectionIds: string[];
  limit: number;
}): Promise<QdrantScoredPoint[]> {
  await ensureQdrantKnowledgeCollection();
  const collection = encodeURIComponent(getQdrantCollectionName());
  const response = await qdrantFetch(`/collections/${collection}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector: opts.vector,
      limit: opts.limit,
      with_payload: true,
      filter: {
        must: [
          {
            key: "collectionId",
            match: { any: opts.accessibleCollectionIds },
          },
        ],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Qdrant search failed: ${response.status} ${await response.text()}`);
  }
  const parsed = (await response.json()) as { result?: Array<{ id: string | number; score: number; payload?: unknown }> };
  return (parsed.result ?? [])
    .filter((point): point is { id: string | number; score: number; payload: QdrantKnowledgePayload } =>
      Boolean(point.payload && typeof point.payload === "object"),
    )
    .map((point) => ({ id: point.id, score: point.score, payload: point.payload }));
}
