import { describe, expect, it } from "vitest";

import {
  advanceReindexCheckpoint,
  completeReindexCheckpoint,
  failReindexCheckpoint,
  startReindexCheckpoint,
} from "./reindexCheckpoint.js";

describe("reindex checkpoint lifecycle", () => {
  it("starts a typed V2 payload reindex operation with zeroed counters", () => {
    expect(startReindexCheckpoint({
      operationId: "operation-1",
      indexName: "knowledge",
      collectionId: "collection-1",
      targetKind: "chunk",
      startedAt: "2026-05-26T00:00:00.000Z",
      totalCount: 12,
    })).toMatchObject({
      version: 1,
      operationId: "operation-1",
      status: "running",
      payloadSchemaVersion: 2,
      processedCount: 0,
      indexedCount: 0,
      failedIds: [],
      totalCount: 12,
    });
  });

  it("accumulates resume progress and preserves unique failed ids", () => {
    const started = startReindexCheckpoint({
      operationId: "operation-1",
      indexName: "knowledge",
      targetKind: "chunk",
      startedAt: "2026-05-26T00:00:00.000Z",
    });
    const first = advanceReindexCheckpoint(started, {
      cursor: "chunk-2",
      processedCount: 2,
      indexedCount: 1,
      failedIds: ["chunk-2"],
      updatedAt: "2026-05-26T00:01:00.000Z",
    });
    const second = advanceReindexCheckpoint(first, {
      cursor: "chunk-4",
      processedCount: 2,
      indexedCount: 2,
      failedIds: ["chunk-2"],
      updatedAt: "2026-05-26T00:02:00.000Z",
    });

    expect(second).toMatchObject({
      cursor: "chunk-4",
      processedCount: 4,
      indexedCount: 3,
      failedCount: 1,
      failedIds: ["chunk-2"],
    });
  });

  it("records terminal completed and failed lifecycle states", () => {
    const started = startReindexCheckpoint({
      operationId: "operation-1",
      indexName: "knowledge",
      targetKind: "chunk",
      startedAt: "2026-05-26T00:00:00.000Z",
    });

    expect(completeReindexCheckpoint(started, "2026-05-26T00:03:00.000Z")).toMatchObject({
      status: "completed",
      completedAt: "2026-05-26T00:03:00.000Z",
    });
    expect(failReindexCheckpoint(started, "2026-05-26T00:03:00.000Z", new Error("provider failed"))).toMatchObject({
      status: "failed",
      lastError: "provider failed",
    });
  });
});
