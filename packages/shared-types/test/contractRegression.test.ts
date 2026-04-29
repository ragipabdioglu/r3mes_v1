import { describe, expect, it } from "vitest";

import {
  assertAdapterCidEqualsWeightsCid,
  assertBenchmarkScoreSemantic,
  ContractInvariantError,
} from "../src/contractGuards.js";
import {
  AdapterListResponseSchema,
  BenchmarkQueueJobMessageSchema,
  LoRAUploadAcceptedResponseSchema,
  NotImplementedOnChainRestResponseSchema,
  parseAdapterListResponse,
  parseNotImplementedOnChainRestResponse,
  QaResultWebhookPayloadSchema,
} from "../src/schemas.js";

describe("Faz 2 contract regression (Zod)", () => {
  it("rejects adapter list when status is not AdapterStatusWire", () => {
    const bad = {
      data: [
        {
          id: "ckx",
          name: "x",
          status: "UNKNOWN",
          kind: "LORA",
          onChainAdapterId: null,
          onChainObjectId: null,
          ipfsCid: "bafy",
          benchmarkScore: null,
          domainTags: [],
          ownerWallet: "0x1",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    expect(() => parseAdapterListResponse(bad)).toThrow();
  });

  it("accepts valid AdapterListResponse", () => {
    const ok = parseAdapterListResponse({
      data: [
        {
          id: "ckx",
          name: "x",
          status: "ACTIVE",
          kind: "LORA",
          onChainAdapterId: null,
          onChainObjectId: null,
          ipfsCid: "bafy",
          benchmarkScore: 88.5,
          domainTags: [],
          ownerWallet:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(ok.data[0]?.benchmarkScore).toBe(88.5);
  });

  it("benchmarkScore out of range fails schema", () => {
    const row = {
      id: "ckx",
      name: "x",
      status: "ACTIVE",
      kind: "LORA",
      onChainAdapterId: null,
      onChainObjectId: null,
      ipfsCid: "bafy",
      benchmarkScore: 101,
      domainTags: [],
      ownerWallet: "0x1",
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    expect(() => AdapterListResponseSchema.parse({ data: [row], nextCursor: null })).toThrow();
  });

  it("QA webhook parses approved payload", () => {
    const p = QaResultWebhookPayloadSchema.parse({
      jobId: "j1",
      adapterCid: "bafy",
      status: "approved",
      score: 90,
    });
    expect(p.jobId).toBe("j1");
  });

  it("queue message enforces adapterCid + ipfsCid shape", () => {
    const m = BenchmarkQueueJobMessageSchema.parse({
      adapterDbId: "adb",
      onChainAdapterId: "0",
      ipfsCid: "bafyWEIGHTS",
      ownerWallet: "0x2",
      jobId: "job",
      adapterCid: "bafyWEIGHTS",
    });
    expect(m.adapterCid).toBe(m.ipfsCid);
  });

  it("LoRA upload response requires adapterId === adapterDbId pair", () => {
    const r = LoRAUploadAcceptedResponseSchema.parse({
      adapterId: "same",
      adapterDbId: "same",
      weightsCid: "w",
      manifestCid: null,
      benchmarkJobId: "bj",
      status: "PENDING_REVIEW",
    });
    expect(r.adapterId).toBe(r.adapterDbId);
  });

  it("LoRA upload response allows optional devQaBypassApplied", () => {
    const r = LoRAUploadAcceptedResponseSchema.parse({
      adapterId: "a",
      adapterDbId: "a",
      weightsCid: "w",
      manifestCid: null,
      benchmarkJobId: "dev-bypass-qa",
      status: "ACTIVE",
      devQaBypassApplied: true,
    });
    expect(r.devQaBypassApplied).toBe(true);
  });

  it("501 NotImplemented stake surface parses", () => {
    const b = parseNotImplementedOnChainRestResponse({
      success: false,
      code: "NOT_IMPLEMENTED",
      message: "x",
      surface: "POST /v1/stake",
    });
    expect(b.surface).toBe("POST /v1/stake");
  });

  it("501 NotImplemented rewards claim surface parses", () => {
    const b = parseNotImplementedOnChainRestResponse({
      success: false,
      code: "NOT_IMPLEMENTED",
      message: "y",
      surface: "POST /v1/user/:wallet/rewards/claim",
    });
    expect(b.surface).toBe("POST /v1/user/:wallet/rewards/claim");
  });

  it("501 NotImplemented rejects wrong surface literal", () => {
    expect(() =>
      NotImplementedOnChainRestResponseSchema.parse({
        success: false,
        code: "NOT_IMPLEMENTED",
        message: "x",
        surface: "POST /v1/other",
      }),
    ).toThrow();
  });
});

describe("contractGuards", () => {
  it("assertAdapterCidEqualsWeightsCid throws on mismatch", () => {
    expect(() => assertAdapterCidEqualsWeightsCid("a", "b")).toThrow(ContractInvariantError);
  });

  it("assertBenchmarkScoreSemantic throws above 100", () => {
    expect(() => assertBenchmarkScoreSemantic(101)).toThrow(ContractInvariantError);
  });
});
