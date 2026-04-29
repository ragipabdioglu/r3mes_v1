import { afterEach, describe, expect, it, vi } from "vitest";

describe("isDevQaBypassEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false when flag off", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("R3MES_DEV_BYPASS_QA", "0");
    const { isDevQaBypassEnabled } = await import("./lib/devQaBypass.js");
    expect(isDevQaBypassEnabled()).toBe(false);
  });

  it("is true when development and R3MES_DEV_BYPASS_QA=1", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("R3MES_DEV_BYPASS_QA", "1");
    const { isDevQaBypassEnabled } = await import("./lib/devQaBypass.js");
    expect(isDevQaBypassEnabled()).toBe(true);
  });

  it("is false in production even if flag is 1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("R3MES_DEV_BYPASS_QA", "1");
    const { isDevQaBypassEnabled } = await import("./lib/devQaBypass.js");
    expect(isDevQaBypassEnabled()).toBe(false);
  });

  it("is false for staging-like NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("R3MES_DEV_BYPASS_QA", "1");
    const { isDevQaBypassEnabled } = await import("./lib/devQaBypass.js");
    expect(isDevQaBypassEnabled()).toBe(false);
  });
});
