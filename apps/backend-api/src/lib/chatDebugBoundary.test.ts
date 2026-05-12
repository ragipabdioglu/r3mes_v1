import { describe, expect, it } from "vitest";

import { shouldExposeChatDebugFromHeaders } from "./chatDebugBoundary.js";

describe("chat debug boundary", () => {
  it("keeps public responses clean when debug is not requested", () => {
    expect(shouldExposeChatDebugFromHeaders({}, { NODE_ENV: "development" })).toBe(false);
  });

  it("allows debug header outside production by default", () => {
    expect(
      shouldExposeChatDebugFromHeaders(
        { "x-r3mes-debug": "1" },
        { NODE_ENV: "development" },
      ),
    ).toBe(true);
  });

  it("blocks debug header in production unless explicitly allowed", () => {
    expect(
      shouldExposeChatDebugFromHeaders(
        { "x-r3mes-debug": "1" },
        { NODE_ENV: "production" },
      ),
    ).toBe(false);
  });

  it("supports explicit production debug override for admin/dev deployments", () => {
    expect(
      shouldExposeChatDebugFromHeaders(
        { "x-r3mes-debug": "1" },
        { NODE_ENV: "production", R3MES_ALLOW_CHAT_DEBUG_HEADER: "1" },
      ),
    ).toBe(true);
  });

  it("supports global debug exposure for controlled environments", () => {
    expect(
      shouldExposeChatDebugFromHeaders(
        {},
        { NODE_ENV: "production", R3MES_EXPOSE_CHAT_DEBUG: "1" },
      ),
    ).toBe(true);
  });
});
