import { describe, expect, it } from "vitest";

import { chatDebugResponseKeys, stripChatDebugFields } from "./chatResponseBoundary.js";

describe("chat response boundary", () => {
  it("strips internal debug fields from public payloads", () => {
    const payload = {
      id: "chatcmpl_test",
      choices: [],
      sources: [],
      grounded_answer: { hidden: true },
      safety_gate: { hidden: true },
      answer_quality: { hidden: true },
      retrieval_debug: { hidden: true },
      chat_trace: { hidden: true },
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
      "grounded_answer",
      "safety_gate",
      "answer_quality",
      "retrieval_debug",
      "chat_trace",
    ]);
  });
});
