import { describe, expect, it } from "vitest";

import { buildChatRequestContext, summarizeChatRequestContext } from "./lib/chatRequestContext.js";

describe("buildChatRequestContext", () => {
  it("marks explicit selected sources from request body collection ids", () => {
    const context = buildChatRequestContext({
      body: {
        collectionIds: [" c1 ", "c2", "c1"],
        includePublic: false,
      },
      retrievalQuery: "KAP gelir tablosunu özetle",
      debugEnabled: true,
    });

    expect(context.sourceMode).toBe("explicit_selected");
    expect(context.requestedCollectionIds).toEqual(["c1", "c2"]);
    expect(summarizeChatRequestContext(context)).toMatchObject({
      sourceMode: "explicit_selected",
      requestedCollectionCount: 2,
      hasRetrievalQuery: true,
      debugEnabled: true,
    });
  });

  it("prioritizes source discovery and conversational signals over broad private fallback", () => {
    expect(buildChatRequestContext({
      retrievalQuery: "hangi kaynak bunu cevaplar?",
      sourceDiscoveryIntent: true,
    }).sourceMode).toBe("source_discovery");

    expect(buildChatRequestContext({
      retrievalQuery: "merhaba",
      conversationalIntent: { kind: "greeting", confidence: "high" },
    }).sourceMode).toBe("conversational");

    expect(buildChatRequestContext({
      retrievalQuery: "son raporu özetle",
      includePublic: false,
    }).sourceMode).toBe("backend_auto_private");
  });
});
