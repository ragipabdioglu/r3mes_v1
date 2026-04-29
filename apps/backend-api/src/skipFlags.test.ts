import { afterEach, describe, expect, it, vi } from "vitest";

describe("assertNoInsecureSkipFlagsInProduction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not throw when NODE_ENV is not production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "1");
    const { assertNoInsecureSkipFlagsInProduction } = await import("./app.js");
    expect(() => assertNoInsecureSkipFlagsInProduction()).not.toThrow();
  });

  it("throws when production and R3MES_SKIP_WALLET_AUTH=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "1");
    vi.stubEnv("R3MES_SKIP_CHAT_FEE", "0");
    const { assertNoInsecureSkipFlagsInProduction } = await import("./app.js");
    expect(() => assertNoInsecureSkipFlagsInProduction()).toThrow(/R3MES_SKIP_WALLET_AUTH/);
  });

  it("throws when production and R3MES_SKIP_CHAT_FEE=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "0");
    vi.stubEnv("R3MES_SKIP_CHAT_FEE", "1");
    const { assertNoInsecureSkipFlagsInProduction } = await import("./app.js");
    expect(() => assertNoInsecureSkipFlagsInProduction()).toThrow(/R3MES_SKIP_CHAT_FEE/);
  });

  it("throws when production and R3MES_DEV_BYPASS_QA=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("R3MES_SKIP_WALLET_AUTH", "0");
    vi.stubEnv("R3MES_SKIP_CHAT_FEE", "0");
    vi.stubEnv("R3MES_DEV_BYPASS_QA", "1");
    const { assertNoInsecureSkipFlagsInProduction } = await import("./app.js");
    expect(() => assertNoInsecureSkipFlagsInProduction()).toThrow(/R3MES_DEV_BYPASS_QA/);
  });
});
