import { describe, expect, it } from "vitest";

import { chatDebugResponseKeys, stripChatDebugFields } from "./chatResponseBoundary.js";

describe("chat response boundary", () => {
  it("strips internal debug fields from public payloads", () => {
    const payload = {
      id: "chatcmpl_test",
      choices: [],
      sources: [],
      debug_contract_version: "test",
      debugContractVersion: "test",
      eval_debug_contract: { hidden: true },
      evalDebugContract: { hidden: true },
      grounded_answer: { hidden: true },
      answer_plan: { hidden: true },
      answerPlan: { hidden: true },
      safety_gate: { hidden: true },
      safetyGate: { hidden: true },
      answer_quality: { hidden: true },
      answerQuality: { hidden: true },
      answer_baseline: { hidden: true },
      answerBaseline: { hidden: true },
      evidenceSignals: { hidden: true },
      retrieval_debug: { hidden: true },
      retrievalDebug: { hidden: true },
      chat_trace: { hidden: true },
      chatTrace: { hidden: true },
      runtime_lineage: { hidden: true },
      runtimeLineage: { hidden: true },
    };

    const stripped = stripChatDebugFields(payload);

    expect(stripped).toEqual({
      id: "chatcmpl_test",
      choices: [],
      sources: [],
    });
  });

  it("tracks every internal debug key in one place", () => {
    expect(chatDebugResponseKeys()).toEqual([
      "debug_contract_version",
      "debugContractVersion",
      "eval_debug_contract",
      "evalDebugContract",
      "grounded_answer",
      "answer_plan",
      "answerPlan",
      "safety_gate",
      "safetyGate",
      "answer_quality",
      "answerQuality",
      "answer_baseline",
      "answerBaseline",
      "evidenceSignals",
      "retrieval_debug",
      "retrievalDebug",
      "chat_trace",
      "chatTrace",
      "runtime_lineage",
      "runtimeLineage",
    ]);
  });
});
