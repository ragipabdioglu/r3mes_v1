import { describe, expect, it } from "vitest";

import { buildEvalDebugContract, EVAL_DEBUG_CONTRACT_VERSION } from "./evalDebugContract.js";

describe("buildEvalDebugContract", () => {
  it("builds a stable additive debug contract", () => {
    const contract = buildEvalDebugContract({
      answerQualityFindings: [
        {
          bucket: "raw_table_dump",
          severity: "fail",
          message: "answer looks like a raw table row dump",
        },
      ],
      evidenceSignals: {
        legacyUsableFactCount: 1,
        usableEvidenceBundleItemCount: 2,
      },
      evidenceBundleDiagnostics: {
        stringFactCount: 1,
        structuredFactCount: 1,
        tableFactCount: 0,
        contradictionCount: 0,
        sourceLimitCount: 0,
      },
      sourceSelection: { selectionMode: "selected" },
      runtimeLineage: {
        version: 1,
        profileName: "eval",
        answerPath: "rag_fast_path",
        stream: false,
        qwen: {
          called: false,
          validatorCalled: false,
          callCount: 0,
        },
        composer: {
          deterministicUsed: true,
        },
        retrieval: {
          mode: "true_hybrid",
          qdrantUsed: true,
        },
        embedding: {
          fallbackUsed: false,
        },
        reranker: {
          fallbackUsed: false,
        },
        safety: {
          blockedReasonCount: 0,
        },
      },
    });

    expect(contract.version).toBe(EVAL_DEBUG_CONTRACT_VERSION);
    expect(contract.answerQuality?.passed).toBe(false);
    expect(contract.answerQuality?.findings).toHaveLength(1);
    expect(contract.evidenceSignals).toEqual({
      legacyUsableFactCount: 1,
      usableEvidenceBundleItemCount: 2,
    });
    expect(contract.evidenceBundleDiagnostics?.structuredFactCount).toBe(1);
    expect(contract.sourceSelection).toEqual({ selectionMode: "selected" });
    expect(contract.runtimeLineage).toMatchObject({
      answerPath: "rag_fast_path",
      qwen: { called: false },
      embedding: { fallbackUsed: false },
    });
  });
});
