import { describe, expect, it } from "vitest";
import { isQaResultWebhookPath } from "./lib/qaHmac.js";

describe("isQaResultWebhookPath", () => {
  it("accepts exact path", () => {
    expect(isQaResultWebhookPath("/v1/internal/qa-result")).toBe(true);
  });
  it("accepts trailing slash (403 Ham gövde eksik önleme)", () => {
    expect(isQaResultWebhookPath("/v1/internal/qa-result/")).toBe(true);
  });
  it("accepts path with query", () => {
    expect(isQaResultWebhookPath("/v1/internal/qa-result?x=1")).toBe(true);
  });
  it("rejects other paths", () => {
    expect(isQaResultWebhookPath("/v1/internal/other")).toBe(false);
  });
});
