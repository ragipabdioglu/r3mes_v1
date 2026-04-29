import { describe, expect, it } from "vitest";
import {
  assertAuthTimingValid,
  getMessageStringForParsing,
  getSignedMessageBytes,
  parseAuthTiming,
  parseOptionalJti,
} from "./lib/walletAuth.js";

describe("walletAuth helpers", () => {
  it("parses exp/iat from JSON message", () => {
    const t = parseAuthTiming('{"exp":2000000000,"iat":1999999900}');
    expect(t).toEqual({ expSec: 2000000000, iatSec: 1999999900 });
  });

  it("normalizes exp in milliseconds", () => {
    const t = parseAuthTiming(`{"exp":${2000000000 * 1000}}`);
    expect(t?.expSec).toBe(2000000000);
  });

  it("rejects expired exp", () => {
    const now = Date.parse("2020-01-01T00:00:00.000Z");
    const r = assertAuthTimingValid({ expSec: 100, iatSec: null }, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("accepts valid exp window", () => {
    const nowMs = Date.parse("2025-06-01T12:00:00.000Z");
    const expSec = Math.floor(nowMs / 1000) + 60;
    const r = assertAuthTimingValid({ expSec, iatSec: Math.floor(nowMs / 1000) - 30 }, nowMs);
    expect(r.ok).toBe(true);
  });

  it("getSignedMessageBytes matches UTF-8", () => {
    const s = '{"exp":9999999999}';
    expect(Buffer.from(getSignedMessageBytes(s)).toString("utf8")).toBe(s);
  });

  it("base64: prefix decodes for parsing", () => {
    const inner = '{"exp":9}';
    const raw = `base64:${Buffer.from(inner, "utf8").toString("base64")}`;
    expect(getMessageStringForParsing(raw)).toBe(inner);
  });

  it("parseOptionalJti reads jti from JSON", () => {
    expect(parseOptionalJti('{"exp":9,"jti":"abc12345"}')).toBe("abc12345");
    expect(parseOptionalJti('{"exp":9}')).toBeNull();
  });
});
